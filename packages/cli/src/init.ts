import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rmdir,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { compileGraph } from "@graph-engineering/core";

const TEMPLATE_NAME = "quickstart/research-diamond.graph.json";
const TEMPLATE_URL = new URL(
  "../../assets/templates/quickstart/research-diamond.graph.json",
  import.meta.url,
);
const OUTPUT_FILE = "graph.json";

export interface InitReport {
  targetDirectory: string;
  dryRun: boolean;
  created: boolean;
  directoryCreated: boolean;
  wouldCreateDirectory: boolean;
  files: readonly string[];
  template: typeof TEMPLATE_NAME;
  graphHash: string;
}

export class InitError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InitError";
    this.code = code;
  }
}

interface Template {
  source: string;
  graphHash: string;
}

interface TargetInspection {
  exists: boolean;
}

interface OwnedDirectory {
  path: string;
  identity: Stats;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function loadTemplate(): Promise<Template> {
  const source = await readFile(TEMPLATE_URL, "utf8");
  let document: unknown;
  try {
    document = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`bundled init template is not JSON: ${errorMessage(error)}`);
  }
  const compilation = compileGraph(document);
  if (!compilation.valid || compilation.graphHash === null) {
    const codes = compilation.diagnostics.map((item) => item.code).join(", ") || "unknown";
    throw new Error(`bundled init template violates the Graph IR contract: ${codes}`);
  }
  return { source, graphHash: compilation.graphHash };
}

async function assertExistingAncestorIsDirectory(target: string): Promise<void> {
  let candidate = dirname(target);
  while (true) {
    try {
      const candidateLstat = await lstat(candidate);
      if (candidateLstat.isSymbolicLink()) {
        const followed = await stat(candidate);
        if (!followed.isDirectory()) {
          throw new InitError(
            "GECLI_INIT_PARENT_NOT_DIRECTORY",
            `cannot create ${target}: parent path is not a directory`,
          );
        }
      } else if (!candidateLstat.isDirectory()) {
        throw new InitError(
          "GECLI_INIT_PARENT_NOT_DIRECTORY",
          `cannot create ${target}: parent path is not a directory`,
        );
      }
      return;
    } catch (error) {
      if (error instanceof InitError) throw error;
      if (errorCode(error) !== "ENOENT") {
        throw new InitError(
          "GECLI_INIT_TARGET_ACCESS",
          `cannot inspect parent of ${target}: ${errorMessage(error)}`,
        );
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new InitError(
          "GECLI_INIT_TARGET_ACCESS",
          `cannot find a directory ancestor for ${target}`,
        );
      }
      candidate = parent;
    }
  }
}

async function inspectTarget(target: string): Promise<TargetInspection> {
  let before: Stats;
  try {
    before = await lstat(target);
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      await assertExistingAncestorIsDirectory(target);
      return { exists: false };
    }
    throw new InitError(
      "GECLI_INIT_TARGET_ACCESS",
      `cannot inspect init target ${target}: ${errorMessage(error)}`,
    );
  }

  if (before.isSymbolicLink()) {
    throw new InitError(
      "GECLI_INIT_TARGET_SYMLINK",
      `refusing symlink init target ${target}`,
    );
  }
  if (!before.isDirectory()) {
    throw new InitError(
      "GECLI_INIT_TARGET_NOT_DIRECTORY",
      `refusing existing non-directory init target ${target}`,
    );
  }

  let entries: string[];
  let after: Stats;
  try {
    entries = await readdir(target);
    after = await lstat(target);
  } catch (error) {
    throw new InitError(
      "GECLI_INIT_TARGET_ACCESS",
      `cannot inspect init target ${target}: ${errorMessage(error)}`,
    );
  }
  if (after.isSymbolicLink() || !after.isDirectory() || !sameIdentity(before, after)) {
    throw new InitError(
      "GECLI_INIT_TARGET_CHANGED",
      `init target changed while it was being inspected: ${target}`,
    );
  }
  if (entries.length > 0) {
    throw new InitError(
      "GECLI_INIT_TARGET_NOT_EMPTY",
      `refusing non-empty init target ${target}`,
    );
  }
  return { exists: true };
}

