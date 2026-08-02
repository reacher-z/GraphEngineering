"""Emit real-SQLite Python evidence for the B3 publication-session parity gate."""

from __future__ import annotations

import dis
import inspect
import json
import re
from pathlib import Path

import graph_engineering
import graph_engineering.sqlite_cursor_publication_outer_authority as outer
from graph_engineering.sqlite_cursor_publication_clock_authority import (
    _read_clock_evidence_snapshot_intrinsic,
)
from graph_engineering.sqlite_cursor_publication_target_catalog import (
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
    SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
    SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR,
    _read_target_catalog_observation_intrinsic,
)
from graph_engineering.sqlite_operation_baseline_cursor_stage_ownership import (
    _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic,
)
from sqlite_cursor_publication_initial_python_report import (
    _CaseGraph,
    _record,
    _through_sequence,
)
from sqlite_cursor_publication_initial_python_report import (
    _counter_probe as _initial_counter_probe,
)

ROOT = Path(__file__).resolve().parents[2]
OUTER_SOURCE = (
    ROOT / "python/src/graph_engineering/sqlite_cursor_publication_outer_authority.py"
)
CLOCK_SOURCE = (
    ROOT / "python/src/graph_engineering/sqlite_cursor_publication_clock_authority.py"
)
ROOT_SOURCE = ROOT / "python/src/graph_engineering/__init__.py"


def _invariant(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _adopted_graph() -> tuple[_CaseGraph, object]:
    graph = _through_sequence()
    adoption = outer._adopt_sqlite_cursor_initial_publication_stage_intrinsic(
        graph.authority,
        (graph.migration, graph.entries, graph.header, graph.sequence),
        graph.fence,
        graph.reader,
    )
    snapshot = outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
        graph.authority
    )
    _invariant(
        snapshot.write_phase == "initial-stage-adoption-complete",
        "Python session graph did not complete initial stage adoption",
    )
    return graph, adoption


def _catalog_matches(graph: _CaseGraph) -> bool:
    catalog = _read_target_catalog_observation_intrinsic(graph.connection)
    _invariant(
        catalog.row_count
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
        "Python session target catalog row count drifted",
    )
    return (
        catalog.catalog_sha256
        == SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256
    )


def _publish(graph: _CaseGraph, adoption: object) -> tuple[object, object, object]:
    prepared = outer._prepare_sqlite_cursor_publication_session_intrinsic(
        graph.authority, adoption
    )
    evidence = outer._observe_sqlite_cursor_publication_session_clock_intrinsic(
        prepared
    )
    session = outer._publish_sqlite_cursor_publication_session_intrinsic(
        prepared, evidence
    )
    return prepared, evidence, session


