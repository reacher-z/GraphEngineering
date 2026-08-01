"""Integrated barrier execution: arming, satisfaction, deadlines, and replay.

This module is the native Python execution half of
``spec/integrated-barrier-semantics.md``. Tranche 1 shipped policy validation and
the compiler pass in :mod:`graph_engineering.integrated_barrier`; this tranche
makes a claimed barrier policy *do* something: it arms on the first settled
upstream, collects one disposition per incoming edge, decides by exact-integer
arithmetic, settles a deadline against an **injected** monotonic clock, applies
the three non-pass resolutions, handles late arrival and cancellation, produces
the frozen ``BarrierSatisfied`` decision document with its domain-separated
``policyHash`` and ``decisionId``, and folds a durable history into committed
decisions without ever re-judging one.

Three properties are load-bearing and are enforced by construction:

* **No wall clock and no thread hop.** Every time value comes from the injected
  :class:`MonotonicClock`. Nothing here reads ``time``, creates a timer, awaits,
  or dispatches through a thread, so barrier execution cannot acquire the
  load-sensitive behaviour registered as ``D8-CYCLE-TIMEOUT-DIVERGENCE-090``.
  Deadline settlement is evaluated at explicit quiescence points only.
* **An unsatisfied barrier never succeeds and never binds an output.** The only
  path that produces a bound value is :attr:`BarrierResolution.SATISFIED`.
* **The census key is the ballot, not the disposition name.** An entry that
  produced no conforming :class:`BarrierBallot` is recorded ``not-cast``
  whatever its disposition, including a ``failed`` arising from upstream
  execution failure, and a ``not-cast`` record carries exactly
  ``sourceNodeId`` and ``verdict``.

The published pure evaluator ``graph_engineering.primitives.barrier`` is a
different, narrower surface and is deliberately untouched: the integrated
barrier is a strict superset defined at the scheduler boundary.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Literal, Protocol, TypeAlias, TypeGuard

from .canonical import canonical_json
from .integrated_barrier import (
    MAX_BASIS_POINTS,
    IntegratedBarrierPolicySnapshot,
    ValidBarrierPolicy,
    validate_integrated_barrier_policy,
)
from .models import MAX_SAFE_INTEGER, JsonValue
from .portable_json import PortableJsonError, portable_json_snapshot

__all__ = [
    "BARRIER_DECISION_DOMAIN",
    "BARRIER_POLICY_KIND_TAG",
    "GRAPH_FAILURE_EXCLUDED_CODES",
    "NODE_ID_PATTERN",
    "POLICY_HASH_DOMAIN",
    "ROUTER_POLICY_KIND_TAG",
    "ROUTE_DECISION_DOMAIN",
    "RUN_TERMINAL_PRECEDENCE",
    "SAFE_ROUTE_ID_PATTERN",
    "BarrierArrival",
    "BarrierBallot",
    "BarrierCensusVerdict",
    "BarrierDecisionEvent",
    "BarrierDisposition",
    "BarrierEvaluation",
    "BarrierExecutionState",
    "BarrierFailureCode",
    "BarrierNodeSettlement",
    "BarrierReasonCode",
    "BarrierResolution",
    "BarrierVerdict",
    "BarrierVoteRecord",
    "CommittedDecision",
    "DecisionAdoption",
    "DecisionRejection",
    "DecisionRejectionCode",
    "DescendantTerminal",
    "IntegratedBarrier",
    "InvalidBarrierVote",
    "LateArrivalIgnored",
    "LateArrivalRejected",
    "MalformedBarrierVote",
    "ManualClock",
    "MonotonicClock",
    "RunTerminal",
    "UpstreamOutcome",
    "barrier_decision_id",
    "barrier_policy_hash",
    "build_barrier_decision",
    "descendant_terminal",
    "evaluate_integrated_barrier",
    "evidence_hash",
    "fold_committed_decisions",
    "is_graph_failure_code",
    "parse_barrier_vote",
    "resolve_run_terminal",
    "route_decision_id",
    "route_policy_hash",
    "validate_decision_identifiers",
]

POLICY_HASH_DOMAIN = "graphengineering.policy.v1alpha1"
BARRIER_POLICY_KIND_TAG = "barrier"
ROUTER_POLICY_KIND_TAG = "router"
BARRIER_DECISION_DOMAIN = "graphengineering.barrier-decision.v1alpha1"
ROUTE_DECISION_DOMAIN = "graphengineering.route-decision.v1alpha1"

NODE_ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,127}$")
SAFE_ROUTE_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_RESERVED_ROUTE_KEYS = frozenset({".", ".."})

# `UPSTREAM_UNKNOWN` is excluded from graph failure codes exactly as
# `ROUTE_NOT_SELECTED` already is: an inactive named graph output makes output
# binding incomplete and the run non-successful without inventing a failure.
GRAPH_FAILURE_EXCLUDED_CODES = frozenset({"ROUTE_NOT_SELECTED", "UPSTREAM_UNKNOWN"})


class BarrierDisposition(StrEnum):
    """The closed six-member arrival-disposition vocabulary."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"
    MISSING = "missing"
    TIMED_OUT = "timed_out"
    ABSTAINED = "abstained"
    UNKNOWN = "unknown"


class BarrierReasonCode(StrEnum):
    """The closed eleven-member reason-code set. Deadline elapse is not one."""

    NO_ITEMS = "NO_ITEMS"
    ALL_SUCCEEDED = "ALL_SUCCEEDED"
    ALL_NOT_SUCCEEDED = "ALL_NOT_SUCCEEDED"
    MINIMUM_MET = "MINIMUM_MET"
    MINIMUM_NOT_MET = "MINIMUM_NOT_MET"
    MINIMUM_EXCEEDS_TOTAL = "MINIMUM_EXCEEDS_TOTAL"
    PERCENTAGE_MET = "PERCENTAGE_MET"
    PERCENTAGE_NOT_MET = "PERCENTAGE_NOT_MET"
    QUORUM_MET = "QUORUM_MET"
    QUORUM_NOT_MET = "QUORUM_NOT_MET"
    QUORUM_EXCEEDS_PARTICIPANTS = "QUORUM_EXCEEDS_PARTICIPANTS"


