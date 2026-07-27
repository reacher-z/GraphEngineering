import { canonicalHash } from "@graph-engineering/core";
import { describe, expect, it } from "vitest";
import {
  createCycleControllerCheckpoint,
  createCycleControllerEvent,
  CycleControllerError,
  foldCycleControllerEvents,
  hashWithDomain,
  validateCycleControllerCheckpoint,
  type CycleControllerCheckpoint,
  type CycleControllerEvent,
} from "../src/index.js";
import { durableCycleFixture, materializeDurableHistory } from "./cycle-fixtures.js";

function resignFrom(
  source: readonly CycleControllerEvent[],
  changedSequence: number,
  change: (event: CycleControllerEvent) => CycleControllerEvent,
): readonly CycleControllerEvent[] {
  const result: CycleControllerEvent[] = source.slice(0, changedSequence);
  for (let sequence = changedSequence; sequence < source.length; sequence += 1) {
    const original = sequence === changedSequence ? change(source[sequence]!) : source[sequence]!;
    result.push(createCycleControllerEvent({
      request: materializeDurableHistory().request,
      controllerHash: original.controllerHash,
      requestHash: original.requestHash,
      type: original.type,
      data: original.data,
      graphRevision: original.graphRevision,
      sequence,
      previousEventHash: result.at(-1)?.recordHash ?? null,
      lease: original.lease,
      timestamp: original.timestamp,
      eventId: original.eventId,
    }));
  }
  return result;
}

function rehashAttack(
  source: readonly CycleControllerEvent[],
  sequence: number,
  mutate: (event: Record<string, unknown>) => void,
): readonly CycleControllerEvent[] {
  const result = JSON.parse(JSON.stringify(source)) as Record<string, unknown>[];
  mutate(result[sequence]!);
  for (let index = sequence; index < result.length; index += 1) {
    const event = result[index]!;
    event.sequence = index;
    event.expectedPreviousSequence = index - 1;
    event.previousEventHash = index === 0 ? null : result[index - 1]!.recordHash;
    event.payloadHash = canonicalHash(event.data);
    const { recordHash: _ignored, ...body } = event;
    event.recordHash = hashWithDomain("graph-engineering/cycle-event/v1alpha1\0", body);
  }
  return result as unknown as readonly CycleControllerEvent[];
}