def _assert_commitments(
    graph: _CaseGraph,
    adoption: object,
    prepared: object,
    evidence: object,
    session: object,
) -> None:
    authority = (
        outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
            graph.authority
        )
    )
    snapshot = outer._read_sqlite_cursor_publication_session_snapshot_intrinsic(session)
    outer_clock = _read_clock_evidence_snapshot_intrinsic(
        snapshot.provider_clock_capability, snapshot.outer_clock_evidence
    )
    pre_rebind = _read_clock_evidence_snapshot_intrinsic(
        snapshot.provider_clock_capability, evidence
    )
    state = outer._authority_state(graph.authority)
    lock = snapshot.migration_lock_identity
    _invariant(snapshot.prepared_owner is prepared, "prepared owner drifted")
    _invariant(snapshot.authority is graph.authority, "outer authority drifted")
    _invariant(snapshot.adoption_receipt is adoption, "adoption receipt drifted")
    _invariant(snapshot.receipt is state.receipt, "B2 receipt drifted")
    _invariant(
        snapshot.projection_reference is state.projection_reference,
        "projection reference drifted",
    )
    _invariant(
        snapshot.projection_identity is state.projection_identity,
        "projection identity drifted",
    )
    _invariant(snapshot.stage is graph.stage, "stage drifted")
    _invariant(snapshot.connection is graph.connection, "connection drifted")
    _invariant(snapshot.transfer is state.transfer, "transfer drifted")
    _invariant(
        snapshot.transaction_generation is graph.generation,
        "transaction generation drifted",
    )
    _invariant(
        snapshot.migration_lock_capability is authority.migration_lock_capability,
        "migration-lock capability drifted",
    )
    _invariant(
        snapshot.provider_clock_capability is authority.provider_clock_capability,
        "provider-clock capability drifted",
    )
    _invariant(
        snapshot.outer_clock_evidence is authority.outer_clock_evidence,
        "outer evidence drifted",
    )
    _invariant(
        outer_clock.boundary == "before-first-permanent-mutation"
        and outer_clock.consumer == "outer-publication-authority"
        and snapshot.outer_provider_now_ms == outer_clock.provider_now_ms,
        "outer clock commitment drifted",
    )
    _invariant(
        snapshot.pre_rebind_clock_evidence is evidence, "second evidence drifted"
    )
    _invariant(
        pre_rebind.boundary == "before-cursor-rebind"
        and pre_rebind.consumer == "cursor-publication-session"
        and snapshot.pre_rebind_provider_now_ms == pre_rebind.provider_now_ms,
        "second clock commitment drifted",
    )
    _invariant(snapshot.post_ddl_catalog_fence is graph.fence, "catalog fence drifted")
    _invariant(
        lock.lock_id == "lock-a"
        and lock.owner_id == "owner-a"
        and lock.lock_epoch == 1
        and lock.fencing_token == 1
        and lock.source_schema_version == 1
        and lock.target_schema_version == 2
        and lock.active_expires_at_ms == pre_rebind.active_expires_at_ms,
        "migration-lock tuple drifted",
    )
    _invariant(
        snapshot.source_descriptor_hash == authority.source_descriptor_hash
        and snapshot.source_schema_identity == authority.source_schema_identity_sha256,
        "source identity drifted",
    )
    _invariant(
        snapshot.target_descriptor_hash
        == SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.descriptor_hash
        and snapshot.target_schema_identity
        == SQLITE_CURSOR_PUBLICATION_TARGET_DESCRIPTOR.schema_identity_sha256,
        "target identity drifted",
    )
    _invariant(snapshot.lifecycle == "publication-active", "session lifecycle drifted")


def _success() -> dict[str, object]:
    graph, adoption = _adopted_graph()
    try:
        prepared, evidence, session = _publish(graph, adoption)
        _assert_commitments(graph, adoption, prepared, evidence, session)
        epoch = graph.connection.transaction_epoch
        changes = graph.connection.total_changes
        ledger = (
            outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                graph.authority
            ).outer_ledger
        )
        _invariant(
            outer._assert_sqlite_cursor_publication_session_intrinsic(session)
            is session,
            "first session assertion changed identity",
        )
        _invariant(
            outer._assert_sqlite_cursor_publication_session_intrinsic(session)
            is session,
            "second session assertion changed identity",
        )
        after = (
            outer._read_sqlite_cursor_outer_publication_authority_snapshot_intrinsic(
                graph.authority
            )
        )
        _invariant(
            graph.connection.transaction_epoch == epoch
            and graph.connection.total_changes == changes
            and after.outer_ledger == ledger,
            "session assertion mutated owner or ledger",
        )
        record = _record(
            graph,
            case_id="publication-session-success-control",
            outcome="success",
            failure_boundary=None,
            state="publication-active",
            bundle_retryable=False,
            catalog_fence_matches=_catalog_matches(graph),
        )
        record["clockEvidenceConsumeCount"] = 2
        return record
    finally:
        graph.cleanup()