async function createTargetDirectories(target: string): Promise<OwnedDirectory[]> {
  const missing: string[] = [];
  let candidate = target;
  while (true) {
    try {
      const candidateState = await lstat(candidate);
      if (candidateState.isSymbolicLink()) {
        if (candidate === target) {
          throw new InitError("GECLI_INIT_TARGET_SYMLINK", `refusing symlink init target ${target}`);
        }
        const followed = await stat(candidate);
        if (!followed.isDirectory()) {
          throw new InitError(
            "GECLI_INIT_PARENT_NOT_DIRECTORY",
            `cannot create ${target}: parent path is not a directory`,
          );
        }
      } else if (!candidateState.isDirectory()) {
        throw new InitError(
          "GECLI_INIT_PARENT_NOT_DIRECTORY",
          `cannot create ${target}: parent path is not a directory`,
        );
      }
      break;
    } catch (error) {
      if (error instanceof InitError) throw error;
      if (errorCode(error) !== "ENOENT") {
        throw new InitError(
          "GECLI_INIT_CREATE_DIRECTORY",
          `cannot inspect directory path ${candidate}: ${errorMessage(error)}`,
        );
      }
      missing.unshift(candidate);
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new InitError(
          "GECLI_INIT_CREATE_DIRECTORY",
          `cannot find a directory ancestor for ${target}`,
        );
      }
      candidate = parent;
    }
  }

  const created: OwnedDirectory[] = [];
  for (const path of missing) {
    try {
      // Non-recursive mkdir lets cleanup track only calls that this invocation
      // actually won; raced directories are never misclassified as owned.
      await mkdir(path, { recursive: false, mode: 0o755 });
      const identity = await lstat(path);
      if (identity.isSymbolicLink() || !identity.isDirectory()) {
        throw new InitError(
          "GECLI_INIT_TARGET_CHANGED",
          `created directory changed before it could be verified: ${path}`,
        );
      }
      created.push({ path, identity });
    } catch (error) {
      if (error instanceof InitError) {
        await cleanupCreatedDirectories(created);
        throw error;
      }
      if (errorCode(error) === "EEXIST") {
        try {
          const raced = await lstat(path);
          if (!raced.isSymbolicLink() && raced.isDirectory()) continue;
        } catch {
          // Fall through to the safe creation failure below.
        }
      }
      await cleanupCreatedDirectories(created);
      throw new InitError(
        "GECLI_INIT_CREATE_DIRECTORY",
        `cannot exclusively create directory ${path}: ${errorMessage(error)}`,
      );
    }
  }
  return created;
}

async function requireEmptyStableDirectory(target: string): Promise<Stats> {
  let before: Stats;
  try {
    before = await lstat(target);
  } catch (error) {
    throw new InitError(
      "GECLI_INIT_TARGET_CHANGED",
      `init target disappeared before creation: ${target}: ${errorMessage(error)}`,
    );
  }
  if (before.isSymbolicLink()) {
    throw new InitError("GECLI_INIT_TARGET_SYMLINK", `refusing symlink init target ${target}`);
  }
  if (!before.isDirectory()) {
    throw new InitError(
      "GECLI_INIT_TARGET_NOT_DIRECTORY",
      `refusing existing non-directory init target ${target}`,
    );
  }

  let entries: string[];
  let after: Stats;
  try {
    entries = await readdir(target);
    after = await lstat(target);
  } catch (error) {
    throw new InitError(
      "GECLI_INIT_TARGET_ACCESS",
      `cannot inspect init target ${target}: ${errorMessage(error)}`,
    );
  }
  if (after.isSymbolicLink() || !after.isDirectory() || !sameIdentity(before, after)) {
    throw new InitError(
      "GECLI_INIT_TARGET_CHANGED",
      `init target changed before file creation: ${target}`,
    );
  }
  if (entries.length > 0) {
    throw new InitError(
      "GECLI_INIT_TARGET_NOT_EMPTY",
      `refusing non-empty init target ${target}`,
    );
  }
  return after;
}

async function cleanupCreatedDirectories(created: readonly OwnedDirectory[]): Promise<void> {
  for (const owned of [...created].reverse()) {
    try {
      const current = await lstat(owned.path);
      if (
        current.isSymbolicLink() ||
        !current.isDirectory() ||
        !sameIdentity(current, owned.identity)
      ) {
        continue;
      }
      // rmdir removes only an empty directory. Never recursively delete a target.
      await rmdir(owned.path);
    } catch {
      // A concurrent writer or pre-existing content makes cleanup unsafe; leave it.
    }
  }
}

