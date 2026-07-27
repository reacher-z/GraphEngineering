import { canonicalSerialize } from "@graph-engineering/core";
import {
  captureBoundedJson,
  hashWithDomain,
  validateCycleControllerRequest,
} from "./cycle-contract.js";
import {
  foldCycleControllerEvents,
  readCycleControllerEvents,
} from "./cycle-fold.js";
import {
  CycleControllerError,
  type CycleControllerEvent,
  type CycleControllerEventStore,
  type CycleControllerFold,
} from "./cycle-types.js";

export const CYCLE_LINEAGE_MANIFEST_DOMAIN =
  "graph-engineering/cycle-lineage-manifest/v1alpha1\0";
export const MAX_CYCLE_LINEAGE_DEPTH = 32;
export const MAX_CYCLE_LINEAGE_STREAMS = MAX_CYCLE_LINEAGE_DEPTH + 1;
export const MAX_CYCLE_LINEAGE_EVENTS = 1_024;
export const MAX_CYCLE_LINEAGE_MANIFEST_BYTES = 16_777_216;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const HASH = /^[0-9a-f]{64}$/u;

export interface CycleLineageBinding {
  readonly controllerRunId: string;
  readonly controllerId: string;
  readonly hostRunId: string;
  readonly eventStreamId: string;
  readonly throughSequence: number;
  readonly recordHash: string;
  readonly historyPrefixHash: string;
  readonly requestHash: string;
  readonly controllerHash: string;
}

export interface CycleLineageManifestStream extends CycleLineageBinding {
  readonly parent: CycleLineageBinding | null;
  readonly events: readonly CycleControllerEvent[];
}

export interface CycleLineageManifestLimits {
  readonly maxDepth: typeof MAX_CYCLE_LINEAGE_DEPTH;
  readonly maxStreams: typeof MAX_CYCLE_LINEAGE_STREAMS;
  readonly maxEvents: typeof MAX_CYCLE_LINEAGE_EVENTS;
  readonly maxBytes: typeof MAX_CYCLE_LINEAGE_MANIFEST_BYTES;
}

export interface CycleControllerLineageManifest {
  readonly apiVersion:
    "graphengineering.reacher-z.github.io/cycle-controller-lineage-manifests/v1alpha1";
  readonly kind: "CycleControllerLineageManifest";
  readonly contractVersion: "cycle-controller-lineage/v1alpha1";
  readonly payloadDisposition: "inline-unredacted";
  readonly redacted: false;
  readonly limits: CycleLineageManifestLimits;
  readonly target: CycleLineageBinding;
  /** Exact root-to-target prefixes; every non-root entry consumes its predecessor. */
  readonly streams: readonly CycleLineageManifestStream[];
  readonly eventCount: number;
  readonly manifestHash: string;
}

export interface CycleControllerLineageReplay {
  readonly manifest: CycleControllerLineageManifest;
  readonly folds: readonly CycleControllerFold[];
  readonly target: CycleControllerFold;
}

/** Store capability needed to discover an ancestor when only its run ID is durable. */
export interface CycleControllerLineageStore extends CycleControllerEventStore {
  readByControllerRunId(
    controllerRunId: string,
    throughSequence: number,
  ): AsyncIterable<CycleControllerEvent>;
}

interface ValidatedLineage {
  readonly manifest: CycleControllerLineageManifest;
  readonly folds: readonly CycleControllerFold[];
}

function invalid(
  message: string,
  controllerRunId = "unknown",
  details: Readonly<Record<string, unknown>> = {},
): never {
  throw new CycleControllerError(
    "GE_CYCLE_INVALID_HISTORY",
    controllerRunId,
    message,
    details,
  );
}

