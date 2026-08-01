"""Emit Python results for the shared D9 redaction conformance corpus.

This report is one half of a cross-language join. It reads exactly one input --
``spec/conformance/redaction.case.json`` -- and computes every value it prints
with the native Python package (``graph_engineering``). It imports nothing from
the TypeScript lane, spawns no Node process, reads nothing under ``packages/``,
and never copies an ``expect``/``expected`` block into its output: the corpus
expectation blocks are consumed only to enumerate declared case identifiers,
never to supply a result. The consuming join in ``tools/conformance/run.mjs``
computes the TypeScript half natively from ``@graph-engineering/persistence``
and compares the two member for member before either half is compared to the
corpus.

The report carries five kinds of evidence.

* The closed vocabularies: the 57-source and 54-sink inventories as ordered
  lists, the twelve failure codes, the four payload dispositions, and the
  Section 3.2 disposition truth table -- all read from the native modules, not
  from the corpus, so the join compares two implementations rather than two
  corpus reads.
* The 21 pointer cases through ``apply_pointer_transform``: the transformed
  output, the canonical path list, and the rejection code where rejected.
* The 34 wire cases through ``validate_wire_document``: the schema verdict, the
  named disposition, and the ``redacted`` flag, plus an explicit ``decided``
  flag so a schema this lane cannot decide is a reported hole rather than a
  silent skip.
* The 39 flow cases through ``evaluate_flow``, plus the complete 57 x 54 =
  3,078-pair Cartesian sweep summarized by an order-sensitive digest.
* One shared seeded-canary vector: the declared payload is written through the
  real guarded durable path (``ProtectedEventJournal`` over
  ``GuardedJsonlEventStore`` and ``FileProtectedPayloadStore``), then every byte
  of every file that path produced is scanned with the native scanner. The
  positive control writes the same payload through the ungated legacy
  ``JsonlEventStore`` and must be detected, so a scanner that finds nothing
  because it looks for nothing fails the join.

The corpus declares ``implementationClaim: false`` and
``contractStatus: contract-only-native-implementation-required``. This report
claims nothing beyond what it exercises.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
import tempfile
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from graph_engineering.events import GraphEvent
from graph_engineering.persistence import JsonlEventStore
from graph_engineering.persistence.protected_journal import (
    GuardedJsonlEventStore,
    ProtectedEventJournal,
)
from graph_engineering.redaction.disposition import (
    DISPOSITION_TRUTH_TABLE,
    PAYLOAD_DISPOSITIONS,
    validate_disposition,
)
from graph_engineering.redaction.errors import FAILURE_CODES
from graph_engineering.redaction.flow import (
    ALGORITHM,
    CARTESIAN_PRODUCT_COUNT,
    SINK_RULE_COUNT,
    SOURCE_RULE_COUNT,
    evaluate_flow,
)
from graph_engineering.redaction.guard import SinkGuard
from graph_engineering.redaction.inventory import (
    NEVER_REDACTABLE_SINKS,
    NEVER_REDACTABLE_SOURCE_CLASSES,
    POLICY_CONTROLS,
    SINK_CLASSES,
    SINK_ROWS,
    SOURCE_CLASSES,
    SOURCE_ROWS,
    sink_row,
)
from graph_engineering.redaction.keys import DeterministicTestKeyProvider
from graph_engineering.redaction.limits import DEFAULT_LIMITS
from graph_engineering.redaction.pointer import (
    REDACTION_TOKEN,
    PointerTransformDenied,
    PointerTransformResult,
    apply_pointer_transform,
)
from graph_engineering.redaction.policy import (
    RedactionRule,
    default_stable_profile,
)
from graph_engineering.redaction.protect import (
    FileProtectedPayloadStore,
    key_ref_hash,
)
from graph_engineering.redaction.receipt import (
    TransformOccurrence,
    build_receipt,
    validate_receipt_document,
    verify_receipt,
)
from graph_engineering.redaction.scan import encoded_forms
from graph_engineering.redaction.wire import validate_wire_document

ROOT = Path(__file__).resolve().parents[2]
CASE_PATH = ROOT / "spec" / "conformance" / "redaction.case.json"

# ---------------------------------------------------------------------------
# Shared vectors.
#
# Every constant below is stated identically in the `run.mjs` join block and the
# join asserts the two statements equal before either is used. They are inputs,
# not expectations: no expected output is written down on either side.

#: The Cartesian sweep names one policy control per sink. The rule is "the sink
#: row's first declared control", stated the same way in both halves, so the
#: 3,078-pair sweep is over the same requests in both languages.
CARTESIAN_POLICY_ENABLED = True

#: The receipt vector. The identity key is supplied explicitly rather than taken
#: from a key provider: the two lanes ship different deterministic test
#: providers, so only an explicit key makes the keyed source/result digests
#: comparable across languages.
RECEIPT_IDENTITY_KEY_HEX = "0" * 62 + "d9"
RECEIPT_POLICY_HASH = "1a" * 32
RECEIPT_TRANSFORM_IMPLEMENTATION_HASH = "2b" * 32
RECEIPT_RULE_REGISTRY_HASH = "3c" * 32
RECEIPT_AUTHORITY_BINDING_HASH = "4d" * 32
RECEIPT_TENANT_SCOPE_HASH = "5e" * 32
RECEIPT_RULE_REGISTRY_VERSION = 1
RECEIPT_RULE_ID = "d9-join-observational-v1"
RECEIPT_RULE_RESOLUTION_ID = "d9-join-resolution-1"
RECEIPT_SOURCE_CLASS = "log-field"
RECEIPT_SINK = "runtime-log"
RECEIPT_DECISION_ID = "d9-join-decision-1"
RECEIPT_RUN_ID = "d9-join-run"
RECEIPT_GRAPH_REVISION = 1
RECEIPT_OCCURRENCE_KIND = "sink-write"
RECEIPT_OCCURRENCE_ID = "d9-join-occurrence-1"
RECEIPT_OCCURRENCE_SEQUENCE = 3
RECEIPT_OCCURRED_AT = "2026-07-31T00:00:00Z"
RECEIPT_FIELD_PATH = "/fields/message"
RECEIPT_REPLACEMENT_MODE = "constant-token"
#: Strictly increasing Unicode code-point order, and no ancestor/descendant pair.
RECEIPT_PATHS = ("/detail/token", "/message", "/nested/0/secret")
RECEIPT_SOURCE_SNAPSHOT: dict[str, Any] = {
    "detail": {"token": "synthetic-sensitive-value-a", "keep": 1},
    "message": "synthetic-sensitive-value-b",
    "nested": [{"secret": "synthetic-sensitive-value-c"}, {"secret": "kept"}],
    "public": ["a", "b"],
}

#: The seeded-canary vector. The value is deliberately drawn from `[A-Z0-9-]`
#: only, so every encoded spelling the two scanners recognize is byte-identical
#: across the two languages and the needle sets can be compared directly.
CANARY_ID = "d9-redaction-conformance-canary-1"
CANARY_VALUE = "GE-CANARY-D9-REDACTION-089-7B3F1A6C2E9D4058"
CANARY_RUN_ID = "d9-canary-run"
CANARY_GRAPH_REVISION = 1
CANARY_EVENT_ID = "evt-0"
CANARY_TIMESTAMP = "2026-07-31T00:00:00Z"
CANARY_GRAPH_HASH = "aa" * 32
CANARY_IMPLEMENTATION_HASH = "bb" * 32
CANARY_MAX_TOTAL_ATTEMPTS = 8
CANARY_PAYLOAD: dict[str, Any] = {
    "credentials": {"apiKey": CANARY_VALUE},
    "history": [{"note": CANARY_VALUE}, {"note": "ordinary application data"}],
    "question": CANARY_VALUE,
}
CANARY_TRANSFORM_HASH = "11" * 32
CANARY_REGISTRY_HASH = "22" * 32

#: The corpus sections this report is required to decide in full.
REQUIRED_SECTIONS = ("pointerCases", "wireCases", "flowCases")


def load_corpus() -> dict[str, Any]:
    corpus: dict[str, Any] = json.loads(CASE_PATH.read_text(encoding="utf-8"))
    return corpus


def case_ids(cases: list[dict[str, Any]], section: str) -> list[str]:
    ids = [str(case["id"]) for case in cases]
    if len(set(ids)) != len(ids):
        raise AssertionError(f"{section}: corpus declares a duplicate case id")
    if not ids:
        raise AssertionError(f"{section}: corpus declares no cases")
    return ids


# ---------------------------------------------------------------------------
# Closed vocabularies, read from the native modules.


def native_vocabularies() -> dict[str, Any]:
    return {
        "algorithm": ALGORITHM,
        "sourceInventory": list(SOURCE_CLASSES),
        "sinkInventory": list(SINK_CLASSES),
        "sourceRuleCount": SOURCE_RULE_COUNT,
        "sinkRuleCount": SINK_RULE_COUNT,
        # A set with no contract order, unlike the two inventories below.
        "policyControls": sorted(POLICY_CONTROLS),
        "failureCodes": list(FAILURE_CODES),
        "payloadDispositions": list(PAYLOAD_DISPOSITIONS),
        "neverRedactableSourceClasses": sorted(NEVER_REDACTABLE_SOURCE_CLASSES),
        "neverRedactableSinks": sorted(NEVER_REDACTABLE_SINKS),
        "redactionToken": REDACTION_TOKEN,
        "dispositionTruthTable": {
            disposition: {"redacted": redacted, "receiptRequired": receipt}
            for disposition, (redacted, receipt) in DISPOSITION_TRUTH_TABLE.items()
        },
        "limits": {
            "maxPolicyUtf8Bytes": DEFAULT_LIMITS.max_policy_utf8_bytes,
            "maxProtectedValueUtf8Bytes": DEFAULT_LIMITS.max_protected_value_utf8_bytes,
            "maxTransformedUtf8Bytes": DEFAULT_LIMITS.max_transformed_utf8_bytes,
            "maxValueDepth": DEFAULT_LIMITS.max_value_depth,
            "maxValueNodes": DEFAULT_LIMITS.max_value_nodes,
            "maxContainers": DEFAULT_LIMITS.max_containers,
            "maxObjectMembers": DEFAULT_LIMITS.max_object_members,
            "maxPointersPerRule": DEFAULT_LIMITS.max_pointers_per_rule,
            "maxPointerTokens": DEFAULT_LIMITS.max_pointer_tokens,
            "maxPointerUtf8Bytes": DEFAULT_LIMITS.max_pointer_utf8_bytes,
            "maxPointerTokenUtf8Bytes": DEFAULT_LIMITS.max_pointer_token_utf8_bytes,
            "maxProtectedRefsPerRecord": DEFAULT_LIMITS.max_protected_refs_per_record,
            "maxRefUtf8Bytes": DEFAULT_LIMITS.max_ref_utf8_bytes,
            "maxDiagnosticUtf8Bytes": DEFAULT_LIMITS.max_diagnostic_utf8_bytes,
        },
        "sourceRows": [
            {
                "sourceClass": row.source_class,
                "policyControl": row.policy_control,
                "defaultAction": row.default_action,
                "mayBeMetadata": row.may_be_metadata,
                "mayFeedScheduler": row.may_feed_scheduler,
                "identifierTreatment": row.identifier_treatment,
            }
            for row in SOURCE_ROWS
        ],
        "sinkRows": [
            {
                "sink": row.sink,
                "family": row.family,
                "policyControls": list(row.policy_controls),
                "acceptsProtected": row.accepts_protected,
                "acceptsMetadata": row.accepts_metadata,
                "defaultEnabled": row.default_enabled,
            }
            for row in SINK_ROWS
        ],
    }


def cartesian_sweep() -> dict[str, Any]:
    """Evaluate the complete 57 x 54 domain and summarize it order-sensitively.

    The control for each pair is the sink row's first declared control; the join
    block states the same rule. Every pair must produce a closed outcome, so a
    row that silently fell out of an inventory shows up as a ``failed`` outcome
    rather than as a smaller count.
    """

    outcomes: list[str] = []
    histogram: dict[str, int] = {}
    pairs = 0
    for source_class in SOURCE_CLASSES:
        for sink in SINK_CLASSES:
            row = sink_row(sink)
            if row is None:
                raise AssertionError(f"cartesian sweep: no native policy row for sink {sink!r}")
            decision = evaluate_flow(
                source_class,
                sink,
                row.policy_controls[0],
                policy_enabled=CARTESIAN_POLICY_ENABLED,
            )
            outcomes.append(f"{source_class}\x1f{sink}\x1f{decision.outcome}")
            histogram[decision.outcome] = histogram.get(decision.outcome, 0) + 1
            pairs += 1
    digest = hashlib.sha256("\x1e".join(outcomes).encode("utf-8")).hexdigest()
    return {
        "pairCount": pairs,
        "nativeCartesianProductCount": CARTESIAN_PRODUCT_COUNT,
        "outcomeHistogram": histogram,
        "outcomeDigest": digest,
    }


# ---------------------------------------------------------------------------
# Pointer transform.


def pointer_report(case: Mapping[str, Any]) -> dict[str, Any]:
    outcome = apply_pointer_transform(
        case["input"], list(case["paths"]), case["replacementMode"]
    )
    if isinstance(outcome, PointerTransformResult):
        return {
            "valid": True,
            "output": outcome.output,
            "canonicalPaths": list(outcome.canonical_paths),
            "count": outcome.count,
        }
    return {"valid": False, "code": outcome.failure.code}


# ---------------------------------------------------------------------------
# Wire documents.


def disposition_facts(document: object) -> dict[str, Any] | None:
    """Project the Section 3.2 facts a document states about itself.

    Only the disposition and the ``redacted`` flag are read from the document;
    the required flag and the receipt requirement come from the native truth
    table, and the verdict comes from the native validator.
    """

    if not isinstance(document, Mapping):
        return None
    if "payloadDisposition" not in document or "redacted" not in document:
        return None
    disposition = document["payloadDisposition"]
    facts: dict[str, Any] = {
        "disposition": disposition,
        "documentRedacted": document["redacted"],
        "inTruthTable": disposition in DISPOSITION_TRUTH_TABLE,
    }
    if disposition in DISPOSITION_TRUTH_TABLE:
        required_redacted, receipt_required = DISPOSITION_TRUTH_TABLE[disposition]
        facts["tableRedacted"] = required_redacted
        facts["receiptRequired"] = receipt_required
    projection: dict[str, Any] = {
        "payloadDisposition": disposition,
        "redacted": document["redacted"],
    }
    if "redactionReceipt" in document:
        projection["redactionReceipt"] = document["redactionReceipt"]
    facts["truthTableVerdict"] = validate_disposition(projection) is None
    return facts


def wire_report(case: Mapping[str, Any]) -> dict[str, Any]:
    schema = str(case["schema"])
    document = case["document"]
    try:
        result = validate_wire_document(schema, document)
    except KeyError:
        # No native validator for this schema. Reported, never skipped.
        return {"decided": False, "schema": schema, "dispositionFacts": disposition_facts(document)}
    return {
        "decided": True,
        "schema": schema,
        "verdict": result is None,
        "code": None if result is None else result.code,
        "dispositionFacts": disposition_facts(document),
    }


# ---------------------------------------------------------------------------
# Flow evaluator.


def flow_report(case: Mapping[str, Any]) -> dict[str, Any]:
    decision = evaluate_flow(
        case["sourceClass"],
        case["sink"],
        case["policyControl"],
        policy_enabled=case["policyEnabled"],
        known_source=case["knownSource"],
        known_sink=case["knownSink"],
        known_control=case["knownControl"],
    )
    return {
        "outcome": decision.outcome,
        "writeAuthorized": decision.write_authorized,
        "code": None if decision.failure is None else decision.failure.code,
    }


# ---------------------------------------------------------------------------
# Receipt.


def receipt_section() -> dict[str, Any]:
    """Build one receipt from the shared vector and report its bound facts."""

    identity_key = bytes.fromhex(RECEIPT_IDENTITY_KEY_HEX)
    rule = RedactionRule(
        rule_id=RECEIPT_RULE_ID,
        registry_version=RECEIPT_RULE_REGISTRY_VERSION,
        sink=RECEIPT_SINK,
        paths=RECEIPT_PATHS,
        replacement_mode=RECEIPT_REPLACEMENT_MODE,
    )
    transformed = apply_pointer_transform(
        RECEIPT_SOURCE_SNAPSHOT, list(RECEIPT_PATHS), RECEIPT_REPLACEMENT_MODE
    )
    if type(transformed) is PointerTransformDenied:
        raise AssertionError(
            f"the shared receipt vector must transform cleanly: {transformed.failure.code}"
        )

    occurrence = TransformOccurrence(
        source_class=RECEIPT_SOURCE_CLASS,
        sink=RECEIPT_SINK,
        decision_id=RECEIPT_DECISION_ID,
        run_id=RECEIPT_RUN_ID,
        graph_revision=RECEIPT_GRAPH_REVISION,
        occurrence_kind=RECEIPT_OCCURRENCE_KIND,
        occurrence_id=RECEIPT_OCCURRENCE_ID,
        occurrence_sequence=RECEIPT_OCCURRENCE_SEQUENCE,
        occurred_at=RECEIPT_OCCURRED_AT,
        field_path=RECEIPT_FIELD_PATH,
    )
    receipt = build_receipt(
        identity_key=identity_key,
        policy_hash=RECEIPT_POLICY_HASH,
        transform_implementation_hash=RECEIPT_TRANSFORM_IMPLEMENTATION_HASH,
        rule_registry_hash=RECEIPT_RULE_REGISTRY_HASH,
        rule_registry_version=RECEIPT_RULE_REGISTRY_VERSION,
        rule_resolution_id=RECEIPT_RULE_RESOLUTION_ID,
        authority_binding_hash=RECEIPT_AUTHORITY_BINDING_HASH,
        tenant_scope_hash=RECEIPT_TENANT_SCOPE_HASH,
        occurrence=occurrence,
        rules=[rule],
        source_snapshot=RECEIPT_SOURCE_SNAPSHOT,
        transformed=transformed.output,
        paths=RECEIPT_PATHS,
        replacement_mode=RECEIPT_REPLACEMENT_MODE,
    )
    document = receipt.as_document()
    verification = verify_receipt(
        receipt,
        identity_key=identity_key,
        source_snapshot=RECEIPT_SOURCE_SNAPSHOT,
        persisted_result=transformed.output,
        occurrence=occurrence,
    )
    # A receipt replayed against a value that is not the persisted result is not
    # proof of anything; the negative control proves the replay is real.
    tampered = json.loads(json.dumps(transformed.output))
    tampered["public"] = ["a", "b", "c"]
    tampered_verification = verify_receipt(
        receipt,
        identity_key=identity_key,
        source_snapshot=RECEIPT_SOURCE_SNAPSHOT,
        persisted_result=tampered,
        occurrence=occurrence,
    )
    paths = list(document["paths"])
    return {
        "document": document,
        "documentFields": sorted(document),
        "transformed": transformed.output,
        "countEqualsPathsLength": document["count"] == len(paths),
        "strictlyIncreasing": all(
            paths[index - 1] < paths[index] for index in range(1, len(paths))
        ),
        "structuralVerdict": validate_receipt_document(document) is None,
        "verified": verification is None,
        "tamperedVerified": tampered_verification is None,
        "tamperedCode": None if tampered_verification is None else tampered_verification.code,
    }


def corpus_receipt_facts(corpus: Mapping[str, Any]) -> dict[str, Any]:
    """Count/order facts for every receipt the corpus wire cases carry.

    Nothing here reads an ``expected`` block: the facts are recomputed from the
    document the corpus supplies as input.
    """

    facts: dict[str, Any] = {}
    for case in corpus["wireCases"]:
        document = case["document"]
        candidates: list[tuple[str, Any]] = []
        if isinstance(document, Mapping):
            if case["schema"] == "redaction-receipt.schema.json":
                candidates.append((str(case["id"]), document))
            if isinstance(document.get("redactionReceipt"), Mapping):
                candidates.append((f"{case['id']}#redactionReceipt", document["redactionReceipt"]))
        for label, receipt in candidates:
            paths = receipt.get("paths")
            ordered = (
                all(paths[index - 1] < paths[index] for index in range(1, len(paths)))
                if isinstance(paths, list)
                else None
            )
            facts[label] = {
                "count": receipt.get("count"),
                "pathsLength": len(paths) if isinstance(paths, list) else None,
                "countEqualsPathsLength": (
                    receipt.get("count") == len(paths) if isinstance(paths, list) else False
                ),
                "strictlyIncreasing": ordered,
                "structuralVerdict": validate_receipt_document(receipt) is None,
            }
    return facts


# ---------------------------------------------------------------------------
# Seeded canary vector, through the real guarded durable path.


async def _write_guarded(root: Path) -> dict[str, Any]:
    key_provider = DeterministicTestKeyProvider()
    blob_store = FileProtectedPayloadStore(root / "protected")
    policy = default_stable_profile(
        transform_implementation_hash=CANARY_TRANSFORM_HASH,
        rule_registry_version=1,
        rule_registry_hash=CANARY_REGISTRY_HASH,
        key_ref=key_provider.key_ref,
    )
    guard = SinkGuard(policy=policy, key_provider=key_provider, store=blob_store)
    journal_store = GuardedJsonlEventStore(root)
    journal = ProtectedEventJournal(
        run_id=CANARY_RUN_ID,
        graph_revision=CANARY_GRAPH_REVISION,
        guard=guard,
        store=journal_store,
    )
    await journal.append_run_created(
        event_id=CANARY_EVENT_ID,
        timestamp=CANARY_TIMESTAMP,
        graph_input=CANARY_PAYLOAD,
        graph_hash=CANARY_GRAPH_HASH,
        implementation_hash=CANARY_IMPLEMENTATION_HASH,
        key_ref_digest=key_ref_hash(key_provider.key_ref),
        max_total_attempts=CANARY_MAX_TOTAL_ATTEMPTS,
    )
    # Read the record back from the bytes that actually reached the sink, not
    # from the in-memory append result: the join is about what is on disk.
    journals = sorted(root.rglob("*.jsonl"))
    if len(journals) != 1:
        raise AssertionError("the guarded write must produce exactly one journal file")
    lines = [line for line in journals[0].read_bytes().split(b"\n") if line]
    if len(lines) != 1:
        raise AssertionError("the guarded write must produce exactly one journal record")
    document = json.loads(lines[0])
    data = document.get("data")
    return {
        "recordCount": len(lines),
        "payloadDisposition": document.get("payloadDisposition"),
        "redacted": document.get("redacted"),
        "adjacentMacEqualities": _adjacent_mac_equalities(document),
        "inlinePayloadFields": sorted(
            set(data) & {"input", "output", "result", "state"} if isinstance(data, dict) else []
        ),
    }


def _adjacent_mac_equalities(document: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Every ``<name>Mac`` beside a ``<name>Ref`` must equal the ref's valueMac.

    A record that carries a protected reference and a sibling MAC is only
    self-consistent when the two agree; a MAC that names a different value would
    let a swapped blob pass an integrity check.
    """

    equalities: list[dict[str, Any]] = []
    stack: list[Any] = [document]
    while stack:
        current = stack.pop()
        if isinstance(current, list):
            stack.extend(current)
            continue
        if not isinstance(current, Mapping):
            continue
        for key, value in current.items():
            stack.append(value)
            if not key.endswith("Ref") or not isinstance(value, Mapping):
                continue
            mac_key = f"{key[: -len('Ref')]}Mac"
            if mac_key not in current:
                continue
            equalities.append(
                {
                    "refField": key,
                    "macField": mac_key,
                    "equal": current[mac_key] == value.get("valueMac"),
                }
            )
    equalities.sort(key=lambda item: (item["refField"], item["macField"]))
    return equalities


