# Graph Engineering progress scanner

`graph-progress` is a zero-runtime-dependency supervisor aid. It reads
`codex_logs/task-registry.json`, combines registry heartbeats with local agent-log
and expected-artifact evidence, writes atomic scan snapshots, and queues nudges for
the supervising agent. It never messages an agent or edits the registry itself.

Run directly from a checkout:

```bash
python3 tools/progress-scanner/graph_progress.py --repo "$PWD" scan
python3 tools/progress-scanner/graph_progress.py --repo "$PWD" status
python3 tools/progress-scanner/graph_progress.py --repo "$PWD" acknowledge <nudge-id>
```

Install an isolated command if desired:

```bash
python3 -m pip install ./tools/progress-scanner
graph-progress --repo "$PWD" scan
```

## Registry contract

The root object must contain a `tasks` array. Every task requires a unique `id`;
the current registry also uses `owner`, `status`, `depends_on`, `last_heartbeat`,
`blocker`, `quiet_until`, `expected_artifacts`, and `next_action`. Policy defaults
can be overridden with:

```json
{
  "scan_policy": {
    "warning_after_minutes": 60,
    "stale_after_minutes": 120,
    "nudge_cooldown_minutes": 120,
    "escalate_same_blocker_after_scans": 2
  }
}
```

New work can require evidence before a terminal status is trusted:

```json
{
  "evidence_policy": {
    "required_for_assigned_at_or_after": "2026-07-26T16:20:00Z"
  },
  "tasks": [{
    "id": "example",
    "assigned_at": "2026-07-26T16:30:00Z",
    "expected_tests": ["unit suite"],
    "test_evidence": [{
      "requirement": "unit suite",
      "result": "passed",
      "recorded_at": "2026-07-26T17:00:00Z",
      "reference": "command: pytest tests/unit"
    }],
    "completion_evidence": ["review: PR #42"]
  }]
}
```

Each required expected-test string needs a matching passing record, and at least
one completion reference is required. A failed record is an integration risk
even before the task is marked complete. The timestamp cutoff is an explicit
legacy migration boundary; a task can override it with
`"evidence_required": true` or `false`. References are auditable descriptions,
not commands the scanner executes.

Evidence records are append-only: for each exact requirement, the newest
`recorded_at` value wins (array order breaks equal-timestamp ties). This permits
a later passing rerun to supersede a recorded failure without deleting history,
while a later failure reopens the gate. Evidence cannot predate task assignment
or claim a future timestamp, and an evidence-required task must declare at least
one expected test.

Classification precedence is blocked, integration risk, waiting dependency,
quiet window, completion, staleness, then healthy. A dependency is satisfied only
when its registry status is one of `complete`, `completed`, `done`, `merged`, or
`released`. A completed task with missing expected artifacts is an integration
risk. A registered `quiet_until` suppresses age warnings while long-running work
is expected.

For evidence-required completed work, missing passing records or a missing
completion reference is also an integration risk. Scan snapshots preserve the
expected, passing, failed, and missing requirements so a healthy liveness result
cannot be mistaken for release acceptance.

Snapshots are written to `codex_logs/scans/<scan-id>.json` and atomically mirrored
to `codex_logs/scans/latest.json`. Nudge and acknowledgement events are append-only
records in `codex_logs/nudges/queue.jsonl`. The repository-level
`codex_logs/.scanner.lock` uses `flock`, so overlapping timer and manual scans do
not race. A task can create at most one nudge per configured cooldown period.

## 30-minute timer

Preview the exact files and commands first:

```bash
graph-progress --repo "$PWD" install-timer --dry-run
graph-progress --repo "$PWD" install-timer
graph-progress --repo "$PWD" uninstall-timer
```

Linux uses a systemd user timer and macOS uses a LaunchAgent. The generated timer
runs the exact Python interpreter and scanner file used during installation. CI
and tests only exercise `--dry-run`; they never install a timer.

## Tests

```bash
python3 -m unittest discover -s tools/progress-scanner/tests -v
```