function record(value: unknown, label: string, controllerRunId = "unknown"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${label} must be an object`, controllerRunId);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string,
  controllerRunId = "unknown",
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
      || actual.some((key, index) => key !== expected[index])) {
    invalid(`${label} must be closed`, controllerRunId, { actual, expected });
  }
}

function identifier(value: unknown, label: string, controllerRunId = "unknown"): string {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || value === "." || value === "..") {
    return invalid(`${label} is not a valid identifier`, controllerRunId);
  }
  return value;
}

function hash(value: unknown, label: string, controllerRunId = "unknown"): string {
  if (typeof value !== "string" || !HASH.test(value)) {
    return invalid(`${label} is not a SHA-256 digest`, controllerRunId);
  }
  return value;
}

function counter(value: unknown, label: string, controllerRunId = "unknown"): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid(`${label} is not a nonnegative safe integer`, controllerRunId);
  }
  return value as number;
}

const BINDING_KEYS = [
  "controllerRunId",
  "controllerId",
  "hostRunId",
  "eventStreamId",
  "throughSequence",
  "recordHash",
  "historyPrefixHash",
  "requestHash",
  "controllerHash",
] as const;

function parseBinding(
  value: unknown,
  label: string,
  requireClosed = true,
): CycleLineageBinding {
  const item = record(value, label);
  const runId = typeof item.controllerRunId === "string" ? item.controllerRunId : "unknown";
  if (requireClosed) exactKeys(item, BINDING_KEYS, label, runId);
  const binding = {
    controllerRunId: identifier(item.controllerRunId, `${label}.controllerRunId`, runId),
    controllerId: identifier(item.controllerId, `${label}.controllerId`, runId),
    hostRunId: identifier(item.hostRunId, `${label}.hostRunId`, runId),
    eventStreamId: identifier(item.eventStreamId, `${label}.eventStreamId`, runId),
    throughSequence: counter(item.throughSequence, `${label}.throughSequence`, runId),
    recordHash: hash(item.recordHash, `${label}.recordHash`, runId),
    historyPrefixHash: hash(item.historyPrefixHash, `${label}.historyPrefixHash`, runId),
    requestHash: hash(item.requestHash, `${label}.requestHash`, runId),
    controllerHash: hash(item.controllerHash, `${label}.controllerHash`, runId),
  } satisfies CycleLineageBinding;
  if (binding.recordHash !== binding.historyPrefixHash) {
    invalid(`${label} record and prefix hashes differ`, binding.controllerRunId);
  }
  return Object.freeze(binding);
}

function bindingFromFold(fold: CycleControllerFold): CycleLineageBinding {
  return Object.freeze({
    controllerRunId: fold.request.controllerRunId,
    controllerId: fold.request.controllerId,
    hostRunId: fold.request.hostRun.runId,
    eventStreamId: fold.request.eventStreamId,
    throughSequence: fold.lastSequence,
    recordHash: fold.historyPrefixHash,
    historyPrefixHash: fold.historyPrefixHash,
    requestHash: fold.requestHash,
    controllerHash: fold.controllerHash,
  });
}

function same(left: unknown, right: unknown): boolean {
  return canonicalSerialize(left) === canonicalSerialize(right);
}

function validateLimits(value: unknown): void {
  const limits = record(value, "lineage manifest limits");
  exactKeys(limits, ["maxDepth", "maxStreams", "maxEvents", "maxBytes"], "lineage manifest limits");
  if (limits.maxDepth !== MAX_CYCLE_LINEAGE_DEPTH
      || limits.maxStreams !== MAX_CYCLE_LINEAGE_STREAMS
      || limits.maxEvents !== MAX_CYCLE_LINEAGE_EVENTS
      || limits.maxBytes !== MAX_CYCLE_LINEAGE_MANIFEST_BYTES) {
    invalid("lineage manifest limits differ from the contract bounds");
  }
}

function validateAndReplay(value: unknown): ValidatedLineage {
  let captured: ReturnType<typeof captureBoundedJson>;
  try {
    captured = captureBoundedJson(value, MAX_CYCLE_LINEAGE_MANIFEST_BYTES);
  } catch (error) {
    throw new CycleControllerError(
      "GE_CYCLE_INVALID_HISTORY",
      "unknown",
      "lineage manifest is not bounded portable JSON",
      { causeName: error instanceof Error ? error.name : typeof error },
      { cause: error },
    );
  }
  const manifest = record(captured.value, "lineage manifest");
  exactKeys(manifest, [
    "apiVersion",
    "kind",
    "contractVersion",
    "payloadDisposition",
    "redacted",
    "limits",
    "target",
    "streams",
    "eventCount",
    "manifestHash",
  ], "lineage manifest");
  if (manifest.apiVersion
      !== "graphengineering.reacher-z.github.io/cycle-controller-lineage-manifests/v1alpha1"
      || manifest.kind !== "CycleControllerLineageManifest"
      || manifest.contractVersion !== "cycle-controller-lineage/v1alpha1"
      || manifest.payloadDisposition !== "inline-unredacted"
      || manifest.redacted !== false) {
    invalid("lineage manifest envelope is invalid");
  }
  validateLimits(manifest.limits);
  const declaredHash = hash(manifest.manifestHash, "lineage manifest hash");
  const { manifestHash: _manifestHash, ...body } = manifest;
  if (hashWithDomain(CYCLE_LINEAGE_MANIFEST_DOMAIN, body) !== declaredHash) {
    invalid("lineage manifest hash drifted");
  }
  const target = parseBinding(manifest.target, "lineage manifest target");
  if (!Array.isArray(manifest.streams)
      || manifest.streams.length === 0
      || manifest.streams.length > MAX_CYCLE_LINEAGE_STREAMS) {
    invalid("lineage manifest stream count is outside the contract bounds", target.controllerRunId);
  }
  const eventCount = counter(manifest.eventCount, "lineage manifest eventCount", target.controllerRunId);
  const folds: CycleControllerFold[] = [];
  const runIds = new Set<string>();
  const streamIds = new Set<string>();
  let observedEvents = 0;

  for (let index = 0; index < manifest.streams.length; index += 1) {
    const raw = record(manifest.streams[index], `lineage stream ${index}`, target.controllerRunId);
    exactKeys(raw, [...BINDING_KEYS, "parent", "events"], `lineage stream ${index}`, target.controllerRunId);
    const binding = parseBinding(raw, `lineage stream ${index}`, false);
    if (runIds.has(binding.controllerRunId) || streamIds.has(binding.eventStreamId)) {
      invalid("lineage manifest contains a duplicate ancestor or ancestry cycle", binding.controllerRunId);
    }
    runIds.add(binding.controllerRunId);
    streamIds.add(binding.eventStreamId);
    if (!Array.isArray(raw.events) || raw.events.length === 0) {
      invalid("lineage stream event prefix is empty", binding.controllerRunId);
    }
    observedEvents += raw.events.length;
    if (observedEvents > MAX_CYCLE_LINEAGE_EVENTS) {
      invalid("lineage manifest event count exceeds the contract bound", binding.controllerRunId);
    }
    if (raw.events.length !== binding.throughSequence + 1) {
      invalid("lineage stream prefix length differs from throughSequence", binding.controllerRunId);
    }
    const previousFold = folds.at(-1);
    let fold: CycleControllerFold;
    try {
      fold = foldCycleControllerEvents(
        raw.events as unknown as readonly CycleControllerEvent[],
        previousFold === undefined ? {} : { parent: previousFold },
      );
    } catch (error) {
      if (error instanceof CycleControllerError
          && error.code === "GE_CYCLE_INVALID_HISTORY") throw error;
      throw new CycleControllerError(
        "GE_CYCLE_INVALID_HISTORY",
        binding.controllerRunId,
        "lineage stream cannot be replayed",
        { causeName: error instanceof Error ? error.name : typeof error },
        { cause: error },
      );
    }
    const derived = bindingFromFold(fold);
    if (!same(binding, derived)) {
      invalid("lineage stream binding differs from its validated event prefix", binding.controllerRunId);
    }
    if (index === 0) {
      if (raw.parent !== null || fold.request.lineage.origin !== "start") {
        invalid("lineage root must be an origin=start stream with no parent", binding.controllerRunId);
      }
    } else {
      if (raw.parent === null || previousFold === undefined
          || fold.request.lineage.origin !== "fork") {
        invalid("lineage child is missing its immediate parent", binding.controllerRunId);
      }
      const declaredParent = parseBinding(raw.parent, `lineage stream ${index}.parent`);
      const actualParent = bindingFromFold(previousFold);
      if (!same(declaredParent, actualParent)) {
        invalid("lineage child parent binding is missing, reordered, or substituted", binding.controllerRunId);
      }
    }
    folds.push(fold);
  }
  if (manifest.streams.length - 1 > MAX_CYCLE_LINEAGE_DEPTH) {
    invalid("lineage manifest exceeds the ancestry depth bound", target.controllerRunId);
  }
  if (observedEvents !== eventCount) {
    invalid("lineage manifest eventCount differs from its prefixes", target.controllerRunId);
  }
  const targetFold = folds.at(-1);
  if (targetFold === undefined || !same(target, bindingFromFold(targetFold))) {
    invalid("lineage manifest target differs from the final stream", target.controllerRunId);
  }
  return Object.freeze({
    manifest: captured.value as unknown as CycleControllerLineageManifest,
    folds: Object.freeze(folds),
  });
}

/** Validate a closed offline lineage package and every root-to-target event fold. */
export function validateCycleControllerLineageManifest(
  value: unknown,
): CycleControllerLineageManifest {
  return validateAndReplay(value).manifest;
}

/** Replay a complete offline lineage package without leases, adapters, clocks, or handlers. */
export function replayCycleControllerLineageManifest(
  value: unknown,
  options: { readonly requireTerminal?: boolean } = {},
): CycleControllerLineageReplay {
  const validated = validateAndReplay(value);
  const target = validated.folds.at(-1);
  if (target === undefined) return invalid("lineage manifest has no target stream");
  if (options.requireTerminal === true && target.terminalResult === null) {
    invalid("lineage manifest target is not terminal", target.request.controllerRunId);
  }
  return Object.freeze({
    manifest: validated.manifest,
    folds: validated.folds,
    target,
  });
}

async function collect(
  values: AsyncIterable<CycleControllerEvent>,
  controllerRunId: string,
): Promise<readonly CycleControllerEvent[]> {
  const events: CycleControllerEvent[] = [];
  try {
    for await (const event of values) events.push(event);
  } catch (error) {
    if (error instanceof CycleControllerError) throw error;
    throw new CycleControllerError(
      "GE_CYCLE_STORE_FAILED",
      controllerRunId,
      "lineage ancestor stream could not be read",
      { causeName: error instanceof Error ? error.name : typeof error },
      { cause: error },
    );
  }
  return Object.freeze(events);
}

function requestFromPrefix(events: readonly CycleControllerEvent[]) {
  const first = events[0];
  if (first === undefined || first.type !== "ControllerCreated") {
    return invalid("lineage event prefix does not begin with ControllerCreated");
  }
  try {
    return validateCycleControllerRequest(first.data.request);
  } catch (error) {
    throw new CycleControllerError(
      "GE_CYCLE_INVALID_HISTORY",
      first.controllerRunId,
      "lineage event prefix contains an invalid controller request",
      { causeName: error instanceof Error ? error.name : typeof error },
      { cause: error },
    );
  }
}

/**
 * Export the exact target prefix plus every immutable ancestor prefix.
 *
 * The returned object is already validated and content-addressed. A source
 * that omits, truncates, duplicates, or substitutes an ancestor cannot produce
 * a manifest.
 */
export async function exportCycleControllerLineageManifest(
  store: CycleControllerLineageStore,
  targetStreamId: string,
  throughSequence?: number,
): Promise<CycleControllerLineageManifest> {
  const allTargetEvents = await readCycleControllerEvents(store, targetStreamId);
  if (allTargetEvents.length === 0) {
    invalid("lineage export target stream does not exist");
  }
  const through = throughSequence ?? allTargetEvents.length - 1;
  if (!Number.isSafeInteger(through) || through < 0 || through >= allTargetEvents.length) {
    invalid("lineage export target prefix is outside history", allTargetEvents[0]!.controllerRunId);
  }
  const targetEvents = Object.freeze(allTargetEvents.slice(0, through + 1));

  const reverse: Array<readonly CycleControllerEvent[]> = [];
  const seen = new Set<string>();
  let current = targetEvents;
  for (;;) {
    if (reverse.length >= MAX_CYCLE_LINEAGE_STREAMS) {
      invalid("lineage export exceeds the ancestry depth bound", current[0]?.controllerRunId);
    }
    const request = requestFromPrefix(current);
    if (seen.has(request.controllerRunId)) {
      invalid("lineage export detected an ancestry cycle", request.controllerRunId);
    }
    seen.add(request.controllerRunId);
    reverse.push(current);
    if (request.lineage.origin === "start") break;
    const parentEvents = await collect(
      store.readByControllerRunId(
        request.lineage.parentControllerRunId,
        request.lineage.parentSequence,
      ),
      request.controllerRunId,
    );
    if (parentEvents.length !== request.lineage.parentSequence + 1
        || parentEvents.at(-1)?.recordHash !== request.lineage.parentHistoryHash) {
      invalid("lineage ancestor prefix is missing, truncated, or substituted", request.controllerRunId);
    }
    current = parentEvents;
  }

  const prefixes = reverse.reverse();
  const folds: CycleControllerFold[] = [];
  const streams: CycleLineageManifestStream[] = [];
  let eventCount = 0;
  for (const events of prefixes) {
    eventCount += events.length;
    if (eventCount > MAX_CYCLE_LINEAGE_EVENTS) {
      invalid("lineage export exceeds the event-count bound", events[0]?.controllerRunId);
    }
    const parentFold = folds.at(-1);
    const fold = foldCycleControllerEvents(
      events,
      parentFold === undefined ? {} : { parent: parentFold },
    );
    const binding = bindingFromFold(fold);
    streams.push(Object.freeze({
      ...binding,
      parent: parentFold === undefined ? null : bindingFromFold(parentFold),
      events: Object.freeze([...events]),
    }));
    folds.push(fold);
  }
  const target = bindingFromFold(folds.at(-1)!);
  if (target.eventStreamId !== targetStreamId) {
    invalid("lineage export target store key differs from the request eventStreamId", target.controllerRunId);
  }
  const body = {
    apiVersion:
      "graphengineering.reacher-z.github.io/cycle-controller-lineage-manifests/v1alpha1" as const,
    kind: "CycleControllerLineageManifest" as const,
    contractVersion: "cycle-controller-lineage/v1alpha1" as const,
    payloadDisposition: "inline-unredacted" as const,
    redacted: false as const,
    limits: {
      maxDepth: MAX_CYCLE_LINEAGE_DEPTH,
      maxStreams: MAX_CYCLE_LINEAGE_STREAMS,
      maxEvents: MAX_CYCLE_LINEAGE_EVENTS,
      maxBytes: MAX_CYCLE_LINEAGE_MANIFEST_BYTES,
    } as const,
    target,
    streams: Object.freeze(streams),
    eventCount,
  };
  return validateCycleControllerLineageManifest({
    ...body,
    manifestHash: hashWithDomain(CYCLE_LINEAGE_MANIFEST_DOMAIN, body),
  });
}
