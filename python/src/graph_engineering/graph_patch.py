"""Native Python append-only GraphPatch compiler and CAS decision runtime."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import math
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, NoReturn, TypeAlias, cast

from pydantic import ValidationError

from .canonical import canonical_json
from .compiler import CompiledGraph, try_compile_graph
from .cycle_contract import (
    CycleErrorCode,
    CycleEvent,
    CycleIssue,
    CycleRuntimeError,
    GraphPatchLimits,
    assert_identifier,
    capture_portable_json,
    patch_hash,
    revision_hash,
)
from .models import (
    EdgeSpec,
    Endpoint,
    GraphSpec,
    JsonObject,
    JsonValue,
    NodeSpec,
    capture_graph_model_document,
)

DecisionRecorder: TypeAlias = Callable[["PatchDecision"], Awaitable[None] | None]

_HASH = re.compile(r"^[0-9a-f]{64}$")
_JSON_POINTER = re.compile(r"^(?:/(?:[^~/]|~[01])*)*$")
_PATCH_ERROR_CODES = frozenset(
    code.value for code in CycleErrorCode if code.name.startswith("PATCH_")
)
_AUTHORITY_FIELDS = frozenset(
    {
        "proposerActivityKey",
        "principalHash",
        "proposerGrantHash",
        "runGrantHash",
        "tenantGrantHash",
        "deploymentGrantHash",
        "effectiveGrantHash",
        "policyHash",
        "approvalHash",
    }
)
_BUDGET_FIELDS = frozenset({"attempts", "costUsd", "dynamicNodes"})


def _restore_invalid(message: str, *, cause: BaseException | None = None) -> NoReturn:
    raise CycleRuntimeError(
        CycleErrorCode.INVALID_HISTORY,
        message,
        cause=cause,
    )


def _restore_record(value: object, fields: frozenset[str], label: str) -> dict[str, Any]:
    if type(value) is not dict or set(value) != fields:
        _restore_invalid(f"stored {label} is not a closed object")
    return cast(dict[str, Any], value)


def _restore_hash(value: object, label: str) -> str:
    if type(value) is not str or _HASH.fullmatch(value) is None:
        _restore_invalid(f"stored {label} is not a lowercase SHA-256 digest")
    return value


def _restore_integer(value: object, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        _restore_invalid(f"stored {label} is outside its portable integer range")
    return value


def _restore_budget(value: object, label: str) -> dict[str, int | float]:
    record = _restore_record(value, _BUDGET_FIELDS, label)
    attempts = _restore_integer(record["attempts"], 0, 2**53 - 1, f"{label}.attempts")
    dynamic_nodes = _restore_integer(
        record["dynamicNodes"], 0, 2**53 - 1, f"{label}.dynamicNodes"
    )
    cost = record["costUsd"]
    if (
        type(cost) not in {int, float}
        or not math.isfinite(cost)
        or cost < 0
        or cost > 2**53 - 1
    ):
        _restore_invalid(f"stored {label}.costUsd is outside its portable range")
    return {"attempts": attempts, "costUsd": cost, "dynamicNodes": dynamic_nodes}


def _validate_restored_patch_event(
    event: CycleEvent,
) -> tuple[dict[str, Any], JsonObject, str, str]:
    """Validate the complete durable GraphPatch carrier before state exposure."""

    try:
        captured = capture_portable_json(
            event.data,
            error_code=CycleErrorCode.INVALID_HISTORY,
        )
        accepted = event.type == "PatchAccepted"
        if not accepted and event.type != "PatchRejected":
            _restore_invalid("stored event is not a GraphPatch decision")
        common_fields = {
            "iteration",
            "plannerActivityKey",
            "patchId",
            "patch",
            "patchHash",
            "requestedBase",
            "authoritySnapshot",
            "policySnapshotHash",
            "budgetOutcome",
            "diagnostics",
            "decidedAtDurationMs",
            "outcome",
        }
        fields = frozenset(
            common_fields | ({"resultingRevision"} if accepted else {"errorCode"})
        )
        data = _restore_record(captured, fields, "GraphPatch decision")
        _restore_integer(data["iteration"], 1, 2**53 - 1, "patch iteration")
        planner_key = _restore_hash(data["plannerActivityKey"], "planner activity key")

        payload = _restore_record(
            data["patch"],
            frozenset(
                {
                    "disposition",
                    "redacted",
                    "encoding",
                    "canonicalJson",
                    "utf8ByteLength",
                    "sha256",
                }
            ),
            "GraphPatch inline payload",
        )
        canonical = payload["canonicalJson"]
        if (
            payload["disposition"] != "inline-unredacted"
            or payload["redacted"] is not False
            or payload["encoding"] != "canonical-json/v1alpha1"
            or type(canonical) is not str
        ):
            _restore_invalid("stored GraphPatch inline payload shape is invalid")
        raw = canonical.encode("utf-8")
        if (
            len(raw) < 1
            or len(raw) > 4_194_304
            or _restore_integer(
                payload["utf8ByteLength"],
                1,
                4_194_304,
                "patch payload byte length",
            )
            != len(raw)
            or _restore_hash(payload["sha256"], "patch payload hash")
            != hashlib.sha256(raw).hexdigest()
        ):
            _restore_invalid("stored GraphPatch inline payload bytes drifted")
        try:
            decoded = json.loads(
                canonical,
                parse_constant=lambda token: (_restore_invalid(
                    f"stored GraphPatch contains invalid JSON token {token}"
                )),
            )
        except (TypeError, ValueError, json.JSONDecodeError) as exc:
            _restore_invalid("stored GraphPatch canonical JSON cannot be decoded", cause=exc)
        decoded_capture = capture_portable_json(
            decoded,
            error_code=CycleErrorCode.INVALID_HISTORY,
        )
        if canonical_json(decoded_capture) != canonical:
            _restore_invalid("stored GraphPatch payload is not canonical JSON")
        try:
            document, patch_id, digest = validate_graph_patch_shape(decoded_capture)
        except CycleRuntimeError as exc:
            _restore_invalid("stored GraphPatch violates its closed schema", cause=exc)
        if (
            data["patchId"] != patch_id
            or _restore_hash(data["patchHash"], "patch decision hash") != digest
            or payload["sha256"] != digest
        ):
            _restore_invalid("stored GraphPatch bytes, hash, or ID drifted")

        requested_base = _restore_record(
            data["requestedBase"],
            frozenset({"graphRevision", "graphHash", "revisionHash"}),
            "requested GraphPatch base",
        )
        _restore_integer(
            requested_base["graphRevision"],
            1,
            2**53 - 2,
            "requested graph revision",
        )
        _restore_hash(requested_base["graphHash"], "requested graph hash")
        _restore_hash(requested_base["revisionHash"], "requested revision hash")
        if canonical_json(document["base"]) != canonical_json(requested_base):
            _restore_invalid("stored GraphPatch document and requested base differ")

        authority = _restore_record(
            data["authoritySnapshot"], _AUTHORITY_FIELDS, "GraphPatch authority snapshot"
        )
        for field in _AUTHORITY_FIELDS:
            if field == "approvalHash" and authority[field] is None:
                continue
            _restore_hash(authority[field], f"GraphPatch authority {field}")
        if authority["proposerActivityKey"] != planner_key:
            _restore_invalid("stored GraphPatch authority is detached from its planner claim")
        _restore_hash(data["policySnapshotHash"], "GraphPatch policy snapshot hash")

        budget = _restore_record(
            data["budgetOutcome"],
            frozenset({"reservationId", "requested", "committed", "released"}),
            "GraphPatch budget outcome",
        )
        reservation_id = budget["reservationId"]
        if type(reservation_id) is not str or not 1 <= len(reservation_id) <= 256:
            _restore_invalid("stored GraphPatch reservation identity is invalid")
        requested = _restore_budget(budget["requested"], "requested patch budget")
        committed = _restore_budget(budget["committed"], "committed patch budget")
        released = _restore_budget(budget["released"], "released patch budget")
        if any(
            requested[field] != committed[field] + released[field]
            for field in _BUDGET_FIELDS
        ):
            _restore_invalid("stored GraphPatch budget does not reconcile")

        diagnostics_value = data["diagnostics"]
        if type(diagnostics_value) is not list or len(diagnostics_value) > 100_000:
            _restore_invalid("stored GraphPatch diagnostics are not a bounded array")
        for item in diagnostics_value:
            diagnostic = _restore_record(
                item, frozenset({"code", "phase", "path"}), "GraphPatch diagnostic"
            )
            if diagnostic["code"] not in _PATCH_ERROR_CODES:
                _restore_invalid("stored GraphPatch diagnostic code is unknown")
            _restore_integer(diagnostic["phase"], 1, 13, "GraphPatch diagnostic phase")
            if (
                type(diagnostic["path"]) is not str
                or _JSON_POINTER.fullmatch(diagnostic["path"]) is None
            ):
                _restore_invalid("stored GraphPatch diagnostic path is invalid")
        _restore_integer(
            data["decidedAtDurationMs"],
            0,
            2_147_483_647,
            "GraphPatch decision duration",
        )

        appended_nodes = len(cast(dict[str, Any], document["append"])["nodes"])
        if accepted:
            if data["outcome"] != "accepted" or diagnostics_value != []:
                _restore_invalid("stored accepted GraphPatch outcome is invalid")
            if committed["dynamicNodes"] != appended_nodes:
                _restore_invalid("stored accepted GraphPatch node accounting drifted")
            revision = _restore_record(
                data["resultingRevision"],
                frozenset({"body", "revisionHash"}),
                "GraphPatch resulting revision",
            )
            body = _restore_record(
                revision["body"],
                frozenset(
                    {
                        "apiVersion",
                        "kind",
                        "graphRevision",
                        "previousRevisionHash",
                        "patchHash",
                        "graphHash",
                    }
                ),
                "GraphPatch revision body",
            )
            if (
                body["apiVersion"]
                != "graphengineering.reacher-z.github.io/graph-revisions/v1alpha1"
                or body["kind"] != "GraphRevision"
                or _restore_integer(
                    body["graphRevision"], 2, 2**53 - 1, "resulting graph revision"
                )
                != requested_base["graphRevision"] + 1
                or _restore_hash(
                    body["previousRevisionHash"], "previous revision hash"
                )
                != requested_base["revisionHash"]
                or _restore_hash(body["patchHash"], "revision patch hash") != digest
                or _restore_hash(body["graphHash"], "resulting graph hash")
                != body["graphHash"]
                or _restore_hash(revision["revisionHash"], "resulting revision hash")
                != revision_hash(body)
            ):
                _restore_invalid("stored accepted GraphPatch revision chain is invalid")
        else:
            if (
                data["outcome"] != "rejected"
                or not diagnostics_value
                or committed["dynamicNodes"] != 0
                or data["errorCode"] not in _PATCH_ERROR_CODES
            ):
                _restore_invalid("stored rejected GraphPatch outcome is invalid")
        return data, document, patch_id, digest
    except CycleRuntimeError as exc:
        if exc.code is CycleErrorCode.INVALID_HISTORY:
            raise
        _restore_invalid("stored GraphPatch failed closed restore validation", cause=exc)
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        _restore_invalid("stored GraphPatch failed closed restore validation", cause=exc)


@dataclass(frozen=True, slots=True)
class PatchAuthority:
    proposer_activity_key: str
    principal_hash: str
    proposer_grant_hash: str
    run_grant_hash: str
    tenant_grant_hash: str
    deployment_grant_hash: str
    effective_grant_hash: str
    policy_hash: str
    approval_hash: str | None
    allowed_capabilities: frozenset[str] = frozenset()

    def snapshot(self) -> JsonObject:
        return {
            "proposerActivityKey": self.proposer_activity_key,
            "principalHash": self.principal_hash,
            "proposerGrantHash": self.proposer_grant_hash,
            "runGrantHash": self.run_grant_hash,
            "tenantGrantHash": self.tenant_grant_hash,
            "deploymentGrantHash": self.deployment_grant_hash,
            "effectiveGrantHash": self.effective_grant_hash,
            "policyHash": self.policy_hash,
            "approvalHash": self.approval_hash,
        }


@dataclass(frozen=True, slots=True)
class PatchReservation:
    reservation_id: str
    attempts: int
    cost_usd: int | float
    dynamic_nodes: int


@dataclass(frozen=True, slots=True)
class PatchDecision:
    patch_id: str
    patch_hash: str
    canonical_json: str
    outcome: Literal["accepted", "rejected"]
    requested_base: JsonObject
    authority_snapshot: JsonObject
    policy_snapshot_hash: str
    budget_outcome: JsonObject
    diagnostics: tuple[CycleIssue, ...]
    resulting_revision: JsonObject | None
    candidate_graph_hash: str | None
    error_code: CycleErrorCode | None
    dry_run: bool

    def projection(self) -> JsonObject:
        if self.outcome == "accepted":
            assert self.resulting_revision is not None
            body = cast(dict[str, Any], self.resulting_revision["body"])
            return {
                "patchId": self.patch_id,
                "patchHash": self.patch_hash,
                "outcome": "accepted",
                "requestedBase": self.requested_base,
                "resultingRevision": {
                    "graphRevision": cast(JsonValue, body["graphRevision"]),
                    "graphHash": cast(JsonValue, body["graphHash"]),
                    "revisionHash": self.resulting_revision["revisionHash"],
                },
            }
        assert self.error_code is not None
        return {
            "patchId": self.patch_id,
            "patchHash": self.patch_hash,
            "outcome": "rejected",
            "requestedBase": self.requested_base,
            "errorCode": self.error_code.value,
        }


def _issue(code: CycleErrorCode, phase: int, path: str) -> CycleIssue:
    return CycleIssue(code.value, path, phase)


def _diagnostic_document(items: tuple[CycleIssue, ...]) -> list[JsonObject]:
    return [{"code": item.code, "phase": item.phase, "path": item.path} for item in items]


def _raise_invalid(message: str, *, path: str = "") -> NoReturn:
    raise CycleRuntimeError(CycleErrorCode.PATCH_INVALID, message, path=path)


def _pointer_token(value: object) -> str:
    return str(value).replace("~", "~0").replace("/", "~1")


def _raise_fragment_invalid(
    exc: ValidationError,
    *,
    prefix: str,
    label: str,
) -> NoReturn:
    first = exc.errors()[0]
    suffix = "".join(f"/{_pointer_token(part)}" for part in first["loc"])
    _raise_invalid(
        f"{label} violates the Graph IR schema: {first['msg']}",
        path=f"{prefix}{suffix}",
    )


def validate_graph_patch_shape(value: object) -> tuple[JsonObject, str, str]:
    """Capture and fully validate one append-only GraphPatch document.

    The returned document is detached portable JSON.  This validator is the
    common trust boundary for live application, durable restore, and pure
    event replay, so a re-signed history cannot bypass the Graph IR fragment
    schemas that an online compiler would enforce.
    """

    captured = capture_portable_json(value, error_code=CycleErrorCode.PATCH_INVALID)
    if type(captured) is not dict:
        _raise_invalid("GraphPatch must be an object")
    document = captured
    if set(document) != {"apiVersion", "kind", "patchId", "base", "append"}:
        _raise_invalid("GraphPatch root is not closed")
    if (
        document["apiVersion"] != "graphengineering.reacher-z.github.io/patches/v1alpha1"
        or document["kind"] != "GraphPatch"
    ):
        _raise_invalid("GraphPatch version or kind is unsupported")
    patch_id = assert_identifier(document["patchId"], patch=True, path="/patchId")
    base = document["base"]
    if type(base) is not dict or set(base) != {"graphRevision", "graphHash", "revisionHash"}:
        _raise_invalid("GraphPatch base is not closed", path="/base")
    if (
        type(base["graphRevision"]) is not int
        or base["graphRevision"] < 1
        or base["graphRevision"] >= 2**53 - 1
    ):
        _raise_invalid("GraphPatch base revision cannot advance safely", path="/base/graphRevision")
    for field in ("graphHash", "revisionHash"):
        item = base[field]
        if type(item) is not str or len(item) != 64 or any(
            character not in "0123456789abcdef" for character in item
        ):
            _raise_invalid("GraphPatch base hash is invalid", path=f"/base/{field}")
    append = document["append"]
    if type(append) is not dict or set(append) != {"nodes", "edges", "outputs"}:
        _raise_invalid("GraphPatch append is not closed", path="/append")
    if type(append["nodes"]) is not list or type(append["edges"]) is not list:
        _raise_invalid("GraphPatch nodes and edges must be arrays", path="/append")
    if type(append["outputs"]) is not dict:
        _raise_invalid("GraphPatch outputs must be an object", path="/append/outputs")
    if (
        len(append["nodes"]) > 10_000
        or len(append["edges"]) > 20_000
        or len(append["outputs"]) > 10_000
    ):
        _raise_invalid("GraphPatch exceeds per-patch element limits", path="/append")
    if not append["nodes"] and not append["edges"] and not append["outputs"]:
        _raise_invalid("GraphPatch append must not be empty", path="/append")
    for index, node in enumerate(append["nodes"]):
        try:
            NodeSpec.model_validate(node)
        except ValidationError as exc:
            _raise_fragment_invalid(
                exc,
                prefix=f"/append/nodes/{index}",
                label="appended node",
            )
    for index, edge in enumerate(append["edges"]):
        try:
            EdgeSpec.model_validate(edge)
        except ValidationError as exc:
            _raise_fragment_invalid(
                exc,
                prefix=f"/append/edges/{index}",
                label="appended edge",
            )
    for name, endpoint in append["outputs"].items():
        if not name or len(name) > 128:
            _raise_invalid(
                "GraphPatch output name is outside its portable range",
                path=f"/append/outputs/{_pointer_token(name)}",
            )
        try:
            Endpoint.model_validate(endpoint)
        except ValidationError as exc:
            _raise_fragment_invalid(
                exc,
                prefix=f"/append/outputs/{_pointer_token(name)}",
                label="appended output endpoint",
            )
    digest = patch_hash(document)
    return document, patch_id, digest


def _requested_capabilities(nodes: list[Any]) -> frozenset[str]:
    requested: set[str] = set()
    for index, node_value in enumerate(nodes):
        if type(node_value) is not dict:
            continue
        node = cast(dict[str, Any], node_value)
        for field in ("resources", "config"):
            record = node.get(field)
            if type(record) is not dict:
                continue
            capabilities = cast(dict[str, Any], record).get("capabilities")
            if capabilities is not None:
                if type(capabilities) is not list or any(
                    type(item) is not str for item in capabilities
                ):
                    raise CycleRuntimeError(
                        CycleErrorCode.PATCH_AUTHORITY_EXPANSION,
                        "node capability declaration is not a closed string list",
                        path=f"/append/nodes/{index}/{field}/capabilities",
                    )
                requested.update(cast(list[str], capabilities))
            if field == "config":
                for prohibited in ("authority", "grant", "ambientAuthority"):
                    if prohibited in record:
                        raise CycleRuntimeError(
                            CycleErrorCode.PATCH_AUTHORITY_EXPANSION,
                            "planner cannot provide an authority object",
                            path=f"/append/nodes/{index}/config/{prohibited}",
                        )
    return frozenset(requested)


def _candidate_limits(compiled: CompiledGraph, limits: GraphPatchLimits) -> CycleIssue | None:
    if len(compiled.spec.nodes) > limits.max_nodes:
        return _issue(CycleErrorCode.PATCH_BUDGET_EXCEEDED, 10, "/append/nodes")
    if len(compiled.spec.edges) > limits.max_edges:
        return _issue(CycleErrorCode.PATCH_BUDGET_EXCEEDED, 10, "/append/edges")
    if len(compiled.spec.outputs) > limits.max_outputs:
        return _issue(CycleErrorCode.PATCH_BUDGET_EXCEEDED, 10, "/append/outputs")
    if len(compiled.topological_layers) > limits.max_depth:
        return _issue(CycleErrorCode.PATCH_BUDGET_EXCEEDED, 10, "/append")
    if any(len(edges) > limits.max_fan_out for edges in compiled.outgoing.values()):
        return _issue(CycleErrorCode.PATCH_BUDGET_EXCEEDED, 10, "/append/edges")
    return None


class GraphPatchRuntime:
    """Append-only graph revision runtime with one serial CAS decision point."""

    def __init__(
        self,
        graph: CompiledGraph,
        *,
        revision_hash_value: str,
        limits: GraphPatchLimits,
        succeeded_nodes: frozenset[str] = frozenset(),
        initial_coordinate: JsonObject | None = None,
        max_dynamic_nodes: int = 100_000,
        initial_dynamic_nodes: int = 0,
    ) -> None:
        if (
            type(max_dynamic_nodes) is not int
            or not 0 <= max_dynamic_nodes <= 100_000
            or type(initial_dynamic_nodes) is not int
            or not 0 <= initial_dynamic_nodes <= max_dynamic_nodes
        ):
            raise CycleRuntimeError(
                CycleErrorCode.PATCH_INVALID,
                "dynamic-node bounds are outside the portable runtime range",
            )
        base_document = capture_graph_model_document(graph.spec, GraphSpec)
        detached = capture_portable_json(base_document)
        if type(detached) is not dict:  # pragma: no cover - compiler invariant
            raise TypeError("compiled graph snapshot is not an object")
        compiled = try_compile_graph(detached).raise_for_errors()
        self._graph = compiled
        self._graph_document = detached
        coordinate: JsonObject = initial_coordinate or {
            "graphRevision": 1,
            "graphHash": compiled.graph_hash,
            "revisionHash": revision_hash_value,
        }
        detached_coordinate = capture_portable_json(coordinate)
        if type(detached_coordinate) is not dict:  # pragma: no cover - annotation invariant
            raise TypeError("initial graph coordinate is not an object")
        if detached_coordinate.get("graphHash") != compiled.graph_hash:
            raise CycleRuntimeError(
                CycleErrorCode.PATCH_STALE_BASE,
                "initial graph coordinate does not match compiled graph",
            )
        self._coordinate = detached_coordinate
        self._limits = limits
        self._max_dynamic_nodes = max_dynamic_nodes
        self._dynamic_nodes = initial_dynamic_nodes
        self._succeeded_nodes = frozenset(succeeded_nodes)
        self._decisions: dict[str, PatchDecision] = {}
        self._lock = asyncio.Lock()

    @property
    def graph(self) -> CompiledGraph:
        return self._graph

    @property
    def coordinate(self) -> JsonObject:
        return cast(JsonObject, capture_portable_json(self._coordinate))

    @property
    def decision_count(self) -> int:
        return len(self._decisions)

    @property
    def dynamic_nodes(self) -> int:
        """Return the number of accepted dynamic nodes in this runtime lineage."""

        return self._dynamic_nodes

    async def restore(self, events: Sequence[CycleEvent]) -> None:
        """Rebuild accepted graph revisions and complete decided-ID records.

        Recovery trusts neither a caller-supplied revision table nor a partial
        decision cache.  It recompiles every stored accepted patch in durable
        order and reconstructs accepted and rejected decisions with their full
        authority, policy, budget, diagnostics, and revision evidence.
        """

        async with self._lock:
            for event in events:
                if event.type not in {"PatchAccepted", "PatchRejected"}:
                    continue
                data, document, patch_id, digest = _validate_restored_patch_event(event)
                payload = cast(dict[str, Any], data["patch"])
                canonical = cast(str, payload["canonicalJson"])
                prior = self._decisions.get(patch_id)
                if prior is not None:
                    expected_outcome = (
                        "accepted" if event.type == "PatchAccepted" else "rejected"
                    )
                    expected_diagnostics = tuple(
                        CycleIssue(
                            cast(str, item["code"]),
                            cast(str, item["path"]),
                            cast(int, item["phase"]),
                        )
                        for item in cast(list[dict[str, Any]], data["diagnostics"])
                    )
                    expected_resulting = (
                        cast(JsonObject, capture_portable_json(data["resultingRevision"]))
                        if event.type == "PatchAccepted"
                        else None
                    )
                    expected_error = (
                        None
                        if event.type == "PatchAccepted"
                        else CycleErrorCode(cast(str, data["errorCode"]))
                    )
                    complete_match = (
                        prior.canonical_json == canonical
                        and prior.patch_hash == digest
                        and prior.outcome == expected_outcome
                        and canonical_json(prior.requested_base)
                        == canonical_json(data["requestedBase"])
                        and canonical_json(prior.authority_snapshot)
                        == canonical_json(data["authoritySnapshot"])
                        and prior.policy_snapshot_hash == data["policySnapshotHash"]
                        and canonical_json(prior.budget_outcome)
                        == canonical_json(data["budgetOutcome"])
                        and prior.diagnostics == expected_diagnostics
                        and canonical_json(prior.resulting_revision)
                        == canonical_json(expected_resulting)
                        and prior.error_code is expected_error
                        and prior.dry_run is False
                    )
                    if not complete_match:
                        raise CycleRuntimeError(
                            CycleErrorCode.PATCH_IDEMPOTENCY_CONFLICT,
                            "restored patchId conflicts with complete existing decision evidence",
                        )
                    continue
                requested_base = cast(JsonObject, capture_portable_json(data["requestedBase"]))
                stale_rejection = (
                    event.type == "PatchRejected"
                    and data.get("errorCode") == CycleErrorCode.PATCH_STALE_BASE.value
                )
                base_matches = canonical_json(requested_base) == canonical_json(self._coordinate)
                if (stale_rejection and base_matches) or (not stale_rejection and not base_matches):
                    raise CycleRuntimeError(
                        CycleErrorCode.INVALID_HISTORY,
                        "restored GraphPatch base does not match reconstructed revision",
                    )
                diagnostics = tuple(
                    CycleIssue(
                        cast(str, item["code"]),
                        cast(str, item["path"]),
                        cast(int, item["phase"]),
                    )
                    for item in cast(list[dict[str, Any]], data["diagnostics"])
                )
                resulting_revision = (
                    cast(JsonObject, capture_portable_json(data["resultingRevision"]))
                    if event.type == "PatchAccepted"
                    else None
                )
                error_code = (
                    None
                    if event.type == "PatchAccepted"
                    else CycleErrorCode(cast(str, data["errorCode"]))
                )
                decision = PatchDecision(
                    patch_id=patch_id,
                    patch_hash=digest,
                    canonical_json=canonical,
                    outcome="accepted" if event.type == "PatchAccepted" else "rejected",
                    requested_base=requested_base,
                    authority_snapshot=cast(
                        JsonObject,
                        capture_portable_json(data["authoritySnapshot"]),
                    ),
                    policy_snapshot_hash=cast(str, data["policySnapshotHash"]),
                    budget_outcome=cast(
                        JsonObject,
                        capture_portable_json(data["budgetOutcome"]),
                    ),
                    diagnostics=diagnostics,
                    resulting_revision=resulting_revision,
                    candidate_graph_hash=(
                        None
                        if resulting_revision is None
                        else cast(
                            str,
                            cast(dict[str, Any], resulting_revision["body"])["graphHash"],
                        )
                    ),
                    error_code=error_code,
                    dry_run=False,
                )
                if resulting_revision is not None:
                    append = cast(dict[str, Any], document["append"])
                    committed = cast(
                        dict[str, Any],
                        cast(dict[str, Any], data["budgetOutcome"])["committed"],
                    )
                    committed_dynamic_nodes = committed.get("dynamicNodes")
                    if (
                        type(committed_dynamic_nodes) is not int
                        or committed_dynamic_nodes != len(cast(list[Any], append["nodes"]))
                        or self._dynamic_nodes + committed_dynamic_nodes
                        > self._max_dynamic_nodes
                    ):
                        raise CycleRuntimeError(
                            CycleErrorCode.INVALID_HISTORY,
                            "restored accepted GraphPatch exceeds its dynamic-node lineage bound",
                        )
                    candidate = cast(
                        dict[str, Any],
                        capture_portable_json(self._graph_document),
                    )
                    cast(list[Any], candidate["nodes"]).extend(
                        cast(list[Any], append["nodes"])
                    )
                    cast(list[Any], candidate["edges"]).extend(
                        cast(list[Any], append["edges"])
                    )
                    candidate_outputs = cast(dict[str, Any], candidate["outputs"])
                    for name in sorted(cast(dict[str, Any], append["outputs"])):
                        candidate_outputs[name] = cast(dict[str, Any], append["outputs"])[name]
                    compiled = try_compile_graph(candidate).raise_for_errors()
                    if _candidate_limits(compiled, self._limits) is not None:
                        raise CycleRuntimeError(
                            CycleErrorCode.INVALID_HISTORY,
                            "restored accepted GraphPatch exceeds runtime graph limits",
                        )
                    body = cast(dict[str, Any], resulting_revision["body"])
                    expected_coordinate: JsonObject = {
                        "graphRevision": body["graphRevision"],
                        "graphHash": body["graphHash"],
                        "revisionHash": resulting_revision["revisionHash"],
                    }
                    if (
                        compiled.graph_hash != body["graphHash"]
                        or body["previousRevisionHash"] != self._coordinate["revisionHash"]
                        or body["patchHash"] != digest
                        or resulting_revision["revisionHash"] != revision_hash(body)
                    ):
                        raise CycleRuntimeError(
                            CycleErrorCode.INVALID_HISTORY,
                            "restored accepted GraphPatch revision does not compile exactly",
                        )
                    self._graph = compiled
                    self._graph_document = candidate
                    self._coordinate = expected_coordinate
                    self._dynamic_nodes += committed_dynamic_nodes
                self._decisions[patch_id] = decision

    async def apply(
        self,
        patch: object,
        *,
        authority: PatchAuthority,
        policy_snapshot_hash: str,
        reservation: PatchReservation,
        dry_run: bool = False,
        record: DecisionRecorder | None = None,
    ) -> PatchDecision:
        document, patch_id, digest = validate_graph_patch_shape(patch)
        canonical = canonical_json(document)
        async with self._lock:
            prior = self._decisions.get(patch_id)
            if prior is not None:
                if prior.patch_hash != digest or prior.canonical_json != canonical:
                    raise CycleRuntimeError(
                        CycleErrorCode.PATCH_IDEMPOTENCY_CONFLICT,
                        "decided patchId was reused with different canonical bytes",
                    )
                return prior

            requested_base = cast(JsonObject, document["base"])
            if canonical_json(requested_base) != canonical_json(self._coordinate):
                return await self._reject(
                    document,
                    patch_id,
                    digest,
                    canonical,
                    authority,
                    policy_snapshot_hash,
                    reservation,
                    CycleErrorCode.PATCH_STALE_BASE,
                    (_issue(CycleErrorCode.PATCH_STALE_BASE, 5, "/base"),),
                    dry_run=dry_run,
                    record=record,
                )

            append = cast(dict[str, Any], document["append"])
            nodes = cast(list[Any], append["nodes"])
            edges = cast(list[Any], append["edges"])
            outputs = cast(dict[str, Any], append["outputs"])
            existing_nodes = {node.id for node in self._graph.spec.nodes}
            existing_edges = {edge.id for edge in self._graph.spec.edges}
            existing_outputs = set(self._graph.spec.outputs)
            appended_node_ids = [
                node.get("id") if type(node) is dict else None for node in nodes
            ]
            appended_edge_ids = [
                edge.get("id") if type(edge) is dict else None for edge in edges
            ]
            duplicate_path: str | None = None
            if len(set(appended_node_ids)) != len(appended_node_ids) or any(
                node_id in existing_nodes for node_id in appended_node_ids
            ):
                duplicate_path = "/append/nodes"
            elif len(set(appended_edge_ids)) != len(appended_edge_ids) or any(
                edge_id in existing_edges for edge_id in appended_edge_ids
            ):
                duplicate_path = "/append/edges"
            elif existing_outputs.intersection(outputs):
                duplicate_path = "/append/outputs"
            if duplicate_path is not None:
                return await self._reject(
                    document,
                    patch_id,
                    digest,
                    canonical,
                    authority,
                    policy_snapshot_hash,
                    reservation,
                    CycleErrorCode.PATCH_DUPLICATE_ID,
                    (_issue(CycleErrorCode.PATCH_DUPLICATE_ID, 6, duplicate_path),),
                    dry_run=dry_run,
                    record=record,
                )

            for index, edge_value in enumerate(edges):
                if type(edge_value) is not dict:
                    continue
                edge = cast(dict[str, Any], edge_value)
                source = edge.get("from")
                target = edge.get("to")
                targets_existing = (
                    type(target) is dict
                    and cast(dict[str, Any], target).get("node") in existing_nodes
                )
                if targets_existing:
                    return await self._reject(
                        document,
                        patch_id,
                        digest,
                        canonical,
                        authority,
                        policy_snapshot_hash,
                        reservation,
                        CycleErrorCode.PATCH_STATE_CONFLICT,
                        (
                            _issue(
                                CycleErrorCode.PATCH_STATE_CONFLICT,
                                6,
                                f"/append/edges/{index}/to/node",
                            ),
                        ),
                        dry_run=dry_run,
                        record=record,
                    )
                source_id = (
                    cast(dict[str, Any], source).get("node") if type(source) is dict else None
                )
                if source_id in existing_nodes and source_id not in self._succeeded_nodes:
                    return await self._reject(
                        document,
                        patch_id,
                        digest,
                        canonical,
                        authority,
                        policy_snapshot_hash,
                        reservation,
                        CycleErrorCode.PATCH_STATE_CONFLICT,
                        (
                            _issue(
                                CycleErrorCode.PATCH_STATE_CONFLICT,
                                6,
                                f"/append/edges/{index}/from/node",
                            ),
                        ),
                        dry_run=dry_run,
                        record=record,
                    )
                if edge.get("mode", "value") != "value":
                    return await self._reject(
                        document,
                        patch_id,
                        digest,
                        canonical,
                        authority,
                        policy_snapshot_hash,
                        reservation,
                        CycleErrorCode.PATCH_UNSUPPORTED,
                        (
                            _issue(
                                CycleErrorCode.PATCH_UNSUPPORTED,
                                10,
                                f"/append/edges/{index}/mode",
                            ),
                        ),
                        dry_run=dry_run,
                        record=record,
                    )

            requested_capabilities = _requested_capabilities(nodes)
            if not requested_capabilities.issubset(authority.allowed_capabilities):
                return await self._reject(
                    document,
                    patch_id,
                    digest,
                    canonical,
                    authority,
                    policy_snapshot_hash,
                    reservation,
                    CycleErrorCode.PATCH_AUTHORITY_EXPANSION,
                    (
                        _issue(
                            CycleErrorCode.PATCH_AUTHORITY_EXPANSION,
                            9,
                            "/append/nodes",
                        ),
                    ),
                    dry_run=dry_run,
                    record=record,
                )

            if (
                reservation.attempts < 1
                or reservation.dynamic_nodes < len(nodes)
                or self._dynamic_nodes + len(nodes) > self._max_dynamic_nodes
            ):
                return await self._reject(
                    document,
                    patch_id,
                    digest,
                    canonical,
                    authority,
                    policy_snapshot_hash,
                    reservation,
                    CycleErrorCode.PATCH_BUDGET_EXCEEDED,
                    (_issue(CycleErrorCode.PATCH_BUDGET_EXCEEDED, 10, "/append/nodes"),),
                    dry_run=dry_run,
                    record=record,
                )

            candidate = cast(dict[str, Any], capture_portable_json(self._graph_document))
            candidate_nodes = cast(list[Any], candidate["nodes"])
            candidate_edges = cast(list[Any], candidate["edges"])
            candidate_outputs = cast(dict[str, Any], candidate["outputs"])
            candidate_nodes.extend(nodes)
            candidate_edges.extend(edges)
            for name in sorted(outputs):
                candidate_outputs[name] = outputs[name]
            compilation = try_compile_graph(candidate)
            if not compilation.valid or compilation.graph is None:
                issues = tuple(
                    _issue(
                        CycleErrorCode.PATCH_GRAPH_INVALID,
                        8,
                        diagnostic.path or "/append",
                    )
                    for diagnostic in compilation.diagnostics
                ) or (_issue(CycleErrorCode.PATCH_GRAPH_INVALID, 8, "/append"),)
                return await self._reject(
                    document,
                    patch_id,
                    digest,
                    canonical,
                    authority,
                    policy_snapshot_hash,
                    reservation,
                    CycleErrorCode.PATCH_GRAPH_INVALID,
                    issues,
                    dry_run=dry_run,
                    record=record,
                )
            compiled = compilation.graph
            limit_issue = _candidate_limits(compiled, self._limits)
            if limit_issue is not None:
                return await self._reject(
                    document,
                    patch_id,
                    digest,
                    canonical,
                    authority,
                    policy_snapshot_hash,
                    reservation,
                    CycleErrorCode.PATCH_BUDGET_EXCEEDED,
                    (limit_issue,),
                    dry_run=dry_run,
                    record=record,
                )

            body: JsonObject = {
                "apiVersion": "graphengineering.reacher-z.github.io/graph-revisions/v1alpha1",
                "kind": "GraphRevision",
                "graphRevision": cast(int, self._coordinate["graphRevision"]) + 1,
                "previousRevisionHash": cast(str, self._coordinate["revisionHash"]),
                "patchHash": digest,
                "graphHash": compiled.graph_hash,
            }
            resulting_revision: JsonObject = {
                "body": body,
                "revisionHash": revision_hash(body),
            }
            budget_outcome: JsonObject = {
                "reservationId": reservation.reservation_id,
                "requested": {
                    "attempts": reservation.attempts,
                    "costUsd": reservation.cost_usd,
                    "dynamicNodes": reservation.dynamic_nodes,
                },
                "committed": {
                    "attempts": 1,
                    "costUsd": reservation.cost_usd,
                    "dynamicNodes": len(nodes),
                },
                "released": {
                    "attempts": reservation.attempts - 1,
                    "costUsd": 0,
                    "dynamicNodes": reservation.dynamic_nodes - len(nodes),
                },
            }
            decision = PatchDecision(
                patch_id=patch_id,
                patch_hash=digest,
                canonical_json=canonical,
                outcome="accepted",
                requested_base=requested_base,
                authority_snapshot=authority.snapshot(),
                policy_snapshot_hash=policy_snapshot_hash,
                budget_outcome=budget_outcome,
                diagnostics=(),
                resulting_revision=resulting_revision,
                candidate_graph_hash=compiled.graph_hash,
                error_code=None,
                dry_run=dry_run,
            )
            if dry_run:
                return decision
            await _record(record, decision)
            self._decisions[patch_id] = decision
            self._graph = compiled
            self._graph_document = candidate
            self._coordinate = cast(JsonObject, decision.projection()["resultingRevision"])
            self._dynamic_nodes += len(nodes)
            return decision

    async def _reject(
        self,
        document: JsonObject,
        patch_id: str,
        digest: str,
        canonical: str,
        authority: PatchAuthority,
        policy_snapshot_hash: str,
        reservation: PatchReservation,
        error_code: CycleErrorCode,
        diagnostics: tuple[CycleIssue, ...],
        *,
        dry_run: bool,
        record: DecisionRecorder | None,
    ) -> PatchDecision:
        requested_base = cast(JsonObject, document["base"])
        budget_outcome: JsonObject = {
            "reservationId": reservation.reservation_id,
            "requested": {
                "attempts": reservation.attempts,
                "costUsd": reservation.cost_usd,
                "dynamicNodes": reservation.dynamic_nodes,
            },
            "committed": {
                "attempts": 1 if reservation.attempts else 0,
                "costUsd": reservation.cost_usd,
                "dynamicNodes": 0,
            },
            "released": {
                "attempts": max(0, reservation.attempts - 1),
                "costUsd": 0,
                "dynamicNodes": reservation.dynamic_nodes,
            },
        }
        decision = PatchDecision(
            patch_id=patch_id,
            patch_hash=digest,
            canonical_json=canonical,
            outcome="rejected",
            requested_base=requested_base,
            authority_snapshot=authority.snapshot(),
            policy_snapshot_hash=policy_snapshot_hash,
            budget_outcome=budget_outcome,
            diagnostics=diagnostics,
            resulting_revision=None,
            candidate_graph_hash=None,
            error_code=error_code,
            dry_run=dry_run,
        )
        if dry_run:
            return decision
        await _record(record, decision)
        self._decisions[patch_id] = decision
        return decision


async def _record(recorder: DecisionRecorder | None, decision: PatchDecision) -> None:
    if recorder is None:
        raise CycleRuntimeError(
            CycleErrorCode.STORE_FAILED,
            "non-dry GraphPatch decisions require a durable recorder",
        )
    outcome = recorder(decision)
    if inspect.isawaitable(outcome):
        await outcome


__all__ = [
    "DecisionRecorder",
    "GraphPatchRuntime",
    "PatchAuthority",
    "PatchDecision",
    "PatchReservation",
]
