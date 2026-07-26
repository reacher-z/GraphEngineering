from __future__ import annotations

import datetime as dt
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

MODULE_PATH = Path(__file__).parents[1] / "graph_progress.py"
SPEC = importlib.util.spec_from_file_location("graph_progress", MODULE_PATH)
assert SPEC and SPEC.loader
graph_progress = importlib.util.module_from_spec(SPEC)
sys.modules["graph_progress"] = graph_progress
SPEC.loader.exec_module(graph_progress)


UTC = dt.timezone.utc


class ProgressScannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary.name)
        (self.repo / "codex_logs" / "agents").mkdir(parents=True)
        (self.repo / "codex_logs" / "nudges").mkdir(parents=True)
        (self.repo / "codex_logs" / "scans").mkdir(parents=True)
        self.now = dt.datetime(2026, 7, 26, 12, 0, tzinfo=UTC)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def write_registry(self, tasks, policy=None, evidence_policy=None) -> None:
        value = {
            "schema_version": 1,
            "updated_at": "2026-07-26T10:00:00Z",
            "tasks": tasks,
        }
        if policy:
            value["scan_policy"] = policy
        if evidence_policy:
            value["evidence_policy"] = evidence_policy
        (self.repo / "codex_logs" / "task-registry.json").write_text(
            json.dumps(value), encoding="utf-8"
        )

    def test_classifies_healthy_waiting_stale_blocked_and_integration_risk(
        self,
    ) -> None:
        artifact = self.repo / "result.txt"
        artifact.write_text("done", encoding="utf-8")
        self.write_registry(
            [
                {
                    "id": "done",
                    "status": "completed",
                    "last_heartbeat": "2026-07-26T08:00:00Z",
                    "expected_artifacts": ["result.txt"],
                },
                {
                    "id": "active",
                    "status": "in_progress",
                    "last_heartbeat": "2026-07-26T11:50:00Z",
                },
                {
                    "id": "waiting",
                    "status": "in_progress",
                    "depends_on": ["active"],
                    "last_heartbeat": "2026-07-26T08:00:00Z",
                },
                {
                    "id": "stale",
                    "status": "in_progress",
                    "last_heartbeat": "2026-07-26T09:59:00Z",
                },
                {
                    "id": "blocked",
                    "status": "in_progress",
                    "blocker": "Waiting for a schema decision",
                    "last_heartbeat": "2026-07-26T11:59:00Z",
                },
                {
                    "id": "bad-dependency",
                    "status": "in_progress",
                    "depends_on": ["does-not-exist"],
                    "last_heartbeat": "2026-07-26T11:59:00Z",
                },
            ]
        )

        snapshot = graph_progress.scan_repository(self.repo, now=self.now)
        states = {task["id"]: task["classification"] for task in snapshot["tasks"]}

        self.assertEqual(states["done"], "healthy")
        self.assertEqual(states["active"], "healthy")
        self.assertEqual(states["waiting"], "waiting-dependency")
        self.assertEqual(states["stale"], "stale")
        self.assertEqual(states["blocked"], "blocked")
        self.assertEqual(states["bad-dependency"], "integration-risk")
        self.assertEqual(snapshot["summary"]["total"], 6)

    def test_warning_queues_one_nudge_per_cooldown(self) -> None:
        self.write_registry(
            [
                {
                    "id": "slow",
                    "status": "in_progress",
                    "last_heartbeat": "2026-07-26T10:50:00Z",
                }
            ]
        )

        first = graph_progress.scan_repository(self.repo, now=self.now)
        second = graph_progress.scan_repository(
            self.repo, now=self.now + dt.timedelta(minutes=30)
        )
        third = graph_progress.scan_repository(
            self.repo, now=self.now + dt.timedelta(minutes=121)
        )

        self.assertTrue(first["tasks"][0]["warning"])
        self.assertEqual(first["summary"]["nudges_created"], 1)
        self.assertEqual(second["summary"]["nudges_created"], 0)
        self.assertEqual(third["summary"]["nudges_created"], 1)
        events = graph_progress.read_jsonl(
            self.repo / "codex_logs" / "nudges" / "queue.jsonl"
        )
        self.assertEqual(len(events), 2)

    def test_same_blocker_escalates_on_second_scan(self) -> None:
        self.write_registry(
            [
                {
                    "id": "blocked",
                    "status": "blocked",
                    "blocker": "Provider access is unavailable",
                    "last_heartbeat": "2026-07-26T11:59:00Z",
                }
            ],
            policy={
                "warning_after_minutes": 1,
                "stale_after_minutes": 2,
                "nudge_cooldown_minutes": 120,
                "escalate_same_blocker_after_scans": 2,
            },
        )

        first = graph_progress.scan_repository(self.repo, now=self.now)
        second = graph_progress.scan_repository(
            self.repo, now=self.now + dt.timedelta(minutes=30)
        )

        self.assertEqual(first["tasks"][0]["consecutive_blocked_scans"], 1)
        self.assertFalse(first["tasks"][0]["escalated"])
        self.assertEqual(second["tasks"][0]["consecutive_blocked_scans"], 2)
        self.assertTrue(second["tasks"][0]["escalated"])
        self.assertEqual(second["summary"]["nudges_created"], 0)

    def test_acknowledge_is_append_only_and_rejects_duplicate(self) -> None:
        self.write_registry(
            [{"id": "blocked", "status": "blocked", "blocker": "Needs review"}]
        )
        snapshot = graph_progress.scan_repository(self.repo, now=self.now)
        nudge_id = snapshot["nudges_created"][0]["nudge_id"]

        acknowledgement = graph_progress.acknowledge_nudge(
            self.repo, nudge_id, now=self.now + dt.timedelta(minutes=1)
        )

        self.assertEqual(acknowledgement["event"], "acknowledged")
        events = graph_progress.read_jsonl(
            self.repo / "codex_logs" / "nudges" / "queue.jsonl"
        )
        self.assertEqual(
            [event["event"] for event in events], ["created", "acknowledged"]
        )
        with self.assertRaises(graph_progress.ScannerError):
            graph_progress.acknowledge_nudge(self.repo, nudge_id, now=self.now)

    def test_completed_missing_and_unsafe_artifacts_are_integration_risk(self) -> None:
        self.write_registry(
            [
                {
                    "id": "complete-but-missing",
                    "status": "done",
                    "expected_artifacts": ["missing.txt", "../outside.txt"],
                }
            ]
        )

        snapshot = graph_progress.scan_repository(self.repo, now=self.now)
        task = snapshot["tasks"][0]

        self.assertEqual(task["classification"], "integration-risk")
        self.assertEqual(task["expected_artifacts"]["missing"], ["missing.txt"])
        self.assertEqual(task["expected_artifacts"]["unsafe"], ["../outside.txt"])

    def test_required_completion_evidence_must_cover_every_expected_test(self) -> None:
        artifact = self.repo / "result.txt"
        artifact.write_text("done", encoding="utf-8")
        self.write_registry(
            [
                {
                    "id": "incomplete-evidence",
                    "status": "completed",
                    "assigned_at": "2026-07-26T11:00:00Z",
                    "expected_artifacts": ["result.txt"],
                    "expected_tests": ["unit suite", "integration suite"],
                    "test_evidence": [
                        {
                            "requirement": "unit suite",
                            "result": "passed",
                            "recorded_at": "2026-07-26T11:30:00Z",
                            "reference": "command: unit",
                        }
                    ],
                    "completion_evidence": ["review: 17"],
                }
            ],
            evidence_policy={
                "required_for_assigned_at_or_after": "2026-07-26T10:30:00Z"
            },
        )

        task = graph_progress.scan_repository(self.repo, now=self.now)["tasks"][0]

        self.assertEqual(task["classification"], "integration-risk")
        self.assertEqual(
            task["completion_evidence"]["missing_requirements"], ["integration suite"]
        )
        self.assertIn("integration suite", task["reason"])

    def test_required_completion_evidence_can_make_completed_task_healthy(self) -> None:
        artifact = self.repo / "result.txt"
        artifact.write_text("done", encoding="utf-8")
        records = [
            {
                "requirement": requirement,
                "result": "passed",
                "recorded_at": "2026-07-26T11:30:00Z",
                "reference": f"command: {requirement}",
            }
            for requirement in ("unit suite", "integration suite")
        ]
        self.write_registry(
            [
                {
                    "id": "evidenced",
                    "status": "completed",
                    "evidence_required": True,
                    "expected_artifacts": ["result.txt"],
                    "expected_tests": ["unit suite", "integration suite"],
                    "test_evidence": records,
                    "completion_evidence": ["review: 18", "commit: abc123"],
                }
            ]
        )

        task = graph_progress.scan_repository(self.repo, now=self.now)["tasks"][0]

        self.assertEqual(task["classification"], "healthy")
        self.assertTrue(task["completion_evidence"]["satisfied"])
        self.assertEqual(task["completion_evidence"]["missing_requirements"], [])
        snapshot = graph_progress.current_status(self.repo)
        self.assertEqual(snapshot["summary"]["evidence_required"], 1)
        self.assertEqual(snapshot["summary"]["evidence_satisfied"], 1)
        self.assertEqual(snapshot["summary"]["evidence_open"], 0)

    def test_failed_recorded_evidence_is_integration_risk_before_completion(
        self,
    ) -> None:
        self.write_registry(
            [
                {
                    "id": "failed-test",
                    "status": "in_progress",
                    "last_heartbeat": "2026-07-26T11:59:00Z",
                    "expected_tests": ["red team"],
                    "test_evidence": [
                        {
                            "requirement": "red team",
                            "result": "failed",
                            "recorded_at": "2026-07-26T11:58:00Z",
                            "reference": "log: failure-1",
                        }
                    ],
                }
            ]
        )

        task = graph_progress.scan_repository(self.repo, now=self.now)["tasks"][0]

        self.assertEqual(task["classification"], "integration-risk")
        self.assertEqual(
            task["completion_evidence"]["failed_requirements"], ["red team"]
        )

    def test_latest_evidence_record_supersedes_an_earlier_failure(self) -> None:
        self.write_registry(
            [
                {
                    "id": "retested",
                    "status": "completed",
                    "evidence_required": True,
                    "assigned_at": "2026-07-26T10:00:00Z",
                    "expected_tests": ["red team"],
                    "test_evidence": [
                        {
                            "requirement": "red team",
                            "result": "failed",
                            "recorded_at": "2026-07-26T10:30:00Z",
                            "reference": "run: first",
                        },
                        {
                            "requirement": "red team",
                            "result": "passed",
                            "recorded_at": "2026-07-26T11:30:00Z",
                            "reference": "run: fixed",
                        },
                    ],
                    "completion_evidence": ["review: fixed"],
                }
            ]
        )

        task = graph_progress.scan_repository(self.repo, now=self.now)["tasks"][0]

        self.assertEqual(task["classification"], "healthy")
        self.assertEqual(
            task["completion_evidence"]["passing_requirements"], ["red team"]
        )
        self.assertEqual(task["completion_evidence"]["failed_requirements"], [])

    def test_evidence_timestamps_cannot_predate_assignment_or_claim_the_future(
        self,
    ) -> None:
        base = {
            "id": "impossible-time",
            "status": "completed",
            "evidence_required": True,
            "assigned_at": "2026-07-26T11:00:00Z",
            "expected_tests": ["unit suite"],
            "completion_evidence": ["review: time"],
        }
        for recorded_at, message in (
            ("2026-07-26T10:59:00Z", "predates assigned_at"),
            ("2026-07-26T12:01:00Z", "is in the future"),
        ):
            with self.subTest(recorded_at=recorded_at):
                self.write_registry(
                    [
                        {
                            **base,
                            "test_evidence": [
                                {
                                    "requirement": "unit suite",
                                    "result": "passed",
                                    "recorded_at": recorded_at,
                                    "reference": "run: impossible",
                                }
                            ],
                        }
                    ]
                )
                with self.assertRaisesRegex(graph_progress.ScannerError, message):
                    graph_progress.scan_repository(self.repo, now=self.now)

    def test_evidence_required_task_needs_an_expected_test(self) -> None:
        self.write_registry(
            [
                {
                    "id": "empty-gate",
                    "status": "in_progress",
                    "evidence_required": True,
                    "last_heartbeat": "2026-07-26T11:59:00Z",
                    "expected_tests": [],
                }
            ]
        )

        with self.assertRaisesRegex(graph_progress.ScannerError, "must not be empty"):
            graph_progress.scan_repository(self.repo, now=self.now)

    def test_invalid_test_evidence_is_rejected(self) -> None:
        self.write_registry(
            [
                {
                    "id": "invalid-evidence",
                    "status": "completed",
                    "expected_tests": ["unit suite"],
                    "test_evidence": [
                        {
                            "requirement": "unknown suite",
                            "result": "passed",
                            "recorded_at": "2026-07-26T11:30:00Z",
                            "reference": "command: unit",
                        }
                    ],
                }
            ]
        )

        with self.assertRaisesRegex(graph_progress.ScannerError, "unknown requirement"):
            graph_progress.scan_repository(self.repo, now=self.now)

    def test_agent_jsonl_is_progress_evidence(self) -> None:
        self.write_registry(
            [
                {
                    "id": "active",
                    "status": "in_progress",
                    "last_heartbeat": "2026-07-26T08:00:00Z",
                }
            ]
        )
        (self.repo / "codex_logs" / "agents" / "worker.jsonl").write_text(
            json.dumps(
                {
                    "ts": "2026-07-26T11:55:00Z",
                    "task_id": "active",
                    "event": "test",
                }
            )
            + "\n",
            encoding="utf-8",
        )

        snapshot = graph_progress.scan_repository(self.repo, now=self.now)

        self.assertEqual(snapshot["tasks"][0]["classification"], "healthy")
        self.assertEqual(snapshot["tasks"][0]["activity_source"], "agent_log")

    def test_repository_lock_rejects_overlap(self) -> None:
        with (
            graph_progress.repository_lock(self.repo / "codex_logs"),
            self.assertRaises(graph_progress.ScannerBusy),
            graph_progress.repository_lock(self.repo / "codex_logs"),
        ):
            pass

    def test_snapshot_and_latest_are_complete_json(self) -> None:
        self.write_registry(
            [
                {
                    "id": "active",
                    "status": "in_progress",
                    "last_heartbeat": "2026-07-26T11:59:00Z",
                }
            ]
        )

        snapshot = graph_progress.scan_repository(self.repo, now=self.now)
        latest = graph_progress.current_status(self.repo)
        snapshot_files = list((self.repo / "codex_logs" / "scans").glob("scan-*.json"))

        self.assertEqual(latest["scan_id"], snapshot["scan_id"])
        self.assertEqual(len(snapshot_files), 1)
        self.assertFalse(list((self.repo / "codex_logs" / "scans").glob("*.tmp")))

    @mock.patch.object(graph_progress.Path, "home")
    def test_timer_dry_run_does_not_write_or_execute(self, home) -> None:
        fake_home = self.repo / "home"
        home.return_value = fake_home
        with mock.patch.object(graph_progress, "run_commands") as run_commands:
            install = graph_progress.install_timer(
                self.repo, kind="systemd", dry_run=True
            )
            uninstall = graph_progress.uninstall_timer(kind="systemd", dry_run=True)

        self.assertTrue(install["dry_run"])
        self.assertTrue(uninstall["dry_run"])
        self.assertTrue(
            any("OnUnitActiveSec=30min" in value for value in install["files"].values())
        )
        self.assertFalse(fake_home.exists())
        run_commands.assert_not_called()

    def test_cli_json_scan(self) -> None:
        self.write_registry(
            [
                {
                    "id": "active",
                    "status": "in_progress",
                    "last_heartbeat": "2099-01-01T00:00:00Z",
                }
            ]
        )
        output = io.StringIO()

        with redirect_stdout(output):
            exit_code = graph_progress.main(
                ["--repo", str(self.repo), "--json", "scan"]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(output.getvalue())["summary"]["total"], 1)


if __name__ == "__main__":
    unittest.main()
