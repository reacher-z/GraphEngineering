/**
 * Streamed response normalization, rules `S-001` through `S-017`.
 *
 * adapter-semantics 6.1: a stream opens with exactly one `start`, numbers
 * frames from zero increasing by exactly one, carries at most one `usage`
 * frame, and closes with exactly one `finish` after which no frame may arrive.
 *
 * An oversized *response* is deliberately not `GE_ADAPTER_BOUNDS_EXCEEDED`: a
 * provider that exceeds the declared response bound has already performed work,
 * so the outcome is a dispatch code with a conservative usage disposition.
 */

import { STREAM_FRAME_KINDS } from "./contract.js";
import { fail } from "./errors.js";
import type { AdapterDescriptor, FinishReason, NormalizedStream, StreamFrame } from "./types.js";

const MALFORMED = "GE_ADAPTER_MALFORMED_RESPONSE" as const;

export function normalizeStream(
  descriptor: AdapterDescriptor,
  frames: readonly StreamFrame[],
): NormalizedStream {
  const declared = new Set<string>(descriptor.capabilities);
  const bounds = descriptor.bounds;

  if (frames.length > bounds.maxStreamFrames) {
    fail(MALFORMED, "S-008", "stream exceeds maxStreamFrames");
  }
  const opening = frames[0];
  if (opening === undefined || opening.kind !== "start") {
    fail(MALFORMED, "S-001", "a stream must open with a start frame");
  }

  let startCount = 0;
  let usageCount = 0;
  let toolCallCount = 0;
  let textBytes = 0;
  let finished = false;
  let finishReason: FinishReason | null = null;

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index] as StreamFrame;
    if (!STREAM_FRAME_KINDS.includes(frame.kind)) {
      throw new Error(`unknown stream frame kind '${String(frame.kind)}'`);
    }

    if (finished) {
      fail(MALFORMED, "S-005", "a frame arrived after the finish frame");
    }
    if (index === 0 && frame.sequence !== 0) {
      fail(MALFORMED, "S-003", "stream sequence must start at zero");
    }
    if (index > 0 && frame.sequence !== (frames[index - 1] as StreamFrame).sequence + 1) {
      fail(MALFORMED, "S-004", "stream sequence must increase by exactly one");
    }
    if (frame.bytes > bounds.maxStreamFrameBytes) {
      fail(MALFORMED, "S-007", "stream frame exceeds maxStreamFrameBytes");
    }

    if (frame.kind === "start") {
      startCount += 1;
      if (startCount > 1) {
        fail(MALFORMED, "S-002", "a stream carries exactly one start frame");
      }
    } else if (frame.kind === "text-delta") {
      textBytes += frame.bytes;
      if (textBytes > bounds.maxResponseBytes) {
        fail(MALFORMED, "S-013", "streamed text exceeds maxResponseBytes");
      }
    } else if (frame.kind === "tool-call") {
      if (!declared.has("tool-calling")) {
        fail(MALFORMED, "S-011",
          "a provider emitted a tool call to an adapter without tool-calling");
      }
      toolCallCount += 1;
      if (toolCallCount > 1 && !declared.has("parallel-tool-calls")) {
        fail(MALFORMED, "S-016", "more than one tool call requires parallel-tool-calls");
      }
      if (toolCallCount > bounds.maxToolCallsPerResponse) {
        fail(MALFORMED, "S-012", "stream exceeds maxToolCallsPerResponse");
      }
    } else if (frame.kind === "usage") {
      if (!declared.has("usage-reporting")) {
        fail(MALFORMED, "S-010",
          "a provider reported usage to an adapter without usage-reporting");
      }
      usageCount += 1;
      if (usageCount > 1) {
        fail(MALFORMED, "S-009", "a stream carries at most one usage frame");
      }
    } else {
      finished = true;
      finishReason = frame.finishReason ?? null;
      if (finishReason === "cancelled") {
        fail(MALFORMED, "S-015",
          "cancellation is a caller fact and is never a provider finish reason");
      }
      if (finishReason === "tool-calls" && toolCallCount === 0) {
        fail(MALFORMED, "S-014", "finishReason tool-calls requires at least one tool call");
      }
      if (finishReason === "content-filter" && !declared.has("content-filter-reporting")) {
        fail(MALFORMED, "S-017", "finishReason content-filter requires content-filter-reporting");
      }
    }
  }

  if (!finished) {
    // A truncated stream is a transport fact, not a protocol fact: the provider
    // may have completed the work and lost the connection, so it is in doubt.
    fail("GE_ADAPTER_TRANSPORT_FAILURE", "S-006",
      "the provider disconnected before the finish frame");
  }

  return Object.freeze({
    frames: frames.length,
    textBytes,
    toolCalls: toolCallCount,
    usageFrames: usageCount,
    finishReason,
  });
}
