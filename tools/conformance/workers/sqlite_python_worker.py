#!/usr/bin/env python3
"""One-shot Python subprocess for SQLite CycleStore interoperability cases."""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from graph_engineering import SQLiteCycleStoreProvider, create_cycle_store_record

AUTH = {
    "tenantId": "tenant-a",
    "principalHash": "a" * 64,
    "authorizationHash": "b" * 64,
}
MISSING = {"exists": False, "sequence": -1, "recordHash": None}


def mutation(operation_id: str) -> dict[str, Any]:
    return {**AUTH, "operationId": operation_id}


async def run(configuration: dict[str, Any]) -> dict[str, Any]:
    action = configuration["action"]
    provider = SQLiteCycleStoreProvider(
        configuration["path"], initial_time=configuration["initialTime"]
    )
    try:
        if action == "descriptor":
            return {"descriptor": await provider.describe()}

        stream_id = configuration["streamId"]
        if action == "seed":
            sequence = 0
            previous_hash = None
            expected_tail = MISSING
        elif action == "continue":
            expected_tail = await provider.read_tail(
                {"context": AUTH, "streamId": stream_id}
            )
            sequence = expected_tail["sequence"] + 1
            previous_hash = expected_tail["recordHash"]
        else:
            raise ValueError("unknown Python SQLite worker action")

        record = create_cycle_store_record(
            record_id=configuration["recordId"],
            sequence=sequence,
            previous_record_hash=previous_hash,
            value=configuration["value"],
        )
        result = await provider.append(
            {
                "context": mutation(configuration["operationId"]),
                "streamId": stream_id,
                "expectedTail": expected_tail,
                "lease": None,
                "records": [record],
            }
        )
        return {"record": record, "result": result}
    finally:
        await provider.close()


def main() -> None:
    configuration = json.loads(sys.argv[1])
    result = asyncio.run(run(configuration))
    print(
        json.dumps(
            {"type": "result", "outcome": "accepted", **result}, separators=(",", ":")
        )
    )


if __name__ == "__main__":
    main()
