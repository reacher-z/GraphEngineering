"""Emit Python results for the shared integrated-barrier conformance corpus.

This report is one half of a cross-language join. It reads exactly one input —
``spec/conformance/integrated-barrier.case.json`` — and computes every value it
prints with the native Python package (``graph_engineering``). It never imports,
spawns, or reads anything produced by the TypeScript implementation, and it
never copies an ``expect`` block from the corpus into its own output: the
``expect`` blocks are consumed only to enumerate case names, never to supply a
result. The consuming join in ``tools/conformance/run.mjs`` computes the
TypeScript half natively and compares the two member for member.

The corpus declares ``implementationClaim: false``. This report proves nothing
about barrier execution; it only exercises the policy validator, the ownership
discriminator, and the real public compiler entry point.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from graph_engineering.compiler import Diagnostic, try_compile_graph
from graph_engineering.integrated_barrier import (
    BarrierPolicyValidation,
    IntegratedBarrierPolicySnapshot,
    InvalidBarrierPolicy,
    UnclaimedBarrierConfig,
    ValidBarrierPolicy,
    claims_integrated_barrier_policy,
    validate_integrated_barrier_policy,
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


def main() -> None:
    corpus = load_corpus()
    policy_cases: list[dict[str, Any]] = corpus["policyCases"]
    ownership_cases: list[dict[str, Any]] = corpus["ownershipCases"]
    compiler_cases: list[dict[str, Any]] = corpus["compilerCases"]

    policy_names = case_names(policy_cases, "policyCases")
    ownership_names = case_names(ownership_cases, "ownershipCases")
    compiler_names = case_names(compiler_cases, "compilerCases")

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
        "policyCaseOrder": policy_names,
        "ownershipCaseOrder": ownership_names,
        "compilerCaseOrder": compiler_names,
        "policyCases": policy_report,
        "ownershipCases": ownership_report,
        "compilerCases": compiler_report_by_name,
    }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