class BarrierResolution(StrEnum):
    SATISFIED = "satisfied"
    FAILED = "failed"
    UNKNOWN = "unknown"
    AWAITING_HUMAN = "awaiting_human"


class BarrierVerdict(StrEnum):
    """The four verdicts an upstream node may cast."""

    ACCEPT = "accept"
    REJECT = "reject"
    ABSTAIN = "abstain"
    UNKNOWN = "unknown"


class BarrierCensusVerdict(StrEnum):
    """The five census verdicts. ``not-cast`` exists only in the document."""

    ACCEPT = "accept"
    REJECT = "reject"
    ABSTAIN = "abstain"
    UNKNOWN = "unknown"
    NOT_CAST = "not-cast"


class RunTerminal(StrEnum):
    FAILED = "failed"
    CANCELLED = "cancelled"
    AWAITING_HUMAN = "awaiting_human"
    UNKNOWN = "unknown"
    SUCCEEDED = "succeeded"


#: Run terminal precedence, highest first. A run with any failed node is failed
#: even when another barrier resolved to `unknown` or `awaiting_human`.
RUN_TERMINAL_PRECEDENCE: tuple[RunTerminal, ...] = (
    RunTerminal.FAILED,
    RunTerminal.CANCELLED,
    RunTerminal.AWAITING_HUMAN,
    RunTerminal.UNKNOWN,
    RunTerminal.SUCCEEDED,
)


class BarrierFailureCode(StrEnum):
    INVALID_BARRIER_VOTE = "INVALID_BARRIER_VOTE"
    BARRIER_NOT_SATISFIED = "BARRIER_NOT_SATISFIED"
    BARRIER_LATE_ARRIVAL = "BARRIER_LATE_ARRIVAL"
    UPSTREAM_FAILED = "UPSTREAM_FAILED"
    UPSTREAM_UNKNOWN = "UPSTREAM_UNKNOWN"
    NODE_CANCELLED = "NODE_CANCELLED"


class DecisionRejectionCode(StrEnum):
    DECISION_POLICY_DRIFT = "DECISION_POLICY_DRIFT"
    DECISION_IDENTITY_MISMATCH = "DECISION_IDENTITY_MISMATCH"
    DUPLICATE_DECISION = "DUPLICATE_DECISION"


class UpstreamOutcome(StrEnum):
    """How one incoming edge of a barrier settled, before vote interpretation."""

    SUCCEEDED = "succeeded"
    FAILED = "failed"
    #: settled without an attempt: ROUTE_NOT_SELECTED, UPSTREAM_FAILED, UPSTREAM_UNKNOWN
    MISSING = "missing"
    #: cancelled before settling
    CANCELLED = "cancelled"


class BarrierExecutionState(StrEnum):
    PENDING = "pending"
    ARMED = "armed"
    DECIDED = "decided"
    CANCELLED = "cancelled"


_VERDICT_TO_DISPOSITION: Mapping[BarrierVerdict, BarrierDisposition] = {
    BarrierVerdict.ACCEPT: BarrierDisposition.SUCCEEDED,
    BarrierVerdict.REJECT: BarrierDisposition.FAILED,
    BarrierVerdict.ABSTAIN: BarrierDisposition.ABSTAINED,
    BarrierVerdict.UNKNOWN: BarrierDisposition.UNKNOWN,
}
_DISPOSITION_TO_COUNT_FIELD: Mapping[BarrierDisposition, str] = {
    BarrierDisposition.SUCCEEDED: "succeeded",
    BarrierDisposition.FAILED: "failed",
    BarrierDisposition.MISSING: "missing",
    BarrierDisposition.TIMED_OUT: "timedOut",
    BarrierDisposition.ABSTAINED: "abstained",
    BarrierDisposition.UNKNOWN: "unknown",
}
_DISPOSITION_TO_ID_LIST: Mapping[BarrierDisposition, str] = {
    BarrierDisposition.SUCCEEDED: "acceptedIds",
    BarrierDisposition.FAILED: "failedIds",
    BarrierDisposition.MISSING: "missingIds",
    BarrierDisposition.TIMED_OUT: "timedOutIds",
    BarrierDisposition.ABSTAINED: "abstainedIds",
    BarrierDisposition.UNKNOWN: "unknownIds",
}
_RESOLUTION_BY_ON_UNSATISFIED: Mapping[str, BarrierResolution] = {
    "fail": BarrierResolution.FAILED,
    "unknown": BarrierResolution.UNKNOWN,
    "human": BarrierResolution.AWAITING_HUMAN,
}
_DISPOSITION_ORDER: tuple[BarrierDisposition, ...] = (
    BarrierDisposition.SUCCEEDED,
    BarrierDisposition.FAILED,
    BarrierDisposition.MISSING,
    BarrierDisposition.TIMED_OUT,
    BarrierDisposition.ABSTAINED,
    BarrierDisposition.UNKNOWN,
)


# --------------------------------------------------------------------------- #
# Injected monotonic clock                                                     #
# --------------------------------------------------------------------------- #


class MonotonicClock(Protocol):
    """A monotonic millisecond source. Barriers never read a wall clock."""

    def now_ms(self) -> int: ...


class ManualClock:
    """A scripted monotonic clock: the only clock conformance may use.

    The driver advances it explicitly, so a deadline result never depends on
    real elapsed time, timer scheduling, thread scheduling, or CPU load.
    """

    __slots__ = ("_now_ms",)

    def __init__(self, start_ms: int = 0) -> None:
        if type(start_ms) is not int or start_ms < 0 or start_ms > MAX_SAFE_INTEGER:
            raise ValueError("start_ms must be a non-negative safe integer")
        self._now_ms = start_ms

    def now_ms(self) -> int:
        return self._now_ms

    def advance(self, delta_ms: int) -> int:
        """Advance by a non-negative delta and return the new value."""

        if type(delta_ms) is not int or delta_ms < 0:
            raise ValueError("delta_ms must be a non-negative integer")
        return self.set_now(self._now_ms + delta_ms)

    def set_now(self, value: int) -> int:
        if type(value) is not int or value < 0 or value > MAX_SAFE_INTEGER:
            raise ValueError("clock value must be a non-negative safe integer")
        if value < self._now_ms:
            raise ValueError("a monotonic clock cannot move backwards")
        self._now_ms = value
        return self._now_ms