def _scan_tree(root: Path) -> dict[str, Any]:
    """Scan every byte of every file below ``root`` for the seeded canary."""

    forms = encoded_forms(CANARY_VALUE)
    files = sorted(path for path in root.rglob("*") if path.is_file())
    detections: list[dict[str, str]] = []
    bytes_scanned = 0
    for path in files:
        raw = path.read_bytes()
        bytes_scanned += len(raw)
        lowered = raw.lower()
        for form, encoded in forms.items():
            if not encoded:
                continue
            haystack = lowered if form == "hex" else raw
            needle = encoded.lower() if form == "hex" else encoded
            if needle in haystack:
                detections.append(
                    {
                        "canaryId": CANARY_ID,
                        "form": form,
                        "file": str(path.relative_to(root)),
                    }
                )
    detections.sort(key=lambda item: (item["file"], item["form"]))
    return {
        "filesScanned": len(files),
        "bytesScanned": bytes_scanned,
        "detections": detections,
        "suffixes": sorted({path.suffix for path in files}),
    }


async def _write_positive_control(root: Path) -> None:
    """The ungated legacy v1alpha1 writer, which persists payloads verbatim."""

    store = JsonlEventStore(root)
    event = GraphEvent.model_validate(
        {
            "apiVersion": "graphengineering.reacher-z.github.io/events/v1alpha1",
            "eventId": "evt-0",
            "type": "RunCreated",
            "timestamp": CANARY_TIMESTAMP,
            "runId": "d9-canary-positive-control",
            "graphRevision": 1,
            "sequence": 0,
            "redacted": False,
            "data": {"input": CANARY_PAYLOAD},
        }
    )
    await store.append("d9-canary-positive-control", -1, [event])


