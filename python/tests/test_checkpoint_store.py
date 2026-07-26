from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from graph_engineering import canonical_sha256
from graph_engineering.persistence import (
    CHECKPOINT_API_VERSION,
    CheckpointInput,
    CorruptCheckpointError,
    FileCheckpointStore,
    PersistenceIOError,
    PersistenceValidationError,
    UnsafeIdentifierError,
)

ROOT = Path(__file__).resolve().parents[2]


def checkpoint(
    run_id: str = "run-1",
    checkpoint_id: str = "checkpoint-1",
    sequence: int = 0,
    state: object = None,
) -> CheckpointInput:
    return CheckpointInput.model_validate(
        {
            "runId": run_id,
            "checkpointId": checkpoint_id,
            "sequence": sequence,
            "createdAt": "2026-07-26T00:00:00.000Z",
            "state": {"value": sequence} if state is None else state,
        }
    )


def test_checkpoint_round_trip_hash_restart_and_list_order(tmp_path: Path) -> None:
    store = FileCheckpointStore(tmp_path)
    second = asyncio.run(store.save(checkpoint(checkpoint_id="z-last", sequence=2)))
    first_b = asyncio.run(store.save(checkpoint(checkpoint_id="b", sequence=1)))
    first_a = asyncio.run(store.save(checkpoint(checkpoint_id="a", sequence=1)))

    payload = {
        "apiVersion": CHECKPOINT_API_VERSION,
        "runId": second.run_id,
        "checkpointId": second.checkpoint_id,
        "sequence": second.sequence,
        "createdAt": second.created_at,
        "state": second.state,
    }
    assert second.content_hash == canonical_sha256(payload)

    reopened = FileCheckpointStore(tmp_path)
    restored = asyncio.run(reopened.load("run-1", "b"))
    assert restored == first_b
    assert restored is not first_b
    summaries = asyncio.run(reopened.list("run-1"))
    assert [(item.sequence, item.checkpoint_id) for item in summaries] == [
        (1, "a"),
        (1, "b"),
        (2, "z-last"),
    ]
    assert first_a.content_hash != first_b.content_hash
    assert asyncio.run(reopened.load("run-1", "missing")) is None


def test_checkpoint_matches_shared_cross_language_fixture(tmp_path: Path) -> None:
    document = json.loads(
        (ROOT / "spec/conformance/checkpoint-basic.json").read_text()
    )
    store = FileCheckpointStore(tmp_path)

    saved = asyncio.run(
        store.save(
            {
                "runId": document["runId"],
                "checkpointId": document["checkpointId"],
                "sequence": document["sequence"],
                "createdAt": document["createdAt"],
                "state": document["state"],
            }
        )
    )

    assert saved.model_dump(mode="json", by_alias=True) == document
    assert asyncio.run(store.load(document["runId"], document["checkpointId"])) == saved


def test_checkpoint_escapes_lone_surrogates_as_utf8_safe_json(tmp_path: Path) -> None:
    store = FileCheckpointStore(tmp_path)
    lone_surrogate = json.loads(r'"\udfff"')

    saved = asyncio.run(store.save(checkpoint(state={"text": lone_surrogate})))

    raw = store.path_for_checkpoint(saved.run_id, saved.checkpoint_id).read_bytes()
    assert b"\\udfff" in raw
    raw.decode("utf-8")
    restored = asyncio.run(store.load(saved.run_id, saved.checkpoint_id))
    assert restored is not None
    assert restored.state == {"text": lone_surrogate}


def test_checkpoint_normalizes_surrogate_pairs_and_rejects_key_collisions(
    tmp_path: Path,
) -> None:
    store = FileCheckpointStore(tmp_path)
    scalar = json.loads(r'"\ud83d\ude00"')
    explicit_pair = "\ud83d\ude00"

    saved = asyncio.run(store.save(checkpoint(state={explicit_pair: explicit_pair})))

    assert saved.state == {scalar: scalar}
    assert asyncio.run(store.load(saved.run_id, saved.checkpoint_id)) == saved
    with pytest.raises(PersistenceValidationError, match="validation failed"):
        asyncio.run(
            store.save(
                {
                    "runId": "run-collision",
                    "checkpointId": "collision",
                    "sequence": 0,
                    "state": {explicit_pair: 1, scalar: 2},
                }
            )
        )


