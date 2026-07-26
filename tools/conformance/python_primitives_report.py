#!/usr/bin/env python3
"""Evaluate the shared settled-barrier corpus through the Python primitive."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from graph_engineering import evaluate_settled_barrier

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "settled-barrier.case.json"


def report() -> dict[str, Any]:
    fixture = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    return {
        case["name"]: evaluate_settled_barrier(
            case["items"], case["policy"]
        ).to_dict()
        for case in fixture["cases"]
    }


if __name__ == "__main__":
    print(json.dumps(report(), ensure_ascii=False, sort_keys=True, separators=(",", ":")))
