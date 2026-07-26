#!/usr/bin/env python3
"""Evaluate the shared route-selection corpus through the Python primitive."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from graph_engineering import evaluate_route_selection

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "route-selection.case.json"


def report() -> dict[str, Any]:
    fixture = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    return {
        case["name"]: evaluate_route_selection(
            case["request"], case["policy"]
        ).to_dict()
        for case in fixture["cases"]
    }


if __name__ == "__main__":
    print(json.dumps(report(), ensure_ascii=False, sort_keys=True, separators=(",", ":")))
