import { describe, expect, it, vi } from "vitest";
import {
  runPipeline,
  type PipelineHandlerContext,
  type PipelineItemResult,
  type PipelineStage,
} from "../src/index.js";

function gate(): { readonly promise: Promise<void>; readonly open: () => void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function collect(run: AsyncIterable<PipelineItemResult>): Promise<PipelineItemResult[]> {
  const results: PipelineItemResult[] = [];
  for await (const result of run) results.push(result);
  return results;
}

async function flushMicrotasks(turns = 20): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
}

describe("runPipeline", () => {
  it("is lazy, is its own iterator, and preserves JSON null presence", async () => {
    let iterated = 0;
    let pulls = 0;
    const source: Iterable<unknown> = {
      [Symbol.iterator]() {
        iterated += 1;
        return {
          next(): IteratorResult<unknown> {
            pulls += 1;
            return pulls === 1 ? { done: false, value: null } : { done: true, value: undefined };
          },
        };
      },
    };

    const run = runPipeline(source, [], { maxItems: 2, maxInFlight: 1 });
    expect(run[Symbol.asyncIterator]()).toBe(run);
    expect(iterated).toBe(0);
    expect(pulls).toBe(0);

    let completionSettled = false;
    void run.completion.then(() => { completionSettled = true; });
    await flushMicrotasks(2);
    expect(completionSettled).toBe(false);
    expect(iterated).toBe(0);

    const first = await run.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatchObject({
      itemIndex: 0,
      status: "succeeded",
      inputBound: true,
      input: null,
      output: null,
      completedStages: 0,
      totalAttempts: 0,
    });
    expect(Object.hasOwn(first.value as object, "failure")).toBe(false);
    expect((await run.next()).done).toBe(true);
    expect(await run.completion).toMatchObject({
      status: "succeeded",
      accepted: 1,
      emitted: 1,
      succeeded: 1,
    });
  });

  it("bounds retries and dead-letters invalid output without stopping siblings", async () => {
    const attempts = new Map<number, number>();
    const run = runPipeline(
      [1, 2, 3],
      [{
        id: "prepare",
        concurrency: 2,
        retry: { maxAttempts: 2 },
        handler: async (context) => {
          attempts.set(context.itemIndex, (attempts.get(context.itemIndex) ?? 0) + 1);
          if (context.itemIndex === 0 && context.attempt === 1) throw new Error("transient");
          if (context.itemIndex === 2) return Number.POSITIVE_INFINITY;
          return { value: context.input };
        },
      }],
      { bufferCapacity: 1, maxInFlight: 3, maxItems: 4 },
    );

    const results = await collect(run);
    expect(results.map(({ itemIndex }) => itemIndex)).toEqual([0, 1, 2]);
    expect(results.map(({ status }) => status)).toEqual(["succeeded", "succeeded", "failed"]);
    expect(results[0]?.totalAttempts).toBe(2);
    expect(results[2]?.totalAttempts).toBe(1);
    expect(results[2]?.failure).toMatchObject({
      code: "INVALID_OUTPUT",
      stageId: "prepare",
      stageIndex: 0,
      attempt: 1,
      retryable: false,
    });
    expect(attempts.get(2)).toBe(1);
    const summary = await run.completion;
    expect(summary).toMatchObject({ status: "failed", succeeded: 2, failed: 1 });
    expect(summary.maxObservedInFlight).toBeLessThanOrEqual(3);
    expect(summary.stageMaxObservedConcurrency.prepare).toBeLessThanOrEqual(2);
    expect(summary.stageMaxObservedQueueDepth.prepare).toBeLessThanOrEqual(1);
  });

  it("contains hostile error getters and releases the stage slot for the next item", async () => {
    let messageReads = 0;
    let nameReads = 0;
    const hostile = new Proxy(new Error("hidden"), {
      get(target, property, receiver) {
        if (property === "message") {
          messageReads += 1;
          throw new Error("message getter failed");
        }
        if (property === "name") {
          nameReads += 1;
          throw new Error("name getter failed");
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const calls: number[] = [];
    const safetyController = new AbortController();
    const run = runPipeline(
      [0, 1],
      [{
        id: "serial",
        concurrency: 1,
        handler: ({ input }) => {
          if (typeof input !== "number") throw new TypeError("expected number");
          calls.push(input);
          if (input === 0) throw hostile;
          return input;
        },
      }],
      {
        bufferCapacity: 1,
        maxInFlight: 1,
        maxItems: 3,
        cancellationSignal: safetyController.signal,
      },
    );
    const safetyTimer = setTimeout(() => {
      safetyController.abort(new Error("stage-slot regression timed out"));
    }, 1_000);

    try {
      const results = await collect(run);
      expect(calls).toEqual([0, 1]);
      expect(results[0]).toMatchObject({
        itemIndex: 0,
        status: "failed",
        totalAttempts: 1,
        failure: {
          code: "STAGE_EXECUTION_FAILED",
          stageId: "serial",
          attempt: 1,
          causeName: "object",
        },
      });
      expect(results[0]?.failure?.message).toContain("stage 'serial' failed");
      expect(results[1]).toMatchObject({ itemIndex: 1, status: "succeeded", output: 1 });
      expect(messageReads).toBeGreaterThan(0);
      expect(nameReads).toBeGreaterThan(0);
      expect(await run.completion).toMatchObject({
        status: "failed",
        succeeded: 1,
        failed: 1,
        stageMaxObservedConcurrency: { serial: 1 },
      });
    } finally {
      clearTimeout(safetyTimer);
      await run.close();
    }
  });

  it("emits drop as an explicit structured terminal record", async () => {
    const stages: PipelineStage[] = [{
      id: "validate",
      onFailure: "drop",
      handler: ({ itemIndex }) => {
        if (itemIndex === 0) throw Object.assign(new Error("bad item"), { name: "Rejected" });
        return "accepted";
      },
    }];
    const run = runPipeline(["bad", "good"], stages, { maxItems: 3, maxInFlight: 2 });
    stages.length = 0;

    const results = await collect(run);
    expect(results[0]).toMatchObject({
      itemIndex: 0,
      status: "dropped",
      input: "bad",
      completedStages: 0,
      totalAttempts: 1,
      failure: { code: "STAGE_EXECUTION_FAILED", causeName: "Rejected" },
    });
    expect(Object.hasOwn(results[0] as object, "output")).toBe(false);
    expect(results[1]).toMatchObject({ status: "succeeded", output: "accepted" });
    expect((await run.completion).dropped).toBe(1);
  });

  it("stop closes its source without one extra pull", async () => {
    let pulls = 0;
    let closes = 0;
    const source: Iterable<string> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<string> {
            pulls += 1;
            return { done: false, value: pulls === 1 ? "stop" : "must-not-pull" };
          },
          return(): IteratorResult<string> {
            closes += 1;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const run = runPipeline(
      source,
      [{ id: "gate", onFailure: "stop", handler: () => { throw new Error("stop"); } }],
      { bufferCapacity: 1, maxInFlight: 1, maxItems: 3 },
    );

    const results = await collect(run);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("failed");
    expect(pulls).toBe(1);
    expect(closes).toBe(1);
  });

  it("enforces maxItems without probing the source again", async () => {
    let pulls = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            pulls += 1;
            return { done: false, value: pulls };
          },
        };
      },
    };
    const run = runPipeline(source, [], { maxItems: 2, maxInFlight: 2 });
    expect(await collect(run)).toHaveLength(2);
    expect(pulls).toBe(2);
    expect(await run.completion).toMatchObject({
      status: "failed",
      accepted: 2,
      emitted: 2,
      runFailure: { code: "ITEM_LIMIT_REACHED" },
    });
  });

  it("drains an accepted prefix after an asynchronous source error", async () => {
    async function* source(): AsyncGenerator<number> {
      yield 1;
      yield 2;
      throw Object.assign(new Error("offline"), { name: "SourceOffline" });
    }
    const run = runPipeline(source(), [], { maxItems: 4, maxInFlight: 3 });
    expect((await collect(run)).map(({ output }) => output)).toEqual([1, 2]);
    expect(await run.completion).toMatchObject({
      status: "failed",
      accepted: 2,
      emitted: 2,
      runFailure: { code: "SOURCE_FAILED", causeName: "SourceOffline" },
    });
  });

  it("lets a fast item enter a later stage before a slow earlier item finishes", async () => {
    const releaseSlow = gate();
    let fastReachedSecond = false;
    const run = runPipeline(
      ["slow", "fast"],
      [
        {
          id: "first",
          concurrency: 2,
          handler: async (context) => {
            if (context.itemIndex === 0) {
              await releaseSlow.promise;
              return "slow-first";
            }
            return "fast-first";
          },
        },
        {
          id: "second",
          handler: (context) => {
            if (context.itemIndex === 1) {
              fastReachedSecond = true;
              releaseSlow.open();
              return "fast-done";
            }
            return "slow-done";
          },
        },
      ],
      { bufferCapacity: 1, maxInFlight: 2, maxItems: 3, ordering: "input" },
    );

    const results = await collect(run);
    expect(fastReachedSecond).toBe(true);
    expect(results.map(({ itemIndex }) => itemIndex)).toEqual([0, 1]);
    expect(results.map(({ output }) => output)).toEqual(["slow-done", "fast-done"]);
  });

  it("delivers terminal records in completion order when requested", async () => {
    const releaseSlow = gate();
    const run = runPipeline(
      [0, 1],
      [{
        id: "work",
        concurrency: 2,
        handler: async (context) => {
          if (context.itemIndex === 0) await releaseSlow.promise;
          return context.itemIndex === 0 ? "slow" : "fast";
        },
      }],
      { maxItems: 3, maxInFlight: 2, ordering: "completion" },
    );
    const first = await run.next();
    expect(first.value?.itemIndex).toBe(1);
    releaseSlow.open();
    expect((await run.next()).value?.itemIndex).toBe(0);
    expect((await run.next()).done).toBe(true);
  });

  it("holds global credit until delivery and bounds slow-consumer pull-ahead", async () => {
    let pulls = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            if (pulls >= 5) return { done: true, value: undefined };
            const value = pulls;
            pulls += 1;
            return { done: false, value };
          },
        };
      },
    };
    const run = runPipeline(source, [], {
      bufferCapacity: 1,
      maxInFlight: 2,
      maxItems: 6,
      ordering: "completion",
    });
    const first = await run.next();
    await flushMicrotasks();
    const pullsWhilePaused = pulls;
    const rest = await collect(run);

    expect(pullsWhilePaused).toBeLessThanOrEqual(3);
    expect(new Set([first.value, ...rest].map((item) => item?.itemIndex))).toEqual(
      new Set([0, 1, 2, 3, 4]),
    );
    expect((await run.completion).maxObservedInFlight).toBeLessThanOrEqual(2);
  });

  it("applies real downstream-buffer backpressure to additional upstream attempts", async () => {
    const downstreamStarted = gate();
    const releaseDownstream = gate();
    let upstreamCalls = 0;
    const run = runPipeline(
      [0, 1, 2, 3, 4],
      [
        {
          id: "upstream",
          concurrency: 1,
          handler: (context) => {
            upstreamCalls += 1;
            return context.input;
          },
        },
        {
          id: "downstream",
          concurrency: 1,
          handler: async (context) => {
            if (context.itemIndex === 0) {
              downstreamStarted.open();
              await releaseDownstream.promise;
            }
            return context.input;
          },
        },
      ],
      { bufferCapacity: 1, maxInFlight: 5, maxItems: 6 },
    );

    const firstRead = run.next();
    await downstreamStarted.promise;
    await flushMicrotasks();
    const callsWhileBlocked = upstreamCalls;
    releaseDownstream.open();
    const first = await firstRead;
    const rest = await collect(run);

    expect(callsWhileBlocked).toBeLessThanOrEqual(3);
    expect([first.value, ...rest]).toHaveLength(5);
    expect((await run.completion).stageMaxObservedQueueDepth.downstream).toBeLessThanOrEqual(1);
  });

  it("does not construct or pull a pre-cancelled source", async () => {
    let iterated = 0;
    let pulls = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        iterated += 1;
        return {
          next(): IteratorResult<number> {
            pulls += 1;
            return { done: false, value: 1 };
          },
        };
      },
    };
    const controller = new AbortController();
    controller.abort(new Error("pre-cancelled"));
    const run = runPipeline(source, [], { cancellationSignal: controller.signal });

    expect(await collect(run)).toEqual([]);
    expect(iterated).toBe(0);
    expect(pulls).toBe(0);
    expect((await run.completion).status).toBe("cancelled");
  });

  it("gives cancellation priority when iterator construction aborts and throws", async () => {
    const controller = new AbortController();
    const source: Iterable<number> = {
      [Symbol.iterator](): Iterator<number> {
        controller.abort(new Error("cancel from factory"));
        throw new Error("factory failed after cancellation");
      },
    };
    const run = runPipeline(source, [], { cancellationSignal: controller.signal });

    expect(await collect(run)).toEqual([]);
    expect(await run.completion).toMatchObject({
      status: "cancelled",
      accepted: 0,
      runFailure: { code: "SOURCE_FAILED" },
    });
  });

  it("gives queued cancellation priority when iterator construction throws", async () => {
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, "removeEventListener");
    const source: Iterable<number> = {
      [Symbol.iterator](): Iterator<number> {
        queueMicrotask(() => controller.abort(new Error("queued cancel from factory")));
        throw new Error("factory failed before queued cancellation");
      },
    };
    const run = runPipeline(source, [], { cancellationSignal: controller.signal });

    expect(await collect(run)).toEqual([]);
    expect(await run.completion).toMatchObject({
      status: "cancelled",
      accepted: 0,
      runFailure: { code: "SOURCE_FAILED" },
    });
    expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("ignores a throwing source return getter without hanging completion", async () => {
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            return { done: true, value: undefined };
          },
          get return(): never {
            throw new Error("cleanup getter failed");
          },
        };
      },
    };
    const run = runPipeline(source, [], { maxItems: 2, maxInFlight: 1 });

    expect(await run.next()).toEqual({ done: true, value: undefined });
    expect(await run.completion).toMatchObject({ status: "succeeded", accepted: 0, emitted: 0 });
  });

  it("does not admit a source value when cancellation wins after pull settlement", async () => {
    const controller = new AbortController();
    let pulls = 0;
    const source: AsyncIterable<number> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<number>> {
            pulls += 1;
            const settled = Promise.resolve({ done: false as const, value: 42 });
            void settled.then(() => queueMicrotask(() => controller.abort(new Error("cancel"))));
            return settled;
          },
        };
      },
    };
    const run = runPipeline(source, [], {
      maxItems: 2,
      maxInFlight: 1,
      cancellationSignal: controller.signal,
    });

    expect(await collect(run)).toEqual([]);
    expect(pulls).toBe(1);
    expect(await run.completion).toMatchObject({
      status: "cancelled",
      accepted: 0,
      emitted: 0,
    });
  });

  it("does not admit a source value when its done getter cancels and returns false", async () => {
    const controller = new AbortController();
    let doneReads = 0;
    let valueReads = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            return {
              get done(): false {
                doneReads += 1;
                controller.abort(new Error("cancel from done getter"));
                return false;
              },
              get value(): number {
                valueReads += 1;
                return 42;
              },
            };
          },
        };
      },
    };
    const run = runPipeline(source, [], {
      maxItems: 2,
      maxInFlight: 1,
      cancellationSignal: controller.signal,
    });

    expect(await collect(run)).toEqual([]);
    expect(doneReads).toBe(1);
    expect(valueReads).toBe(0);
    expect(await run.completion).toMatchObject({
      status: "cancelled",
      accepted: 0,
      emitted: 0,
    });
  });

  it("retains a source failure when its done getter cancels and throws", async () => {
    const controller = new AbortController();
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            return {
              get done(): never {
                controller.abort(new Error("cancel from throwing done getter"));
                throw Object.assign(new Error("done getter failed"), { name: "DoneGetterError" });
              },
              value: 42,
            };
          },
        };
      },
    };
    const run = runPipeline(source, [], {
      maxItems: 2,
      maxInFlight: 1,
      cancellationSignal: controller.signal,
    });

    expect(await collect(run)).toEqual([]);
    expect(await run.completion).toMatchObject({
      status: "cancelled",
      accepted: 0,
      emitted: 0,
      runFailure: { code: "SOURCE_FAILED", causeName: "DoneGetterError" },
    });
  });

  it("gives cancellation priority when a value getter aborts and throws during snapshot", async () => {
    const controller = new AbortController();
    let pulls = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            pulls += 1;
            return {
              done: false,
              get value(): number {
                controller.abort(new Error("cancel from value getter"));
                throw new Error("value getter failed after cancellation");
              },
            };
          },
        };
      },
    };
    const run = runPipeline(source, [], {
      maxItems: 2,
      maxInFlight: 1,
      cancellationSignal: controller.signal,
    });

    const results = await collect(run);
    expect(pulls).toBe(1);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      itemIndex: 0,
      status: "cancelled",
      inputBound: false,
      completedStages: 0,
      totalAttempts: 0,
      failure: { code: "ITEM_CANCELLED", attempt: 0, retryable: false },
    });
    expect(Object.hasOwn(results[0] as object, "input")).toBe(false);
    expect(Object.hasOwn(results[0] as object, "output")).toBe(false);
    expect(await run.completion).toMatchObject({
      status: "cancelled",
      accepted: 1,
      emitted: 1,
      failed: 0,
      cancelled: 1,
    });
  });

  it("does not start or count a stage attempt when cancellation wins after slot acquisition", async () => {
    const controller = new AbortController();
    let pulled = false;
    let handlerCalls = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<number> {
            if (pulled) return { done: true, value: undefined };
            pulled = true;
            return {
              done: false,
              get value(): number {
                queueMicrotask(() => controller.abort(new Error("cancel after slot acquisition")));
                return 42;
              },
            };
          },
        };
      },
    };
    const run = runPipeline(
      source,
      [{
        id: "work",
        handler: ({ input }) => {
          handlerCalls += 1;
          return input;
        },
      }],
      { maxItems: 2, maxInFlight: 1, cancellationSignal: controller.signal },
    );

    const result = await run.next();
    expect(handlerCalls).toBe(0);
    expect(result.value).toMatchObject({
      itemIndex: 0,
      status: "cancelled",
      inputBound: true,
      input: 42,
      completedStages: 0,
      totalAttempts: 0,
      failure: {
        code: "ITEM_CANCELLED",
        stageId: "work",
        stageIndex: 0,
        attempt: 0,
      },
    });
    expect((await run.next()).done).toBe(true);
    expect(await run.completion).toMatchObject({
      status: "cancelled",
      accepted: 1,
      emitted: 1,
      stageMaxObservedConcurrency: { work: 0 },
    });
  });

  it("settles a running item as cancelled and signals its handler", async () => {
    const started = gate();
    let handlerObservedAbort = false;
    const controller = new AbortController();
    const run = runPipeline(
      [1],
      [{
        id: "work",
        handler: async ({ signal }) => {
          started.open();
          await new Promise<void>((resolve) => {
            const onAbort = () => {
              handlerObservedAbort = true;
              resolve();
            };
            if (signal.aborted) onAbort();
            else signal.addEventListener("abort", onAbort, { once: true });
          });
          return "late-success";
        },
      }],
      { maxItems: 2, maxInFlight: 1, cancellationSignal: controller.signal },
    );
    const pending = run.next();
    await started.promise;
    controller.abort(new Error("cancel"));
    const result = await pending;

    expect(result.value).toMatchObject({
      status: "cancelled",
      totalAttempts: 1,
      failure: { code: "ITEM_CANCELLED" },
    });
    expect(handlerObservedAbort).toBe(true);
    expect((await run.next()).done).toBe(true);
    expect((await run.completion).status).toBe("cancelled");
  });

  it("gives cancellation priority before a rejected stage outcome commits", async () => {
    const controller = new AbortController();
    const run = runPipeline(
      [1],
      [{
        id: "work",
        onFailure: "stop",
        handler: () => {
          const rejected = Promise.reject(new Error("stage failed"));
          void rejected.catch(() => queueMicrotask(() => controller.abort(new Error("cancel"))));
          return rejected;
        },
      }],
      { maxItems: 2, maxInFlight: 1, cancellationSignal: controller.signal },
    );

    const result = await run.next();
    expect(result.value).toMatchObject({
      status: "cancelled",
      totalAttempts: 1,
      failure: { code: "ITEM_CANCELLED", stageId: "work", stageIndex: 0 },
    });
    expect((await run.next()).done).toBe(true);
    expect(await run.completion).toMatchObject({ status: "cancelled", failed: 0, cancelled: 1 });
  });

  it("identifies the next stage when cancellation interrupts downstream admission", async () => {
    const controller = new AbortController();
    const downstreamStarted = gate();
    const allUpstreamReturned = gate();
    let upstreamReturns = 0;
    const run = runPipeline(
      [0, 1, 2],
      [
        {
          id: "upstream",
          concurrency: 3,
          handler: ({ input }) => {
            upstreamReturns += 1;
            if (upstreamReturns === 3) allUpstreamReturned.open();
            return input;
          },
        },
        {
          id: "downstream",
          concurrency: 1,
          handler: async () => {
            downstreamStarted.open();
            return await new Promise<never>(() => undefined);
          },
        },
      ],
      {
        bufferCapacity: 1,
        maxInFlight: 3,
        maxItems: 4,
        cancellationSignal: controller.signal,
      },
    );
    const firstRead = run.next();
    await downstreamStarted.promise;
    await allUpstreamReturned.promise;
    await flushMicrotasks();
    controller.abort(new Error("cancel blocked admission"));
    const first = await firstRead;
    const results = [first.value, ...await collect(run)];
    const blocked = results.find((item) => item?.itemIndex === 2);

    expect(blocked).toMatchObject({
      status: "cancelled",
      completedStages: 1,
      totalAttempts: 1,
      failure: {
        code: "ITEM_CANCELLED",
        stageId: "downstream",
        stageIndex: 1,
        attempt: 0,
      },
    });
  });

  it("times out and retries to the exact finite attempt bound", async () => {
    let calls = 0;
    const run = runPipeline(
      [1],
      [{
        id: "work",
        timeoutMs: 2,
        retry: { maxAttempts: 2 },
        handler: () => {
          calls += 1;
          return new Promise<never>(() => undefined);
        },
      }],
      { maxItems: 2, maxInFlight: 1 },
    );
    const result = await run.next();

    expect(result.value).toMatchObject({
      status: "failed",
      totalAttempts: 2,
      failure: { code: "STAGE_TIMEOUT", attempt: 2 },
    });
    expect(calls).toBe(2);
    expect((await run.next()).done).toBe(true);
  });

  it("for-await break delegates to idempotent close and accounts accepted work", async () => {
    const run = runPipeline([0, 1, 2, 3], [], { maxItems: 5, maxInFlight: 2 });
    for await (const item of run) {
      expect(item.itemIndex).toBe(0);
      break;
    }
    const firstSummary = await run.completion;
    const secondSummary = await run.close();

    expect(firstSummary.status).toBe("cancelled");
    expect(firstSummary.accepted).toBe(
      firstSummary.succeeded + firstSummary.failed + firstSummary.dropped + firstSummary.cancelled,
    );
    expect(secondSummary).toBe(firstSummary);
  });

  it("close wakes a pending read and completes without further demand", async () => {
    const started = gate();
    const run = runPipeline(
      [1],
      [{
        id: "work",
        handler: async ({ signal }) => {
          started.open();
          await new Promise<void>((resolve) => {
            if (signal.aborted) resolve();
            else signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return "late";
        },
      }],
      { maxItems: 2, maxInFlight: 1 },
    );
    const pendingRead = run.next();
    await started.promise;
    const summary = await run.close();
    const delivered = await pendingRead;

    expect(delivered.done).toBe(true);
    expect(summary).toMatchObject({ status: "cancelled", accepted: 1, emitted: 0, cancelled: 1 });
    expect(await run.close()).toBe(summary);
  });

  it("rejects concurrent next without stealing the pending result", async () => {
    const started = gate();
    const release = gate();
    const run = runPipeline(
      [1],
      [{
        id: "work",
        handler: async (context) => {
          started.open();
          await release.promise;
          return context.input;
        },
      }],
      { maxItems: 2 },
    );
    const firstRead = run.next();
    await started.promise;
    await expect(run.next()).rejects.toThrow(/concurrent/i);
    release.open();
    expect((await firstRead).value?.output).toBe(1);
    expect((await run.next()).done).toBe(true);
  });

  it("snapshots a reused source value before the next pull mutates it", async () => {
    const shared = { values: [1] };
    let pull = 0;
    const source: Iterable<unknown> = {
      [Symbol.iterator]() {
        return {
          next(): IteratorResult<unknown> {
            pull += 1;
            if (pull === 1) return { done: false, value: shared };
            if (pull === 2) {
              shared.values.push(2);
              return { done: false, value: "second" };
            }
            return { done: true, value: undefined };
          },
        };
      },
    };
    const results = await collect(runPipeline(source, [], { maxItems: 3, maxInFlight: 2 }));
    expect(results[0]?.input).toEqual({ values: [1] });
    expect(results[0]?.output).toEqual({ values: [1] });
  });

  it("snapshots handler output before a queued post-return mutation", async () => {
    const owned = { values: [1] };
    const run = runPipeline(
      [0],
      [{
        id: "work",
        handler: () => {
          queueMicrotask(() => owned.values.push(2));
          return owned;
        },
      }],
      { maxItems: 2 },
    );
    const result = await run.next();

    expect(result.value?.output).toEqual({ values: [1] });
    await flushMicrotasks();
    expect(owned).toEqual({ values: [1, 2] });
    expect((await run.next()).done).toBe(true);
  });

  it("distinguishes invalid input absence from valid null", async () => {
    const run = runPipeline([undefined, null], [], { maxItems: 3, maxInFlight: 2 });
    const results = await collect(run);
    expect(results[0]).toMatchObject({
      status: "failed",
      inputBound: false,
      completedStages: 0,
      totalAttempts: 0,
      failure: { code: "INVALID_INPUT", attempt: 0 },
    });
    expect(Object.hasOwn(results[0] as object, "input")).toBe(false);
    expect(Object.hasOwn(results[0] as object, "output")).toBe(false);
    expect(results[1]).toMatchObject({ status: "succeeded", inputBound: true, input: null, output: null });
  });

  it("fails synchronously when stage id or handler getters throw without constructing source", () => {
    let iterated = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        iterated += 1;
        return [1][Symbol.iterator]();
      },
    };
    const identity: PipelineStage["handler"] = ({ input }) => input;

    let idReads = 0;
    const badId: PipelineStage = {
      get id(): string {
        idReads += 1;
        throw new Error("id exploded");
      },
      handler: identity,
    };
    let idError: unknown;
    try {
      runPipeline(source, [badId]);
    } catch (error) {
      idError = error;
    }
    expect(idError).toBeInstanceOf(TypeError);
    expect((idError as Error).message).toMatch(/stages\[0\]\.id getter failed.*id exploded/);
    expect(idReads).toBe(1);

    let handlerReads = 0;
    const badHandler: PipelineStage = {
      id: "bad-handler",
      get handler(): PipelineStage["handler"] {
        handlerReads += 1;
        throw new Error("handler exploded");
      },
    };
    let handlerError: unknown;
    try {
      runPipeline(source, [badHandler]);
    } catch (error) {
      handlerError = error;
    }
    expect(handlerError).toBeInstanceOf(TypeError);
    expect((handlerError as Error).message).toMatch(
      /stages\[0\]\.handler getter failed.*handler exploded/,
    );
    expect(handlerReads).toBe(1);
    expect(iterated).toBe(0);
  });

  it("captures every structural stage property once and retains the id and handler snapshots", async () => {
    let iterated = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        iterated += 1;
        return [7][Symbol.iterator]();
      },
    };
    const reads = {
      id: 0,
      handler: 0,
      concurrency: 0,
      timeoutMs: 0,
      retry: 0,
      onFailure: 0,
    };
    let capturedHandlerCalls = 0;
    let replacementHandlerCalls = 0;
    const capturedHandler: PipelineStage["handler"] = ({ input }) => {
      capturedHandlerCalls += 1;
      return { handler: "captured", input };
    };
    const replacementHandler: PipelineStage["handler"] = () => {
      replacementHandlerCalls += 1;
      return "replacement";
    };
    const stage: PipelineStage = {
      get id(): string {
        reads.id += 1;
        return reads.id === 1 ? "captured-id" : "mutated-id";
      },
      get handler(): PipelineStage["handler"] {
        reads.handler += 1;
        return reads.handler === 1 ? capturedHandler : replacementHandler;
      },
      get concurrency(): number {
        reads.concurrency += 1;
        return reads.concurrency === 1 ? 1 : 2;
      },
      get timeoutMs(): undefined {
        reads.timeoutMs += 1;
        return undefined;
      },
      get retry(): PipelineStage["retry"] {
        reads.retry += 1;
        return { maxAttempts: reads.retry === 1 ? 1 : 2 };
      },
      get onFailure(): PipelineStage["onFailure"] {
        reads.onFailure += 1;
        return reads.onFailure === 1 ? "dead-letter" : "stop";
      },
    };

    const run = runPipeline(source, [stage], { maxItems: 2, maxInFlight: 1 });
    expect(iterated).toBe(0);
    expect(reads).toEqual({
      id: 1,
      handler: 1,
      concurrency: 1,
      timeoutMs: 1,
      retry: 1,
      onFailure: 1,
    });

    const results = await collect(run);
    expect(results[0]).toMatchObject({
      status: "succeeded",
      output: { handler: "captured", input: 7 },
      totalAttempts: 1,
    });
    expect(capturedHandlerCalls).toBe(1);
    expect(replacementHandlerCalls).toBe(0);
    expect(reads.id).toBe(1);
    expect(reads.handler).toBe(1);
    expect(await run.completion).toMatchObject({
      stageMaxObservedConcurrency: { "captured-id": 1 },
      stageMaxObservedQueueDepth: { "captured-id": 1 },
    });
  });

  it("validates numeric bounds, derived attempts, and duplicate IDs synchronously", () => {
    let iterated = false;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        iterated = true;
        return [][Symbol.iterator]();
      },
    };
    const identity = ({ input }: PipelineHandlerContext) => input;

    expect(() => runPipeline(source, [], { maxInFlight: 0 })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { maxItems: 1.5 })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { maxStages: 0 })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { maxStages: 2_049 })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { maxStages: null as never })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { bufferCapacity: null as never })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { maxInFlight: null as never })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { maxItems: null as never })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { ordering: null as never })).toThrow(TypeError);
    expect(() => runPipeline(source, [], { bufferCapacity: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => runPipeline(source, [{ id: "bad", handler: identity, concurrency: 0 }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{ id: "bad", handler: identity, concurrency: null as never }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{ id: "bad", handler: identity, timeoutMs: 0.5 }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{ id: "bad", handler: identity, onFailure: null as never }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{ id: "bad", handler: identity, retry: null as never }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{
      id: "bad",
      handler: identity,
      retry: { maxAttempts: 2, initialDelayMs: Number.NaN },
    }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{
      id: "bad",
      handler: identity,
      retry: { maxAttempts: null as never },
    }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{
      id: "bad",
      handler: identity,
      retry: { initialDelayMs: null as never },
    }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{
      id: "bad",
      handler: identity,
      retry: { backoffMultiplier: null as never },
    }])).toThrow(TypeError);
    expect(() => runPipeline(source, [{
      id: "bad",
      handler: identity,
      retry: { maxDelayMs: null as never },
    }])).toThrow(TypeError);
    expect(() => runPipeline(source, [
      { id: "same", handler: identity },
      { id: "same", handler: identity },
    ])).toThrow(/duplicate/i);
    expect(() => runPipeline(
      source,
      [{ id: "unsafe", handler: identity, retry: { maxAttempts: 2 } }],
      { maxItems: Number.MAX_SAFE_INTEGER },
    )).toThrow(/attempt/i);
    expect(iterated).toBe(false);
  });

  it("bounds an infinite stage iterable before constructing the item source", () => {
    let sourceIterated = false;
    let yieldedStages = 0;
    let stageIteratorClosed = false;
    let overflowStageReads = 0;
    const source: Iterable<number> = {
      [Symbol.iterator]() {
        sourceIterated = true;
        return [1][Symbol.iterator]();
      },
    };
    function* infiniteStages(): Generator<PipelineStage> {
      try {
        while (true) {
          const id = `stage-${yieldedStages}`;
          yieldedStages += 1;
          if (yieldedStages === 4) {
            yield {
              get id() {
                overflowStageReads += 1;
                return id;
              },
              get handler() {
                overflowStageReads += 1;
                return ({ input }: PipelineHandlerContext) => input;
              },
            };
          } else {
            yield { id, handler: ({ input }) => input };
          }
        }
      } finally {
        stageIteratorClosed = true;
      }
    }

    expect(() => runPipeline(source, infiniteStages(), { maxStages: 3 })).toThrow(
      /pipeline stage count exceeds maxStages limit of 3/,
    );
    expect(yieldedStages).toBe(4);
    expect(overflowStageReads).toBe(0);
    expect(stageIteratorClosed).toBe(true);
    expect(sourceIterated).toBe(false);
  });
});
