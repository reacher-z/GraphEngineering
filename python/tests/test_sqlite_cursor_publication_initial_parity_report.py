from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "tools/conformance/sqlite_cursor_publication_initial_python_report.py"
FIXTURE = ROOT / "spec/conformance/sqlite-cursor-publication-rebind-v2.case.json"


@pytest.fixture(scope="module")
def report_module() -> Iterator[ModuleType]:
    name = "_sqlite_cursor_publication_initial_python_report_test_subject"
    specification = importlib.util.spec_from_file_location(name, REPORT)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    sys.modules[name] = module
    try:
        specification.loader.exec_module(module)
        yield module
    finally:
        sys.modules.pop(name, None)


def test_python_report_is_exact_single_line_real_sqlite_fixture_evidence() -> None:
    completed = subprocess.run(
        [sys.executable, str(REPORT)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=20 * 60,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stderr == ""
    assert completed.stdout.endswith("\n")
    assert completed.stdout.count("\n") == 1

    decoded = json.loads(completed.stdout)
    assert completed.stdout == json.dumps(decoded, ensure_ascii=False, separators=(",", ":")) + "\n"
    assert list(decoded) == [
        "runtime",
        "publicExports",
        "counterProbe",
        "rollbackCount",
        "cases",
    ]
    assert decoded["runtime"] == "python"
    assert decoded["publicExports"] == {
        "packageRootAdoption": False,
        "packageRootMeasurement": False,
    }
    assert decoded["rollbackCount"] == 0

    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    parity = fixture["parityGates"]["initialPublicationNormalizedOutput"]
    expected_probe = {**parity["counterSelfProbe"], "rollbackCount": 1}
    assert list(decoded["counterProbe"]) == list(expected_probe)
    assert decoded["counterProbe"] == expected_probe
    assert len(decoded["cases"]) == 3
    assert all(list(case) == parity["orderedFields"] for case in decoded["cases"])
    assert decoded["cases"] == parity["expectedRecords"]


def test_counter_self_probe_uses_independently_observable_hooks(
    report_module: ModuleType,
) -> None:
    def total(snapshot: dict[str, object]) -> int:
        result = 0
        for value in snapshot.values():
            if isinstance(value, list):
                assert all(type(item) is int for item in value)
                result += sum(value)
            else:
                assert type(value) is int
                result += value
        return result

    scalar_paths = (
        ("provider_clock_read", "providerClockReadCount"),
        ("clock_evidence_consumed", "clockEvidenceConsumeCount"),
        ("outer_authority_minted", "outerAuthorityMintCount"),
        ("ledger_logical_write", "outerLedgerLogicalWriteSequence"),
        ("ledger_fixed_statement", "outerLedgerFixedStatementCount"),
        ("ledger_affected_row", "outerLedgerAffectedRowsWatermark"),
        ("catalog_fence_minted", "postDdlCatalogFenceMintCount"),
        ("reader_lease_minted", "readerLeaseMintCount"),
        ("reader_lease_closed", "readerLeaseCloseCount"),
        ("initial_write_receipt_minted", "initialWriteReceiptMintCount"),
        ("initial_write_receipt_consumed", "initialWriteReceiptConsumeCount"),
        ("initial_write_receipt_tombstoned", "initialWriteReceiptTombstoneCount"),
        ("stage_adoption_receipt_minted", "stageAdoptionReceiptMintCount"),
        ("cursor_rebind_prepared", "cursorRebindPrepareCount"),
        ("cursor_rebind_executed", "cursorRebindExecuteCount"),
        ("committed", "commitCount"),
        ("rolled_back", "rollbackCount"),
    )
    for method_name, field in scalar_paths:
        recorder = report_module._CounterProbeRecorder()
        getattr(recorder, method_name)()
        observed = recorder.snapshot()
        assert observed[field] == 1
        assert total(observed) == 1

    write_paths = (
        ("write_prepared", "perWritePrepareCounts"),
        ("write_executed", "perWriteExecuteCounts"),
        ("write_affected", "perWriteAffectedRowCounts"),
        ("write_changed", "perWriteTotalChangesDeltas"),
    )
    for method_name, field in write_paths:
        for slot in range(4):
            recorder = report_module._CounterProbeRecorder()
            getattr(recorder, method_name)(slot)
            observed = recorder.snapshot()
            expected = [0, 0, 0, 0]
            expected[slot] = 1
            assert observed[field] == expected
            assert total(observed) == 1

    recorder = report_module._CounterProbeRecorder()
    with pytest.raises(AssertionError, match="unknown write probe slot"):
        recorder.write_prepared(4)


def test_counter_self_probe_triggers_every_hook_exactly_once(
    report_module: ModuleType,
) -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    expected = {
        **fixture["parityGates"]["initialPublicationNormalizedOutput"]["counterSelfProbe"],
        "rollbackCount": 1,
    }
    assert report_module._counter_probe() == expected
