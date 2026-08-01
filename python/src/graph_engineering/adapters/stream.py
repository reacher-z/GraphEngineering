"""Streamed response normalization, rules ``S-001`` through ``S-017``.

adapter-semantics 6.1: a stream opens with exactly one ``start``, numbers frames
from zero increasing by exactly one, carries at most one ``usage`` frame, and
closes with exactly one ``finish`` after which no frame may arrive.

An oversized *response* is deliberately not ``GE_ADAPTER_BOUNDS_EXCEEDED``: a
provider that exceeds the declared response bound has already performed work, so
the outcome is a dispatch code with a conservative usage disposition.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Final

from .contract import STREAM_FRAME_KINDS
from .errors import fail
from .types import AdapterDescriptor, AdapterErrorCode, NormalizedStream, StreamFrame

_MALFORMED: Final[AdapterErrorCode] = "GE_ADAPTER_MALFORMED_RESPONSE"


def normalize_stream(
    descriptor: AdapterDescriptor,
    frames: Sequence[StreamFrame],
) -> NormalizedStream:
    declared = frozenset(descriptor.capabilities)
    bounds = descriptor.bounds

    if len(frames) > bounds.max_stream_frames:
        fail(_MALFORMED, "S-008", "stream exceeds maxStreamFrames")
    if len(frames) == 0 or frames[0].kind != "start":
        fail(_MALFORMED, "S-001", "a stream must open with a start frame")

    start_count = 0
    usage_count = 0
    tool_call_count = 0
    text_bytes = 0
    finished = False
    finish_reason: str | None = None

    for index, frame in enumerate(frames):
        if frame.kind not in STREAM_FRAME_KINDS:
            raise ValueError(f"unknown stream frame kind {frame.kind!r}")

        if finished:
            fail(_MALFORMED, "S-005", "a frame arrived after the finish frame")
        if index == 0 and frame.sequence != 0:
            fail(_MALFORMED, "S-003", "stream sequence must start at zero")
        if index > 0 and frame.sequence != frames[index - 1].sequence + 1:
            fail(_MALFORMED, "S-004", "stream sequence must increase by exactly one")
        if frame.bytes > bounds.max_stream_frame_bytes:
            fail(_MALFORMED, "S-007", "stream frame exceeds maxStreamFrameBytes")

        if frame.kind == "start":
            start_count += 1
            if start_count > 1:
                fail(_MALFORMED, "S-002", "a stream carries exactly one start frame")
        elif frame.kind == "text-delta":
            text_bytes += frame.bytes
            if text_bytes > bounds.max_response_bytes:
                fail(_MALFORMED, "S-013", "streamed text exceeds maxResponseBytes")
        elif frame.kind == "tool-call":
            if "tool-calling" not in declared:
                fail(
                    _MALFORMED,
                    "S-011",
                    "a provider emitted a tool call to an adapter without tool-calling",
                )
            tool_call_count += 1
            if tool_call_count > 1 and "parallel-tool-calls" not in declared:
                fail(_MALFORMED, "S-016", "more than one tool call requires parallel-tool-calls")
            if tool_call_count > bounds.max_tool_calls_per_response:
                fail(_MALFORMED, "S-012", "stream exceeds maxToolCallsPerResponse")
        elif frame.kind == "usage":
            if "usage-reporting" not in declared:
                fail(
                    _MALFORMED,
                    "S-010",
                    "a provider reported usage to an adapter without usage-reporting",
                )
            usage_count += 1
            if usage_count > 1:
                fail(_MALFORMED, "S-009", "a stream carries at most one usage frame")
        else:
            finished = True
            finish_reason = frame.finish_reason
            if finish_reason == "cancelled":
                fail(
                    _MALFORMED,
                    "S-015",
                    "cancellation is a caller fact and is never a provider finish reason",
                )
            if finish_reason == "tool-calls" and tool_call_count == 0:
                fail(_MALFORMED, "S-014", "finishReason tool-calls requires at least one tool call")
            if finish_reason == "content-filter" and "content-filter-reporting" not in declared:
                fail(
                    _MALFORMED,
                    "S-017",
                    "finishReason content-filter requires content-filter-reporting",
                )

    if not finished:
        # A truncated stream is a transport fact, not a protocol fact: the
        # provider may have completed the work and lost the connection, so it is
        # in doubt.
        fail(
            "GE_ADAPTER_TRANSPORT_FAILURE",
            "S-006",
            "the provider disconnected before the finish frame",
        )

    return NormalizedStream(
        frames=len(frames),
        text_bytes=text_bytes,
        tool_calls=tool_call_count,
        usage_frames=usage_count,
        finish_reason=finish_reason,
    )
