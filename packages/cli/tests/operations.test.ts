import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  DEFAULT_LOG_LIMIT,
  JOURNAL_API_VERSION,
  JOURNAL_API_VERSION_V1ALPHA2,
  JOURNAL_EVENT_TYPES,
  JOURNAL_EVENT_TYPES_V1ALPHA2,
  JOURNAL_SOURCES,
  MAX_LOG_LIMIT,
  UNSUPPORTED_OPERATIONS,
} from "../src/operations.js";
import { EXIT_CODES } from "../src/cli.js";

const workspaceRoot = resolve(import.meta.dirname, "../../../..");
const cliEntrypoint = resolve(import.meta.dirname, "../src/cli.js");

interface CorpusJournal {
  runId: string;
  directory: string | null;
  content: string | null;
}

interface Corpus {
  contract: string;
  journalApiVersion: string;
  journalApiVersionV1Alpha2: string;
  journals: Record<string, CorpusJournal>;
}

/**
 * The shared cross-language corpus. Its four authentic journals were written by
 * the real durable runtime; the rest are deliberate mutations of them. It is
 * input only: it declares no expected CLI output for either implementation.
 */
const corpus = JSON.parse(
  readFileSync(join(workspaceRoot, "tools/conformance/cli-operations.case.json"), "utf8"),
) as Corpus;

const READ_COMMANDS = ["status", "inspect", "logs"] as const;
const UNSUPPORTED_NAMES = Object.keys(UNSUPPORTED_OPERATIONS).sort() as Array<
  keyof typeof UNSUPPORTED_OPERATIONS
>;

interface Invocation {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface Envelope<T = Record<string, unknown>> {
  schemaVersion: string;
  command: string | null;
  ok: boolean;
  exitCode: number;
  data: T | null;
  error: Record<string, unknown> | null;
}

function invoke(args: readonly string[]): Invocation {
  const result = spawnSync(process.execPath, [cliEntrypoint, ...args], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function machine<T = Record<string, unknown>>(result: Invocation): Envelope<T> {
  assert.equal(result.stderr, "", "machine mode must never write stderr");
  assert.ok(result.stdout.endsWith("\n"), "machine output must end with one newline");
  assert.equal(result.stdout.trimEnd().split("\n").length, 1, "machine mode emits one JSON line");
  const envelope = JSON.parse(result.stdout) as Envelope<T>;
  assert.deepEqual(Object.keys(envelope), [
    "schemaVersion",
    "command",
    "ok",
    "exitCode",
    "data",
    "error",
  ]);
  assert.equal(envelope.schemaVersion, "graph-engineering.cli/v1alpha1");
  assert.equal(envelope.exitCode, result.status);
  assert.equal(envelope.ok, result.status === 0);
  return envelope;
}

function journalPath(store: string, runId: string, directory = "events"): string {
  return join(
    store,
    directory,
    `${createHash("sha256").update(runId, "utf8").digest("hex")}.jsonl`,
  );
}

function corpusJournalPath(store: string, journalName: string): string {
  const journal = corpus.journals[journalName];
  assert.ok(journal !== undefined, `corpus is missing journal '${journalName}'`);
  return journalPath(store, journal.runId, journal.directory as string);
}

function fingerprint(path: string): string {
  const state = statSync(path, { bigint: true });
  return [
    createHash("sha256").update(readFileSync(path)).digest("hex"),
    String(state.size),
    String(state.mtimeNs),
  ].join(":");
}

function listing(store: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      found.push(relative(store, path));
      if (entry.isDirectory()) walk(path);
    }
  };
  walk(store);
  return found.sort();
}

const temporaryStores: string[] = [];

/** Materialize one or more shared-corpus journals into a private store. */
function corpusStore(...journalNames: readonly string[]): string {
  const store = mkdtempSync(join(tmpdir(), "graph-cli-ops-"));
  temporaryStores.push(store);
  for (const journalName of journalNames) {
    const journal = corpus.journals[journalName];
    assert.ok(journal !== undefined, `corpus is missing journal '${journalName}'`);
    if (journal.content === null) continue;
    const path = journalPath(store, journal.runId, journal.directory as string);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from(journal.content, "utf8"));
  }
  return store;
}

