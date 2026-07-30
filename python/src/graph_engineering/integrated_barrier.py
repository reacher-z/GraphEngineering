"""Integrated barrier policy validation and its compiler pass.

The validator mirrors :mod:`graph_engineering.integrated_router`: it validates
one direct, exact ``barrier`` node config without inferring anything from edges
or metadata, and it reports the first invalid descendant using the contract
order frozen by ``spec/integrated-barrier-semantics.md``.

Ownership is a versioned claim rather than a guessed shape: a barrier config is
a claimed policy if and only if it is a portable object carrying the exact
``apiVersion``. A config without it — including every pre-contract ``{}`` and
``{"condition": "all"}`` — is not interpreted here and receives no diagnostic
from this pass. Inside a claimed carrier nothing is forgiven: an unknown member,
a missing ``kind``, a wrong type, or a kind/threshold cardinality error is
``GE1421`` or ``GE1422``.

This module deliberately implements no barrier execution. Satisfaction
arithmetic, deadlines, resolutions, late arrival, and durable decisions are a
separate tranche; until they exist the scheduler refuses a policy-bearing
barrier through the pre-dispatch runtime capability preflight
(``node-config:barrier``), which already covers every exact policy because no
exact policy equals ``{}`` or ``{"condition": "all"}``.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Literal, TypeAlias, TypeGuard

from .compiler import Diagnostic, DiagnosticCode
from .models import MAX_SAFE_INTEGER, GraphSpec, JsonValue

BarrierKind: TypeAlias = Literal["all", "minimum", "percentage", "quorum"]
BarrierOnUnsatisfied: TypeAlias = Literal["fail", "unknown", "human"]
BarrierLateArrival: TypeAlias = Literal["ignore", "reject"]
BarrierPolicyApiVersion: TypeAlias = Literal[
    "graphengineering.reacher-z.github.io/barrier/v1alpha1"
]

BARRIER_POLICY_API_VERSION: BarrierPolicyApiVersion = (
    "graphengineering.reacher-z.github.io/barrier/v1alpha1"
)

MAX_BASIS_POINTS = 10_000

_POLICY_KEYS = frozenset(
    {
        "apiVersion",
        "kind",
        "minimum",
        "basisPoints",
        "quorum",
        "deadline",
        "onUnsatisfied",
        "lateArrival",
    }
)
_QUORUM_KEYS = frozenset({"accepts", "countAbstainAsParticipant"})
_DEADLINE_KEYS = frozenset({"afterMs"})
# Shape is checked in the declaration-block order of the semantics document —
# apiVersion, kind, minimum, basisPoints, quorum, deadline, onUnsatisfied,
# lateArrival — which is deliberately not the schema's "properties" order. The
# per-kind cardinality sweep below runs only after every shape check passes.
_CARDINALITY_FIELDS: tuple[tuple[str, BarrierKind], ...] = (
    ("minimum", "minimum"),
    ("basisPoints", "percentage"),
    ("quorum", "quorum"),
)
_KINDS = frozenset({"all", "minimum", "percentage", "quorum"})
_ON_UNSATISFIED = frozenset({"fail", "unknown", "human"})
_LATE_ARRIVAL = frozenset({"ignore", "reject"})


@dataclass(frozen=True, slots=True)
class BarrierQuorumSnapshot:
    accepts: int
    count_abstain_as_participant: bool


@dataclass(frozen=True, slots=True)
class BarrierDeadlineSnapshot:
    after_ms: int


@dataclass(frozen=True, slots=True)
class IntegratedBarrierPolicySnapshot:
    api_version: BarrierPolicyApiVersion
    kind: BarrierKind
    on_unsatisfied: BarrierOnUnsatisfied
    late_arrival: BarrierLateArrival
    minimum: int | None = None
    basis_points: int | None = None
    quorum: BarrierQuorumSnapshot | None = None
    deadline: BarrierDeadlineSnapshot | None = None


@dataclass(frozen=True, slots=True)
class UnclaimedBarrierConfig:
    """A barrier config that never claimed this contract, so it is not a policy."""

    valid: Literal[False]
    claimed: Literal[False]


@dataclass(frozen=True, slots=True)
class InvalidBarrierPolicy:
    valid: Literal[False]
    claimed: Literal[True]
    code: DiagnosticCode
    relative_path: str


@dataclass(frozen=True, slots=True)
class ValidBarrierPolicy:
    valid: Literal[True]
    claimed: Literal[True]
    policy: IntegratedBarrierPolicySnapshot


BarrierPolicyValidation: TypeAlias = (
    UnclaimedBarrierConfig | InvalidBarrierPolicy | ValidBarrierPolicy
)


def _record(value: object) -> TypeGuard[dict[str, JsonValue]]:
    return type(value) is dict


def _first_unknown(value: dict[str, JsonValue], allowed: frozenset[str]) -> str | None:
    return next(iter(sorted(key for key in value if key not in allowed)), None)


def _bounded_integer(value: object, minimum: int, maximum: int) -> int | None:
    """Return the portable integer value, treating JSON ``1.0`` as integer one.

    Booleans are never integers, so ``type`` identity is checked rather than
    ``isinstance``.
    """

    if type(value) is int:
        candidate = value
    elif type(value) is float and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER:
        candidate = int(value)
    else:
        return None
    return candidate if minimum <= candidate <= maximum else None


def _shape_error(relative_path: str) -> InvalidBarrierPolicy:
    return InvalidBarrierPolicy(False, True, DiagnosticCode.INVALID_BARRIER_POLICY, relative_path)


def _kind_error(relative_path: str) -> InvalidBarrierPolicy:
    return InvalidBarrierPolicy(
        False, True, DiagnosticCode.BARRIER_POLICY_KIND_MISMATCH, relative_path
    )


def _validate_quorum(value: JsonValue) -> BarrierQuorumSnapshot | InvalidBarrierPolicy:
    if not _record(value):
        return _shape_error("/quorum")
    unknown = _first_unknown(value, _QUORUM_KEYS)
    if unknown is not None:
        return _shape_error(f"/quorum/{unknown}")
    accepts = _bounded_integer(value.get("accepts"), 1, MAX_SAFE_INTEGER)
    if accepts is None:
        return _shape_error("/quorum/accept")
    count_abstain = value.get("countAbstainAsParticipant")
    if type(count_abstain) is not bool:
        return _shape_error("/quorum/countAbstainAsParticipant")
    return BarrierQuorumSnapshot(accepts, count_abstain)


def _validate_deadline(value: JsonValue) -> BarrierDeadlineSnapshot | InvalidBarrierPolicy:
    if not _record(value):
        return _shape_error("/deadline")
    unknown = _first_unknown(value, _DEADLINE_KEYS)
    if unknown is not None:
        return _shape_error(f"/deadline/{unknown}")
    after_ms = _bounded_integer(value.get("afterMs"), 1, MAX_SAFE_INTEGER)
    if after_ms is None:
        return _shape_error("/deadline/afterMs")
    return BarrierDeadlineSnapshot(after_ms)


def validate_integrated_barrier_policy(value: object) -> BarrierPolicyValidation:
    """Validate one direct exact barrier config without inferring from edges.

    Ownership is decided first: a config that makes no claim is returned
    unclaimed and is never diagnosed. Inside a claimed carrier, shape is decided
    over the whole policy before per-kind cardinality. That order is the frozen
    suppression chain: a policy that is not an exact object has no kind and no
    threshold to compare, so ``GE1421`` always wins over ``GE1422`` on the same
    config.
    """

    if not _record(value):
        return UnclaimedBarrierConfig(False, False)
    record = value
    # `apiVersion` leads the contract order, and a claimed carrier always
    # carries the exact value, so no later member can report before it.
    api_version = record.get("apiVersion")
    if type(api_version) is not str or api_version != BARRIER_POLICY_API_VERSION:
        return UnclaimedBarrierConfig(False, False)

    unknown = _first_unknown(record, _POLICY_KEYS)
    if unknown is not None:
        return _shape_error(f"/{unknown}")

    kind = record.get("kind")
    if type(kind) is not str or kind not in _KINDS:
        return _shape_error("/kind")
    policy_kind: BarrierKind
    if kind == "all":
        policy_kind = "all"
    elif kind == "minimum":
        policy_kind = "minimum"
    elif kind == "percentage":
        policy_kind = "percentage"
    else:
        policy_kind = "quorum"

    minimum: int | None = None
    if "minimum" in record:
        minimum = _bounded_integer(record["minimum"], 1, MAX_SAFE_INTEGER)
        if minimum is None:
            return _shape_error("/minimum")

    basis_points: int | None = None
    if "basisPoints" in record:
        basis_points = _bounded_integer(record["basisPoints"], 1, MAX_BASIS_POINTS)
        if basis_points is None:
            return _shape_error("/basisPoints")

    quorum: BarrierQuorumSnapshot | None = None
    if "quorum" in record:
        quorum_result = _validate_quorum(record["quorum"])
        if isinstance(quorum_result, InvalidBarrierPolicy):
            return quorum_result
        quorum = quorum_result

    deadline: BarrierDeadlineSnapshot | None = None
    if "deadline" in record:
        deadline_result = _validate_deadline(record["deadline"])
        if isinstance(deadline_result, InvalidBarrierPolicy):
            return deadline_result
        deadline = deadline_result

    on_unsatisfied = record.get("onUnsatisfied")
    if type(on_unsatisfied) is not str or on_unsatisfied not in _ON_UNSATISFIED:
        return _shape_error("/onUnsatisfied")
    policy_on_unsatisfied: BarrierOnUnsatisfied
    if on_unsatisfied == "fail":
        policy_on_unsatisfied = "fail"
    elif on_unsatisfied == "unknown":
        policy_on_unsatisfied = "unknown"
    else:
        policy_on_unsatisfied = "human"

    late_arrival = record.get("lateArrival")
    if type(late_arrival) is not str or late_arrival not in _LATE_ARRIVAL:
        return _shape_error("/lateArrival")
    policy_late_arrival: BarrierLateArrival = "ignore" if late_arrival == "ignore" else "reject"

    for field, owning_kind in _CARDINALITY_FIELDS:
        present = field in record
        if policy_kind == owning_kind:
            if not present:
                return _kind_error(f"/{field}")
        elif present:
            return _kind_error(f"/{field}")

    return ValidBarrierPolicy(
        True,
        True,
        IntegratedBarrierPolicySnapshot(
            BARRIER_POLICY_API_VERSION,
            policy_kind,
            policy_on_unsatisfied,
            policy_late_arrival,
            minimum,
            basis_points,
            quorum,
            deadline,
        ),
    )


def claims_integrated_barrier_policy(value: object) -> bool:
    """Report whether a barrier config claims ownership by this contract.

    Ownership is the exact ``apiVersion`` and nothing else. A portable null,
    scalar, or array cannot carry one, and a pre-contract object that omits it
    is not a claimed policy, so neither is interpreted as a policy at all.
    """

    return validate_integrated_barrier_policy(value).claimed


def _diagnostic(
    code: DiagnosticCode,
    message: str,
    path: str,
    node_ids: tuple[str, ...],
) -> Diagnostic:
    return Diagnostic(
        code=code,
        message=message,
        node_id=node_ids[0] if node_ids else None,
        path=path,
        node_ids=node_ids,
    )


def validate_integrated_barrier_snapshot(graph: GraphSpec) -> tuple[Diagnostic, ...]:
    """Validate claimed barrier policies and cardinality in frozen pass order.

    Only barrier nodes whose config claims this contract are considered.
    Diagnostics are grouped by category in ``GE1421``, ``GE1422``, ``GE1423``,
    ``GE1424`` order and, within a category, in node declaration order.
    """

    incoming = Counter(edge.target.node for edge in graph.edges)
    shape_diagnostics: list[Diagnostic] = []
    kind_diagnostics: list[Diagnostic] = []
    no_input_diagnostics: list[Diagnostic] = []
    threshold_diagnostics: list[Diagnostic] = []

    for index, node in enumerate(graph.nodes):
        if node.kind != "barrier":
            continue
        validation = validate_integrated_barrier_policy(node.config)
        if not validation.claimed:
            # Not a claimed policy: this pass does not interpret it and emits
            # nothing for it, so pre-contract barrier configs keep the behavior
            # they already had.
            continue
        inputs = incoming[node.id]
        if inputs == 0:
            no_input_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.BARRIER_NO_INPUTS,
                    f"barrier {node.id!r} has no incoming edges",
                    f"#/nodes/{index}",
                    (node.id,),
                )
            )
        if not validation.valid:
            path = f"#/nodes/{index}/config{validation.relative_path}"
            if validation.code is DiagnosticCode.INVALID_BARRIER_POLICY:
                shape_diagnostics.append(
                    _diagnostic(
                        DiagnosticCode.INVALID_BARRIER_POLICY,
                        f"barrier {node.id!r} has an invalid barrier policy",
                        path,
                        (node.id,),
                    )
                )
            else:
                kind_diagnostics.append(
                    _diagnostic(
                        DiagnosticCode.BARRIER_POLICY_KIND_MISMATCH,
                        f"barrier {node.id!r} policy does not match its kind",
                        path,
                        (node.id,),
                    )
                )
            continue

        policy = validation.policy
        if policy.minimum is not None and policy.minimum > inputs:
            threshold_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.BARRIER_THRESHOLD_EXCEEDS_INPUTS,
                    (
                        f"barrier {node.id!r} minimum {policy.minimum} exceeds its "
                        f"{inputs} incoming edges"
                    ),
                    f"#/nodes/{index}/config/minimum",
                    (node.id,),
                )
            )
        elif policy.quorum is not None and policy.quorum.accepts > inputs:
            threshold_diagnostics.append(
                _diagnostic(
                    DiagnosticCode.BARRIER_THRESHOLD_EXCEEDS_INPUTS,
                    (
                        f"barrier {node.id!r} quorum accepts {policy.quorum.accepts} "
                        f"exceeds its {inputs} incoming edges"
                    ),
                    f"#/nodes/{index}/config/quorum/accepts",
                    (node.id,),
                )
            )

    return (
        *shape_diagnostics,
        *kind_diagnostics,
        *no_input_diagnostics,
        *threshold_diagnostics,
    )