describe("cycle durable fold conformance", () => {
  it("folds the shared accepted-patch history to exact bytes and hashes", () => {
    const fixture = materializeDurableHistory();
    expect(fixture.events.map(({ recordHash }) => recordHash)).toEqual(
      durableCycleFixture.validHistory.expectEventRecordHashes,
    );
    expect(fixture.events.at(-1)?.recordHash).toBe(
      durableCycleFixture.validHistory.expectTerminalRecordHash,
    );

    const fold = foldCycleControllerEvents(fixture.events, { requireTerminal: true });
    expect(fold.terminalResult).toEqual(fixture.events.at(-1)?.data.result);
    expect(fold.currentRevision).toEqual({
      graphRevision: 2,
      graphHash: fixture.revision.body.graphHash,
      revisionHash: fixture.revision.revisionHash,
    });
    expect(fold.seenKeys).toEqual(["finding-a"]);
    expect(fold.acceptedKeys).toEqual(["finding-a"]);
    expect(fold.attemptsUsed).toBe(3);
    expect(fold.dynamicNodes).toBe(1);
    expect(fold.durationMs).toBe(30);
    expect(fold.terminalResult?.exitReason).toBe("MAX_ITERATIONS");
  });

  it("creates and validates the shared full-prefix checkpoint exactly", () => {
    const fixture = materializeDurableHistory();
    const created = createCycleControllerCheckpoint(
      fixture.events,
      durableCycleFixture.checkpoint.body.checkpointId,
      durableCycleFixture.checkpoint.body.createdAt,
    );
    expect(created.contentHash).toBe(durableCycleFixture.checkpoint.expectContentHash);
    expect(created).toEqual(fixture.checkpoint);
    expect(validateCycleControllerCheckpoint(created, fixture.events).historyPrefixHash).toBe(
      fixture.events.at(-1)?.recordHash,
    );
  });

  it("rejects under-reservation even when an attacker recomputes the whole hash chain", () => {
    const fixture = materializeDurableHistory();
    const attacked = resignFrom(fixture.events, 2, (event) => ({
      ...event,
      data: {
        ...event.data,
        maximum: { ...(event.data.maximum as object), attempts: 2 },
      },
    }));
    expect(() => foldCycleControllerEvents(attacked)).toThrowError(CycleControllerError);
  });

  it("rejects terminal observation lies after a fully re-signed replay", () => {
    const fixture = materializeDurableHistory();
    const attacked = resignFrom(fixture.events, 15, (event) => {
      const observation = event.data.observation as Record<string, unknown>;
      return { ...event, data: { ...event.data, observation: { ...observation, maxIterations: false } } };
    });
    expect(() => foldCycleControllerEvents(attacked, { requireTerminal: true })).toThrow(
      /terminal observation maxIterations drifted/u,
    );
  });

  it("rejects a content-valid checkpoint substituted from another state", () => {
    const fixture = materializeDurableHistory();
    const state = { ...fixture.checkpoint.state, seenKeys: ["finding-b"] };
    const { contentHash: _ignored, ...body } = fixture.checkpoint;
    const forgedBody = { ...body, state };
    const forged = { ...forgedBody, contentHash: canonicalHash(forgedBody) } as CycleControllerCheckpoint;
    expect(() => validateCycleControllerCheckpoint(forged, fixture.events)).toThrow(
      /checkpoint does not equal/u,
    );
  });

  it("validates checkpoint wire input without executing accessors or trusting self-hashed envelope fields", () => {
    const fixture = materializeDurableHistory();
    let getterCalls = 0;
    const poisoned = { ...fixture.checkpoint } as Record<string, unknown>;
    Object.defineProperty(poisoned, "state", {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return fixture.checkpoint.state;
      },
    });
    expect(() => validateCycleControllerCheckpoint(poisoned, fixture.events)).toThrow(
      /not bounded portable JSON/u,
    );
    expect(getterCalls).toBe(0);

    const { contentHash: _ignored, ...body } = fixture.checkpoint;
    const malformedBody = { ...body, createdAt: "not-a-timestamp" };
    const malformed = { ...malformedBody, contentHash: canonicalHash(malformedBody) };
    expect(() => validateCycleControllerCheckpoint(malformed, fixture.events)).toThrow(
      /checkpoint envelope is invalid/u,
    );
  });

  it("rejects re-signed unknown, malformed, and discriminator-confused event wire fields", () => {
    const fixture = materializeDurableHistory();
    const attacks: readonly [number, (event: Record<string, unknown>) => void][] = [
      [4, (event) => { event.injected = true; }],
      [4, (event) => { (event.data as Record<string, unknown>).injected = true; }],
      [4, (event) => {
        const data = event.data as Record<string, unknown>;
        data.usage = { ...(data.usage as Record<string, unknown>), injected: true };
      }],
      [0, (event) => { event.apiVersion = "graphengineering.invalid/v1"; }],
      [0, (event) => { event.contractVersion = "cycle-controller-recovery/v999"; }],
      [3, (event) => { event.eventId = "invalid/event/id"; }],
      [3, (event) => { event.graphRevision = 0; }],
      [3, (event) => { event.payloadDisposition = "inline-redacted"; }],
      [3, (event) => { event.timestamp = "July 26 2026 00:00:00 UTC"; }],
      [2, (event) => { (event.data as Record<string, unknown>).reservationId = "invalid/id"; }],
      [3, (event) => { (event.data as Record<string, unknown>).inputHash = "not-a-hash"; }],
      [11, (event) => { (event.data as Record<string, unknown>).errorCode = "GE_PATCH_FAKE"; }],
      [11, (event) => { delete (event.data as Record<string, unknown>).resultingRevision; }],
    ];
    for (const [sequence, mutation] of attacks) {
      const attacked = rehashAttack(fixture.events, sequence, mutation);
      expect(() => foldCycleControllerEvents(attacked)).toThrowError(
        expect.objectContaining({ code: "GE_CYCLE_INVALID_HISTORY" }),
      );
    }
  });

  it("rejects re-signed planner-authority detachment, late dispatch, and an illegal closing-release successor", () => {
    const fixture = materializeDurableHistory();
    const detached = rehashAttack(fixture.events, 11, (event) => {
      const data = event.data as Record<string, unknown>;
      data.authoritySnapshot = {
        ...(data.authoritySnapshot as Record<string, unknown>),
        proposerActivityKey: "f".repeat(64),
      };
    });
    expect(() => foldCycleControllerEvents(detached)).toThrow(
      /authority snapshot is detached/u,
    );

    const late = rehashAttack(fixture.events, 10, (event) => {
      event.timestamp = "2026-07-26T00:00:02.000Z";
    });
    expect(() => foldCycleControllerEvents(late.slice(0, 11))).toThrow(
      /at or after the controller deadline/u,
    );

    const wrongSuccessor = rehashAttack(fixture.events, 13, (event) => {
      (event.data as Record<string, unknown>).reason = "cancelled";
    });
    expect(() => foldCycleControllerEvents(wrongSuccessor)).toThrow(
      /closing budget release is not followed/u,
    );
  });

  it("binds trusted elapsed values, exact planner attempts, and phase-complete release credit", () => {
    const fixture = materializeDurableHistory();
    const durationLie = rehashAttack(fixture.events, 4, (event) => {
      (event.data as Record<string, unknown>).durationMs = 999;
    });
    expect(() => foldCycleControllerEvents(durationLie.slice(0, 5))).toThrow(
      /trusted cumulative elapsed/u,
    );

    const freePlannerAttempt = rehashAttack(fixture.events, 11, (event) => {
      const data = event.data as Record<string, unknown>;
      const outcome = data.budgetOutcome as Record<string, unknown>;
      outcome.committed = { ...(outcome.committed as Record<string, unknown>), attempts: 0 };
      outcome.released = { ...(outcome.released as Record<string, unknown>), attempts: 1 };
    });
    expect(() => foldCycleControllerEvents(freePlannerAttempt.slice(0, 12))).toThrow(
      /exact planner attempt/u,
    );

    const exactPhaseRelease = rehashAttack(fixture.events, 13, (event) => {
      const data = event.data as Record<string, unknown>;
      data.reason = "phase-complete";
      data.phase = "patch-planner";
    });
    expect(() => foldCycleControllerEvents(exactPhaseRelease.slice(0, 15))).not.toThrow();

    const widenedPhaseRelease = rehashAttack(exactPhaseRelease, 13, (event) => {
      const data = event.data as Record<string, unknown>;
      data.released = { ...(data.released as Record<string, unknown>), attempts: 1 };
      data.remaining = { ...(data.remaining as Record<string, unknown>), attempts: -1 };
    });
    expect(() => foldCycleControllerEvents(widenedPhaseRelease.slice(0, 14))).toThrowError(
      expect.objectContaining({ code: "GE_CYCLE_COUNTER_MISMATCH" }),
    );
  });
});
