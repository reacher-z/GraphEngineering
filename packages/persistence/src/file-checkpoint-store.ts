import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import type {
  CheckpointBody,
  CheckpointInput,
  CheckpointStore,
  CheckpointSummary,
  StoredCheckpoint,
} from "./checkpoints.js";
import { CHECKPOINT_API_VERSION } from "./checkpoints.js";
import {
  CorruptCheckpointError,
  PersistenceError,
  PersistenceIoError,
  PersistenceValidationError,
  type ValidationIssue,
} from "./errors.js";
import { assertSafeIdentifier, identifierHash } from "./identifiers.js";
import { decodeUtf8, isErrno, syncDirectory } from "./io.js";
import { isStrictRfc3339 } from "./datetime.js";
import { canonicalJson, cloneJson, compareUnicodeCodePoints, contentHash, jsonValidationIssues } from "./json.js";
import { SerialQueue } from "./serial-queue.js";

export interface FileCheckpointStoreOptions {
  directory: string;
  now?: () => Date;
}

const CHECKPOINT_KEYS = new Set([
  "apiVersion",
  "runId",
  "checkpointId",
  "sequence",
  "createdAt",
  "state",
  "contentHash",
]);
const CHECKPOINT_INPUT_KEYS = new Set(["runId", "checkpointId", "sequence", "createdAt", "state"]);
const SHA256 = /^[a-f0-9]{64}$/;
const PROCESS_CHECKPOINT_QUEUE = new SerialQueue();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bodyOf(checkpoint: StoredCheckpoint): CheckpointBody {
  return {
    apiVersion: checkpoint.apiVersion,
    runId: checkpoint.runId,
    checkpointId: checkpoint.checkpointId,
    sequence: checkpoint.sequence,
    createdAt: checkpoint.createdAt,
    state: checkpoint.state,
  };
}

function validateCheckpointInput(checkpoint: unknown): asserts checkpoint is CheckpointInput {
  if (!isRecord(checkpoint)) {
    throw new PersistenceValidationError("Checkpoint input is invalid", [
      { path: "#", message: "expected a checkpoint object" },
    ]);
  }
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(checkpoint)) {
    if (!CHECKPOINT_INPUT_KEYS.has(key)) {
      issues.push({ path: `#/${key}`, message: "unknown property" });
    }
  }
  if (typeof checkpoint.runId !== "string") {
    issues.push({ path: "#/runId", message: "expected a string" });
  }
  if (typeof checkpoint.checkpointId !== "string") {
    issues.push({ path: "#/checkpointId", message: "expected a string" });
  }
  if (!Number.isSafeInteger(checkpoint.sequence) || (checkpoint.sequence as number) < 0) {
    issues.push({ path: "#/sequence", message: "expected a safe integer >= 0" });
  }
  if (
    checkpoint.createdAt !== undefined &&
    !isStrictRfc3339(checkpoint.createdAt)
  ) {
    issues.push({ path: "#/createdAt", message: "expected an RFC 3339 date-time" });
  }
  issues.push(...jsonValidationIssues(checkpoint.state, "#/state", { safeIntegersOnly: true }));
  if (issues.length > 0) throw new PersistenceValidationError("Checkpoint input is invalid", issues);
  assertSafeIdentifier(checkpoint.runId, "runId");
  assertSafeIdentifier(checkpoint.checkpointId, "checkpointId");
}

function checkpointSummary(checkpoint: StoredCheckpoint): CheckpointSummary {
  const { apiVersion, runId, checkpointId, sequence, createdAt, contentHash: hash } = checkpoint;
  return { apiVersion, runId, checkpointId, sequence, createdAt, contentHash: hash };
}

export class FileCheckpointStore implements CheckpointStore {
  readonly #rootDirectory: string;
  readonly #now: () => Date;