# --------------------------------------------------------------------------- #
# Barrier vote                                                                 #
# --------------------------------------------------------------------------- #

_VOTE_KEYS = frozenset({"apiVersion", "kind", "verdict", "confidenceBasisPoints", "evidence"})
_VOTE_API_VERSION = "graphengineering.reacher-z.github.io/barrier/v1alpha1"


@dataclass(frozen=True, slots=True)
class BarrierBallot:
    """A conforming ``BarrierVote`` carrier produced by one upstream node."""

    verdict: BarrierVerdict
    confidence_basis_points: int | None = None
    evidence: JsonValue = None
    has_evidence: bool = False


@dataclass(frozen=True, slots=True)
class MalformedBarrierVote:
    """Not a ballot. It is never coerced to ``abstain`` or ``unknown``."""

    reason: str


def _record(value: object) -> TypeGuard[dict[str, JsonValue]]:
    return type(value) is dict


def _bounded_integer(value: object, minimum: int, maximum: int) -> int | None:
    """Return the portable integer value, treating JSON ``1.0`` as integer one."""

    if type(value) is int:
        candidate = value
    elif type(value) is float and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER:
        candidate = int(value)
    else:
        return None
    return candidate if minimum <= candidate <= maximum else None


def parse_barrier_vote(value: object) -> BarrierBallot | MalformedBarrierVote:
    """Parse the exact ``BarrierVote`` carrier. Property order is immaterial."""

    if not _record(value):
        return MalformedBarrierVote("a barrier vote must be a portable JSON object")
    unknown = sorted(key for key in value if key not in _VOTE_KEYS)
    if unknown:
        return MalformedBarrierVote(f"unknown barrier vote member {unknown[0]!r}")
    if value.get("apiVersion") != _VOTE_API_VERSION:
        return MalformedBarrierVote("barrier vote apiVersion is not the claimed contract")
    if value.get("kind") != "BarrierVote":
        return MalformedBarrierVote("barrier vote kind is not 'BarrierVote'")
    raw_verdict = value.get("verdict")
    if type(raw_verdict) is not str or raw_verdict not in tuple(BarrierVerdict):
        return MalformedBarrierVote("barrier vote verdict is not one of the four verdicts")
    verdict = BarrierVerdict(raw_verdict)

    confidence: int | None = None
    if "confidenceBasisPoints" in value:
        confidence = _bounded_integer(value["confidenceBasisPoints"], 1, MAX_BASIS_POINTS)
        if confidence is None:
            return MalformedBarrierVote("barrier vote confidenceBasisPoints is out of range")

    evidence: JsonValue = None
    has_evidence = "evidence" in value
    if has_evidence:
        try:
            evidence = portable_json_snapshot(value["evidence"])
        except PortableJsonError:
            return MalformedBarrierVote("barrier vote evidence is not portable JSON")
    return BarrierBallot(verdict, confidence, evidence, has_evidence)


# --------------------------------------------------------------------------- #
# Arrivals, census records, and evaluation                                     #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class BarrierArrival:
    """One disposition entry, keyed by source node ID.

    ``ballot`` is the conforming vote this entry produced, or ``None`` when it
    produced no ballot at all. The census is keyed on that presence, never on
    the disposition name.
    """

    source_node_id: str
    disposition: BarrierDisposition
    ballot: BarrierBallot | None = None


@dataclass(frozen=True, slots=True)
class BarrierVoteRecord:
    """One census record. ``not-cast`` carries no confidence and no evidence."""

    source_node_id: str
    verdict: BarrierCensusVerdict
    confidence_basis_points: int | None = None
    evidence_hash: str | None = None

    def to_dict(self) -> dict[str, JsonValue]:
        record: dict[str, JsonValue] = {
            "sourceNodeId": self.source_node_id,
            "verdict": self.verdict.value,
        }
        if self.verdict is BarrierCensusVerdict.NOT_CAST:
            # A not-cast record's key set MUST be exactly sourceNodeId and
            # verdict: there is no ballot from which either optional member
            # could be derived, and materializing one would invent the ballot
            # this member exists to deny.
            return record
        if self.confidence_basis_points is not None:
            record["confidenceBasisPoints"] = self.confidence_basis_points
        if self.evidence_hash is not None:
            record["evidenceHash"] = self.evidence_hash
        return record


@dataclass(frozen=True, slots=True)
class BarrierEvaluation:
    """The arithmetic half of a decision: everything except identity and time."""

    barrier_node_id: str
    deadline_elapsed: bool
    satisfied: bool
    reason_code: BarrierReasonCode
    resolution: BarrierResolution
    total: int
    succeeded: int
    failed: int
    missing: int
    timed_out: int
    abstained: int
    unknown: int
    accepted_ids: tuple[str, ...]
    failed_ids: tuple[str, ...]
    missing_ids: tuple[str, ...]
    timed_out_ids: tuple[str, ...]
    abstained_ids: tuple[str, ...]
    unknown_ids: tuple[str, ...]
    votes: tuple[BarrierVoteRecord, ...] | None = None

    def to_dict(self) -> dict[str, JsonValue]:
        document: dict[str, JsonValue] = {
            "barrierNodeId": self.barrier_node_id,
            "deadlineElapsed": self.deadline_elapsed,
            "satisfied": self.satisfied,
            "reasonCode": self.reason_code.value,
            "resolution": self.resolution.value,
            "total": self.total,
            "succeeded": self.succeeded,
            "failed": self.failed,
            "missing": self.missing,
            "timedOut": self.timed_out,
            "abstained": self.abstained,
            "unknown": self.unknown,
            "acceptedIds": list(self.accepted_ids),
            "failedIds": list(self.failed_ids),
            "missingIds": list(self.missing_ids),
            "timedOutIds": list(self.timed_out_ids),
            "abstainedIds": list(self.abstained_ids),
            "unknownIds": list(self.unknown_ids),
        }
        if self.votes is not None:
            document["votes"] = [record.to_dict() for record in self.votes]
        return document