def test_checkpoint_path_uses_only_identifier_hashes(tmp_path: Path) -> None:
    store = FileCheckpointStore(tmp_path)
    path = store.path_for_checkpoint("customer.run-42", "nightly.checkpoint")

    assert "customer" not in str(path)
    assert "nightly" not in str(path)
    assert path.name.endswith(".checkpoint.json")


@pytest.mark.parametrize("unsafe", ["../escape", "a/b", "a\\b", ".", "..", "💥"])
def test_checkpoint_store_rejects_path_escape(tmp_path: Path, unsafe: str) -> None:
    store = FileCheckpointStore(tmp_path / "root")

    with pytest.raises(UnsafeIdentifierError):
        asyncio.run(store.save(checkpoint(run_id=unsafe)))
    with pytest.raises(UnsafeIdentifierError):
        asyncio.run(store.load("safe", unsafe))
    assert not (tmp_path / "escape").exists()


def test_checkpoint_detects_content_tampering_and_truncation(tmp_path: Path) -> None:
    store = FileCheckpointStore(tmp_path)
    asyncio.run(store.save(checkpoint()))
    path = store.path_for_checkpoint("run-1", "checkpoint-1")
    document = json.loads(path.read_text())
    document["state"] = {"tampered": True}
    path.write_text(f"{json.dumps(document)}\n")

    with pytest.raises(CorruptCheckpointError, match="contentHash"):
        asyncio.run(store.load("run-1", "checkpoint-1"))

    asyncio.run(store.save(checkpoint()))
    path.write_bytes(path.read_bytes()[:-1])
    with pytest.raises(CorruptCheckpointError, match="truncated"):
        asyncio.run(store.load("run-1", "checkpoint-1"))


def test_failed_atomic_replace_preserves_previous_checkpoint(tmp_path: Path) -> None:
    store = FileCheckpointStore(tmp_path)
    original = asyncio.run(store.save(checkpoint(state={"generation": 1})))

    with patch(
        "graph_engineering.persistence.checkpoint_store.os.replace",
        side_effect=OSError("simulated crash before replace"),
    ), pytest.raises(PersistenceIOError):
        asyncio.run(store.save(checkpoint(sequence=1, state={"generation": 2})))

    restored = asyncio.run(store.load("run-1", "checkpoint-1"))
    assert restored == original
    run_directory = store.path_for_checkpoint("run-1", "checkpoint-1").parent
    assert tuple(run_directory.glob("*.tmp")) == ()


@pytest.mark.parametrize("state", [{"value": 1.0}, {"value": 2**53}, [0.25]])
def test_checkpoint_rejects_nonportable_numbers(tmp_path: Path, state: object) -> None:
    store = FileCheckpointStore(tmp_path)

    with pytest.raises(PersistenceValidationError):
        asyncio.run(store.save(checkpoint(state=state)))


@pytest.mark.parametrize(
    "created_at",
    ["20260726T000000Z", "2026-02-30T00:00:00Z", "2026-07-26T24:00:00Z", None],
)
def test_checkpoint_rejects_invalid_present_created_at(
    tmp_path: Path, created_at: object
) -> None:
    store = FileCheckpointStore(tmp_path)

    with pytest.raises(PersistenceValidationError):
        asyncio.run(
            store.save(
                {
                    "runId": "run-time",
                    "checkpointId": "bad-time",
                    "sequence": 0,
                    "createdAt": created_at,
                    "state": {},
                }
            )
        )


def test_checkpoint_mapping_validation_is_structured(tmp_path: Path) -> None:
    store = FileCheckpointStore(tmp_path)

    with pytest.raises(PersistenceValidationError):
        asyncio.run(
            store.save(
                {
                    "runId": "run-large",
                    "checkpointId": "large",
                    "sequence": 2**53,
                    "state": {},
                }
            )
        )
    with pytest.raises(UnsafeIdentifierError):
        asyncio.run(store.load(42, "checkpoint"))  # type: ignore[arg-type]


def test_read_treats_nonportable_numbers_as_corruption(tmp_path: Path) -> None:
    store = FileCheckpointStore(tmp_path)
    saved = asyncio.run(store.save(checkpoint()))
    path = store.path_for_checkpoint(saved.run_id, saved.checkpoint_id)
    document = json.loads(path.read_text())
    document["state"] = {"float": 1.0}
    path.write_text(f"{json.dumps(document)}\n")

    with pytest.raises(CorruptCheckpointError, match="floating-point"):
        asyncio.run(store.load(saved.run_id, saved.checkpoint_id))