def _cancellation() -> dict[str, object]:
    graph, adoption = _adopted_graph()
    try:
        prepared = outer._prepare_sqlite_cursor_publication_session_intrinsic(
            graph.authority, adoption
        )
        evidence = outer._observe_sqlite_cursor_publication_session_clock_intrinsic(
            prepared
        )
        cancellation = outer._create_sqlite_cursor_publication_session_cancellation_controller_intrinsic()
        cancellation.cancel()
        try:
            outer._publish_sqlite_cursor_publication_session_intrinsic(
                prepared, evidence, cancellation.signal
            )
        except ValueError as error:
            _invariant(
                str(error) == "GE_CURSOR_B3_PUBLICATION_CANCELLED",
                "Python cancellation returned the wrong error",
            )
        else:
            raise AssertionError("Python publication-session cancellation was ignored")
        state = outer._authority_state(graph.authority)
        _invariant(
            state.lifecycle == "active"
            and state.write_phase == "initial-stage-adoption-complete"
            and state.publication_prepared_owner is prepared
            and state.publication_session is None,
            "Python cancellation changed publication ownership",
        )
        frozen = {
            "caseId": "publication-session-cancelled-before-tail",
            "outcome": "cancelled",
            "state": "pre-rebind-complete",
            "poisoned": False,
            "providerClockReadCount": graph.provider_reads[0],
            "clockEvidenceConsumeCount": 1,
            "sessionRetryable": True,
            "cursorRebindPrepareCount": graph.trace.cursor_rebind_prepare_count,
            "cursorRebindExecuteCount": graph.trace.cursor_rebind_execute_count,
            "commitCount": graph.trace.commit_count,
        }
        session = outer._publish_sqlite_cursor_publication_session_intrinsic(
            prepared, evidence
        )
        _invariant(
            outer._assert_sqlite_cursor_publication_session_intrinsic(session)
            is session,
            "cancelled graph did not retry with the same evidence",
        )
        return frozen
    finally:
        graph.cleanup()


def _raw_error(error: BaseException) -> str:
    return f"{type(error).__name__}|{error}"


def _normalized_hostile(
    graph: _CaseGraph,
    *,
    case_id: str,
    failure_boundary: str,
) -> dict[str, object]:
    state = outer._authority_state(graph.authority)
    _invariant(
        state.lifecycle == "poisoned" and state.write_phase == "poisoned",
        f"Python hostile {case_id} did not poison its graph",
    )
    return _record(
        graph,
        case_id=case_id,
        outcome="poisoned",
        failure_boundary=failure_boundary,
        state="poisoned",
        bundle_retryable=False,
        catalog_fence_matches=_catalog_matches(graph),
    )


def _fresh_graph_succeeded() -> bool:
    graph, adoption = _adopted_graph()
    try:
        _prepared, _evidence, session = _publish(graph, adoption)
        return (
            outer._assert_sqlite_cursor_publication_session_intrinsic(session)
            is session
        )
    finally:
        graph.cleanup()


def _activated(
    ordinal: int,
    error: BaseException,
    normalized: dict[str, object],
) -> dict[str, object]:
    _invariant(
        _fresh_graph_succeeded(),
        f"Python hostile ordinal {ordinal} did not recover on a fresh graph",
    )
    return {
        "ordinal": ordinal,
        "runtimeError": _raw_error(error),
        "semanticErrorCode": "GE_CURSOR_B3_INVARIANT",
        "sameGraphRetryable": False,
        "freshGraphSucceeded": True,
        "normalized": normalized,
    }


def _ordinal_20() -> dict[str, object]:
    old_graph, old_adoption = _adopted_graph()
    graph, adoption = _adopted_graph()
    try:
        _old_prepared, old_evidence, _old_session = _publish(old_graph, old_adoption)
        prepared = outer._prepare_sqlite_cursor_publication_session_intrinsic(
            graph.authority, adoption
        )
        outer._observe_sqlite_cursor_publication_session_clock_intrinsic(prepared)
        try:
            outer._publish_sqlite_cursor_publication_session_intrinsic(
                prepared, old_evidence
            )
        except ValueError as error:
            caught = error
        else:
            raise AssertionError("Python hostile ordinal 20 unexpectedly succeeded")
        normalized = _normalized_hostile(
            graph,
            case_id="stale-provider-clock-evidence-replay",
            failure_boundary="pre-rebind-clock-evidence-validation",
        )
        return _activated(20, caught, normalized)
    finally:
        graph.cleanup()
        old_graph.cleanup()