async function cleanupOwnedFile(
  target: string,
  outputPath: string,
  directoryIdentity: Stats,
  fileIdentity: Stats,
): Promise<void> {
  try {
    const currentDirectory = await lstat(target);
    if (
      currentDirectory.isSymbolicLink() ||
      !currentDirectory.isDirectory() ||
      !sameIdentity(currentDirectory, directoryIdentity)
    ) {
      return;
    }
    const currentFile = await lstat(outputPath);
    if (
      currentFile.isSymbolicLink() ||
      !currentFile.isFile() ||
      !sameIdentity(currentFile, fileIdentity)
    ) {
      return;
    }
    await unlink(outputPath);
  } catch {
    // Cleanup is best-effort and identity-gated so user-owned paths are untouched.
  }
}

async function createGraphFile(
  target: string,
  template: Template,
  directoryIdentity: Stats,
  createdDirectories: readonly OwnedDirectory[],
): Promise<void> {
  const outputPath = join(target, OUTPUT_FILE);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow;
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    // O_EXCL is the final overwrite guard after inspection and closes the TOCTOU
    // window between checking for graph.json and creating it.
    handle = await open(outputPath, flags, 0o644);
  } catch (error) {
    await cleanupCreatedDirectories(createdDirectories);
    const code = errorCode(error);
    if (code === "EEXIST" || code === "ELOOP") {
      throw new InitError(
        "GECLI_INIT_EXCLUSIVE_CREATE",
        `refusing to overwrite an existing init file at ${outputPath}`,
      );
    }
    throw new InitError(
      "GECLI_INIT_CREATE_FILE",
      `cannot exclusively create ${outputPath}: ${errorMessage(error)}`,
    );
  }

  let fileIdentity: Stats | null = null;
  let closed = false;
  try {
    fileIdentity = await handle.stat();
    await handle.writeFile(template.source, "utf8");
    await handle.sync();
    await handle.close();
    closed = true;

    const beforeEntries = await lstat(target);
    const entries = await readdir(target);
    const afterEntries = await lstat(target);
    const currentFile = await lstat(outputPath);
    const stableDirectory =
      !beforeEntries.isSymbolicLink() &&
      beforeEntries.isDirectory() &&
      sameIdentity(beforeEntries, directoryIdentity) &&
      sameIdentity(afterEntries, directoryIdentity);
    const stableFile =
      !currentFile.isSymbolicLink() &&
      currentFile.isFile() &&
      sameIdentity(currentFile, fileIdentity);
    if (!stableDirectory || !stableFile || entries.length !== 1 || entries[0] !== OUTPUT_FILE) {
      throw new InitError(
        "GECLI_INIT_TARGET_CHANGED",
        `init target changed while ${OUTPUT_FILE} was being created: ${target}`,
      );
    }
  } catch (error) {
    if (!closed) {
      try {
        await handle.close();
      } catch {
        // Continue to identity-gated cleanup.
      }
    }
    if (fileIdentity !== null) {
      await cleanupOwnedFile(target, outputPath, directoryIdentity, fileIdentity);
    }
    await cleanupCreatedDirectories(createdDirectories);
    if (error instanceof InitError) throw error;
    throw new InitError(
      "GECLI_INIT_WRITE_FILE",
      `failed while writing ${outputPath}: ${errorMessage(error)}`,
    );
  }
}

/** Safely initialize a one-file Graph Engineering project. */
export async function initializeGraphProject(
  directory: string,
  options: { dryRun: boolean },
): Promise<InitReport> {
  const target = resolve(directory);
  const template = await loadTemplate();
  const inspection = await inspectTarget(target);
  const wouldCreateDirectory = !inspection.exists;

  if (options.dryRun) {
    return {
      targetDirectory: target,
      dryRun: true,
      created: false,
      directoryCreated: false,
      wouldCreateDirectory,
      files: [OUTPUT_FILE],
      template: TEMPLATE_NAME,
      graphHash: template.graphHash,
    };
  }

  const createdDirectories = inspection.exists ? [] : await createTargetDirectories(target);
  let directoryIdentity: Stats;
  try {
    directoryIdentity = await requireEmptyStableDirectory(target);
  } catch (error) {
    await cleanupCreatedDirectories(createdDirectories);
    throw error;
  }
  await createGraphFile(target, template, directoryIdentity, createdDirectories);

  return {
    targetDirectory: target,
    dryRun: false,
    created: true,
    directoryCreated: createdDirectories.some((item) => item.path === target),
    wouldCreateDirectory,
    files: [OUTPUT_FILE],
    template: TEMPLATE_NAME,
    graphHash: template.graphHash,
  };
}