process.on("exit", () => {
  for (const store of temporaryStores) rmSync(store, { recursive: true, force: true });
});

test("the shared corpus carries authentic journals of both durable layouts", () => {
  assert.equal(corpus.contract, "graph-engineering.cli/v1alpha1");
  assert.equal(corpus.journalApiVersion, JOURNAL_API_VERSION);
  assert.equal(corpus.journalApiVersionV1Alpha2, JOURNAL_API_VERSION_V1ALPHA2);
  // Every journal states the layout it belongs in, and the only layouts are the
  // two this reader probes, in the order it probes them.
  assert.deepEqual(
    JOURNAL_SOURCES.map((source) => [source.directory, source.apiVersion]),
    [
      ["events-v1alpha2", JOURNAL_API_VERSION_V1ALPHA2],
      ["events", JOURNAL_API_VERSION],
    ],
  );
  const directories = new Set(
    Object.values(corpus.journals)
      .filter((journal) => journal.content !== null)
      .map((journal) => journal.directory),
  );
  assert.deepEqual([...directories].sort(), ["events", "events-v1alpha2"]);
  const protectedJournal = corpus.journals["v1alpha2-succeeded-run"];
  assert.ok(protectedJournal?.content != null);
  for (const [index, line] of (protectedJournal.content as string)
    .trimEnd().split("\n").entries()) {
    const record = JSON.parse(line) as Record<string, unknown>;
    assert.equal(record.apiVersion, JOURNAL_API_VERSION_V1ALPHA2);
    assert.equal(record.sequence, index);
    assert.equal(record.runId, "v1alpha2-succeeded-run");
    assert.equal(record.redacted, false);
    assert.ok(["metadata-only", "protected-ref"].includes(record.payloadDisposition as string));
    assert.ok(JOURNAL_EVENT_TYPES_V1ALPHA2.includes(record.type as never));
  }
  const succeeded = corpus.journals["succeeded-run"];
  assert.ok(succeeded?.content !== null && succeeded !== undefined);
  const records = (succeeded.content as string).trimEnd().split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.ok(records.length > 0);
  for (const [index, record] of records.entries()) {
    assert.equal(record.apiVersion, JOURNAL_API_VERSION);
    assert.equal(record.sequence, index);
    assert.equal(record.runId, "succeeded-run");
    assert.ok(JOURNAL_EVENT_TYPES.includes(record.type as never));
  }
});

test("status projects one terminal run without reading event data", () => {
  const store = corpusStore("succeeded-run");
  const result = invoke(["status", "--run", "succeeded-run", "--store", store, "--json"]);

  assert.equal(result.status, EXIT_CODES.success);
  const envelope = machine<Record<string, unknown>>(result);
  assert.equal(envelope.command, "status");
  assert.equal(envelope.error, null);
  assert.deepEqual(Object.keys(envelope.data ?? {}), [
    "runId",
    "runIdHash",
    "journalApiVersion",
    "status",
    "terminal",
    "eventCount",
    "lastSequence",
    "graphRevision",
    "firstEventTimestamp",
    "lastEventTimestamp",
    "resumeCount",
    "pauseCount",
    "observedNodeCount",
    "redaction",
  ]);
  assert.equal(envelope.data?.status, "succeeded");
  assert.equal(envelope.data?.terminal, true);
  assert.equal(envelope.data?.eventCount, 19);
  assert.equal(envelope.data?.lastSequence, 18);
  assert.equal(envelope.data?.observedNodeCount, 4);
  assert.equal(
    envelope.data?.runIdHash,
    createHash("sha256").update("succeeded-run", "utf8").digest("hex"),
  );
  assert.deepEqual(envelope.data?.redaction, {
    sink: "cli-json",
    eventDataEmitted: false,
    payloadsEmitted: false,
    pathsEmitted: false,
  });
});