def evidence_hash(value: JsonValue) -> str:
    """``sha256(utf8(canonicalSerialize(evidence)))``, lowercase hex."""

    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def _census_record(arrival: BarrierArrival) -> BarrierVoteRecord:
    ballot = arrival.ballot
    if ballot is None:
        # No ballot at all: `not-cast`, whatever the disposition. That includes
        # `missing`, `timed_out`, and a `failed` arising from upstream
        # execution failure rather than from a ballot that said `reject`.
        return BarrierVoteRecord(arrival.source_node_id, BarrierCensusVerdict.NOT_CAST)
    return BarrierVoteRecord(
        arrival.source_node_id,
        BarrierCensusVerdict(ballot.verdict.value),
        ballot.confidence_basis_points,
        evidence_hash(ballot.evidence) if ballot.has_evidence else None,
    )


def _satisfaction(
    policy: IntegratedBarrierPolicySnapshot,
    total: int,
    succeeded: int,
    abstained: int,
) -> tuple[bool, BarrierReasonCode]:
    """Exact-integer satisfaction arithmetic. No floating-point ratio exists."""

    if total == 0:
        return False, BarrierReasonCode.NO_ITEMS
    if policy.kind == "all":
        if succeeded == total:
            return True, BarrierReasonCode.ALL_SUCCEEDED
        return False, BarrierReasonCode.ALL_NOT_SUCCEEDED
    if policy.kind == "minimum":
        minimum = policy.minimum
        if minimum is None:
            raise AssertionError("a valid minimum policy always carries its minimum")
        if minimum > total:
            return False, BarrierReasonCode.MINIMUM_EXCEEDS_TOTAL
        if succeeded >= minimum:
            return True, BarrierReasonCode.MINIMUM_MET
        return False, BarrierReasonCode.MINIMUM_NOT_MET
    if policy.kind == "percentage":
        basis_points = policy.basis_points
        if basis_points is None:
            raise AssertionError("a valid percentage policy always carries its basisPoints")
        # Both products stay exact safe integers for every admissible input.
        if succeeded * MAX_BASIS_POINTS >= total * basis_points:
            return True, BarrierReasonCode.PERCENTAGE_MET
        return False, BarrierReasonCode.PERCENTAGE_NOT_MET
    quorum = policy.quorum
    if quorum is None:
        raise AssertionError("a valid quorum policy always carries its quorum")
    # `unknown` always counts as a participant and never as an accept.
    participants = total - (0 if quorum.count_abstain_as_participant else abstained)
    if quorum.accepts > participants:
        return False, BarrierReasonCode.QUORUM_EXCEEDS_PARTICIPANTS
    if succeeded >= quorum.accepts:
        return True, BarrierReasonCode.QUORUM_MET
    return False, BarrierReasonCode.QUORUM_NOT_MET


def evaluate_integrated_barrier(
    policy: IntegratedBarrierPolicySnapshot,
    barrier_node_id: str,
    arrivals: Sequence[BarrierArrival],
) -> BarrierEvaluation:
    """Decide one barrier from its complete disposition list.

    ``arrivals`` are in the barrier's incoming-edge declaration order, and that
    order is normative: it appears verbatim in the ID lists and in the census.
    """

    seen: set[str] = set()
    buckets: dict[BarrierDisposition, list[str]] = {
        disposition: [] for disposition in _DISPOSITION_ORDER
    }
    for arrival in arrivals:
        if arrival.source_node_id in seen:
            raise ValueError(
                f"barrier {barrier_node_id!r} received two entries for "
                f"source {arrival.source_node_id!r}"
            )
        seen.add(arrival.source_node_id)
        if policy.kind != "quorum" and arrival.disposition in {
            BarrierDisposition.ABSTAINED,
            BarrierDisposition.UNKNOWN,
        }:
            raise ValueError(
                f"disposition {arrival.disposition.value!r} is unreachable "
                f"for a {policy.kind!r} barrier"
            )
        buckets[arrival.disposition].append(arrival.source_node_id)

    total = len(arrivals)
    counts = {disposition: len(ids) for disposition, ids in buckets.items()}
    satisfied, reason_code = _satisfaction(
        policy,
        total,
        counts[BarrierDisposition.SUCCEEDED],
        counts[BarrierDisposition.ABSTAINED],
    )
    resolution = (
        BarrierResolution.SATISFIED
        if satisfied
        else _RESOLUTION_BY_ON_UNSATISFIED[policy.on_unsatisfied]
    )
    return BarrierEvaluation(
        barrier_node_id=barrier_node_id,
        # Deadline elapse is not a reason code: it is exactly the presence of a
        # timed_out entry.
        deadline_elapsed=counts[BarrierDisposition.TIMED_OUT] > 0,
        satisfied=satisfied,
        reason_code=reason_code,
        resolution=resolution,
        total=total,
        succeeded=counts[BarrierDisposition.SUCCEEDED],
        failed=counts[BarrierDisposition.FAILED],
        missing=counts[BarrierDisposition.MISSING],
        timed_out=counts[BarrierDisposition.TIMED_OUT],
        abstained=counts[BarrierDisposition.ABSTAINED],
        unknown=counts[BarrierDisposition.UNKNOWN],
        accepted_ids=tuple(buckets[BarrierDisposition.SUCCEEDED]),
        failed_ids=tuple(buckets[BarrierDisposition.FAILED]),
        missing_ids=tuple(buckets[BarrierDisposition.MISSING]),
        timed_out_ids=tuple(buckets[BarrierDisposition.TIMED_OUT]),
        abstained_ids=tuple(buckets[BarrierDisposition.ABSTAINED]),
        unknown_ids=tuple(buckets[BarrierDisposition.UNKNOWN]),
        votes=(
            tuple(_census_record(arrival) for arrival in arrivals)
            if policy.kind == "quorum"
            else None
        ),
    )


