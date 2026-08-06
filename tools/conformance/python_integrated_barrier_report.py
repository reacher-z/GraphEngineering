"""Emit Python results for the shared integrated-barrier conformance corpus.

This report is one half of a cross-language join. It reads exactly one input —
``spec/conformance/integrated-barrier.case.json`` — and computes every value it
prints with the native Python package (``graph_engineering``). It never imports,
spawns, or reads anything produced by the TypeScript implementation, and it
never copies an ``expect`` block from the corpus into its own output: the
``expect`` blocks are consumed only to enumerate case names, never to supply a
result. The consuming join in ``tools/conformance/run.mjs`` computes the
TypeScript half natively and compares the two member for member.

The corpus declares ``implementationClaim: false``. Tranche 1 of this report
(``policyCases``, ``ownershipCases``, ``compilerCases``) exercises only the
policy validator, the ownership discriminator, and the real public compiler
entry point. Tranche 2 (``evaluationCases``, ``identityCases``, ``replayCases``,
``identifierCases``) drives the real public barrier runtime surface —
``evaluate_integrated_barrier``, ``barrier_policy_hash`` /
``route_policy_hash``, ``barrier_decision_id`` / ``route_decision_id``,
``fold_committed_decisions`` and ``validate_decision_identifiers`` — and every
hash it prints is recomputed here from the framing rule, never read out of the
corpus ``expect`` block and never read across from TypeScript. Every replay
case additionally drives the real ordinary scheduler ``run_graph`` with
executors that record every call, so the zero-executor-call claim is an
authentic scheduler observation on this side of the join too.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from graph_engineering import DecisionContext, NodeContext, compile_graph, run_graph
from graph_engineering.canonical import canonical_json
from graph_engineering.compiler import Diagnostic, try_compile_graph
from graph_engineering.integrated_barrier import (
    BARRIER_POLICY_API_VERSION,
    BarrierPolicyValidation,
    IntegratedBarrierPolicySnapshot,
    InvalidBarrierPolicy,
    UnclaimedBarrierConfig,
    ValidBarrierPolicy,
    claims_integrated_barrier_policy,
    validate_integrated_barrier_policy,
)
from graph_engineering.integrated_barrier_runtime import (
    BARRIER_DECISION_DOMAIN,
    BARRIER_POLICY_KIND_TAG,
    POLICY_HASH_DOMAIN,
    ROUTE_DECISION_DOMAIN,
    ROUTER_POLICY_KIND_TAG,
    BarrierArrival,
    BarrierDisposition,
    DecisionAdoption,
    DecisionRejection,
    MalformedBarrierVote,
    barrier_decision_id,
    barrier_policy_hash,
    evaluate_integrated_barrier,
    evidence_hash,
    fold_committed_decisions,
    parse_barrier_vote,
    route_decision_id,
    route_policy_hash,
    validate_decision_identifiers,
)

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "integrated-barrier.case.json"

# The ownership probe replaces the config of the two-input barrier at node index
# 3 of this graph, so GE1423 can never confound the ownership discriminant. The
# TypeScript join derives the same probe from the same corpus case by the same
# rule; the graph itself is corpus input, not an expectation.
OWNERSHIP_PROBE_CASE = "ge1421-unknown-policy-field-reports-the-first-invalid-descendant"
OWNERSHIP_PROBE_NODE_INDEX = 3

# Optional policy members, in the contract order frozen by
# `firstInvalidDescendantRule.policyFieldOrder`. An absent member is omitted
# from the projection and reported in `policyOptionalAbsent`; it is never
# materialized as JSON null.
OPTIONAL_POLICY_FIELDS = ("minimum", "basisPoints", "quorum", "deadline")

# The six count members and the six ID lists of a barrier decision, in the
# declaration order the contract freezes. The join compares this projection
# member for member, so a runtime that renamed, reordered, or dropped one is a
# divergence rather than a silent pass.
DECISION_COUNT_FIELDS = (
    "total",
    "succeeded",
    "failed",
    "missing",
    "timedOut",
    "abstained",
    "unknown",
)
DECISION_ID_LIST_FIELDS = (
    "acceptedIds",
    "failedIds",
    "missingIds",
    "timedOutIds",
    "abstainedIds",
    "unknownIds",
)
# `decisionId` and `policyHash` are the two identity members the evaluation
# surface does not own; an evaluation projection must never carry them.
DECISION_IDENTITY_FIELDS = ("policyHash", "decisionId")


def load_corpus() -> dict[str, Any]:
    corpus: dict[str, Any] = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    return corpus


def case_names(cases: list[dict[str, Any]], section: str) -> list[str]:
    names = [str(case["name"]) for case in cases]
    if len(set(names)) != len(names):
        raise AssertionError(f"{section}: corpus declares a duplicate case name")
    return names


def project_diagnostic(item: Diagnostic) -> dict[str, Any]:
    """Project a diagnostic exactly as ``diagnosticProjection`` requires.

    ``fieldsInOrder`` is ``code``, ``path``, ``nodeIds``, ``edgeId`` and
    ``absentFieldBehavior`` is ``omit``, so an absent member is dropped rather
    than emitted as null. Diagnostic order and node-id order are preserved.
    """

    projected: dict[str, Any] = {"code": item.code.value}
    if item.path is not None:
        projected["path"] = item.path
    if item.node_ids is not None:
        projected["nodeIds"] = list(item.node_ids)
    if item.edge_id is not None:
        projected["edgeId"] = item.edge_id
    return projected


def project_diagnostics(diagnostics: tuple[Diagnostic, ...]) -> dict[str, Any]:
    projections = [project_diagnostic(item) for item in diagnostics]
    return {
        "diagnostics": projections,
        # Emitted separately because the transport sorts object keys; the join
        # compares this list against the TypeScript projection's key order to
        # prove `fieldsInOrder` holds identically on both sides.
        "diagnosticFields": [list(projection) for projection in projections],
    }


def project_policy(policy: IntegratedBarrierPolicySnapshot) -> dict[str, Any]:
    projected: dict[str, Any] = {
        "apiVersion": policy.api_version,
        "kind": policy.kind,
    }
    if policy.minimum is not None:
        projected["minimum"] = policy.minimum
    if policy.basis_points is not None:
        projected["basisPoints"] = policy.basis_points
    if policy.quorum is not None:
        projected["quorum"] = {
            "accepts": policy.quorum.accepts,
            "countAbstainAsParticipant": policy.quorum.count_abstain_as_participant,
        }
    if policy.deadline is not None:
        projected["deadline"] = {"afterMs": policy.deadline.after_ms}
    projected["onUnsatisfied"] = policy.on_unsatisfied
    projected["lateArrival"] = policy.late_arrival
    return projected


def optional_policy_state(policy: IntegratedBarrierPolicySnapshot) -> tuple[list[str], list[str]]:
    """Split the optional members into present and absent, in contract order."""

    values = {
        "minimum": policy.minimum,
        "basisPoints": policy.basis_points,
        "quorum": policy.quorum,
        "deadline": policy.deadline,
    }
    present = [field for field in OPTIONAL_POLICY_FIELDS if values[field] is not None]
    absent = [field for field in OPTIONAL_POLICY_FIELDS if values[field] is None]
    return present, absent


def validation_report(validation: BarrierPolicyValidation) -> dict[str, Any]:
    """Project one validator result with absent members omitted, never nulled."""

    if type(validation) is ValidBarrierPolicy:
        present, absent = optional_policy_state(validation.policy)
        projected = project_policy(validation.policy)
        return {
            "claimed": validation.claimed,
            "valid": validation.valid,
            "policy": projected,
            "policyFields": list(projected),
            "policyOptionalPresent": present,
            "policyOptionalAbsent": absent,
        }
    if type(validation) is InvalidBarrierPolicy:
        return {
            "claimed": validation.claimed,
            "valid": validation.valid,
            "code": validation.code.value,
            "relativePath": validation.relative_path,
        }
    if type(validation) is UnclaimedBarrierConfig:
        return {"claimed": validation.claimed, "valid": validation.valid}
    raise AssertionError(f"unknown barrier validation member: {type(validation)!r}")


def ownership_diagnostics(validation: BarrierPolicyValidation) -> list[dict[str, str]]:
    if type(validation) is InvalidBarrierPolicy:
        return [{"code": validation.code.value, "relativePath": validation.relative_path}]
    return []


def probe_graph(base: dict[str, Any], config: Any) -> dict[str, Any]:
    document: dict[str, Any] = json.loads(json.dumps(base))
    document["nodes"][OWNERSHIP_PROBE_NODE_INDEX]["config"] = config
    return document


def compiler_report(graph: dict[str, Any]) -> dict[str, Any]:
    result = try_compile_graph(graph)
    report: dict[str, Any] = {
        "valid": result.valid,
        "graphHash": result.graph_hash,
    }
    report.update(project_diagnostics(result.diagnostics))
    return report


# --------------------------------------------------------------------------- #
# evaluationCases: satisfaction arithmetic, dispositions, resolutions           #
# --------------------------------------------------------------------------- #


def valid_policy_snapshot(document: Any, label: str) -> IntegratedBarrierPolicySnapshot:
    """Normalize a corpus policy through the real public validator."""

    validation = validate_integrated_barrier_policy(document)
    if type(validation) is not ValidBarrierPolicy:
        raise AssertionError(f"{label}: corpus policy is not a valid barrier policy")
    return validation.policy


def arrival(entry: dict[str, Any], label: str) -> BarrierArrival:
    """Build one arrival, parsing any ballot through the real public parser."""

    disposition = BarrierDisposition(str(entry["disposition"]))
    if "vote" not in entry:
        return BarrierArrival(str(entry["sourceNodeId"]), disposition)
    ballot = parse_barrier_vote(entry["vote"])
    if type(ballot) is MalformedBarrierVote:
        raise AssertionError(f"{label}: corpus ballot is malformed: {ballot.reason}")
    return BarrierArrival(str(entry["sourceNodeId"]), disposition, ballot)


def evaluation_report(case: dict[str, Any]) -> dict[str, Any]:
    """Drive ``evaluate_integrated_barrier`` and project the decision document.

    The projection is the whole document the evaluator owns: it carries neither
    `policyHash` nor `decisionId`, because the evaluation surface does not own
    identity. `counts` and `idLists` restate the twelve partition members
    separately so a divergence names the exact member rather than the document.
    """

    name = str(case["name"])
    policy = valid_policy_snapshot(case["policy"], name)
    arrivals = [arrival(entry, name) for entry in case["dispositions"]]
    document = evaluate_integrated_barrier(policy, str(case["barrierNodeId"]), arrivals).to_dict()

    for field in DECISION_IDENTITY_FIELDS:
        if field in document:
            raise AssertionError(f"{name}: the evaluation surface materialized {field!r}")

    entry: dict[str, Any] = {
        "document": document,
        # Emitted separately because the transport sorts object keys; the join
        # compares this list against the TypeScript key order.
        "documentFields": list(document),
        "barrierNodeId": document["barrierNodeId"],
        "deadlineElapsed": document["deadlineElapsed"],
        "satisfied": document["satisfied"],
        "reasonCode": document["reasonCode"],
        "resolution": document["resolution"],
        "counts": {field: document[field] for field in DECISION_COUNT_FIELDS},
        "idLists": {field: document[field] for field in DECISION_ID_LIST_FIELDS},
        "votesPresent": "votes" in document,
    }
    # The six counts partition the arrivals, so they must sum to `total`.
    entry["countSum"] = sum(document[field] for field in DECISION_COUNT_FIELDS[1:])
    if "votes" in document:
        entry["votes"] = document["votes"]
        entry["voteFields"] = [list(record) for record in document["votes"]]
    return entry


# --------------------------------------------------------------------------- #
# identityCases: policyHash and decisionId, recomputed from the framing rule    #
# --------------------------------------------------------------------------- #


def canonical_utf8_bytes(value: Any) -> int:
    return len(canonical_json(value).encode("utf-8"))


def identity_report(case: dict[str, Any]) -> dict[str, Any]:
    """Recompute both identities natively. No literal is read from ``expect``."""

    kind = str(case["documentKind"])
    document: dict[str, Any] = case["document"]
    without_identity = {key: value for key, value in document.items() if key != "decisionId"}
    run_id = str(case["runId"])
    graph_revision = int(case["graphRevision"])
    node_id = str(case["nodeId"])

    if kind == "BarrierDecision":
        policy_hash = barrier_policy_hash(case["policy"])
        decision_id = barrier_decision_id(run_id, graph_revision, node_id, document)
        # Taken from the native package constants, not from the corpus case.
        policy_kind_tag = BARRIER_POLICY_KIND_TAG
        decision_domain = BARRIER_DECISION_DOMAIN
    elif kind == "RouteDecision":
        policy_hash = route_policy_hash(case["policy"])
        decision_id = route_decision_id(run_id, graph_revision, node_id, document)
        policy_kind_tag = ROUTER_POLICY_KIND_TAG
        decision_domain = ROUTE_DECISION_DOMAIN
    else:
        raise AssertionError(f"{case['name']}: unknown decision document kind {kind!r}")

    entry: dict[str, Any] = {
        "documentKind": kind,
        "policyKindTag": policy_kind_tag,
        "decisionDomain": decision_domain,
        "policyHash": policy_hash,
        "decisionId": decision_id,
        # The recorded members are echoed so the join can prove each half
        # recomputed the document it was actually handed.
        "recordedPolicyHash": document["policyHash"],
        "recordedDecisionId": document["decisionId"],
        "canonicalPolicyUtf8Bytes": canonical_utf8_bytes(case["policy"]),
        "canonicalDocumentWithoutDecisionIdUtf8Bytes": canonical_utf8_bytes(without_identity),
        "documentFieldsWithoutDecisionId": list(without_identity),
    }
    if "evidenceInputs" in case:
        entry["evidenceHashes"] = [
            {
                "sourceNodeId": item["sourceNodeId"],
                "evidenceHash": evidence_hash(item["evidence"]),
            }
            for item in case["evidenceInputs"]
        ]
    if "canonicalEvidenceKeyOrder" in case:
        entry["canonicalEvidenceKeyOrder"] = [
            key
            for key in json.loads(canonical_json(case["evidenceInputs"][0]["evidence"]))
        ]
    return entry


# --------------------------------------------------------------------------- #
# replayCases: zero-rejudge adoption and the three rejection codes              #
# --------------------------------------------------------------------------- #


class ExecutorLedger:
    """Counts every executor call a replaying scheduler would make.

    The rule, stated identically in the Node half of the join: a rejection is a
    non-retryable run failure, so no node runs at all; on adoption, a node whose
    decision was adopted MUST NOT be re-evaluated, and only a policy-carrying
    node without an adopted decision would reach its executor.
    """

    def __init__(self) -> None:
        self.calls: list[str] = []

    def execute(self, node_id: str) -> None:
        self.calls.append(node_id)


BARRIER_REPLAY_SOURCE_NODES = ("a", "b", "c")


def barrier_replay_node(node_id: str, **overrides: Any) -> dict[str, Any]:
    return {
        "id": node_id,
        "kind": "transform",
        "inputSchema": {},
        "outputSchema": {},
        "config": {},
        **overrides,
    }


def barrier_replay_graph(case: dict[str, Any]) -> dict[str, Any]:
    """A graph carrying exactly the replay case's currently compiled policies,
    so ``run_graph`` exercises the real scheduler rather than the fold in
    isolation. Three upstreams keep every corpus threshold within the
    incoming-edge count, so GE1424 never fires and the graph always compiles.
    The same graph is derived by the same rule in the Node half of the join;
    the corpus case is its only input.
    """

    entries = list(case["currentPolicies"].items())
    barriers = [
        (node_id, config)
        for node_id, config in entries
        if config.get("apiVersion") == BARRIER_POLICY_API_VERSION
    ]
    routers = [
        (node_id, config)
        for node_id, config in entries
        if config.get("apiVersion") != BARRIER_POLICY_API_VERSION
    ]
    return {
        "apiVersion": "graphengineering.reacher-z.github.io/v1alpha1",
        "kind": "Graph",
        "metadata": {"name": "integrated-barrier-replay", "version": "1"},
        "inputSchema": {},
        "outputSchema": {},
        "entrypoints": ["root"],
        "outputs": {"result": {"node": "root"}},
        "nodes": [
            barrier_replay_node("root"),
            *(barrier_replay_node(source) for source in BARRIER_REPLAY_SOURCE_NODES),
            *(
                barrier_replay_node(node_id, kind="router", config=config)
                for node_id, config in routers
            ),
            *(
                barrier_replay_node(f"{node_id}-{route}")
                for node_id, config in routers
                for route in config["allowedRoutes"]
            ),
            *(
                barrier_replay_node(node_id, kind="barrier", config=config)
                for node_id, config in barriers
            ),
        ],
        "edges": [
            *(
                {
                    "id": f"root-{source}",
                    "from": {"node": "root"},
                    "to": {"node": source, "port": source},
                }
                for source in BARRIER_REPLAY_SOURCE_NODES
            ),
            *(
                {
                    "id": f"root-{node_id}",
                    "from": {"node": "root"},
                    "to": {"node": node_id},
                }
                for node_id, _ in routers
            ),
            # GE1407 requires every allowed route to carry a case.
            *(
                {
                    "id": f"{node_id}-{route}",
                    "from": {"node": node_id},
                    "to": {"node": f"{node_id}-{route}"},
                    "condition": {
                        "apiVersion": (
                            "graphengineering.reacher-z.github.io/"
                            "pattern-conditions/v1alpha1"
                        ),
                        "kind": "RouteEquals",
                        "routeKey": route,
                    },
                }
                for node_id, config in routers
                for route in config["allowedRoutes"]
            ),
            *(
                {
                    "id": f"{source}-{node_id}",
                    "from": {"node": source},
                    "to": {"node": node_id, "port": source},
                }
                for node_id, _ in barriers
                for source in BARRIER_REPLAY_SOURCE_NODES
            ),
        ],
    }


def drive_replay_scheduler(case: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Drive the real ``run_graph`` with executors that record every call.

    A spy executor is registered for every policy-carrying node; the committed
    history is handed to the scheduler, which folds it before any dispatch. The
    returned evidence is the authentic scheduler observation: the run status,
    the nodes whose executors were actually called (always none), and the
    number of decision events the run appended (always zero, because an adopted
    decision is never re-judged and a rejection dispatches nothing).
    """

    spied: list[str] = []

    def spy(context: NodeContext) -> Any:
        spied.append(context.node.id)
        return "must-not-run"

    def source_handler(context: NodeContext) -> Any:
        return "ok"

    handlers: dict[str, Any] = {node_id: spy for node_id in case["currentPolicies"]}
    for source in BARRIER_REPLAY_SOURCE_NODES:
        handlers[source] = source_handler

    result = asyncio.run(
        run_graph(
            compile_graph(barrier_replay_graph(case)),
            {},
            handlers,
            decision=DecisionContext(str(case["runId"]), int(case["graphRevision"])),
            committed_decisions=case["history"],
        )
    )
    scheduler_evidence = {
        "status": result.status.value,
        "spiedNodeIds": list(spied),
    }
    return scheduler_evidence, len(result.decision_events)