test("inspect reports observed nodes and edges in code-point order", () => {
  const store = corpusStore("succeeded-run");
  const envelope = machine<{
    observedNodes: Array<Record<string, unknown>>;
    observedEdges: Array<Record<string, unknown>>;
    eventTypeCounts: Record<string, number>;
    eventCount: number;
  }>(invoke(["inspect", "--run", "succeeded-run", "--store", store, "--json"]));

  assert.deepEqual(
    envelope.data?.observedNodes.map((node) => node.nodeId),
    ["join", "left", "right", "root"],
  );
  assert.deepEqual(
    envelope.data?.observedEdges.map((edge) => edge.edgeId),
    ["left-join", "right-join", "root-left", "root-right"],
  );
  for (const node of envelope.data?.observedNodes ?? []) {
    assert.deepEqual(Object.keys(node), [
      "nodeId",
      "eventCount",
      "firstSequence",
      "lastSequence",
      "observedMaxAttempt",
      "scheduled",
      "started",
      "succeeded",
      "attemptFailures",
      "retries",
      "settledWithoutAttempt",
    ]);
    assert.equal(node.succeeded, true);
  }
  const counts = envelope.data?.eventTypeCounts ?? {};
  // The histogram may only name types the history contains, in contract order.
  assert.deepEqual(
    Object.keys(counts),
    JOURNAL_EVENT_TYPES.filter((type) => Object.hasOwn(counts, type)),
  );
  assert.equal(
    Object.values(counts).reduce((total, value) => total + value, 0),
    envelope.data?.eventCount,
  );
});

test("logs pages envelope metadata and never emits payloads", () => {
  const store = corpusStore("succeeded-run");
  const envelope = machine<{
    events: Array<Record<string, unknown>>;
    returned: number;
    limit: number;
    truncated: boolean;
    nextSequence: number | null;
  }>(invoke(["logs", "--run", "succeeded-run", "--store", store, "--json"]));

  assert.equal(envelope.data?.limit, DEFAULT_LOG_LIMIT);
  assert.equal(envelope.data?.returned, 19);
  assert.equal(envelope.data?.truncated, false);
  assert.equal(envelope.data?.nextSequence, null);
  for (const event of envelope.data?.events ?? []) {
    assert.deepEqual(Object.keys(event), [
      "sequence",
      "type",
      "timestamp",
      "nodeId",
      "edgeId",
      "attempt",
      "redacted",
    ]);
  }
  const text = JSON.stringify(envelope.data);
  for (const marker of ["implementationHash", "inputHash", "payloadHash", "activityKey"]) {
    assert.ok(!text.includes(marker), `logs leaked the payload marker ${marker}`);
  }
});

test("logs windows are bounded and expose a stable cursor", () => {
  const store = corpusStore("succeeded-run");
  const windowed = machine<{
    events: Array<{ sequence: number }>;
    truncated: boolean;
    nextSequence: number | null;
  }>(invoke([
    "logs", "--run", "succeeded-run", "--store", store, "--from", "2", "--limit", "3", "--json",
  ]));
  assert.deepEqual(windowed.data?.events.map((event) => event.sequence), [2, 3, 4]);
  assert.equal(windowed.data?.truncated, true);
  assert.equal(windowed.data?.nextSequence, 5);

  const beyond = machine<{ returned: number; events: unknown[]; truncated: boolean }>(
    invoke(["logs", "--run", "succeeded-run", "--store", store, "--from", "9999", "--json"]),
  );
  assert.equal(beyond.data?.returned, 0);
  assert.deepEqual(beyond.data?.events, []);
  assert.equal(beyond.data?.truncated, false);
});