# --------------------------------------------------------------------------- #
# Domain-separated identity                                                    #
# --------------------------------------------------------------------------- #


def _frame(value: str) -> bytes:
    """``frame(s) = uint32be(byteLength(utf8(s))) || utf8(s)``."""

    encoded = value.encode("utf-8")
    return len(encoded).to_bytes(4, "big") + encoded


def _policy_hash(policy_document: JsonValue, kind_tag: str) -> str:
    digest = hashlib.sha256()
    digest.update(_frame(POLICY_HASH_DOMAIN))
    digest.update(_frame(kind_tag))
    digest.update(_frame(canonical_json(policy_document)))
    return digest.hexdigest()


def barrier_policy_hash(policy_document: JsonValue) -> str:
    return _policy_hash(policy_document, BARRIER_POLICY_KIND_TAG)


def route_policy_hash(policy_document: JsonValue) -> str:
    return _policy_hash(policy_document, ROUTER_POLICY_KIND_TAG)


def _decision_id(
    domain: str,
    run_id: str,
    graph_revision: int,
    node_id: str,
    document: Mapping[str, JsonValue],
) -> str:
    if type(graph_revision) is not int or graph_revision < 0:
        raise ValueError("graph_revision must be a non-negative integer")
    without_identity = {key: value for key, value in document.items() if key != "decisionId"}
    digest = hashlib.sha256()
    digest.update(_frame(domain))
    digest.update(_frame(run_id))
    # `decimal(graphRevision)` so neither language depends on platform integer
    # width or locale-sensitive formatting.
    digest.update(_frame(str(graph_revision)))
    digest.update(_frame(node_id))
    digest.update(_frame(canonical_json(without_identity)))
    return digest.hexdigest()


def barrier_decision_id(
    run_id: str,
    graph_revision: int,
    node_id: str,
    document: Mapping[str, JsonValue],
) -> str:
    return _decision_id(BARRIER_DECISION_DOMAIN, run_id, graph_revision, node_id, document)


def route_decision_id(
    run_id: str,
    graph_revision: int,
    node_id: str,
    document: Mapping[str, JsonValue],
) -> str:
    return _decision_id(ROUTE_DECISION_DOMAIN, run_id, graph_revision, node_id, document)


def build_barrier_decision(
    evaluation: BarrierEvaluation,
    *,
    policy_document: JsonValue,
    run_id: str,
    graph_revision: int,
    armed_at_ms: int,
    decided_at_ms: int,
) -> dict[str, JsonValue]:
    """Complete an evaluation into the frozen ``BarrierSatisfied`` document."""

    if armed_at_ms < 0 or decided_at_ms < armed_at_ms:
        raise ValueError("decidedAtMs must be at least armedAtMs and both non-negative")
    document = evaluation.to_dict()
    document["policyHash"] = barrier_policy_hash(policy_document)
    document["armedAtMs"] = armed_at_ms
    document["decidedAtMs"] = decided_at_ms
    document["decisionId"] = barrier_decision_id(
        run_id,
        graph_revision,
        evaluation.barrier_node_id,
        document,
    )
    return document


# --------------------------------------------------------------------------- #
# Decision-document identifiers                                                #
# --------------------------------------------------------------------------- #

_BARRIER_ID_LIST_MEMBERS = (
    "acceptedIds",
    "failedIds",
    "missingIds",
    "timedOutIds",
    "abstainedIds",
    "unknownIds",
)
_ROUTE_KEY_MEMBERS = ("requestedRoutes", "selectedRoutes", "unknownRoutes")


def _is_node_id(value: JsonValue) -> bool:
    return type(value) is str and NODE_ID_PATTERN.fullmatch(value) is not None


def _is_safe_route_id(value: JsonValue) -> bool:
    return (
        type(value) is str
        and SAFE_ROUTE_ID_PATTERN.fullmatch(value) is not None
        and value not in _RESERVED_ROUTE_KEYS
    )


def validate_decision_identifiers(
    document_kind: Literal["BarrierDecision", "RouteDecision"],
    document: Mapping[str, JsonValue],
) -> bool:
    """Check every identifier member of a decision document.

    A node identifier is a Graph IR node ID and can never begin with a digit;
    a route key is a ``SafeRouteId``, which may, but is never ``.`` or ``..``.
    The two patterns are deliberately different.
    """

    if document_kind == "BarrierDecision":
        if not _is_node_id(document.get("barrierNodeId")):
            return False
        for member in _BARRIER_ID_LIST_MEMBERS:
            values = document.get(member)
            if type(values) is not list:
                return False
            if any(not _is_node_id(item) for item in values):
                return False
        votes = document.get("votes")
        if votes is not None:
            if type(votes) is not list:
                return False
            for record in votes:
                if not _record(record) or not _is_node_id(record.get("sourceNodeId")):
                    return False
        return True
    if not _is_node_id(document.get("routerNodeId")):
        return False
    for member in _ROUTE_KEY_MEMBERS:
        values = document.get(member)
        if type(values) is not list:
            return False
        if any(not _is_safe_route_id(item) for item in values):
            return False
    return True


# --------------------------------------------------------------------------- #
# Execution                                                                    #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class BarrierDecisionEvent:
    """A durable decision event body. The envelope is the caller's to supply."""

    type: Literal["BarrierSatisfied", "HumanInputRequested"]
    node_id: str
    data: Mapping[str, JsonValue]


@dataclass(frozen=True, slots=True)
class DescendantTerminal:
    """The zero-attempt terminal a descendant inherits from a barrier."""

    status: RunTerminal
    failure_code: BarrierFailureCode | None
    scheduled: bool


@dataclass(frozen=True, slots=True)
class BarrierNodeSettlement:
    """How the barrier node itself settled, plus everything it emitted."""

    node_id: str
    status: RunTerminal
    attempts: Literal[0]
    resolution: BarrierResolution | None
    failure_code: BarrierFailureCode | None
    document: Mapping[str, JsonValue] | None
    events: tuple[BarrierDecisionEvent, ...]
    #: Present only for a satisfied barrier. An unsatisfied barrier NEVER
    #: succeeds and NEVER binds an output.
    output: Mapping[str, JsonValue] | None
    #: A `human` resolution schedules no descendant and stops the run.
    stops_run: bool = False


