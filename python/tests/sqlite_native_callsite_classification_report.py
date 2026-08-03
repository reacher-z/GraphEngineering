"""Emit deterministic bounded Python callsite-classification evidence."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import cast

from graph_engineering.sqlite_native_callsite_classification import (
    classify_sqlite_native_python_callsites,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SCANNER = REPOSITORY_ROOT / "tools/sqlite-native-callsite-discovery.mjs"


def build_report() -> dict[str, object]:
    """Run read-only discovery and classify every Python candidate."""

    completed = subprocess.run(
        [
            "node",
            "--no-warnings",
            str(SCANNER),
            "--root",
            str(REPOSITORY_ROOT),
        ],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if completed.stderr:
        raise RuntimeError("SQLite callsite discovery wrote unexpected stderr")
    decoded = cast(object, json.loads(completed.stdout))
    report = classify_sqlite_native_python_callsites(decoded, REPOSITORY_ROOT)
    result = report.to_json_object()
    result["sourceScannerPolicy"] = {
        "routeClosureClaimed": False,
        "classificationConsumesReadOnlyJson": True,
    }
    return result


if __name__ == "__main__":
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))