test("no operational command invents a status the history does not contain", () => {
  for (const [journalName, expected] of [
    ["created-only-run", "created"],
    ["paused-run", "paused"],
    ["interrupted-run", "running"],
    ["failed-run", "failed"],
    ["cancelled-run", "cancelled"],
    ["succeeded-run", "succeeded"],
  ] as const) {
    const store = corpusStore(journalName);
    const runId = corpus.journals[journalName]?.runId as string;
    const envelope = machine<{ status: string; terminal: boolean }>(
      invoke(["status", "--run", runId, "--store", store, "--json"]),
    );
    assert.equal(envelope.data?.status, expected, `${journalName} projected the wrong status`);
    assert.equal(
      envelope.data?.terminal,
      ["succeeded", "failed", "cancelled"].includes(expected),
    );
  }
});

test("a cancelled run reads successfully and reports the cancellation", () => {
  const store = corpusStore("cancelled-run");
  const envelope = machine<{ status: string }>(
    invoke(["status", "--run", "cancelled-run", "--store", store, "--json"]),
  );
  // The exit code reports the read, never the run outcome.
  assert.equal(envelope.exitCode, EXIT_CODES.success);
  assert.equal(envelope.data?.status, "cancelled");
});

test("a missing durable run fails with a stable not-found envelope", () => {
  const store = corpusStore("absent-run");
  const result = invoke(["status", "--run", "absent-run", "--store", store, "--json"]);

  assert.equal(result.status, EXIT_CODES.runNotFound);
  const envelope = machine(result);
  assert.equal(envelope.data, null);
  assert.deepEqual(envelope.error, {
    code: "GECLI_RUN_NOT_FOUND",
    message: "durable run history does not exist",
    runId: "absent-run",
  });
});

test("an empty durable history is malformed rather than an empty run", () => {
  const store = corpusStore("empty-run");
  const result = invoke(["status", "--run", "empty-run", "--store", store, "--json"]);

  assert.equal(result.status, EXIT_CODES.history);
  assert.deepEqual(machine(result).error, {
    code: "GECLI_HISTORY_MALFORMED",
    message: "durable history is empty",
    runId: "empty-run",
    record: null,
  });
});

for (const [journalName, message, record] of [
  ["truncated-run", "durable history has a truncated final record", null],
  ["blank-record-run", "durable history record is blank", 2],
  ["not-json-run", "durable history record is not JSON", 2],
  ["non-object-run", "durable history record is not a JSON object", 2],
  ["unknown-property-run", "durable history record has an unknown property", 2],
  ["missing-property-run", "durable history record is missing a required property", 2],
  ["bad-api-version-run", "durable history record has an unsupported event apiVersion", 2],
  ["unknown-type-run", "durable history record has an unknown event type", 2],
  ["foreign-run-id-run", "durable history record does not belong to this run", 2],
  ["out-of-sequence-run", "durable history record is out of sequence", 2],
  ["non-object-data-run", "durable history record has a non-object data member", 2],
  ["invalid-timestamp-run", "durable history record has an invalid timestamp", 2],
  ["invalid-attempt-run", "durable history record has an invalid attempt", 3],
  ["invalid-revision-run", "durable history record has an invalid graphRevision", 2],
  ["invalid-event-id-run", "durable history record has an invalid eventId", 2],
] as const) {
  test(`a ${journalName} history fails closed with a record ordinal`, () => {
    const store = corpusStore(journalName);
    const runId = corpus.journals[journalName]?.runId as string;
    const result = invoke(["status", "--run", runId, "--store", store, "--json"]);

    assert.equal(result.status, EXIT_CODES.history);
    const envelope = machine(result);
    assert.equal(envelope.data, null);
    assert.deepEqual(envelope.error, {
      code: "GECLI_HISTORY_MALFORMED",
      message,
      runId,
      record,
    });
  });
}

