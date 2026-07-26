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

Classification precedence is blocked, integration risk, waiting dependency,
quiet window, completion, staleness, then healthy. A dependency is satisfied only
when its registry status is one of `complete`, `completed`, `done`, `merged`, or
`released`. A completed task with missing expected artifacts is an integration
risk. A registered `quiet_until` suppresses age warnings while long-running work
is expected.

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