def canary_section() -> dict[str, Any]:
    guarded_root = Path(tempfile.mkdtemp(prefix="ge-d9-canary-guarded-"))
    control_root = Path(tempfile.mkdtemp(prefix="ge-d9-canary-control-"))
    try:
        record = asyncio.run(_write_guarded(guarded_root))
        guarded = _scan_tree(guarded_root)
        asyncio.run(_write_positive_control(control_root))
        control = _scan_tree(control_root)
    finally:
        shutil.rmtree(guarded_root, ignore_errors=True)
        shutil.rmtree(control_root, ignore_errors=True)

    return {
        "canaryId": CANARY_ID,
        "canaryValue": CANARY_VALUE,
        "record": record,
        "guarded": guarded,
        "positiveControl": control,
        # The byte spellings this scanner looks for. Comparing the two needle
        # sets is what stops a scanner that reports zero because it searches for
        # nothing from passing the join.
        "needles": sorted(value.hex() for value in encoded_forms(CANARY_VALUE).values()),
        "needleCount": len(encoded_forms(CANARY_VALUE)),
    }


# ---------------------------------------------------------------------------


def main() -> None:
    corpus = load_corpus()

    pointer_cases: list[dict[str, Any]] = corpus["pointerCases"]
    wire_cases: list[dict[str, Any]] = corpus["wireCases"]
    flow_cases: list[dict[str, Any]] = corpus["flowCases"]

    pointer_ids = case_ids(pointer_cases, "pointerCases")
    wire_ids = case_ids(wire_cases, "wireCases")
    flow_ids = case_ids(flow_cases, "flowCases")

    pointers = {str(case["id"]): pointer_report(case) for case in pointer_cases}
    wires = {str(case["id"]): wire_report(case) for case in wire_cases}
    flows = {str(case["id"]): flow_report(case) for case in flow_cases}

    for section, reported, declared in (
        ("pointerCases", pointers, pointer_ids),
        ("wireCases", wires, wire_ids),
        ("flowCases", flows, flow_ids),
    ):
        if len(reported) != len(declared):
            raise AssertionError(
                f"{section}: Python reported {len(reported)} cases for {len(declared)} declared"
            )

    document: dict[str, Any] = {
        "apiVersion": corpus["apiVersion"],
        "contractStatus": corpus["contractStatus"],
        # Read by this process from the corpus file; the join proves the Node
        # process read literally the same flag.
        "implementationClaim": corpus["implementationClaim"],
        "requiredSections": list(REQUIRED_SECTIONS),
        "native": native_vocabularies(),
        "cartesian": cartesian_sweep(),
        "pointerCaseOrder": pointer_ids,
        "wireCaseOrder": wire_ids,
        "flowCaseOrder": flow_ids,
        "pointerCases": pointers,
        "wireCases": wires,
        "flowCases": flows,
        "receipt": receipt_section(),
        "corpusReceiptFacts": corpus_receipt_facts(corpus),
        "canary": canary_section(),
        "sharedVectors": {
            "cartesianPolicyEnabled": CARTESIAN_POLICY_ENABLED,
            "receiptIdentityKeyHex": RECEIPT_IDENTITY_KEY_HEX,
            "receiptPolicyHash": RECEIPT_POLICY_HASH,
            "receiptTransformImplementationHash": RECEIPT_TRANSFORM_IMPLEMENTATION_HASH,
            "receiptRuleRegistryHash": RECEIPT_RULE_REGISTRY_HASH,
            "receiptAuthorityBindingHash": RECEIPT_AUTHORITY_BINDING_HASH,
            "receiptTenantScopeHash": RECEIPT_TENANT_SCOPE_HASH,
            "receiptRuleRegistryVersion": RECEIPT_RULE_REGISTRY_VERSION,
            "receiptRuleId": RECEIPT_RULE_ID,
            "receiptRuleResolutionId": RECEIPT_RULE_RESOLUTION_ID,
            "receiptSourceClass": RECEIPT_SOURCE_CLASS,
            "receiptSink": RECEIPT_SINK,
            "receiptDecisionId": RECEIPT_DECISION_ID,
            "receiptRunId": RECEIPT_RUN_ID,
            "receiptGraphRevision": RECEIPT_GRAPH_REVISION,
            "receiptOccurrenceKind": RECEIPT_OCCURRENCE_KIND,
            "receiptOccurrenceId": RECEIPT_OCCURRENCE_ID,
            "receiptOccurrenceSequence": RECEIPT_OCCURRENCE_SEQUENCE,
            "receiptOccurredAt": RECEIPT_OCCURRED_AT,
            "receiptFieldPath": RECEIPT_FIELD_PATH,
            "receiptReplacementMode": RECEIPT_REPLACEMENT_MODE,
            "receiptPaths": list(RECEIPT_PATHS),
            "receiptSourceSnapshot": RECEIPT_SOURCE_SNAPSHOT,
            "canaryId": CANARY_ID,
            "canaryValue": CANARY_VALUE,
            "canaryRunId": CANARY_RUN_ID,
            "canaryGraphRevision": CANARY_GRAPH_REVISION,
            "canaryEventId": CANARY_EVENT_ID,
            "canaryTimestamp": CANARY_TIMESTAMP,
            "canaryGraphHash": CANARY_GRAPH_HASH,
            "canaryImplementationHash": CANARY_IMPLEMENTATION_HASH,
            "canaryMaxTotalAttempts": CANARY_MAX_TOTAL_ATTEMPTS,
            "canaryPayload": CANARY_PAYLOAD,
        },
    }
    print(json.dumps(document, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