for (const command of READ_COMMANDS) {
  test(`${command} performs zero durable appends`, () => {
    const store = corpusStore("succeeded-run");
    const path = journalPath(store, "succeeded-run");
    const before = fingerprint(path);
    const entriesBefore = listing(store);

    const result = invoke([command, "--run", "succeeded-run", "--store", store, "--json"]);

    assert.equal(result.status, EXIT_CODES.success);
    assert.equal(fingerprint(path), before, `${command} mutated the durable history`);
    assert.deepEqual(listing(store), entriesBefore, `${command} changed the store layout`);
  });

  test(`${command} succeeds against a read-only durable store`, { skip: process.getuid?.() === 0 }, () => {
    const store = corpusStore("succeeded-run");
    const path = journalPath(store, "succeeded-run");
    chmodSync(path, 0o400);
    chmodSync(dirname(path), 0o500);
    chmodSync(store, 0o500);
    try {
      const result = invoke([command, "--run", "succeeded-run", "--store", store, "--json"]);
      assert.equal(result.status, EXIT_CODES.success, result.stderr);
    } finally {
      chmodSync(store, 0o700);
      chmodSync(dirname(path), 0o700);
      chmodSync(path, 0o600);
    }
  });

  test(`${command} human output writes stdout only and omits payloads`, () => {
    const store = corpusStore("succeeded-run");
    const result = invoke([command, "--run", "succeeded-run", "--store", store]);

    assert.equal(result.status, EXIT_CODES.success);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.startsWith("Run succeeded-run"));
    assert.ok(result.stdout.includes("payloads and event data are never emitted by this sink"));
    assert.ok(!result.stdout.includes(store), "human output emitted a filesystem path");
    for (const marker of ["implementationHash", "inputHash", "payloadHash", "activityKey"]) {
      assert.ok(!result.stdout.includes(marker));
    }
  });
}

for (const command of UNSUPPORTED_NAMES) {
  test(`${command} fails closed without reading or writing the durable store`, () => {
    const store = corpusStore("succeeded-run");
    const path = journalPath(store, "succeeded-run");
    const before = fingerprint(path);
    const entriesBefore = listing(store);

    const argv = command === "retry"
      ? [command, "--run", "succeeded-run", "--node", "root", "--store", store, "--json"]
      : [command, "--run", "succeeded-run", "--store", store, "--json"];
    const result = invoke(argv);

    assert.equal(result.status, EXIT_CODES.unsupported);
    const envelope = machine(result);
    assert.equal(envelope.command, command);
    assert.equal(envelope.data, null, "a refused command must never return a result");
    assert.deepEqual(envelope.error, {
      code: "GECLI_UNSUPPORTED_CAPABILITY",
      message: UNSUPPORTED_OPERATIONS[command].message,
      runId: "succeeded-run",
      capability: UNSUPPORTED_OPERATIONS[command].capability,
    });
    assert.equal(fingerprint(path), before);
    assert.deepEqual(listing(store), entriesBefore);
  });

  test(`${command} refuses identically when the run does not exist`, () => {
    const store = corpusStore("absent-run");
    const argv = command === "retry"
      ? [command, "--run", "absent-run", "--node", "root", "--store", store, "--json"]
      : [command, "--run", "absent-run", "--store", store, "--json"];
    const result = invoke(argv);

    // The capability check precedes the store read, so a missing run does not
    // change the answer.
    assert.equal(result.status, EXIT_CODES.unsupported);
    assert.equal(machine(result).error?.code, "GECLI_UNSUPPORTED_CAPABILITY");
  });
}