def _adoption_ordinal(ordinal: int) -> dict[str, object]:
    foreign_graph: _CaseGraph | None = None
    graph: _CaseGraph | None = None
    try:
        if ordinal == 100:
            graph, adoption = _adopted_graph()
            candidate = object.__new__(type(adoption))
        else:
            foreign_graph, foreign_adoption = _adopted_graph()
            if ordinal == 101:
                foreign_state = outer._authority_state(foreign_graph.authority)
                _retire_sqlite_cursor_stage_ownership_outer_publication_intrinsic(
                    foreign_state.transfer, foreign_graph.authority
                )
            graph, _adoption = _adopted_graph()
            candidate = foreign_adoption
        try:
            outer._prepare_sqlite_cursor_publication_session_intrinsic(
                graph.authority, candidate
            )
        except ValueError as error:
            caught = error
        else:
            raise AssertionError(
                f"Python hostile ordinal {ordinal} unexpectedly succeeded"
            )
        case_id = {
            100: "stage-adoption-receipt-clone",
            101: "stage-adoption-receipt-cross-run-or-post-retirement-replay",
            102: "stage-adoption-receipt-substitution",
        }[ordinal]
        normalized = _normalized_hostile(
            graph,
            case_id=case_id,
            failure_boundary="stage-adoption-receipt-presentation",
        )
        return _activated(ordinal, caught, normalized)
    finally:
        if graph is not None:
            graph.cleanup()
        if foreign_graph is not None:
            foreign_graph.cleanup()


def _public_exports() -> dict[str, bool]:
    names = (
        "_prepare_sqlite_cursor_publication_session_intrinsic",
        "_observe_sqlite_cursor_publication_session_clock_intrinsic",
        "_publish_sqlite_cursor_publication_session_intrinsic",
        "_assert_sqlite_cursor_publication_session_intrinsic",
        "_read_sqlite_cursor_publication_session_snapshot_intrinsic",
        "_create_sqlite_cursor_publication_session_cancellation_controller_intrinsic",
        "_SQLiteCursorPublicationSessionPreparedOwner",
        "_SQLiteCursorPublicationSession",
    )
    fields = (
        "packageRootPrepare",
        "packageRootObserve",
        "packageRootPublish",
        "packageRootAssert",
        "packageRootReadSnapshot",
        "packageRootCancellation",
        "packageRootPreparedOwner",
        "packageRootSession",
    )
    package_members = vars(graph_engineering)
    declared = getattr(graph_engineering, "__all__", ())
    return {
        field: name in package_members
        or name in declared
        or hasattr(graph_engineering, name)
        for field, name in zip(fields, names, strict=True)
    }