def replay_report(case: dict[str, Any]) -> dict[str, Any]:
    name = str(case["name"])
    run_id = str(case["runId"])
    graph_revision = int(case["graphRevision"])
    current_policies: dict[str, Any] = case["currentPolicies"]
    history: list[dict[str, Any]] = case["history"]

    outcome = fold_committed_decisions(
        history,
        run_id=run_id,
        graph_revision=graph_revision,
        current_policies=current_policies,
    )
    adopted_node_ids = list(outcome.adopted_node_ids)

    ledger = ExecutorLedger()
    if type(outcome) is DecisionAdoption:
        for node_id in current_policies:
            if node_id not in set(adopted_node_ids):
                ledger.execute(node_id)

    scheduler_evidence, appended_decision_events = drive_replay_scheduler(case)

    entry: dict[str, Any] = {
        "outcome": "adopted" if type(outcome) is DecisionAdoption else "rejected",
        "adoptedNodeIds": adopted_node_ids,
        # Observed by driving the real scheduler, not restated from the fold.
        "appendedDecisionEvents": appended_decision_events,
        "executorCalls": len(ledger.calls),
        "executedNodeIds": list(ledger.calls),
        "scheduler": scheduler_evidence,
        # Recomputed natively for every event in the history, whatever the
        # outcome: this is what makes a forked child run recompute its own
        # identity instead of inheriting the parent's.
        "currentPolicyHashes": {
            str(event["nodeId"]): (
                barrier_policy_hash(current_policies[str(event["nodeId"])])
                if event["type"] == "BarrierSatisfied"
                else route_policy_hash(current_policies[str(event["nodeId"])])
            )
            for event in history
            if str(event["nodeId"]) in current_policies
        },
        "recomputedDecisionIds": {
            str(event["nodeId"]): (
                barrier_decision_id(run_id, graph_revision, str(event["nodeId"]), event["data"])
                if event["type"] == "BarrierSatisfied"
                else route_decision_id(run_id, graph_revision, str(event["nodeId"]), event["data"])
            )
            for event in history
        },
        "recordedPolicyHashes": {
            str(event["nodeId"]): event["data"]["policyHash"] for event in history
        },
        "recordedDecisionIds": {
            str(event["nodeId"]): event["data"]["decisionId"] for event in history
        },
    }
    if type(outcome) is DecisionRejection:
        entry["code"] = outcome.code.value
        entry["nodeId"] = outcome.node_id
        for field, value in (
            ("recordedPolicyHash", outcome.recorded_policy_hash),
            ("currentPolicyHash", outcome.current_policy_hash),
            ("recordedDecisionId", outcome.recorded_decision_id),
            ("recomputedDecisionId", outcome.recomputed_decision_id),
        ):
            # Absent members are omitted rather than materialized as JSON null.
            if value is not None:
                entry[field] = value
    elif type(outcome) is not DecisionAdoption:
        raise AssertionError(f"{name}: unknown replay outcome {type(outcome)!r}")
    return entry