for (const [label, argv, code] of [
  ["a missing --run", ["status", "--store", "STORE", "--json"], "GECLI_USAGE"],
  ["a missing --store", ["status", "--run", "succeeded-run", "--json"], "GECLI_USAGE"],
  ["an unsafe run id", ["status", "--run", "not a safe id", "--store", "STORE", "--json"], "GECLI_RUN_ID_INVALID"],
  ["a relative run id", ["status", "--run", "..", "--store", "STORE", "--json"], "GECLI_RUN_ID_INVALID"],
  ["a repeated --run", ["status", "--run", "a", "--run", "b", "--store", "STORE", "--json"], "GECLI_USAGE"],
  ["a stray operand", ["status", "--run", "succeeded-run", "--store", "STORE", "x", "--json"], "GECLI_USAGE"],
  ["a source-only flag", ["status", "--run", "succeeded-run", "--store", "STORE", "--format", "dot", "--json"], "GECLI_USAGE"],
  ["retry without --node", ["retry", "--run", "succeeded-run", "--store", "STORE", "--json"], "GECLI_USAGE"],
  ["a zero --limit", ["logs", "--run", "succeeded-run", "--store", "STORE", "--limit", "0", "--json"], "GECLI_USAGE"],
  ["an oversized --limit", ["logs", "--run", "succeeded-run", "--store", "STORE", "--limit", "10001", "--json"], "GECLI_USAGE"],
  ["a negative --from", ["logs", "--run", "succeeded-run", "--store", "STORE", "--from", "-1", "--json"], "GECLI_USAGE"],
  ["--run on doctor", ["doctor", "--run", "succeeded-run", "--json"], "GECLI_USAGE"],
  ["--store on validate", ["validate", "--store", "STORE", "--json"], "GECLI_USAGE"],
] as const) {
  test(`${label} is an exit-2 usage failure`, () => {
    const store = corpusStore("succeeded-run");
    const result = invoke(argv.map((item) => (item === "STORE" ? store : item)));

    assert.equal(result.status, EXIT_CODES.input);
    const envelope = machine(result);
    assert.equal(envelope.data, null);
    assert.equal(envelope.error?.code, code);
  });
}

test("an unreadable store directory is an input failure", () => {
  const store = corpusStore("succeeded-run");
  const result = invoke([
    "status", "--run", "succeeded-run", "--store", join(store, "absent"), "--json",
  ]);

  assert.equal(result.status, EXIT_CODES.input);
  assert.equal(machine(result).error?.code, "GECLI_STORE_UNREADABLE");
});

test("human-mode read failures write stderr only", () => {
  const store = corpusStore("absent-run");
  const result = invoke(["status", "--run", "absent-run", "--store", store]);

  assert.equal(result.status, EXIT_CODES.runNotFound);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "graph: durable run history does not exist: absent-run\n");
});

test("help documents the operational surface and its exit codes", () => {
  const result = invoke(["--help"]);

  assert.equal(result.status, EXIT_CODES.success);
  for (const command of [...READ_COMMANDS, ...UNSUPPORTED_NAMES]) {
    assert.ok(result.stdout.includes(`graph ${command} --run <runId>`));
  }
  assert.ok(result.stdout.includes("4 durable run history does not exist"));
  assert.ok(result.stdout.includes("5 durable run history is malformed"));
  assert.ok(result.stdout.includes("6 the requested durable capability is not implemented"));
});

test("the exit-code table and log bounds are the documented ones", () => {
  assert.deepEqual(EXIT_CODES, {
    success: 0,
    invalidGraph: 1,
    input: 2,
    unhealthy: 3,
    runNotFound: 4,
    history: 5,
    unsupported: 6,
    internal: 70,
  });
  assert.equal(DEFAULT_LOG_LIMIT, 200);
  assert.equal(MAX_LOG_LIMIT, 10_000);
  assert.deepEqual(UNSUPPORTED_NAMES, ["cancel", "fork", "replay", "resume", "retry"]);
});

const PROTECTED_RUN = "v1alpha2-succeeded-run";