@dataclass(frozen=True, slots=True)
class InvalidBarrierVote:
    """A malformed vote: the non-retryable failure of the upstream node."""

    code: Literal[BarrierFailureCode.INVALID_BARRIER_VOTE] = (
        BarrierFailureCode.INVALID_BARRIER_VOTE
    )
    node_id: str = ""
    attempts: Literal[1] = 1
    retryable: Literal[False] = False
    message: str = ""


@dataclass(frozen=True, slots=True)
class LateArrivalIgnored:
    """The committed decision is immutable; the late node is still recorded."""

    barrier_node_id: str
    source_node_id: str


@dataclass(frozen=True, slots=True)
class LateArrivalRejected:
    """The non-retryable run failure ``BARRIER_LATE_ARRIVAL``."""

    barrier_node_id: str
    source_node_id: str
    message: str
    code: Literal[BarrierFailureCode.BARRIER_LATE_ARRIVAL] = (
        BarrierFailureCode.BARRIER_LATE_ARRIVAL
    )
    retryable: Literal[False] = False


SettlementOutcome: TypeAlias = (
    BarrierNodeSettlement | InvalidBarrierVote | LateArrivalIgnored | LateArrivalRejected | None
)


def descendant_terminal(resolution: BarrierResolution | None) -> DescendantTerminal | None:
    """Return what a descendant reachable only through this barrier inherits.

    ``None`` is the resolution of a cancelled barrier — the one settlement that
    commits no decision — and propagates the existing cancellation terminal.
    ``satisfied`` returns ``None``: descendants are scheduled normally.
    """

    if resolution is None:
        return DescendantTerminal(
            RunTerminal.CANCELLED,
            BarrierFailureCode.NODE_CANCELLED,
            True,
        )
    if resolution is BarrierResolution.SATISFIED:
        return None
    if resolution is BarrierResolution.FAILED:
        return DescendantTerminal(RunTerminal.FAILED, BarrierFailureCode.UPSTREAM_FAILED, True)
    if resolution is BarrierResolution.UNKNOWN:
        return DescendantTerminal(RunTerminal.UNKNOWN, BarrierFailureCode.UPSTREAM_UNKNOWN, True)
    # `awaiting_human` schedules no descendant at all and stops the run. Whether
    # and how such a run resumes is D9-APPROVAL-077 authority, not this module's.
    return DescendantTerminal(RunTerminal.AWAITING_HUMAN, None, False)