# --------------------------------------------------------------------------- #
# identifierCases: node IDs and route keys are deliberately different patterns  #
# --------------------------------------------------------------------------- #


def apply_pointer(document: Any, pointer: str, value: Any) -> Any:
    """Return a deep copy of ``document`` with one JSON-pointer slot replaced."""

    if not pointer.startswith("/"):
        raise AssertionError(f"identifier path {pointer!r} is not a JSON pointer")
    tokens = [token.replace("~1", "/").replace("~0", "~") for token in pointer[1:].split("/")]
    mutated: Any = json.loads(json.dumps(document))
    cursor: Any = mutated
    for token in tokens[:-1]:
        cursor = cursor[int(token)] if type(cursor) is list else cursor[token]
    last = tokens[-1]
    if type(cursor) is list:
        cursor[int(last)] = value
    else:
        cursor[last] = value
    return mutated


def identifier_report(case: dict[str, Any], base_documents: dict[str, Any]) -> dict[str, Any]:
    kind = str(case["documentKind"])
    base = base_documents[kind]
    mutated = apply_pointer(base, str(case["path"]), case["value"])
    return {
        "documentKind": kind,
        "path": case["path"],
        "value": case["value"],
        # The unmutated base document must be accepted, or the case proves
        # nothing about the mutation.
        "controlValid": validate_decision_identifiers(kind, base),
        "valid": validate_decision_identifiers(kind, mutated),
        "mutatedDocument": mutated,
    }