test("status projects a protected v1alpha2 run this runtime produces today", () => {
  const store = corpusStore("v1alpha2-succeeded-run");
  const result = invoke(["status", "--run", PROTECTED_RUN, "--store", store, "--json"]);

  assert.equal(result.status, EXIT_CODES.success);
  const envelope = machine<Record<string, unknown>>(result);
  assert.equal(envelope.command, "status");
  assert.equal(envelope.error, null);
  // The envelope contract does not change with the journal contract: the same
  // closed, ordered member list, and the same redaction marker.
  assert.deepEqual(Object.keys(envelope.data ?? {}), [
    "runId",
    "runIdHash",
    "journalApiVersion",
    "status",
    "terminal",
    "eventCount",
    "lastSequence",
    "graphRevision",
    "firstEventTimestamp",
    "lastEventTimestamp",
    "resumeCount",
    "pauseCount",
    "observedNodeCount",
    "redaction",
  ]);
  assert.equal(envelope.data?.journalApiVersion, JOURNAL_API_VERSION_V1ALPHA2);
  assert.equal(envelope.data?.status, "succeeded");
  assert.equal(envelope.data?.terminal, true);
  assert.equal(envelope.data?.eventCount, 19);
  assert.equal(envelope.data?.observedNodeCount, 4);
  assert.deepEqual(envelope.data?.redaction, {
    sink: "cli-json",
    eventDataEmitted: false,
    payloadsEmitted: false,
    pathsEmitted: false,
  });
});

test("inspect counts protected event types in v1alpha2 contract order", () => {
  const store = corpusStore("v1alpha2-failed-run");
  const envelope = machine<{
    journalApiVersion: string;
    status: string;
    eventTypeCounts: Record<string, number>;
    observedNodes: Array<Record<string, unknown>>;
    eventCount: number;
  }>(invoke(["inspect", "--run", "v1alpha2-failed-run", "--store", store, "--json"]));

  assert.equal(envelope.data?.journalApiVersion, JOURNAL_API_VERSION_V1ALPHA2);
  assert.equal(envelope.data?.status, "failed");
  const counts = envelope.data?.eventTypeCounts ?? {};
  assert.deepEqual(
    Object.keys(counts),
    JOURNAL_EVENT_TYPES_V1ALPHA2.filter((type) => Object.hasOwn(counts, type)),
  );
  assert.equal(
    Object.values(counts).reduce((total, value) => total + value, 0),
    envelope.data?.eventCount,
  );
  // A protected failure is projected from envelope metadata alone.
  assert.ok(Object.hasOwn(counts, "NodeAttemptFailed"));
  assert.ok(Object.hasOwn(counts, "NodeSettledWithoutAttempt"));
});

test("logs pages protected envelope metadata and resolves no protected reference", () => {
  const store = corpusStore("v1alpha2-succeeded-run");
  const envelope = machine<{
    journalApiVersion: string;
    events: Array<Record<string, unknown>>;
    returned: number;
  }>(invoke(["logs", "--run", PROTECTED_RUN, "--store", store, "--json"]));

  assert.equal(envelope.data?.journalApiVersion, JOURNAL_API_VERSION_V1ALPHA2);
  assert.equal(envelope.data?.returned, 19);
  for (const event of envelope.data?.events ?? []) {
    assert.deepEqual(Object.keys(event), [
      "sequence",
      "type",
      "timestamp",
      "nodeId",
      "edgeId",
      "attempt",
      "redacted",
    ]);
    // v1alpha2 records are always `redacted: false`; the CLI restates the
    // envelope fact rather than inventing one.
    assert.equal(event.redacted, false);
  }
  const text = JSON.stringify(envelope.data);
  for (const marker of [
    "payloadHash",
    "capturePolicyHash",
    "protected-ref",
    "inputRef",
    "outputRef",
    "valueMac",
    "ciphertextHash",
    "activityKey",
  ]) {
    assert.ok(!text.includes(marker), `logs leaked the protected marker ${marker}`);
  }
});

test("a store carrying both layouts projects the protected journal", () => {
  const store = corpusStore("v1alpha2-succeeded-run", "v1alpha2-precedence-legacy-run");
  const envelope = machine<{ journalApiVersion: string; status: string; eventCount: number }>(
    invoke(["status", "--run", PROTECTED_RUN, "--store", store, "--json"]),
  );

  // The legacy half of this pair is a paused three-record history, so the
  // projection below could only come from the protected journal.
  assert.equal(envelope.data?.journalApiVersion, JOURNAL_API_VERSION_V1ALPHA2);
  assert.equal(envelope.data?.status, "succeeded");
  assert.equal(envelope.data?.eventCount, 19);
});