def _static_gates() -> dict[str, bool]:
    outer_source = OUTER_SOURCE.read_text(encoding="utf-8")
    clock_source = CLOCK_SOURCE.read_text(encoding="utf-8")
    root_source = ROOT_SOURCE.read_text(encoding="utf-8")
    publisher = outer._publish_sqlite_cursor_publication_session_intrinsic
    publish = inspect.signature(publisher)
    publisher_closure = inspect.getclosurevars(publisher).nonlocals
    implementation = publisher_closure.get("implementation")
    atomic_tail = publisher_closure.get("atomic_tail")
    closed_publisher = (
        inspect.isfunction(implementation)
        and implementation.__name__
        == "_publish_sqlite_cursor_publication_session_implementation"
        and inspect.isfunction(atomic_tail)
        and atomic_tail.__name__ == "atomic_tail"
        and "_publish_sqlite_cursor_publication_session_implementation"
        not in vars(outer)
        and "_ATOMIC_PUBLICATION_SESSION_TAIL" not in vars(outer)
    )
    atomic_closure = (
        inspect.getclosurevars(atomic_tail).nonlocals if closed_publisher else {}
    )
    exact_atomic_callables = (
        atomic_closure.get("burn_publication_commit")
        is outer._OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT
        and atomic_closure.get("consume_clock") is outer._CONSUME_CLOCK
        and atomic_closure.get("publish_publication_commit")
        is outer._OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT
        and atomic_closure.get("object_setattr") is object.__setattr__
        and atomic_closure.get("poison") is outer._poison
        and atomic_closure.get("authority_session_slot")
        == outer._AUTHORITY_SESSION_SLOT
        and atomic_closure.get("authority_session_state_slot")
        == outer._AUTHORITY_SESSION_STATE_SLOT
    )
    atomic_instructions = (
        tuple(dis.get_instructions(atomic_tail)) if closed_publisher else ()
    )
    forbidden_dispatch_names = {
        "__import__",
        "call",
        "eval",
        "exec",
        "getattr",
        "setattr",
    }
    forbidden_mutable_globals = forbidden_dispatch_names | {
        "_AUTHORITY_SESSION_SLOT",
        "_AUTHORITY_SESSION_STATE_SLOT",
        "_CONSUME_CLOCK",
        "_OBJECT_SETATTR",
        "_OWNERSHIP_BURN_PUBLICATION_SESSION_COMMIT",
        "_OWNERSHIP_PUBLISH_PUBLICATION_SESSION_COMMIT",
        "_poison",
    }
    atomic_names = set(atomic_tail.__code__.co_names) if closed_publisher else set()
    no_mutable_global_dispatch = closed_publisher and not any(
        instruction.opname in {"LOAD_GLOBAL", "LOAD_NAME"}
        and instruction.argval in forbidden_mutable_globals
        for instruction in atomic_instructions
    )
    no_dynamic_dispatch = forbidden_dispatch_names.isdisjoint(atomic_names)
    tail_start = outer_source.index("# Non-interruptible tail:")
    tail_end = outer_source.index("except BaseException:", tail_start)
    tail = re.sub(
        r"^\s*#.*$", "", outer_source[tail_start:tail_end], flags=re.MULTILINE
    )
    session_start = outer_source.index(
        "def _prepare_sqlite_cursor_publication_session_intrinsic"
    )
    session_end = outer_source.index("class _SQLiteCursorPublicationSessionSnapshot")
    session_slice = outer_source[session_start:session_end]
    private_names = (
        "_prepare_sqlite_cursor_publication_session_intrinsic",
        "_SQLiteCursorPublicationSession",
    )
    return {
        "closedPrepareSignature": len(
            inspect.signature(
                outer._prepare_sqlite_cursor_publication_session_intrinsic
            ).parameters
        )
        == 2,
        "closedObserveSignature": len(
            inspect.signature(
                outer._observe_sqlite_cursor_publication_session_clock_intrinsic
            ).parameters
        )
        == 1,
        "closedPublishSignature": len(publish.parameters) == 3
        and publish.parameters["cancellation"].default is None,
        "atomicTailNoCancellation": "cancel" not in tail.lower(),
        "atomicTailNoFaultHook": re.search(r"fault|hook", tail, re.IGNORECASE) is None,
        "atomicTailNoSql": re.search(
            r"\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b", tail, re.IGNORECASE
        )
        is None,
        "atomicTailNoProviderClock": re.search(
            r"provider_now|_OBSERVE_CLOCK", tail, re.IGNORECASE
        )
        is None,
        "atomicTailNoCallerDispatch": closed_publisher
        and exact_atomic_callables
        and no_mutable_global_dispatch
        and no_dynamic_dispatch,
        "atomicTailNoImport": "__import__(" not in tail and "importlib" not in tail,
        "atomicTailNoTransactionControl": re.search(
            r"\b(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b", tail, re.IGNORECASE
        )
        is None,
        "atomicTailNoCursorRebind": "rebind" not in tail.lower(),
        "atomicTailNoCommit": re.search(r"\bCOMMIT\b", tail, re.IGNORECASE) is None,
        "clockRegistryEncapsulated": re.search(
            r"\b(?:_CLOCK_CAPABILITIES|_EVIDENCE|_LOCK_CAPABILITIES|_TOMBSTONES)\b",
            session_slice,
        )
        is None,
        "packageRootDeclarationPrivate": all(
            name not in root_source for name in private_names
        )
        and "_SecondBoundaryGraphSnapshot" in clock_source,
    }


def _counter_probe() -> dict[str, object]:
    base = _initial_counter_probe()
    rollback = base.pop("rollbackCount")
    base["publicationSessionMintCount"] = 1
    base["publicationSessionAssertionCount"] = 1
    base["cancellationObservationCount"] = 1
    base["rollbackCount"] = rollback
    return base


def build_report() -> dict[str, object]:
    exports = _public_exports()
    gates = _static_gates()
    _invariant(
        not any(exports.values()), "Python package root leaked session internals"
    )
    _invariant(all(gates.values()), "Python static publication-session gate failed")
    success = _success()
    cancellation = _cancellation()
    activated = [
        _ordinal_20(),
        _adoption_ordinal(100),
        _adoption_ordinal(101),
        _adoption_ordinal(102),
    ]
    return {
        "runtime": "python",
        "publicExports": exports,
        "staticGates": gates,
        "counterProbe": _counter_probe(),
        "rollbackCount": 0,
        "success": success,
        "cancellation": cancellation,
        "activatedRecords": activated,
    }


def main() -> None:
    print(json.dumps(build_report(), ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