def main() -> None:
    corpus = load_corpus()
    policy_cases: list[dict[str, Any]] = corpus["policyCases"]
    ownership_cases: list[dict[str, Any]] = corpus["ownershipCases"]
    compiler_cases: list[dict[str, Any]] = corpus["compilerCases"]
    evaluation_cases: list[dict[str, Any]] = corpus["evaluationCases"]
    identity_cases: list[dict[str, Any]] = corpus["identityCases"]
    replay_cases: list[dict[str, Any]] = corpus["replayCases"]
    identifier_cases: list[dict[str, Any]] = corpus["identifierCases"]

    policy_names = case_names(policy_cases, "policyCases")
    ownership_names = case_names(ownership_cases, "ownershipCases")
    compiler_names = case_names(compiler_cases, "compilerCases")
    evaluation_names = case_names(evaluation_cases, "evaluationCases")
    identity_names = case_names(identity_cases, "identityCases")
    replay_names = case_names(replay_cases, "replayCases")
    identifier_names = case_names(identifier_cases, "identifierCases")

    probe_base = next(
        case["graph"] for case in compiler_cases if case["name"] == OWNERSHIP_PROBE_CASE
    )

    policy_report: dict[str, Any] = {}
    for case in policy_cases:
        name = str(case["name"])
        validation = validate_integrated_barrier_policy(case["config"])
        entry = validation_report(validation)
        # The standalone discriminator must agree with the validator member.
        entry["claimsPredicate"] = claims_integrated_barrier_policy(case["config"])
        policy_report[name] = entry
    if len(policy_report) != len(policy_names):
        raise AssertionError("policyCases: Python skipped a case the corpus declares")

    ownership_report: dict[str, Any] = {}
    for case in ownership_cases:
        name = str(case["name"])
        validation = validate_integrated_barrier_policy(case["config"])
        entry: dict[str, Any] = {
            "claimed": validation.claimed,
            "claimsPredicate": claims_integrated_barrier_policy(case["config"]),
            "diagnostics": ownership_diagnostics(validation),
        }
        # The same ownership rule, driven through the real public compiler.
        entry["probe"] = compiler_report(probe_graph(probe_base, case["config"]))
        ownership_report[name] = entry
    if len(ownership_report) != len(ownership_names):
        raise AssertionError("ownershipCases: Python skipped a case the corpus declares")

    compiler_report_by_name: dict[str, Any] = {}
    for case in compiler_cases:
        name = str(case["name"])
        compiler_report_by_name[name] = compiler_report(case["graph"])
    if len(compiler_report_by_name) != len(compiler_names):
        raise AssertionError("compilerCases: Python skipped a case the corpus declares")

    evaluation_report_by_name: dict[str, Any] = {}
    for case in evaluation_cases:
        evaluation_report_by_name[str(case["name"])] = evaluation_report(case)
    if len(evaluation_report_by_name) != len(evaluation_names):
        raise AssertionError("evaluationCases: Python skipped a case the corpus declares")

    identity_report_by_name: dict[str, Any] = {}
    for case in identity_cases:
        identity_report_by_name[str(case["name"])] = identity_report(case)
    if len(identity_report_by_name) != len(identity_names):
        raise AssertionError("identityCases: Python skipped a case the corpus declares")

    replay_report_by_name: dict[str, Any] = {}
    for case in replay_cases:
        replay_report_by_name[str(case["name"])] = replay_report(case)
    if len(replay_report_by_name) != len(replay_names):
        raise AssertionError("replayCases: Python skipped a case the corpus declares")

    identifier_base_documents: dict[str, Any] = corpus["identifierBaseDocuments"]
    identifier_report_by_name: dict[str, Any] = {}
    for case in identifier_cases:
        identifier_report_by_name[str(case["name"])] = identifier_report(
            case,
            identifier_base_documents,
        )
    if len(identifier_report_by_name) != len(identifier_names):
        raise AssertionError("identifierCases: Python skipped a case the corpus declares")

    report: dict[str, Any] = {
        "contract": corpus["contract"],
        # Read by this process from the corpus file; the join proves the Node
        # process read literally the same four `false` flags.
        "claims": corpus["claims"],
        "diagnosticCodes": corpus["diagnosticCodes"],
        "ownershipProbe": {
            "case": OWNERSHIP_PROBE_CASE,
            "nodeIndex": OWNERSHIP_PROBE_NODE_INDEX,
        },
        # The five domain-separation constants, read from the native package
        # rather than from the corpus. The join proves the TypeScript package
        # declares literally the same five strings.
        "identityDomains": {
            "policyHashDomain": POLICY_HASH_DOMAIN,
            "barrierDecisionDomain": BARRIER_DECISION_DOMAIN,
            "routeDecisionDomain": ROUTE_DECISION_DOMAIN,
            "barrierPolicyKindTag": BARRIER_POLICY_KIND_TAG,
            "routerPolicyKindTag": ROUTER_POLICY_KIND_TAG,
        },
        "policyCaseOrder": policy_names,
        "ownershipCaseOrder": ownership_names,
        "compilerCaseOrder": compiler_names,
        "evaluationCaseOrder": evaluation_names,
        "identityCaseOrder": identity_names,
        "replayCaseOrder": replay_names,
        "identifierCaseOrder": identifier_names,
        "policyCases": policy_report,
        "ownershipCases": ownership_report,
        "compilerCases": compiler_report_by_name,
        "evaluationCases": evaluation_report_by_name,
        "identityCases": identity_report_by_name,
        "replayCases": replay_report_by_name,
        "identifierCases": identifier_report_by_name,
    }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
