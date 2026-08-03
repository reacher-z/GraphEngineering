"""Emit normalized real-SQLite evidence for Python Rule 12 + third clock."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import graph_engineering.sqlite_cursor_publication_clock_authority as clock  # noqa: E402
import graph_engineering.sqlite_cursor_publication_outer_authority as outer  # noqa: E402
import graph_engineering.sqlite_cursor_publication_rule12 as rule12  # noqa: E402
import graph_engineering.sqlite_cursor_publication_subprotocol as protocol  # noqa: E402
import graph_engineering.sqlite_cursor_publication_third_clock as third  # noqa: E402
from tests.test_sqlite_cursor_publication_subprotocol import (  # noqa: E402
    _CursorAdoptionGraph,
    _session,
)


def _success(population: int) -> dict[str, Any]:
    graph = _CursorAdoptionGraph(population)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        receipt = rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
        evidence = third._observe_sqlite_cursor_before_verification_clock_intrinsic(receipt)
        observed = third._read_sqlite_cursor_before_verification_clock_evidence_snapshot_intrinsic(
            receipt, evidence
        )
        accepted = rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
            receipt
        )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        counts = (
            accepted.receipt_count,
            accepted.main_key_count,
            accepted.driver_count,
            accepted.lookup_count,
            accepted.accumulator_count,
        )
        if (
            counts != (population,) * 5
            or accepted.receipt_immutable_root_sha256
            != accepted.computed_immutable_root_sha256
            or accepted.query_plans.probe_count != 3
            or accepted.lifecycle != "pre-verification-clock-read-unconsumed"
            or authority.write_phase != accepted.lifecycle
            or observed.boundary != "before-verification"
            or observed.head_index != 3
            or observed.consumed
        ):
            raise RuntimeError("Python P10 success graph cannot be normalized")
        return {
            "case": f"success-{population}",
            "status": "success",
            "rule12": {
                "ruleId": accepted.rule_id,
                "position": accepted.position,
                "counts": {
                    "b2": accepted.receipt_count,
                    "main": accepted.main_key_count,
                    "driver": accepted.driver_count,
                    "lookup": accepted.lookup_count,
                    "accumulator": accepted.accumulator_count,
                },
                "root": {
                    "sha256": accepted.computed_immutable_root_sha256,
                    "matchesReceipt": accepted.receipt_immutable_root_sha256
                    == accepted.computed_immutable_root_sha256,
                },
                "phase": accepted.lifecycle,
            },
            "thirdClock": {
                "boundary": observed.boundary,
                "head": observed.head_index,
                "consumed": observed.consumed,
            },
            "commitPresented": False,
        }
    finally:
        graph.close()


def _failure(kind: str) -> dict[str, Any]:
    graph = _CursorAdoptionGraph(1)
    try:
        predecessor = protocol._execute_sqlite_cursor_publication_rebind_rule11_intrinsic(
            _session(graph)
        )
        receipt: Any | None = None
        actual_code: str | None = None
        try:
            if kind == "replay":
                receipt = rule12._execute_sqlite_cursor_publication_rule12_intrinsic(
                    predecessor
                )
                rule12._execute_sqlite_cursor_publication_rule12_intrinsic(predecessor)
            elif kind == "cancel":
                controller = (
                    outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
                )
                controller.cancel()
                rule12._execute_sqlite_cursor_publication_rule12_intrinsic(
                    predecessor, controller.signal
                )
            else:
                receipt = rule12._execute_sqlite_cursor_publication_rule12_intrinsic(
                    predecessor
                )
                accepted = (
                    rule12._read_sqlite_cursor_publication_rule12_receipt_snapshot_intrinsic(
                        receipt
                    )
                )
                state = clock._CLOCK_CAPABILITIES[accepted.provider_clock_capability]

                def unavailable() -> int:
                    raise RuntimeError("provider unavailable")

                clock._CLOCK_SOURCES[state.source] = unavailable
                third._observe_sqlite_cursor_before_verification_clock_intrinsic(receipt)
        except ValueError as error:
            actual_code = str(error)
        expected_native = {
            "replay": "GE_CURSOR_B3_RULE12_REPLAY",
            "cancel": "GE_CURSOR_B3_RULE12_CANCELLED",
            "provider": "GE_CURSOR_B3_CLOCK_UNAVAILABLE",
        }[kind]
        if actual_code != expected_native:
            raise RuntimeError(
                f"{kind} produced {actual_code!r}, expected {expected_native!r}"
            )
        authority = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
        return {
            "case": kind,
            "status": "failure",
            "code": {
                "GE_CURSOR_B3_RULE12_REPLAY": "GE_CYCLE_STORE_CORRUPTION",
                "GE_CURSOR_B3_RULE12_CANCELLED": "GE_CYCLE_STORE_UNAVAILABLE",
                "GE_CURSOR_B3_CLOCK_UNAVAILABLE": "GE_CYCLE_STORE_UNAVAILABLE",
            }[actual_code],
            "rule12AcceptedBeforeFailure": receipt is not None,
            "outerLifecycle": authority.lifecycle,
            "thirdClockRead": False,
            "commitPresented": False,
        }
    finally:
        graph.close()


def main() -> None:
    report = {
        "version": "sqlite-cursor-publication-p10-parity/v1",
        "implementation": "python",
        "cases": [_success(population) for population in (0, 1, 3)]
        + [_failure(kind) for kind in ("replay", "cancel", "provider")],
    }
    print(json.dumps(report, separators=(",", ":")))


if __name__ == "__main__":
    main()