class IntegratedBarrier:
    """One armed, deadline-aware barrier driven by explicit quiescence points.

    The driver calls :meth:`observe_upstream_settlement`, :meth:`observe_tick`,
    or :meth:`observe_cancellation`; each is a quiescence point. Nothing here
    sleeps, awaits, or schedules a timer, so the same scripted tick list yields
    the same decision on any machine at any load.
    """

    __slots__ = (
        "_armed_at_ms",
        "_arrivals",
        "_barrier_node_id",
        "_clock",
        "_excluded",
        "_graph_revision",
        "_late_sources",
        "_policy",
        "_policy_document",
        "_run_id",
        "_settlement",
        "_source_node_ids",
        "_state",
    )

    def __init__(
        self,
        *,
        policy_document: JsonValue,
        barrier_node_id: str,
        source_node_ids: Sequence[str],
        clock: MonotonicClock,
        run_id: str,
        graph_revision: int,
    ) -> None:
        validation = validate_integrated_barrier_policy(policy_document)
        if not isinstance(validation, ValidBarrierPolicy):
            raise ValueError(
                f"barrier {barrier_node_id!r} was given a config that is not an exact "
                "IntegratedBarrierPolicy"
            )
        if len(set(source_node_ids)) != len(source_node_ids):
            raise ValueError(f"barrier {barrier_node_id!r} has a duplicated incoming source")
        self._policy_document = policy_document
        self._policy: IntegratedBarrierPolicySnapshot = validation.policy
        self._barrier_node_id = barrier_node_id
        self._source_node_ids = tuple(source_node_ids)
        self._clock = clock
        self._run_id = run_id
        self._graph_revision = graph_revision
        self._arrivals: dict[str, BarrierArrival] = {}
        self._excluded: set[str] = set()
        self._late_sources: list[str] = []
        self._armed_at_ms: int | None = None
        self._state = BarrierExecutionState.PENDING
        self._settlement: BarrierNodeSettlement | None = None

    # -- observation ------------------------------------------------------- #

    @property
    def state(self) -> BarrierExecutionState:
        return self._state

    @property
    def armed_at_ms(self) -> int | None:
        return self._armed_at_ms

    @property
    def settlement(self) -> BarrierNodeSettlement | None:
        return self._settlement

    @property
    def policy(self) -> IntegratedBarrierPolicySnapshot:
        return self._policy

    @property
    def late_sources(self) -> tuple[str, ...]:
        return tuple(self._late_sources)

    def arrivals(self) -> tuple[BarrierArrival, ...]:
        """Disposition entries in incoming-edge declaration order."""

        return tuple(
            self._arrivals[source]
            for source in self._source_node_ids
            if source in self._arrivals
        )

    def observe_upstream_settlement(
        self,
        source_node_id: str,
        outcome: UpstreamOutcome,
        *,
        output: JsonValue = None,
    ) -> SettlementOutcome:
        """Bind one settled upstream result and re-evaluate at this quiescence.

        A malformed vote returns :class:`InvalidBarrierVote` rather than a
        settlement even when it is the last unsettled source, because the
        upstream node failure is the outcome the caller must act on; the
        barrier's own settlement is then available from :attr:`settlement`.
        """

        if source_node_id not in self._source_node_ids:
            raise ValueError(
                f"{source_node_id!r} is not an incoming source of barrier "
                f"{self._barrier_node_id!r}"
            )
        if self._state is BarrierExecutionState.CANCELLED:
            # A cancelled barrier committed no decision, so a later settlement
            # is not a *late arrival*: it never becomes BARRIER_LATE_ARRIVAL.
            return None
        if self._state is BarrierExecutionState.DECIDED:
            return self._late_arrival(source_node_id)
        if source_node_id in self._arrivals or source_node_id in self._excluded:
            raise ValueError(f"source {source_node_id!r} settled more than once")

        # Arming is the first bound settled upstream result, whatever it says.
        self._arm()

        if self._policy.kind == "quorum" and outcome is UpstreamOutcome.SUCCEEDED:
            ballot = parse_barrier_vote(output)
            if isinstance(ballot, MalformedBarrierVote):
                # A malformed vote is never coerced and never counts as a
                # participant, so it contributes no disposition entry at all.
                self._excluded.add(source_node_id)
                failure = InvalidBarrierVote(
                    node_id=source_node_id,
                    message=(
                        f"node {source_node_id!r} produced a malformed barrier vote: "
                        f"{ballot.reason}"
                    ),
                )
                self._quiesce()
                return failure
            disposition = _VERDICT_TO_DISPOSITION[ballot.verdict]
            self._arrivals[source_node_id] = BarrierArrival(source_node_id, disposition, ballot)
        else:
            # Non-quorum barriers do not inspect upstream values and MUST NOT
            # require a vote. A quorum upstream that failed, was pruned, or was
            # cancelled cast no ballot at all.
            self._arrivals[source_node_id] = BarrierArrival(
                source_node_id,
                _DISPOSITION_FOR_OUTCOME[outcome],
                None,
            )
        return self._quiesce()

    def observe_tick(self) -> BarrierNodeSettlement | None:
        """A quiescence point created by the driver delivering a clock tick."""

        if self._state in {BarrierExecutionState.DECIDED, BarrierExecutionState.CANCELLED}:
            return None
        return self._quiesce()

    def observe_cancellation(self) -> BarrierNodeSettlement | None:
        """Cancel an undecided barrier with zero attempts and no decision event."""

        if self._state in {BarrierExecutionState.DECIDED, BarrierExecutionState.CANCELLED}:
            return None
        self._state = BarrierExecutionState.CANCELLED
        self._settlement = BarrierNodeSettlement(
            node_id=self._barrier_node_id,
            status=RunTerminal.CANCELLED,
            attempts=0,
            resolution=None,
            failure_code=BarrierFailureCode.NODE_CANCELLED,
            document=None,
            events=(),
            output=None,
        )
        return self._settlement

    # -- internals --------------------------------------------------------- #

    def _arm(self) -> None:
        if self._armed_at_ms is None:
            self._armed_at_ms = self._clock.now_ms()
            self._state = BarrierExecutionState.ARMED

    def _late_arrival(self, source_node_id: str) -> LateArrivalIgnored | LateArrivalRejected:
        self._late_sources.append(source_node_id)
        if self._policy.late_arrival == "ignore":
            # The committed decision is immutable: no re-evaluation, no second
            # decision event, and no change to any count, ID list, or identity.
            return LateArrivalIgnored(self._barrier_node_id, source_node_id)
        return LateArrivalRejected(
            barrier_node_id=self._barrier_node_id,
            source_node_id=source_node_id,
            message=(
                f"barrier {self._barrier_node_id!r} rejected a late arrival from "
                f"{source_node_id!r} after its decision was committed"
            ),
        )

    def _quiesce(self) -> BarrierNodeSettlement | None:
        unsettled = tuple(
            source
            for source in self._source_node_ids
            if source not in self._arrivals and source not in self._excluded
        )
        if not unsettled:
            return self._decide(())
        armed_at = self._armed_at_ms
        deadline = self._policy.deadline
        if armed_at is None or deadline is None:
            # A barrier without a deadline is never deadline-settled: it decides
            # when every incoming edge has a disposition.
            return None
        if self._clock.now_ms() - armed_at < deadline.after_ms:
            return None
        return self._decide(unsettled)

    def _decide(self, timed_out: Sequence[str]) -> BarrierNodeSettlement:
        for source in timed_out:
            self._arrivals[source] = BarrierArrival(
                source,
                BarrierDisposition.TIMED_OUT,
                None,
            )
        armed_at = self._armed_at_ms
        if armed_at is None:
            # Nothing ever bound a result, so the barrier decides at the clock
            # value it observes now and armedAtMs == decidedAtMs.
            armed_at = self._clock.now_ms()
            self._armed_at_ms = armed_at
        decided_at = self._clock.now_ms()
        evaluation = evaluate_integrated_barrier(
            self._policy,
            self._barrier_node_id,
            self.arrivals(),
        )
        document = build_barrier_decision(
            evaluation,
            policy_document=self._policy_document,
            run_id=self._run_id,
            graph_revision=self._graph_revision,
            armed_at_ms=armed_at,
            decided_at_ms=decided_at,
        )
        events: list[BarrierDecisionEvent] = [
            # `BarrierSatisfied` is the retained event type name; it is emitted
            # for every committed decision and `satisfied` carries the truth.
            BarrierDecisionEvent("BarrierSatisfied", self._barrier_node_id, document)
        ]
        resolution = evaluation.resolution
        if resolution is BarrierResolution.AWAITING_HUMAN:
            events.append(
                BarrierDecisionEvent("HumanInputRequested", self._barrier_node_id, document)
            )
        self._state = BarrierExecutionState.DECIDED
        self._settlement = BarrierNodeSettlement(
            node_id=self._barrier_node_id,
            status=_TERMINAL_BY_RESOLUTION[resolution],
            attempts=0,
            resolution=resolution,
            failure_code=(
                BarrierFailureCode.BARRIER_NOT_SATISFIED
                if resolution is BarrierResolution.FAILED
                else None
            ),
            document=document,
            events=tuple(events),
            output=document if resolution is BarrierResolution.SATISFIED else None,
            stops_run=resolution is BarrierResolution.AWAITING_HUMAN,
        )
        return self._settlement


