"""Emit exact native-Python H03D PatchAccepted checkpoint fault evidence."""

from __future__ import annotations

import asyncio
import json

from python_cycle_patch_visibility_fault_report import run_patch_visibility_campaign


async def _main() -> None:
    report = await run_patch_visibility_campaign(
        "cycle-controller-patch-checkpoint-fault.case.json"
    )
    print(json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    asyncio.run(_main())