test("a legacy-only store still reads and reports the legacy contract", () => {
  const store = corpusStore("v1alpha2-precedence-legacy-run");
  const envelope = machine<{ journalApiVersion: string; status: string; eventCount: number }>(
    invoke(["status", "--run", PROTECTED_RUN, "--store", store, "--json"]),
  );

  assert.equal(envelope.data?.journalApiVersion, JOURNAL_API_VERSION);
  assert.equal(envelope.data?.status, "paused");
  assert.equal(envelope.data?.eventCount, 3);
});

for (const [journalName, message, record] of [
  ["v1alpha2-empty-run", "durable history is empty", null],
  ["v1alpha2-truncated-run", "durable history has a truncated final record", null],
  ["v1alpha2-unknown-property-run", "durable history record has an unknown property", 2],
  ["v1alpha2-missing-property-run", "durable history record is missing a required property", 2],
  ["v1alpha2-bad-api-version-run", "durable history record has an unsupported event apiVersion", 2],
  ["v1alpha2-redacted-run", "durable history record has an invalid redacted flag", 2],
  ["v1alpha2-inline-disposition-run", "durable history record has an invalid payloadDisposition", 2],
  ["v1alpha2-bad-payload-hash-run", "durable history record has an invalid payload hash", 2],
  ["v1alpha2-out-of-sequence-run", "durable history record is out of sequence", 2],
  ["v1alpha2-unknown-type-run", "durable history record has an unknown event type", 2],
  ["v1alpha2-foreign-run-id-run", "durable history record does not belong to this run", 2],
] as const) {
  test(`a ${journalName} history fails closed with a record ordinal`, () => {
    const store = corpusStore(journalName);
    const result = invoke(["status", "--run", PROTECTED_RUN, "--store", store, "--json"]);

    assert.equal(result.status, EXIT_CODES.history);
    const envelope = machine(result);
    assert.equal(envelope.data, null);
    assert.deepEqual(envelope.error, {
      code: "GECLI_HISTORY_MALFORMED",
      message,
      runId: PROTECTED_RUN,
      record,
    });
  });
}

for (const command of READ_COMMANDS) {
  test(`${command} performs zero durable appends against a protected store`, () => {
    const store = corpusStore("v1alpha2-succeeded-run", "v1alpha2-precedence-legacy-run");
    const protectedPath = corpusJournalPath(store, "v1alpha2-succeeded-run");
    const legacyPath = corpusJournalPath(store, "v1alpha2-precedence-legacy-run");
    const before = [fingerprint(protectedPath), fingerprint(legacyPath)];
    const entriesBefore = listing(store);

    const result = invoke([command, "--run", PROTECTED_RUN, "--store", store, "--json"]);

    assert.equal(result.status, EXIT_CODES.success);
    // Neither the layout that was read nor the one that was not.
    assert.deepEqual(
      [fingerprint(protectedPath), fingerprint(legacyPath)],
      before,
      `${command} mutated a durable history`,
    );
    assert.deepEqual(listing(store), entriesBefore, `${command} changed the store layout`);
  });

  test(`${command} human output names the protected journal contract`, () => {
    const store = corpusStore("v1alpha2-succeeded-run");
    const result = invoke([command, "--run", PROTECTED_RUN, "--store", store]);

    assert.equal(result.status, EXIT_CODES.success);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.includes("journal events/v1alpha2"));
    assert.ok(!result.stdout.includes("journal events/v1alpha1"));
    assert.ok(result.stdout.includes("payloads and event data are never emitted by this sink"));
    assert.ok(!result.stdout.includes(store), "human output emitted a filesystem path");
  });

  test(`${command} human output names the legacy journal contract`, () => {
    const store = corpusStore("succeeded-run");
    const result = invoke([command, "--run", "succeeded-run", "--store", store]);

    assert.equal(result.status, EXIT_CODES.success);
    assert.ok(result.stdout.includes("journal events/v1alpha1"));
  });
}
