import { snapshotJson } from "./json.js";
import type {
  JsonValue,
  PipelineFailureCode,
  PipelineFailurePolicy,
  PipelineHandler,
  PipelineHandlerContext,
  PipelineItemFailure,
  PipelineItemResult,
  PipelineOptions,
  PipelineOrdering,
  PipelineRetryOptions,
  PipelineRun,
  PipelineRunFailure,
  PipelineRunStatus,
  PipelineSource,
  PipelineStage,
  PipelineSummary,
} from "./types.js";

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_BUFFER_CAPACITY = 16;
const DEFAULT_MAX_IN_FLIGHT = 16;
const DEFAULT_MAX_ITEMS = 1_000;
const MAX_PIPELINE_STAGES = 2_048;
const DEFAULT_MAX_STAGES = MAX_PIPELINE_STAGES;

interface NormalizedRetry {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly backoffMultiplier: number;
  readonly maxDelayMs: number;
}

interface NormalizedStage {
  readonly id: string;
  readonly handler: PipelineHandler;
  readonly concurrency: number;
  readonly timeoutMs?: number;
  readonly retry: NormalizedRetry;
  readonly onFailure: PipelineFailurePolicy;
}

interface NormalizedOptions {
  readonly bufferCapacity: number;
  readonly maxInFlight: number;
  readonly maxItems: number;
  readonly maxStages: number;
  readonly ordering: PipelineOrdering;
  readonly cancellationSignal?: AbortSignal;
}

interface ItemState {
  readonly itemIndex: number;
  readonly input: JsonValue;
  value: JsonValue;
  completedStages: number;
  totalAttempts: number;
}

type AttemptOutcome =
  | { readonly succeeded: true; readonly output: JsonValue }
  | {
      readonly succeeded: false;
      readonly code: PipelineFailureCode;
      readonly message: string;
      readonly causeName?: string;
    };

class PipelineAbortError extends Error {
  constructor() {
    super("pipeline operation was cancelled");
    this.name = "PipelineAbortError";
  }
}

interface SemaphoreWaiter {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly signal?: AbortSignal;
  readonly onAbort?: () => void;
}

class AsyncSemaphore {
  readonly #limit: number;
  readonly #waiters: SemaphoreWaiter[] = [];
  #available: number;

  constructor(limit: number) {
    this.#limit = limit;
    this.#available = limit;
  }

