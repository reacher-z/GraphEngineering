#!/usr/bin/env python3
"""Emit Python compiler results for the shared conformance corpus."""

from __future__ import annotations

import json
from pathlib import Path

from graph_engineering import canonical_sha256, try_compile_graph


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "spec" / "conformance"


def main() -> None:
    expected = json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))
    report: dict[str, object] = {}
    for name in expected["compilation"]:
        document = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
        result = try_compile_graph(document)
        report[name] = {
            "valid": result.valid,
            "canonicalSha256": canonical_sha256(document),
            "diagnosticCodes": [item.code.value for item in result.diagnostics],
            "topologicalLayers": (
                [list(layer) for layer in result.graph.topological_layers]
                if result.graph is not None
                else []
            ),
        }
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