  constructor(options: FileCheckpointStoreOptions) {
    if (
      typeof options !== "object" ||
      options === null ||
      typeof options.directory !== "string" ||
      options.directory.length === 0
    ) {
      throw new PersistenceValidationError("FileCheckpointStore directory is invalid", [
        { path: "#/directory", message: "expected a non-empty string" },
      ]);
    }
    this.#rootDirectory = join(resolve(options.directory), "checkpoints");
    this.#now = options.now ?? (() => new Date());
  }

  #runDirectory(runId: string): string {
    assertSafeIdentifier(runId, "runId");
    return join(this.#rootDirectory, identifierHash(runId));
  }

  #path(runId: string, checkpointId: string): string {
    return this.pathForCheckpoint(runId, checkpointId);
  }

  /** Opaque resolved path for diagnostics; identifiers are represented only by hashes. */
  pathForCheckpoint(runId: string, checkpointId: string): string {
    assertSafeIdentifier(checkpointId, "checkpointId");
    return join(this.#runDirectory(runId), `${identifierHash(checkpointId)}.checkpoint.json`);
  }

  #parse(
    bytes: Uint8Array,
    expectedRunId: string,
    expectedCheckpointId: string | undefined,
    sourceName: string,
  ): StoredCheckpoint {
    let text: string;
    try {
      text = decodeUtf8(bytes);
    } catch {
      throw new CorruptCheckpointError(expectedRunId, expectedCheckpointId ?? sourceName, "invalid UTF-8");
    }
    if (!text.endsWith("\n")) {
      throw new CorruptCheckpointError(expectedRunId, expectedCheckpointId ?? sourceName, "truncated record");
    }

    let value: unknown;
    try {
      value = JSON.parse(text.slice(0, -1));
    } catch {
      throw new CorruptCheckpointError(expectedRunId, expectedCheckpointId ?? sourceName, "record is not JSON");
    }
    if (!isRecord(value)) {
      throw new CorruptCheckpointError(expectedRunId, expectedCheckpointId ?? sourceName, "expected an object");
    }
    const checkpointId = typeof value.checkpointId === "string" ? value.checkpointId : (expectedCheckpointId ?? sourceName);
    const invalidKey = Object.keys(value).find((key) => !CHECKPOINT_KEYS.has(key));
    if (invalidKey !== undefined || [...CHECKPOINT_KEYS].some((key) => !Object.hasOwn(value, key))) {
      throw new CorruptCheckpointError(expectedRunId, checkpointId, "invalid checkpoint envelope fields");
    }
    if (
      value.apiVersion !== CHECKPOINT_API_VERSION ||
      typeof value.runId !== "string" ||
      typeof value.checkpointId !== "string" ||
      !Number.isSafeInteger(value.sequence) ||
      (value.sequence as number) < 0 ||
      typeof value.createdAt !== "string" ||
      !isStrictRfc3339(value.createdAt) ||
      typeof value.contentHash !== "string" ||
      !SHA256.test(value.contentHash)
    ) {
      throw new CorruptCheckpointError(expectedRunId, checkpointId, "checkpoint envelope does not match v1alpha1");
    }
    try {
      assertSafeIdentifier(value.runId, "runId");
      assertSafeIdentifier(value.checkpointId, "checkpointId");
    } catch {
      throw new CorruptCheckpointError(expectedRunId, checkpointId, "checkpoint contains unsafe identifiers");
    }
    if (value.runId !== expectedRunId) {
      throw new CorruptCheckpointError(expectedRunId, checkpointId, "runId does not match checkpoint directory");
    }
    if (expectedCheckpointId !== undefined && value.checkpointId !== expectedCheckpointId) {
      throw new CorruptCheckpointError(expectedRunId, expectedCheckpointId, "checkpointId does not match file");
    }
    if (`${identifierHash(value.checkpointId)}.checkpoint.json` !== sourceName) {
      throw new CorruptCheckpointError(expectedRunId, checkpointId, "checkpoint filename does not match checkpointId");
    }
    const stateIssues = jsonValidationIssues(value.state, "#/state", { safeIntegersOnly: true });
    if (stateIssues.length > 0) {
      throw new CorruptCheckpointError(expectedRunId, checkpointId, stateIssues[0]?.message ?? "state is invalid");
    }

    const checkpoint = value as unknown as StoredCheckpoint;
    if (contentHash(bodyOf(checkpoint)) !== checkpoint.contentHash) {
      throw new CorruptCheckpointError(expectedRunId, checkpointId, "content hash mismatch");
    }
    return checkpoint;
  }

  async #loadPath(
    path: string,
    runId: string,
    checkpointId: string | undefined,
    sourceName: string,
  ): Promise<StoredCheckpoint | null> {
    try {
      return this.#parse(await readFile(path), runId, checkpointId, sourceName);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return null;
      if (error instanceof PersistenceError) throw error;
      throw new PersistenceIoError("read checkpoint", path, error);
    }
  }

  async save(input: CheckpointInput): Promise<StoredCheckpoint> {
    validateCheckpointInput(input);
    const snapshot: CheckpointInput = {
      runId: input.runId,
      checkpointId: input.checkpointId,
      sequence: input.sequence,
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
      state: cloneJson(input.state),
    };
    const directory = this.#runDirectory(snapshot.runId);
    return PROCESS_CHECKPOINT_QUEUE.run(directory, async () => {
      const path = this.#path(snapshot.runId, snapshot.checkpointId);
      let temporary: string | undefined;

      try {
        const createdAt = snapshot.createdAt ?? this.#now().toISOString();
        const body: CheckpointBody = {
          apiVersion: CHECKPOINT_API_VERSION,
          runId: snapshot.runId,
          checkpointId: snapshot.checkpointId,
          sequence: snapshot.sequence,
          createdAt,
          state: snapshot.state,
        };
        const checkpoint: StoredCheckpoint = { ...body, contentHash: contentHash(body) };
        temporary = join(
          directory,
          `.${identifierHash(snapshot.checkpointId)}.${process.pid}.${randomUUID()}.tmp`,
        );
        await mkdir(directory, { recursive: true });
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(`${canonicalJson(checkpoint)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, path);
        await syncDirectory(directory);
        return cloneJson(checkpoint);
      } catch (error) {
        if (temporary !== undefined) await unlink(temporary).catch(() => undefined);
        if (error instanceof PersistenceError) throw error;
        throw new PersistenceIoError("save checkpoint", path, error);
      }
    });
  }

  async load(runId: string, checkpointId: string): Promise<StoredCheckpoint | null> {
    assertSafeIdentifier(runId, "runId");
    assertSafeIdentifier(checkpointId, "checkpointId");
    const directory = this.#runDirectory(runId);
    return PROCESS_CHECKPOINT_QUEUE.run(directory, async () => {
      const path = this.#path(runId, checkpointId);
      const loaded = await this.#loadPath(path, runId, checkpointId, `${identifierHash(checkpointId)}.checkpoint.json`);
      return loaded === null ? null : cloneJson(loaded);
    });
  }

  async list(runId: string): Promise<readonly CheckpointSummary[]> {
    assertSafeIdentifier(runId, "runId");
    const directory = this.#runDirectory(runId);
    return PROCESS_CHECKPOINT_QUEUE.run(directory, async () => {
      let names: string[];
      try {
        names = (await readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith(".checkpoint.json"))
          .map((entry) => entry.name);
      } catch (error) {
        if (isErrno(error, "ENOENT")) return [];
        throw new PersistenceIoError("list checkpoints", directory, error);
      }

      const checkpoints: StoredCheckpoint[] = [];
      for (const name of names.sort(compareUnicodeCodePoints)) {
        const loaded = await this.#loadPath(join(directory, name), runId, undefined, name);
        if (loaded !== null) checkpoints.push(loaded);
      }
      return checkpoints
        .sort(
          (left, right) =>
            left.sequence - right.sequence || compareUnicodeCodePoints(left.checkpointId, right.checkpointId),
        )
        .map(checkpointSummary);
    });
  }
}