  get used(): number {
    return this.#limit - this.#available;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new PipelineAbortError());
    if (this.#available > 0) {
      this.#available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const waiter: SemaphoreWaiter = {
        resolve,
        reject,
        ...(signal === undefined ? {} : { signal }),
      };
      if (signal !== undefined) {
        const onAbort = () => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(new PipelineAbortError());
        };
        Object.defineProperty(waiter, "onAbort", { value: onAbort, enumerable: true });
        signal.addEventListener("abort", onAbort, { once: true });
      }
      this.#waiters.push(waiter);
    });
  }

  release(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters.shift() as SemaphoreWaiter;
      waiter.signal?.removeEventListener("abort", waiter.onAbort as () => void);
      if (waiter.signal?.aborted) continue;
      waiter.resolve();
      return;
    }
    if (this.#available >= this.#limit) {
      throw new Error("pipeline semaphore released without a matching acquire");
    }
    this.#available += 1;
  }
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be an integer from 1 to ${MAX_SAFE_INTEGER}`);
  }
  return value;
}

function timerInteger(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(`${name} must be an integer from 0 to ${MAX_TIMER_DELAY_MS}`);
  }
  return value;
}

function timerNumber(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new TypeError(`${name} must be a finite number from 0 to ${MAX_TIMER_DELAY_MS}`);
  }
  return value;
}

function normalizeRetry(retry: PipelineRetryOptions | undefined, index: number): NormalizedRetry {
  if (retry !== undefined && (typeof retry !== "object" || retry === null)) {
    throw new TypeError(`stages[${index}].retry must be an object`);
  }
  const maxAttempts = positiveInteger(
    retry?.maxAttempts === undefined ? 1 : retry.maxAttempts,
    `stages[${index}].retry.maxAttempts`,
  );
  const initialDelayMs = timerNumber(
    retry?.initialDelayMs === undefined ? 0 : retry.initialDelayMs,
    `stages[${index}].retry.initialDelayMs`,
  );
  const backoffMultiplier =
    retry?.backoffMultiplier === undefined ? 1 : retry.backoffMultiplier;
  if (
    typeof backoffMultiplier !== "number" ||
    !Number.isFinite(backoffMultiplier) ||
    backoffMultiplier < 1
  ) {
    throw new TypeError(`stages[${index}].retry.backoffMultiplier must be finite and at least 1`);
  }
  const maxDelayMs = timerNumber(
    retry?.maxDelayMs === undefined ? initialDelayMs : retry.maxDelayMs,
    `stages[${index}].retry.maxDelayMs`,
  );
  return Object.freeze({ maxAttempts, initialDelayMs, backoffMultiplier, maxDelayMs });
}

function captureStageProperty<Key extends keyof PipelineStage>(
  stage: PipelineStage,
  index: number,
  key: Key,
): PipelineStage[Key] {
  try {
    return Reflect.get(stage, key) as PipelineStage[Key];
  } catch (error) {
    throw new TypeError(
      `stages[${index}].${String(key)} getter failed: ${errorMessage(error)}`,
    );
  }
}

function normalizeStages(
  stages: Iterable<PipelineStage>,
  maxItems: number,
  maxStages: number,
): readonly NormalizedStage[] {
  if (stages === null || stages === undefined || typeof stages[Symbol.iterator] !== "function") {
    throw new TypeError("stages must be a finite iterable of PipelineStage values");
  }
  const result: NormalizedStage[] = [];
  const seen = new Set<string>();
  let attemptsPerItem = 0;
  let index = 0;
  for (const stage of stages) {
    if (index >= maxStages) {
      throw new TypeError(`pipeline stage count exceeds maxStages limit of ${maxStages}`);
    }
    if (typeof stage !== "object" || stage === null) {
      throw new TypeError(`stages[${index}] must be a PipelineStage`);
    }
    // Structural stage objects can expose accessors or Proxy traps. Capture
    // each public field exactly once before validation and retain only these
    // values so later reads cannot observe a different configuration.
    const id = captureStageProperty(stage, index, "id");
    const handler = captureStageProperty(stage, index, "handler");
    const configuredConcurrency = captureStageProperty(stage, index, "concurrency");
    const configuredTimeoutMs = captureStageProperty(stage, index, "timeoutMs");
    const retryOptions = captureStageProperty(stage, index, "retry");
    const configuredOnFailure = captureStageProperty(stage, index, "onFailure");

    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError(`stages[${index}].id must be a non-empty string`);
    }
    if (seen.has(id)) throw new TypeError(`duplicate pipeline stage id '${id}'`);
    seen.add(id);
    if (typeof handler !== "function") {
      throw new TypeError(`stages[${index}].handler must be a function`);
    }
    const concurrency = positiveInteger(
      configuredConcurrency === undefined ? 1 : configuredConcurrency,
      `stages[${index}].concurrency`,
    );
    const timeoutMs =
      configuredTimeoutMs === undefined
        ? undefined
        : timerInteger(configuredTimeoutMs, `stages[${index}].timeoutMs`);
    const retry = normalizeRetry(retryOptions, index);
    const onFailure = configuredOnFailure === undefined ? "dead-letter" : configuredOnFailure;
    if (!(["stop", "drop", "dead-letter"] as const).includes(onFailure)) {
      throw new TypeError(`stages[${index}].onFailure is invalid`);
    }
    attemptsPerItem += retry.maxAttempts;
    if (!Number.isSafeInteger(attemptsPerItem)) {
      throw new TypeError("pipeline attempt bound exceeds the portable safe range");
    }
    result.push(Object.freeze({
      id,
      handler,
      concurrency,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      retry,
      onFailure,
    }));
    index += 1;
  }
  if (attemptsPerItem > 0 && maxItems > Math.floor(MAX_SAFE_INTEGER / attemptsPerItem)) {
    throw new TypeError("pipeline maximum attempt count exceeds the portable safe range");
  }
  return Object.freeze(result);
}

function normalizeOptions(options: PipelineOptions): NormalizedOptions {
  const bufferCapacity = positiveInteger(
    options.bufferCapacity === undefined ? DEFAULT_BUFFER_CAPACITY : options.bufferCapacity,
    "bufferCapacity",
  );
  const maxInFlight = positiveInteger(
    options.maxInFlight === undefined ? DEFAULT_MAX_IN_FLIGHT : options.maxInFlight,
    "maxInFlight",
  );
  const maxItems = positiveInteger(
    options.maxItems === undefined ? DEFAULT_MAX_ITEMS : options.maxItems,
    "maxItems",
  );
  const maxStages = positiveInteger(
    options.maxStages === undefined ? DEFAULT_MAX_STAGES : options.maxStages,
    "maxStages",
  );
  if (maxStages > MAX_PIPELINE_STAGES) {
    throw new TypeError(`maxStages must be an integer from 1 to ${MAX_PIPELINE_STAGES}`);
  }
  const ordering = options.ordering === undefined ? "input" : options.ordering;
  if (ordering !== "input" && ordering !== "completion") {
    throw new TypeError("ordering must be 'input' or 'completion'");
  }
  const cancellationSignal = options.cancellationSignal;
  if (cancellationSignal !== undefined && !(cancellationSignal instanceof AbortSignal)) {
    throw new TypeError("cancellationSignal must be an AbortSignal");
  }
  return Object.freeze({
    bufferCapacity,
    maxInFlight,
    maxItems,
    maxStages,
    ordering,
    ...(cancellationSignal === undefined ? {} : { cancellationSignal }),
  });
}

function validateSource(source: PipelineSource): void {
  if (source === null || source === undefined) throw new TypeError("source must be iterable");
  const candidate = source as Partial<Iterable<unknown> & AsyncIterable<unknown>>;
  if (
    typeof candidate[Symbol.iterator] !== "function" &&
    typeof candidate[Symbol.asyncIterator] !== "function"
  ) {
    throw new TypeError("source must be iterable or async iterable");
  }
}

function errorName(error: unknown): string {
  const kind = error === null ? "object" : typeof error;
  if ((kind === "object" && error !== null) || kind === "function") {
    try {
      const name = Reflect.get(error as object, "name");
      if (typeof name === "string" && name.length > 0) return name;
    } catch {
      // Hostile/revoked proxies and diagnostic getters must not escape the
      // structured pipeline failure path.
    }
  }
  return kind;
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const kind = error === null ? "object" : typeof error;
  if ((kind === "object" && error !== null) || kind === "function") {
    try {
      const message = Reflect.get(error as object, "message");
      if (typeof message === "string" && message.length > 0) return message;
    } catch {
      // Fall through to a separately guarded name lookup.
    }
    try {
      const name = Reflect.get(error as object, "name");
      if (typeof name === "string" && name.length > 0) return name;
    } catch {
      // Diagnostic access is best-effort and must be total.
    }
  }
  return "non-Error value";
}

function itemFailure(
  code: PipelineFailureCode,
  message: string,
  itemIndex: number,
  attempt: number,
  fields: { stageId?: string; stageIndex?: number; causeName?: string } = {},
): PipelineItemFailure {
  return Object.freeze({ code, message, itemIndex, attempt, retryable: false, ...fields });
}

function snapshotRecord(record: Record<string, number>): Readonly<Record<string, number>> {
  const result = Object.create(null) as Record<string, number>;
  for (const [key, value] of Object.entries(record)) {
    Object.defineProperty(result, key, { value, enumerable: true });
  }
  return Object.freeze(result);
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new PipelineAbortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new PipelineAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) {
    return signal.aborted ? Promise.reject(new PipelineAbortError()) : Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new PipelineAbortError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

async function runHandlerAttempt(
  stage: NormalizedStage,
  stageIndex: number,
  itemIndex: number,
  input: JsonValue,
  attempt: number,
  runSignal: AbortSignal,
): Promise<AttemptOutcome> {
  if (runSignal.aborted) {
    return { succeeded: false, code: "ITEM_CANCELLED", message: "pipeline was cancelled" };
  }
  const attemptController = new AbortController();
  const relayAbort = () => attemptController.abort(runSignal.reason);
  runSignal.addEventListener("abort", relayAbort, { once: true });
  const context: PipelineHandlerContext = Object.freeze({
    input: snapshotJson(input),
    itemIndex,
    stageId: stage.id,
    stageIndex,
    attempt,
    signal: attemptController.signal,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const resolved = (value: unknown): AttemptOutcome => {
    if (runSignal.aborted && !timedOut) {
      return { succeeded: false, code: "ITEM_CANCELLED", message: "pipeline was cancelled" };
    }
    try {
      return { succeeded: true, output: snapshotJson(value) };
    } catch (error) {
      return {
        succeeded: false,
        code: "INVALID_OUTPUT",
        message: errorMessage(error),
        causeName: errorName(error),
      };
    }
  };
  const rejected = (error: unknown): AttemptOutcome => ({
      succeeded: false,
      code: runSignal.aborted && !timedOut ? "ITEM_CANCELLED" : "STAGE_EXECUTION_FAILED",
      message:
        runSignal.aborted && !timedOut
          ? "pipeline was cancelled"
          : `stage '${stage.id}' failed: ${errorMessage(error)}`,
      causeName: errorName(error),
    });
  let execution: Promise<AttemptOutcome>;
  try {
    const returned = stage.handler(context);
    const isThenable =
      (typeof returned === "object" && returned !== null) || typeof returned === "function"
        ? typeof (returned as { then?: unknown }).then === "function"
        : false;
    if (isThenable) {
      execution = Promise.resolve(returned).then(resolved, rejected);
    } else {
      // A synchronous handler can schedule a microtask that mutates its owned
      // return object. Capture it in the same call stack, before that task runs.
      execution = Promise.resolve(resolved(returned));
    }
  } catch (error) {
    execution = Promise.resolve(rejected(error));
  }
  execution.catch(() => undefined);

  let cancellationListener: (() => void) | undefined;
  const cancellation = new Promise<AttemptOutcome>((resolve) => {
    const onAbort = () => {
      attemptController.abort(runSignal.reason);
      resolve({ succeeded: false, code: "ITEM_CANCELLED", message: "pipeline was cancelled" });
    };
    cancellationListener = onAbort;
    if (runSignal.aborted) onAbort();
    else runSignal.addEventListener("abort", onAbort, { once: true });
  });

  const racers: Promise<AttemptOutcome>[] = [execution, cancellation];
  if (stage.timeoutMs !== undefined) {
    racers.push(new Promise<AttemptOutcome>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        attemptController.abort(new DOMException("Stage timed out", "TimeoutError"));
        resolve({
          succeeded: false,
          code: "STAGE_TIMEOUT",
          message: `stage '${stage.id}' timed out after ${stage.timeoutMs} ms`,
          causeName: "TimeoutError",
        });
      }, stage.timeoutMs);
    }));
  }
  try {
    return await Promise.race(racers);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    runSignal.removeEventListener("abort", relayAbort);
    if (cancellationListener !== undefined) {
      runSignal.removeEventListener("abort", cancellationListener);
    }
  }
}

function retryDelay(retry: NormalizedRetry, failedAttempt: number): number {
  const scaled = retry.initialDelayMs * retry.backoffMultiplier ** Math.max(0, failedAttempt - 1);
  return Math.min(retry.maxDelayMs, Number.isFinite(scaled) ? scaled : retry.maxDelayMs);
}

type PipelineIterator = Iterator<unknown> | AsyncIterator<unknown>;

class SourceAdapter {
  readonly #source: PipelineSource;
  #iterator: PipelineIterator | undefined;
  #closed = false;

  constructor(source: PipelineSource) {
    this.#source = source;
  }

  start(): void {
    const asyncFactory = (this.#source as AsyncIterable<unknown>)[Symbol.asyncIterator];
    this.#iterator = typeof asyncFactory === "function"
      ? asyncFactory.call(this.#source)
      : (this.#source as Iterable<unknown>)[Symbol.iterator]();
    // External cancellation is observed while the iterator factory runs. If
    // that synchronous application code cancelled before returning, honour
    // the already-requested close now that its iterator is available.
    if (this.#closed) this.#closeIterator();
  }

  async next(signal: AbortSignal): Promise<IteratorResult<unknown>> {
    if (this.#iterator === undefined) throw new Error("pipeline source was not started");
    let pending: Promise<IteratorResult<unknown>>;
    try {
      pending = Promise.resolve(this.#iterator.next());
    } catch (error) {
      return await Promise.reject(error);
    }
    return await raceWithAbort(pending, signal);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closeIterator();
  }

  #closeIterator(): void {
    try {
      // `return` itself may be an accessor supplied by application code, so
      // getter lookup belongs inside the diagnostic-only cleanup boundary.
      const iterator = this.#iterator;
      const close = iterator?.return;
      if (typeof close !== "function") return;
      Promise.resolve(Reflect.apply(close, iterator, []) as IteratorResult<unknown> | Promise<IteratorResult<unknown>>)
        .catch(() => undefined);
    } catch {
      // Source cleanup errors are diagnostic-only and never replace the first
      // run failure or explicit consumer cancellation.
    }
  }
}

const PIPELINE_END = Symbol("pipeline-end");

class DeliveryQueue {
  readonly #values: Array<PipelineItemResult | typeof PIPELINE_END> = [];
  readonly #waiters: Array<(value: PipelineItemResult | typeof PIPELINE_END) => void> = [];

  put(value: PipelineItemResult | typeof PIPELINE_END): void {
    const waiter = this.#waiters.shift();
    if (waiter === undefined) this.#values.push(value);
    else waiter(value);
  }

  take(): Promise<PipelineItemResult | typeof PIPELINE_END> {
    const value = this.#values.shift();
    if (value !== undefined) return Promise.resolve(value);
    return new Promise((resolve) => this.#waiters.push(resolve));
  }
}

interface StageExecution {
  readonly output: JsonValue;
  readonly attempts: number;
  readonly failure?: PipelineItemFailure;
  /** Success keeps the worker permit until its output enters the next buffer. */
  readonly releaseSuccessPermit?: () => void;
}

class PipelineRunImpl implements PipelineRun {
  readonly completion: Promise<PipelineSummary>;

  readonly #source: SourceAdapter;
  readonly #stages: readonly NormalizedStage[];
  readonly #options: NormalizedOptions;
  readonly #completionResolve: (summary: PipelineSummary) => void;
  readonly #runController = new AbortController();
  readonly #intakeController = new AbortController();
  readonly #delivery = new DeliveryQueue();
  readonly #credit: AsyncSemaphore;
  readonly #stageSlots: readonly AsyncSemaphore[];
  readonly #stageQueues: readonly AsyncSemaphore[];
  readonly #queueDepths: number[];
  readonly #queueMaxima: number[];
  readonly #activeAttempts: number[];
  readonly #activeMaxima: number[];
  readonly #statusCounts: Record<PipelineItemResult["status"], number> = {
    succeeded: 0,
    failed: 0,
    dropped: 0,
    cancelled: 0,
  };
  readonly #itemTasks = new Set<Promise<void>>();
  readonly #terminalIndices = new Set<number>();
  readonly #reorder = new Map<number, PipelineItemResult>();

  #started = false;
  #consumerClosed = false;
  #advancing = false;
  #sourceFinished = false;
  #processingFinished = false;
  #endSignalled = false;
  #summary: PipelineSummary | undefined;
  #producer: Promise<void> | undefined;
  #externalAbortListener: (() => void) | undefined;
  #accepted = 0;
  #emitted = 0;
  #nextInputResult = 0;
  #maxObservedInFlight = 0;
  #runFailure: PipelineRunFailure | undefined;

  constructor(source: PipelineSource, stages: readonly NormalizedStage[], options: NormalizedOptions) {
    this.#source = new SourceAdapter(source);
    this.#stages = stages;
    this.#options = options;
    this.#credit = new AsyncSemaphore(options.maxInFlight);
    this.#stageSlots = stages.map((stage) => new AsyncSemaphore(stage.concurrency));
    this.#stageQueues = stages.map(() => new AsyncSemaphore(options.bufferCapacity));
    this.#queueDepths = stages.map(() => 0);
    this.#queueMaxima = stages.map(() => 0);
    this.#activeAttempts = stages.map(() => 0);
    this.#activeMaxima = stages.map(() => 0);
    let resolveCompletion!: (summary: PipelineSummary) => void;
    this.completion = new Promise((resolve) => {
      resolveCompletion = resolve;
    });
    this.#completionResolve = resolveCompletion;
  }

  [Symbol.asyncIterator](): PipelineRun {
    return this;
  }

  async next(): Promise<IteratorResult<PipelineItemResult>> {
    if (this.#advancing) throw new TypeError("concurrent pipeline iteration is not allowed");
    if (this.#consumerClosed) return { done: true, value: undefined };
    this.#advancing = true;
    try {
      this.#start();
      const delivered = await this.#delivery.take();
      if (delivered === PIPELINE_END) {
        this.#consumerClosed = true;
        this.#finishSummary(this.#runController.signal.aborted ? "cancelled" : undefined);
        return { done: true, value: undefined };
      }
      this.#emitted += 1;
      this.#credit.release();
      this.#maybeFinishSummary();
      return { done: false, value: delivered };
    } finally {
      this.#advancing = false;
    }
  }

  async return(): Promise<IteratorResult<PipelineItemResult>> {
    await this.close(new DOMException("Pipeline consumer closed", "AbortError"));
    return { done: true, value: undefined };
  }

  async close(reason: unknown = new DOMException("Pipeline consumer closed", "AbortError")): Promise<PipelineSummary> {
    if (this.#summary !== undefined) return this.#summary;
    this.#consumerClosed = true;
    if (!this.#started) {
      this.#runController.abort(reason);
      this.#intakeController.abort(reason);
      this.#sourceFinished = true;
      this.#processingFinished = true;
      return this.#finishSummary("cancelled");
    }
    this.#cancel(reason);
    await (this.#producer ?? Promise.resolve());
    await Promise.allSettled([...this.#itemTasks]);
    this.#processingFinished = true;
    this.#signalEnd();
    return this.#finishSummary("cancelled");
  }

  #start(): void {
    if (this.#started) return;
    this.#started = true;
    const externalSignal = this.#options.cancellationSignal;
    if (externalSignal?.aborted) {
      this.#cancel(externalSignal.reason);
      this.#sourceFinished = true;
      this.#processingFinished = true;
      this.#signalEnd();
      return;
    }
    if (externalSignal !== undefined) {
      this.#externalAbortListener = () => this.#cancel(externalSignal.reason);
      externalSignal.addEventListener("abort", this.#externalAbortListener, { once: true });
      // Preserve the pre-start guarantee if cancellation occurs between the
      // initial check and listener registration.
      if (externalSignal.aborted) {
        this.#cancel(externalSignal.reason);
        this.#sourceFinished = true;
        this.#processingFinished = true;
        this.#signalEnd();
        return;
      }
    }
    try {
      this.#source.start();
    } catch (error) {
      this.#runFailure = Object.freeze({
        code: "SOURCE_FAILED",
        message: `pipeline source failed to create its iterator: ${errorMessage(error)}`,
        causeName: errorName(error),
      });
      // Iterator construction is application code. The external listener is
      // already active, so synchronous and queued cancellation both retain
      // summary priority while preserving this source failure diagnostic.
      this.#sourceFinished = true;
      this.#processingFinished = true;
      this.#signalEnd();
      return;
    }
    if (externalSignal?.aborted) {
      this.#cancel(externalSignal.reason);
      this.#sourceFinished = true;
      this.#processingFinished = true;
      this.#signalEnd();
      return;
    }
    this.#producer = this.#produce().catch((error: unknown) => {
      if (!this.#runController.signal.aborted && this.#runFailure === undefined) {
        this.#runFailure = Object.freeze({
          code: "SOURCE_FAILED",
          message: `pipeline source failed: ${errorMessage(error)}`,
          causeName: errorName(error),
        });
      }
    }).finally(() => {
      this.#sourceFinished = true;
      this.#source.close();
      this.#maybeFinishProcessing();
    });
  }

  #cancel(reason: unknown): void {
    if (!this.#runController.signal.aborted) this.#runController.abort(reason);
    if (!this.#intakeController.signal.aborted) this.#intakeController.abort(reason);
    this.#source.close();
  }

  #stopIntake(reason: unknown): void {
    if (!this.#intakeController.signal.aborted) this.#intakeController.abort(reason);
    this.#source.close();
  }

  async #produce(): Promise<void> {
    while (!this.#intakeController.signal.aborted) {
      if (this.#accepted >= this.#options.maxItems) {
        this.#runFailure ??= Object.freeze({
          code: "ITEM_LIMIT_REACHED",
          message: `pipeline accepted its maxItems limit of ${this.#options.maxItems}`,
        });
        this.#stopIntake(new Error("pipeline item limit reached"));
        break;
      }

      try {
        await this.#credit.acquire(this.#intakeController.signal);
      } catch (error) {
        if (error instanceof PipelineAbortError) break;
        throw error;
      }
      let queuedStage: number | undefined;
      try {
        if (this.#stages.length > 0) {
          queuedStage = 0;
          await this.#enterStageQueue(0, this.#intakeController.signal);
        }
        if (this.#intakeController.signal.aborted) throw new PipelineAbortError();
        const step = await this.#source.next(this.#intakeController.signal);
        // The source promise can settle immediately before caller cancellation
        // wins the next microtask. Do not admit that value after intake closed.
        if (this.#intakeController.signal.aborted) throw new PipelineAbortError();
        // IteratorResult fields are application-owned and may be accessors.
        // Capture `done` exactly once, then close the cancellation window its
        // getter can open before accepting or binding an item.
        const done = step.done;
        if (this.#intakeController.signal.aborted) throw new PipelineAbortError();
        if (done) {
          if (queuedStage !== undefined) this.#leaveStageQueue(queuedStage);
          this.#credit.release();
          break;
        }
        const itemIndex = this.#accepted;
        this.#accepted += 1;
        this.#maxObservedInFlight = Math.max(
          this.#maxObservedInFlight,
          this.#accepted - this.#emitted,
        );

        let input: JsonValue;
        try {
          // Snapshot before any later source pull. Sources may reuse and mutate
          // the same object between calls to next().
          input = snapshotJson(step.value);
        } catch (error) {
          if (queuedStage !== undefined) this.#leaveStageQueue(queuedStage);
          // Reading IteratorResult.value and portable-JSON snapshot getters are
          // application code. They may synchronously cancel the caller before
          // throwing, in which case cancellation owns the accepted item.
          let invalidMessage = "non-Error value";
          let invalidCauseName = "unknown";
          if (!this.#runController.signal.aborted) {
            invalidMessage = errorMessage(error);
            invalidCauseName = errorName(error);
          }
          const cancelled = this.#runController.signal.aborted;
          this.#commitResult(Object.freeze({
            itemIndex,
            status: cancelled ? "cancelled" : "failed",
            inputBound: false,
            completedStages: 0,
            totalAttempts: 0,
            failure: cancelled
              ? itemFailure(
                  "ITEM_CANCELLED",
                  "pipeline cancellation prevented input binding",
                  itemIndex,
                  0,
                )
              : itemFailure("INVALID_INPUT", invalidMessage, itemIndex, 0, {
                  causeName: invalidCauseName,
                }),
          }));
          continue;
        }

        const task = this.#processItem({
          itemIndex,
          input,
          value: input,
          completedStages: 0,
          totalAttempts: 0,
        }, queuedStage !== undefined);
        this.#itemTasks.add(task);
        task.catch(() => undefined).finally(() => {
          this.#itemTasks.delete(task);
          this.#maybeFinishProcessing();
        });
      } catch (error) {
        if (queuedStage !== undefined) this.#leaveStageQueue(queuedStage);
        this.#credit.release();
        if (error instanceof PipelineAbortError) break;
        this.#runFailure ??= Object.freeze({
          code: "SOURCE_FAILED",
          message: `pipeline source failed: ${errorMessage(error)}`,
          causeName: errorName(error),
        });
        this.#stopIntake(error);
        break;
      }
    }
  }

  async #processItem(item: ItemState, queued: boolean): Promise<void> {
    try {
      if (this.#runController.signal.aborted) {
        if (queued && this.#stages.length > 0) this.#leaveStageQueue(0);
        this.#commitResult(this.#cancelledResult(item));
        return;
      }

      for (const [stageIndex, stage] of this.#stages.entries()) {
        if (!queued) {
          try {
            await this.#enterStageQueue(stageIndex, this.#runController.signal);
          } catch (error) {
            if (error instanceof PipelineAbortError) {
              this.#commitResult(this.#cancelledResult(item, stage, stageIndex));
              return;
            }
            throw error;
          }
        }
        queued = false;

        const executed = await this.#executeStage(stage, stageIndex, item);
        item.totalAttempts += executed.attempts;
        const failure =
          executed.failure !== undefined &&
          this.#runController.signal.aborted &&
          executed.failure.code !== "ITEM_CANCELLED"
            ? itemFailure(
                "ITEM_CANCELLED",
                "pipeline cancellation won before the stage outcome committed",
                item.itemIndex,
                Math.max(1, executed.attempts),
                { stageId: stage.id, stageIndex },
              )
            : executed.failure;
        if (failure !== undefined) {
          const status =
            failure.code === "ITEM_CANCELLED"
              ? "cancelled"
              : stage.onFailure === "drop"
                ? "dropped"
                : "failed";
          if (stage.onFailure === "stop" && failure.code !== "ITEM_CANCELLED") {
            this.#stopIntake(new Error(`pipeline stopped by item ${item.itemIndex} at '${stage.id}'`));
          }
          this.#commitResult(Object.freeze({
            itemIndex: item.itemIndex,
            status,
            inputBound: true,
            input: item.input,
            completedStages: item.completedStages,
            totalAttempts: item.totalAttempts,
            failure,
          }));
          return;
        }

        item.value = executed.output;
        item.completedStages += 1;
        if (this.#runController.signal.aborted) {
          executed.releaseSuccessPermit?.();
          const nextStage = this.#stages[stageIndex + 1];
          this.#commitResult(
            nextStage === undefined
              ? this.#cancelledResult(item)
              : this.#cancelledResult(item, nextStage, stageIndex + 1),
          );
          return;
        }

        if (stageIndex + 1 < this.#stages.length) {
          try {
            // Keep the upstream worker permit until this validated output is
            // admitted to the bounded downstream queue. This is the actual
            // stage-to-stage backpressure boundary, not only a depth metric.
            await this.#enterStageQueue(stageIndex + 1, this.#runController.signal);
            queued = true;
          } catch (error) {
            executed.releaseSuccessPermit?.();
            if (error instanceof PipelineAbortError) {
              this.#commitResult(
                this.#cancelledResult(
                  item,
                  this.#stages[stageIndex + 1] as NormalizedStage,
                  stageIndex + 1,
                ),
              );
              return;
            }
            throw error;
          }
          executed.releaseSuccessPermit?.();
        } else {
          const result = this.#runController.signal.aborted
            ? this.#cancelledResult(item)
            : Object.freeze({
                itemIndex: item.itemIndex,
                status: "succeeded" as const,
                inputBound: true,
                input: item.input,
                output: item.value,
                completedStages: item.completedStages,
                totalAttempts: item.totalAttempts,
              });
          this.#commitResult(result);
          executed.releaseSuccessPermit?.();
          return;
        }
      }

      // An empty stage list is an identity pipeline.
      this.#commitResult(Object.freeze({
        itemIndex: item.itemIndex,
        status: "succeeded",
        inputBound: true,
        input: item.input,
        output: item.input,
        completedStages: 0,
        totalAttempts: 0,
      }));
    } catch (error) {
      if (queued && this.#stages.length > 0) {
        // The only queued state not consumed by #executeStage is the next stage.
        const index = Math.min(item.completedStages, this.#stages.length - 1);
        this.#leaveStageQueue(index);
      }
      if (!this.#terminalIndices.has(item.itemIndex)) {
        this.#commitResult(
          this.#runController.signal.aborted
            ? this.#cancelledResult(item)
            : Object.freeze({
                itemIndex: item.itemIndex,
                status: "failed",
                inputBound: true,
                input: item.input,
                completedStages: item.completedStages,
                totalAttempts: item.totalAttempts,
                failure: itemFailure(
                  "STAGE_EXECUTION_FAILED",
                  `pipeline coordinator failed: ${errorMessage(error)}`,
                  item.itemIndex,
                  item.totalAttempts,
                  { causeName: errorName(error) },
                ),
              }),
        );
      }
    }
  }

  async #executeStage(
    stage: NormalizedStage,
    stageIndex: number,
    item: ItemState,
  ): Promise<StageExecution> {
    const slot = this.#stageSlots[stageIndex] as AsyncSemaphore;
    for (let attempt = 1; attempt <= stage.retry.maxAttempts; attempt += 1) {
      try {
        await slot.acquire(this.#runController.signal);
      } catch (error) {
        if (attempt === 1) this.#leaveStageQueue(stageIndex);
        if (error instanceof PipelineAbortError) {
          return {
            output: item.value,
            attempts: attempt - 1,
            failure: itemFailure(
              "ITEM_CANCELLED",
              "pipeline was cancelled before the stage attempt",
              item.itemIndex,
              attempt - 1,
              { stageId: stage.id, stageIndex },
            ),
          };
        }
        throw error;
      }
      if (attempt === 1) this.#leaveStageQueue(stageIndex);
      // An immediately available semaphore still resumes through a promise
      // job. Cancellation may win that job boundary after the slot is granted
      // but before an attempt starts, so it must not consume attempt or
      // concurrency accounting and must not invoke the handler.
      if (this.#runController.signal.aborted) {
        slot.release();
        return {
          output: item.value,
          attempts: attempt - 1,
          failure: itemFailure(
            "ITEM_CANCELLED",
            "pipeline was cancelled before the stage attempt",
            item.itemIndex,
            attempt - 1,
            { stageId: stage.id, stageIndex },
          ),
        };
      }

      this.#activeAttempts[stageIndex] = (this.#activeAttempts[stageIndex] ?? 0) + 1;
      this.#activeMaxima[stageIndex] = Math.max(
        this.#activeMaxima[stageIndex] ?? 0,
        this.#activeAttempts[stageIndex] ?? 0,
      );
      let outcome: AttemptOutcome;
      let holdPermitForSuccess = false;
      try {
        outcome = await runHandlerAttempt(
          stage,
          stageIndex,
          item.itemIndex,
          item.value,
          attempt,
          this.#runController.signal,
        );
        holdPermitForSuccess = outcome.succeeded;
      } catch (error) {
        // Keep the coordinator total even if application-owned diagnostic
        // access or another unexpected attempt boundary throws.
        const message = errorMessage(error);
        const causeName = errorName(error);
        const cancelled = this.#runController.signal.aborted;
        outcome = cancelled
          ? { succeeded: false, code: "ITEM_CANCELLED", message: "pipeline was cancelled" }
          : {
              succeeded: false,
              code: "STAGE_EXECUTION_FAILED",
              message: `stage '${stage.id}' failed: ${message}`,
              causeName,
            };
      } finally {
        this.#activeAttempts[stageIndex] = (this.#activeAttempts[stageIndex] ?? 1) - 1;
        // A successful attempt intentionally retains its permit until the
        // validated output reaches the bounded downstream queue. Every other
        // path, including an unexpected throw, releases it here.
        if (!holdPermitForSuccess) slot.release();
      }

      if (outcome.succeeded) {
        let released = false;
        return {
          output: outcome.output,
          attempts: attempt,
          releaseSuccessPermit: () => {
            if (released) return;
            released = true;
            slot.release();
          },
        };
      }

      const canRetry =
        (outcome.code === "STAGE_EXECUTION_FAILED" || outcome.code === "STAGE_TIMEOUT") &&
        attempt < stage.retry.maxAttempts &&
        !this.#runController.signal.aborted;
      if (!canRetry) {
        return {
          output: item.value,
          attempts: attempt,
          failure: itemFailure(outcome.code, outcome.message, item.itemIndex, attempt, {
            stageId: stage.id,
            stageIndex,
            ...(outcome.causeName === undefined ? {} : { causeName: outcome.causeName }),
          }),
        };
      }
      try {
        await abortableDelay(retryDelay(stage.retry, attempt), this.#runController.signal);
      } catch (error) {
        if (!(error instanceof PipelineAbortError)) throw error;
        return {
          output: item.value,
          attempts: attempt,
          failure: itemFailure(
            "ITEM_CANCELLED",
            "pipeline cancellation interrupted retry delay",
            item.itemIndex,
            attempt,
            { stageId: stage.id, stageIndex },
          ),
        };
      }
    }
    throw new Error("bounded pipeline retry loop exited without an outcome");
  }

  async #enterStageQueue(stageIndex: number, signal: AbortSignal): Promise<void> {
    const queue = this.#stageQueues[stageIndex] as AsyncSemaphore;
    await queue.acquire(signal);
    this.#queueDepths[stageIndex] = (this.#queueDepths[stageIndex] ?? 0) + 1;
    this.#queueMaxima[stageIndex] = Math.max(
      this.#queueMaxima[stageIndex] ?? 0,
      this.#queueDepths[stageIndex] ?? 0,
    );
  }

  #leaveStageQueue(stageIndex: number): void {
    if ((this.#queueDepths[stageIndex] ?? 0) <= 0) return;
    this.#queueDepths[stageIndex] = (this.#queueDepths[stageIndex] ?? 1) - 1;
    (this.#stageQueues[stageIndex] as AsyncSemaphore).release();
  }

  #cancelledResult(
    item: ItemState,
    stage?: NormalizedStage,
    stageIndex?: number,
  ): PipelineItemResult {
    return Object.freeze({
      itemIndex: item.itemIndex,
      status: "cancelled",
      inputBound: true,
      input: item.input,
      completedStages: item.completedStages,
      totalAttempts: item.totalAttempts,
      failure: itemFailure(
        "ITEM_CANCELLED",
        "pipeline cancellation prevented the item from completing",
        item.itemIndex,
        0,
        {
          ...(stage === undefined ? {} : { stageId: stage.id }),
          ...(stageIndex === undefined ? {} : { stageIndex }),
        },
      ),
    });
  }

  #commitResult(result: PipelineItemResult): void {
    if (this.#terminalIndices.has(result.itemIndex)) return;
    this.#terminalIndices.add(result.itemIndex);
    this.#statusCounts[result.status] += 1;
    if (this.#consumerClosed) {
      this.#credit.release();
      return;
    }
    if (this.#options.ordering === "completion") {
      this.#delivery.put(result);
      return;
    }
    this.#reorder.set(result.itemIndex, result);
    while (this.#reorder.has(this.#nextInputResult)) {
      this.#delivery.put(this.#reorder.get(this.#nextInputResult) as PipelineItemResult);
      this.#reorder.delete(this.#nextInputResult);
      this.#nextInputResult += 1;
    }
  }

  #maybeFinishProcessing(): void {
    if (!this.#sourceFinished || this.#itemTasks.size > 0 || this.#processingFinished) return;
    this.#processingFinished = true;
    this.#signalEnd();
    this.#maybeFinishSummary();
  }

  #signalEnd(): void {
    if (this.#endSignalled) return;
    this.#endSignalled = true;
    this.#delivery.put(PIPELINE_END);
  }

  #maybeFinishSummary(): void {
    if (!this.#processingFinished || this.#summary !== undefined) return;
    if (!this.#consumerClosed && this.#emitted < this.#accepted) return;
    this.#finishSummary(this.#runController.signal.aborted ? "cancelled" : undefined);
  }

  #finishSummary(forcedStatus?: PipelineRunStatus): PipelineSummary {
    if (this.#summary !== undefined) return this.#summary;
    const status = forcedStatus ?? (
      this.#runFailure !== undefined || this.#statusCounts.failed > 0 || this.#statusCounts.dropped > 0
        ? "failed"
        : "succeeded"
    );
    const concurrency: Record<string, number> = Object.create(null) as Record<string, number>;
    const queueDepth: Record<string, number> = Object.create(null) as Record<string, number>;
    for (const [index, stage] of this.#stages.entries()) {
      Object.defineProperty(concurrency, stage.id, {
        value: this.#activeMaxima[index] ?? 0,
        enumerable: true,
      });
      Object.defineProperty(queueDepth, stage.id, {
        value: this.#queueMaxima[index] ?? 0,
        enumerable: true,
      });
    }
    const summary: PipelineSummary = Object.freeze({
      status,
      accepted: this.#accepted,
      emitted: this.#emitted,
      succeeded: this.#statusCounts.succeeded,
      failed: this.#statusCounts.failed,
      dropped: this.#statusCounts.dropped,
      cancelled: this.#statusCounts.cancelled,
      maxObservedInFlight: this.#maxObservedInFlight,
      stageMaxObservedConcurrency: snapshotRecord(concurrency),
      stageMaxObservedQueueDepth: snapshotRecord(queueDepth),
      ...(this.#runFailure === undefined ? {} : { runFailure: this.#runFailure }),
    });
    this.#summary = summary;
    if (this.#externalAbortListener !== undefined) {
      this.#options.cancellationSignal?.removeEventListener("abort", this.#externalAbortListener);
    }
    this.#completionResolve(summary);
    return summary;
  }
}

/** Construct a lazy, bounded, single-consumer pipeline over portable JSON items. */
export function runPipeline(
  source: PipelineSource,
  stages: Iterable<PipelineStage>,
  options: PipelineOptions = {},
): PipelineRun {
  validateSource(source);
  const normalizedOptions = normalizeOptions(options);
  const normalizedStages = normalizeStages(
    stages,
    normalizedOptions.maxItems,
    normalizedOptions.maxStages,
  );
  return new PipelineRunImpl(source, normalizedStages, normalizedOptions);
}
