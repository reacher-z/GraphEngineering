"""Emit exact pytest node outcomes for the B2 executable coverage gate."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_REPORTS: dict[str, dict[str, dict[str, object]]] = {}


def pytest_runtest_logreport(report: Any) -> None:
    phases = _REPORTS.setdefault(report.nodeid, {})
    phases[report.when] = {
        "outcome": report.outcome,
        "wasXfail": bool(getattr(report, "wasxfail", False)),
    }


def pytest_sessionfinish(session: Any, exitstatus: int) -> None:
    output = os.environ.get("GE_B2_PYTEST_REPORT")
    if output is None:
        raise RuntimeError("GE_B2_PYTEST_REPORT is required")
    tests: list[dict[str, object]] = []
    for node_id, phases in sorted(_REPORTS.items()):
        execution_id = node_id if node_id.startswith("python/") else f"python/{node_id}"
        required = ("setup", "call", "teardown")
        passed = all(
            phases.get(phase, {}).get("outcome") == "passed"
            and phases.get(phase, {}).get("wasXfail") is False
            for phase in required
        )
        tests.append({"executionId": execution_id, "passed": passed, "phases": phases})
    payload = {
        "exitStatus": int(exitstatus),
        "tests": tests,
    }
    Path(output).write_text(
        json.dumps(payload, separators=(",", ":"), sort_keys=True),
        encoding="utf-8",
    )