_DISPOSITION_FOR_OUTCOME: Mapping[UpstreamOutcome, BarrierDisposition] = {
    UpstreamOutcome.SUCCEEDED: BarrierDisposition.SUCCEEDED,
    UpstreamOutcome.FAILED: BarrierDisposition.FAILED,
    UpstreamOutcome.MISSING: BarrierDisposition.MISSING,
    UpstreamOutcome.CANCELLED: BarrierDisposition.MISSING,
}
_TERMINAL_BY_RESOLUTION: Mapping[BarrierResolution, RunTerminal] = {
    BarrierResolution.SATISFIED: RunTerminal.SUCCEEDED,
    BarrierResolution.FAILED: RunTerminal.FAILED,
    BarrierResolution.UNKNOWN: RunTerminal.UNKNOWN,
    BarrierResolution.AWAITING_HUMAN: RunTerminal.AWAITING_HUMAN,
}


# --------------------------------------------------------------------------- #
# Run terminal precedence                                                      #
# --------------------------------------------------------------------------- #


def is_graph_failure_code(code: str) -> bool:
    """``UPSTREAM_UNKNOWN`` is excluded exactly as ``ROUTE_NOT_SELECTED`` is."""

    return code not in GRAPH_FAILURE_EXCLUDED_CODES


def resolve_run_terminal(terminals: Iterable[RunTerminal]) -> RunTerminal:
    """Fold node terminals with the extended precedence, highest first."""

    observed = set(terminals)
    for candidate in RUN_TERMINAL_PRECEDENCE:
        if candidate in observed:
            return candidate
    return RunTerminal.SUCCEEDED


# --------------------------------------------------------------------------- #
# Zero-rejudge replay                                                          #
# --------------------------------------------------------------------------- #


@dataclass(frozen=True, slots=True)
class CommittedDecision:
    node_id: str
    event_type: Literal["BarrierSatisfied", "RouteSelected"]
    document: Mapping[str, JsonValue]


@dataclass(frozen=True, slots=True)
class DecisionAdoption:
    """Every folded decision was adopted verbatim. Nothing was re-judged."""

    adopted: tuple[CommittedDecision, ...]
    appended_decision_events: Literal[0] = 0

    @property
    def adopted_node_ids(self) -> tuple[str, ...]:
        return tuple(decision.node_id for decision in self.adopted)


@dataclass(frozen=True, slots=True)
class DecisionRejection:
    """A non-retryable run failure. Nothing is adopted and nothing is appended."""

    code: DecisionRejectionCode
    node_id: str
    message: str
    recorded_policy_hash: str | None = None
    current_policy_hash: str | None = None
    recorded_decision_id: str | None = None
    recomputed_decision_id: str | None = None
    appended_decision_events: Literal[0] = 0

    @property
    def adopted_node_ids(self) -> tuple[str, ...]:
        return ()


_DECISION_EVENT_TYPES = frozenset({"BarrierSatisfied", "RouteSelected"})


def fold_committed_decisions(
    history: Sequence[Mapping[str, JsonValue]],
    *,
    run_id: str,
    graph_revision: int,
    current_policies: Mapping[str, JsonValue],
) -> DecisionAdoption | DecisionRejection:
    """Fold a durable history into committed decisions before scheduling.

    A node with a committed decision MUST NOT be re-evaluated: its executor is
    never called, satisfaction is never recomputed, upstream values are never
    re-read, and no second decision event is appended. Every adopted decision is
    first checked for policy drift and then for a forged or transplanted
    identity; two committed events for one node is ``DUPLICATE_DECISION``.
    """

    folded: list[CommittedDecision] = []
    seen: set[str] = set()
    for event in history:
        event_type = event.get("type")
        if type(event_type) is not str or event_type not in _DECISION_EVENT_TYPES:
            continue
        node_id = event.get("nodeId")
        if type(node_id) is not str:
            raise ValueError("a decision event must name its node")
        data = event.get("data")
        if not _record(data):
            raise ValueError(f"decision event for {node_id!r} has no document")
        if node_id in seen:
            return DecisionRejection(
                DecisionRejectionCode.DUPLICATE_DECISION,
                node_id,
                f"node {node_id!r} has two committed decision events in run {run_id!r}",
            )
        seen.add(node_id)
        kind: Literal["BarrierSatisfied", "RouteSelected"] = (
            "BarrierSatisfied" if event_type == "BarrierSatisfied" else "RouteSelected"
        )
        folded.append(CommittedDecision(node_id, kind, data))

    for decision in folded:
        policy_document = current_policies.get(decision.node_id)
        if policy_document is None and decision.node_id not in current_policies:
            raise ValueError(
                f"no currently compiled policy for node {decision.node_id!r}"
            )
        is_barrier = decision.event_type == "BarrierSatisfied"
        current_hash = (
            barrier_policy_hash(policy_document)
            if is_barrier
            else route_policy_hash(policy_document)
        )
        recorded_hash = decision.document.get("policyHash")
        if recorded_hash != current_hash:
            return DecisionRejection(
                DecisionRejectionCode.DECISION_POLICY_DRIFT,
                decision.node_id,
                (
                    f"node {decision.node_id!r} recorded policy hash "
                    f"{recorded_hash!r} but the currently compiled policy hashes to "
                    f"{current_hash!r}"
                ),
                recorded_policy_hash=recorded_hash if type(recorded_hash) is str else None,
                current_policy_hash=current_hash,
            )
        recomputed = (
            barrier_decision_id(run_id, graph_revision, decision.node_id, decision.document)
            if is_barrier
            else route_decision_id(run_id, graph_revision, decision.node_id, decision.document)
        )
        recorded_id = decision.document.get("decisionId")
        if recorded_id != recomputed:
            return DecisionRejection(
                DecisionRejectionCode.DECISION_IDENTITY_MISMATCH,
                decision.node_id,
                (
                    f"node {decision.node_id!r} recorded decision id {recorded_id!r} but "
                    f"run {run_id!r} recomputes {recomputed!r}"
                ),
                recorded_decision_id=recorded_id if type(recorded_id) is str else None,
                recomputed_decision_id=recomputed,
            )
    return DecisionAdoption(tuple(folded))
