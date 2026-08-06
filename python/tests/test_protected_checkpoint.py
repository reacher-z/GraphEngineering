"""The guarded ``checkpoints/v1alpha2`` write path, and its seeded-canary gate.

The property that matters is not that the projection claims ``protected-ref``:
it is that an application value written through the real guarded checkpoint
path is absent from every byte the runtime left on disk — temporary and final —
in every encoding form the scanner recognizes, and that the unguarded
``checkpoints/v1alpha1`` store demonstrably leaks the same seeds (the positive
control), so the scan is known to be able to see a leak.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from graph_engineering.persistence import FileCheckpointStore
from graph_engineering.persistence.errors import (
    CheckpointProtectionRequiredError,
    PersistenceErrorCode,
)
from graph_engineering.persistence.protected_checkpoint import (
    CheckpointNodeSpec,
    GuardedFileCheckpointStore,
    ProtectedCheckpointSpec,
    ProtectedCheckpointWriter,
    prepare_protected_checkpoint,
    resolve_protected_checkpoint_value,
)
from graph_engineering.redaction.guard import GuardFailed, SinkGuard
from graph_engineering.redaction.keys import DeterministicTestKeyProvider
from graph_engineering.redaction.policy import CapturePolicy, default_stable_profile
from graph_engineering.redaction.protect import (
    FileProtectedPayloadStore,
    graph_input_context,
    key_ref_hash,
    node_output_context,
)
from graph_engineering.redaction.scan import encoded_forms

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SPEC_DIRECTORY = REPOSITORY_ROOT / "spec"
PARITY_FIXTURE = SPEC_DIRECTORY / "conformance" / "protected-checkpoint-parity.case.json"

SCOPE = {
    "tenant_scope_id": "tenant-opaque-1",
    "authority_provider_id": "provider-opaque-1",
    "authority_subject_id": "subject-opaque-1",
}

# Distinct synthetic canaries, one per seed point the projection can carry.
CANARIES: dict[str, str] = {
    "graph-input": "GE-CKPT-CANARY-9f31ab7742d0-graph-input",
    "node-input": "GE-CKPT-CANARY-8e20bc6631cf-node-input",
    "node-output": "GE-CKPT-CANARY-7d1fcd5520be-node-output",
    "node-result": "GE-CKPT-CANARY-6c0ede4419ad-node-result",
}


def _policy(keys: DeterministicTestKeyProvider) -> CapturePolicy:
    return default_stable_profile(
        transform_implementation_hash="11" * 32,
        rule_registry_version=1,
        rule_registry_hash="22" * 32,
        key_ref=keys.key_ref,
    )


def _components(
    root: Path,
) -> tuple[
    ProtectedCheckpointWriter,
    GuardedFileCheckpointStore,
    FileProtectedPayloadStore,
    DeterministicTestKeyProvider,
]:
    keys = DeterministicTestKeyProvider()
    blob_store = FileProtectedPayloadStore(root / "protected")
    writer = ProtectedCheckpointWriter(
        key_provider=keys,
        store=blob_store,
        policy=_policy(keys),
        **SCOPE,
    )
    return writer, GuardedFileCheckpointStore(root), blob_store, keys


def _seeded_spec(keys: DeterministicTestKeyProvider) -> ProtectedCheckpointSpec:
    return ProtectedCheckpointSpec(
        decision_id="decision-canary-checkpoint-1",
        run_id="canary-run",
        checkpoint_id="ckpt-canary-1",
        sequence=7,
        created_at="2026-08-01T00:00:00Z",
        graph_revision=1,
        graph_hash="ab" * 32,
        implementation_hash="cd" * 32,
        key_ref_hash=key_ref_hash(keys.key_ref),
        history_prefix_hash="ef" * 32,
        total_attempts=3,
        graph_input={"question": CANARIES["graph-input"]},
        nodes=(
            CheckpointNodeSpec(
                node_id="planner",
                status="succeeded",
                attempts=1,
                input={"prompt": CANARIES["node-input"]},
                output={"answer": CANARIES["node-output"]},
                activity_key="12" * 32,
            ),
            CheckpointNodeSpec(
                node_id="fallback",
                status="failed",
                attempts=2,
                result={"detail": CANARIES["node-result"]},
                failure_code="NODE_EXECUTION_FAILED",
            ),
        ),
    )


def _schema_validator() -> Draft202012Validator:
    checkpoint_schema = json.loads(
        (SPEC_DIRECTORY / "checkpoint-v1alpha2.schema.json").read_text(encoding="utf-8")
    )
    protected_value_schema = json.loads(
        (SPEC_DIRECTORY / "protected-value.schema.json").read_text(encoding="utf-8")
    )
    registry = Registry().with_resources(
        [
            (checkpoint_schema["$id"], Resource.from_contents(checkpoint_schema)),
            (
                protected_value_schema["$id"],
                Resource.from_contents(protected_value_schema),
            ),
        ]
    )
    return Draft202012Validator(checkpoint_schema, registry=registry)


def _scan_tree(root: Path) -> tuple[list[Path], int, list[tuple[str, str, str]]]:
    files = sorted(path for path in root.rglob("*") if path.is_file())
    hits: list[tuple[str, str, str]] = []
    bytes_scanned = 0
    for path in files:
        raw = path.read_bytes()
        bytes_scanned += len(raw)
        for canary_id, value in CANARIES.items():
            for form, encoded in encoded_forms(value).items():
                haystack = raw.lower() if form == "hex" else raw
                needle = encoded.lower() if form == "hex" else encoded
                if needle in haystack:
                    hits.append((str(path.relative_to(root)), canary_id, form))
    return files, bytes_scanned, hits


def test_guarded_write_produces_schema_valid_checkpoint_v1alpha2_bytes(
    tmp_path: Path,
) -> None:
    writer, store, _, keys = _components(tmp_path)
    saved = asyncio.run(writer.save(store, _seeded_spec(keys)))
    validator = _schema_validator()
    validator.validate(saved)

    raw = store.path_for_checkpoint("canary-run", "ckpt-canary-1").read_bytes()
    assert raw.endswith(b"\n")
    persisted = json.loads(raw)
    validator.validate(persisted)
    assert persisted["payloadDisposition"] == "protected-ref"
    assert persisted["redacted"] is False
    assert persisted["protectedRefCount"] == 4


def test_no_canary_byte_reaches_any_temporary_or_final_file(tmp_path: Path) -> None:
    writer, store, _, keys = _components(tmp_path)
    asyncio.run(writer.save(store, _seeded_spec(keys)))

    files, bytes_scanned, hits = _scan_tree(tmp_path)
    # The scan must have had something to look at: the projection plus one
    # protected blob per protected occurrence.
    assert sum(1 for path in files if path.name.endswith(".checkpoint.json")) == 1
    assert sum(1 for path in files if path.suffix == ".blob") == 4
    # No temporary plaintext file is left behind (Section 5.6).
    assert [path for path in files if path.suffix == ".tmp"] == []
    assert bytes_scanned > 0
    assert hits == [], f"canary reached a sink: {hits}"


def test_positive_control_the_unguarded_v1alpha1_store_leaks_the_same_seeds(
    tmp_path: Path,
) -> None:
    _, _, _, _ = _components(tmp_path)
    raw_store = FileCheckpointStore(tmp_path)
    asyncio.run(
        raw_store.save(
            {
                "runId": "unsafe-control",
                "checkpointId": "ckpt-unsafe-1",
                "sequence": 0,
                "createdAt": "2026-08-01T00:00:00Z",
                "state": {
                    "question": CANARIES["graph-input"],
                    "output": CANARIES["node-output"],
                },
            }
        )
    )
    _, _, hits = _scan_tree(tmp_path)
    assert hits, "the unguarded store must be detectable by the same scan"
    assert {hit[1] for hit in hits} >= {"graph-input", "node-output"}
    assert any(hit[2] == "utf-8" for hit in hits)


def test_the_encoding_sweep_detects_every_claimed_spelling() -> None:
    value = CANARIES["graph-input"]
    forms = encoded_forms(value)
    assert set(forms) >= {"utf-8", "base64url", "hex", "utf-16-le"}
    payload = b"|".join(forms.values())
    detected: set[str] = set()
    for form, encoded in forms.items():
        haystack = payload.lower() if form == "hex" else payload
        needle = encoded.lower() if form == "hex" else encoded
        if needle in haystack:
            detected.add(form)
    assert detected == set(forms)


def test_clean_control_an_unseeded_projection_produces_no_detection(
    tmp_path: Path,
) -> None:
    writer, store, _, keys = _components(tmp_path)
    spec = ProtectedCheckpointSpec(
        decision_id="decision-clean-1",
        run_id="clean-run",
        checkpoint_id="ckpt-clean-1",
        sequence=0,
        created_at="2026-08-01T00:00:00Z",
        graph_revision=1,
        graph_hash="ab" * 32,
        implementation_hash="cd" * 32,
        key_ref_hash=key_ref_hash(keys.key_ref),
        history_prefix_hash="ef" * 32,
        total_attempts=0,
        graph_input={"question": "ordinary application data"},
    )
    asyncio.run(writer.save(store, spec))
    _, _, hits = _scan_tree(tmp_path)
    assert hits == []


def test_construction_without_protection_fails_with_checkpoint_protection_required(
    tmp_path: Path,
) -> None:
    keys = DeterministicTestKeyProvider()
    blob_store = FileProtectedPayloadStore(tmp_path / "protected")
    for kwargs in (
        {"key_provider": None, "store": blob_store, "policy": _policy(keys)},
        {"key_provider": keys, "store": None, "policy": _policy(keys)},
        {"key_provider": keys, "store": blob_store, "policy": None},
        {"key_provider": None, "store": None, "policy": None},
    ):
        with pytest.raises(CheckpointProtectionRequiredError) as caught:
            ProtectedCheckpointWriter(**kwargs)  # type: ignore[arg-type]
        assert (
            caught.value.code is PersistenceErrorCode.CHECKPOINT_PROTECTION_REQUIRED
        )


def test_a_policy_naming_a_different_key_ref_fails_closed(tmp_path: Path) -> None:
    keys = DeterministicTestKeyProvider()
    with pytest.raises(CheckpointProtectionRequiredError):
        ProtectedCheckpointWriter(
            key_provider=keys,
            store=FileProtectedPayloadStore(tmp_path / "protected"),
            policy=default_stable_profile(
                transform_implementation_hash="11" * 32,
                rule_registry_version=1,
                rule_registry_hash="22" * 32,
                key_ref="some-other-key-reference",
            ),
        )


def test_the_sink_accepts_only_a_guard_minted_prepared_write(tmp_path: Path) -> None:
    writer, store, _, keys = _components(tmp_path)
    for forged in (None, {}, {"bytes": b"{}"}, "prepared", 42, b"{}"):
        with pytest.raises(CheckpointProtectionRequiredError) as caught:
            asyncio.run(store.save(forged))  # type: ignore[arg-type]
        assert (
            caught.value.code is PersistenceErrorCode.CHECKPOINT_PROTECTION_REQUIRED
        )

    # A prepared write is bound to one sink instance and consumed at most once.
    other = GuardedFileCheckpointStore(tmp_path / "other")
    prepared = writer.prepare(store, _seeded_spec(keys))
    from graph_engineering.redaction.guard import PreparedSinkWriteMisuse

    with pytest.raises(PreparedSinkWriteMisuse):
        asyncio.run(other.save(prepared))
    asyncio.run(store.save(prepared))
    with pytest.raises(PreparedSinkWriteMisuse):
        asyncio.run(store.save(prepared))


def test_a_guard_without_keys_fails_before_any_byte_reaches_disk(
    tmp_path: Path,
) -> None:
    keys = DeterministicTestKeyProvider()
    guard = SinkGuard(policy=_policy(keys), key_provider=None, store=None)
    store = GuardedFileCheckpointStore(tmp_path)
    outcome = prepare_protected_checkpoint(guard, store, _seeded_spec(keys))
    assert isinstance(outcome, GuardFailed)
    assert outcome.failure.code == "PAYLOAD_PROTECTION_REQUIRED"
    # Section 4.2: nothing reached disk — no checkpoint, no blob, no temporary.
    assert [path for path in tmp_path.rglob("*") if path.is_file()] == []


def test_load_round_trips_and_never_resolves_refs(tmp_path: Path) -> None:
    writer, store, _, keys = _components(tmp_path)
    saved = asyncio.run(writer.save(store, _seeded_spec(keys)))
    loaded = asyncio.run(store.load("canary-run", "ckpt-canary-1"))
    assert loaded == saved
    assert asyncio.run(store.load("canary-run", "ckpt-missing")) is None
    # The plain load path exposes references, never application values.
    assert isinstance(loaded, dict)
    assert isinstance(loaded["graphInputRef"], dict)
    assert str(loaded["graphInputRef"]["ref"]).startswith("pv_")
    assert CANARIES["graph-input"] not in json.dumps(loaded)


def test_resolution_requires_the_authorized_key_provider(tmp_path: Path) -> None:
    writer, store, blob_store, keys = _components(tmp_path)
    saved = asyncio.run(writer.save(store, _seeded_spec(keys)))

    resolved = resolve_protected_checkpoint_value(
        saved,
        "/graphInputRef",
        graph_input_context("canary-run", 1),
        store=blob_store,
        key_provider=keys,
        capture_policy_hash=writer.capture_policy_hash,
        **SCOPE,
    )
    assert resolved == {"question": CANARIES["graph-input"]}

    node_output = resolve_protected_checkpoint_value(
        saved,
        "/nodes/0/outputRef",
        node_output_context("canary-run", 1, "planner"),
        store=blob_store,
        key_provider=keys,
        capture_policy_hash=writer.capture_policy_hash,
        **SCOPE,
    )
    assert node_output == {"answer": CANARIES["node-output"]}

    refused = resolve_protected_checkpoint_value(
        saved,
        "/graphInputRef",
        graph_input_context("canary-run", 1),
        store=blob_store,
        key_provider=DeterministicTestKeyProvider(key_ref="another-key-ref/v1"),
        capture_policy_hash=writer.capture_policy_hash,
        **SCOPE,
    )
    assert getattr(refused, "code", None) == "PROTECTED_PAYLOAD_UNAUTHORIZED"


def test_reproduces_the_shared_cross_language_parity_vector(tmp_path: Path) -> None:
    """The machine-readable parity artifact both language suites assert against.

    ``spec/conformance/protected-checkpoint-parity.case.json`` pins one guarded
    projection: the TypeScript lane emitted it, and this test proves the Python
    lane reproduces the identical canonical bytes for the identical input under
    the deterministic test key provider.
    """

    fixture = json.loads(PARITY_FIXTURE.read_text(encoding="utf-8"))
    keys = DeterministicTestKeyProvider(key_ref=fixture["keyProvider"]["keyRef"])
    blob_store = FileProtectedPayloadStore(tmp_path / "protected")
    policy = default_stable_profile(
        transform_implementation_hash=fixture["policy"]["transformImplementationHash"],
        rule_registry_version=fixture["policy"]["ruleRegistryVersion"],
        rule_registry_hash=fixture["policy"]["ruleRegistryHash"],
        key_ref=fixture["policy"]["keyRef"],
    )
    writer = ProtectedCheckpointWriter(
        key_provider=keys,
        store=blob_store,
        policy=policy,
        tenant_scope_id=fixture["scope"]["tenantScopeId"],
        authority_provider_id=fixture["scope"]["authorityProviderId"],
        authority_subject_id=fixture["scope"]["authoritySubjectId"],
    )
    assert writer.capture_policy_hash == fixture["policy"]["capturePolicyHash"]

    source = fixture["input"]

    def node(entry: dict[str, object]) -> CheckpointNodeSpec:
        return CheckpointNodeSpec(
            node_id=str(entry["nodeId"]),
            status=entry["status"],  # type: ignore[arg-type]
            attempts=int(str(entry.get("attempts", 0))),
            input=entry.get("input") if "input" in entry else None,
            output=entry.get("output") if "output" in entry else None,
            result=entry.get("result") if "result" in entry else None,
            activity_key=entry.get("activityKey"),  # type: ignore[arg-type]
            open_attempt=entry.get("openAttempt"),  # type: ignore[arg-type]
            next_attempt=entry.get("nextAttempt"),  # type: ignore[arg-type]
            available_at=entry.get("availableAt"),  # type: ignore[arg-type]
            failure_code=entry.get("failureCode"),  # type: ignore[arg-type]
        )

    spec = ProtectedCheckpointSpec(
        decision_id=str(source["decisionId"]),
        run_id=str(source["runId"]),
        checkpoint_id=str(source["checkpointId"]),
        sequence=int(str(source["sequence"])),
        created_at=str(source["createdAt"]),
        graph_revision=int(str(source["graphRevision"])),
        graph_hash=str(source["graphHash"]),
        implementation_hash=str(source["implementationHash"]),
        key_ref_hash=key_ref_hash(keys.key_ref),
        history_prefix_hash=str(source["historyPrefixHash"]),
        total_attempts=int(str(source["totalAttempts"])),
        graph_input=source["graphInput"],
        nodes=tuple(node(entry) for entry in source["nodes"]),
    )
    store = GuardedFileCheckpointStore(tmp_path)
    saved = asyncio.run(writer.save(store, spec))
    assert saved == fixture["expect"]["record"]
    assert saved["contentHash"] == fixture["expect"]["contentHash"]
    assert saved["protectedRefCount"] == fixture["expect"]["protectedRefCount"]

    raw = store.path_for_checkpoint(spec.run_id, spec.checkpoint_id).read_bytes()
    assert raw.endswith(b"\n")
    assert (
        hashlib.sha256(raw[:-1]).hexdigest() == fixture["expect"]["canonicalSha256"]
    )
