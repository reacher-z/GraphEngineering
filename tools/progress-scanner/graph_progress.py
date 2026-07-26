#!/usr/bin/env python3
"""Local, zero-dependency progress scanner for Graph Engineering.

The scanner deliberately does not contact agents or mutate the task registry.  It
turns registry and local evidence into atomic snapshots, then appends actionable
events to a local nudge queue for the supervising agent to consume.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import errno
import fcntl
import hashlib
import json
import os
import plistlib
import shlex
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator, Mapping, Sequence


SCHEMA_VERSION = 1
DEFAULT_WARNING_MINUTES = 60
DEFAULT_STALE_MINUTES = 120
DEFAULT_COOLDOWN_MINUTES = 120
DEFAULT_ESCALATE_SCANS = 2
TERMINAL_SUCCESS = frozenset({"complete", "completed", "done", "merged", "released"})
TERMINAL_FAILURE = frozenset({"failed", "cancelled", "canceled"})
NUDGEABLE = frozenset({"stale", "blocked", "integration-risk"})


class ScannerError(RuntimeError):
    """An expected, user-facing scanner error."""


class ScannerBusy(ScannerError):
    """Another scanner process owns the repository lock."""


@dataclass(frozen=True)
class ScanPolicy:
    warning_after_minutes: int = DEFAULT_WARNING_MINUTES
    stale_after_minutes: int = DEFAULT_STALE_MINUTES
    nudge_cooldown_minutes: int = DEFAULT_COOLDOWN_MINUTES
    escalate_same_blocker_after_scans: int = DEFAULT_ESCALATE_SCANS

    @classmethod
    def from_registry(cls, registry: Mapping[str, Any]) -> "ScanPolicy":
        value = registry.get("scan_policy", {})
        if not isinstance(value, Mapping):
            raise ScannerError("task-registry.json: scan_policy must be an object")

        def positive_int(key: str, default: int) -> int:
            raw = value.get(key, default)
            if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
                raise ScannerError(f"task-registry.json: scan_policy.{key} must be a positive integer")
            return raw

        policy = cls(
            warning_after_minutes=positive_int("warning_after_minutes", DEFAULT_WARNING_MINUTES),
            stale_after_minutes=positive_int("stale_after_minutes", DEFAULT_STALE_MINUTES),
            nudge_cooldown_minutes=positive_int("nudge_cooldown_minutes", DEFAULT_COOLDOWN_MINUTES),
            escalate_same_blocker_after_scans=positive_int(
                "escalate_same_blocker_after_scans", DEFAULT_ESCALATE_SCANS
            ),
        )
        if policy.warning_after_minutes > policy.stale_after_minutes:
            raise ScannerError(
                "task-registry.json: warning_after_minutes cannot exceed stale_after_minutes"
            )
        return policy


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def format_time(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_time(value: Any, *, field: str) -> dt.datetime | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ScannerError(f"{field} must be an ISO-8601 string")
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = dt.datetime.fromisoformat(candidate)
    except ValueError as exc:
        raise ScannerError(f"{field} is not a valid ISO-8601 timestamp: {value!r}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def json_load(path: Path, *, required: bool = True) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        if required:
            raise ScannerError(f"required file does not exist: {path}") from None
        return None
    except json.JSONDecodeError as exc:
        raise ScannerError(f"invalid JSON in {path}: line {exc.lineno}, column {exc.colno}") from exc


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        with contextlib.suppress(OSError):
            directory_fd = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def append_jsonl(path: Path, value: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ScannerError(f"invalid JSONL in {path} at line {line_number}") from exc
            if not isinstance(value, dict):
                raise ScannerError(f"invalid JSONL in {path} at line {line_number}: expected object")
            events.append(value)
    return events


@contextlib.contextmanager
def repository_lock(log_dir: Path) -> Iterator[None]:
    """Acquire the repository scanner lock with POSIX flock."""

    log_dir.mkdir(parents=True, exist_ok=True)
    lock_path = log_dir / ".scanner.lock"
    with lock_path.open("a+", encoding="utf-8") as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            if exc.errno in {errno.EACCES, errno.EAGAIN}:
                raise ScannerBusy(f"another graph-progress process owns {lock_path}") from None
            raise
        try:
            handle.seek(0)
            handle.truncate()
            handle.write(f"pid={os.getpid()} acquired={format_time(utc_now())}\n")
            handle.flush()
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def discover_repo(explicit: str | None) -> Path:
    if explicit:
        repo = Path(explicit).expanduser().resolve()
    elif os.environ.get("GRAPH_ENGINEERING_REPO"):
        repo = Path(os.environ["GRAPH_ENGINEERING_REPO"]).expanduser().resolve()
    else:
        repo = Path.cwd().resolve()
        for candidate in (repo, *repo.parents):
            if (candidate / "codex_logs" / "task-registry.json").is_file():
                repo = candidate
                break
    if not repo.is_dir():
        raise ScannerError(f"repository directory does not exist: {repo}")
    return repo


def validated_tasks(registry: Mapping[str, Any]) -> list[dict[str, Any]]:
    raw_tasks = registry.get("tasks")
    if not isinstance(raw_tasks, list):
        raise ScannerError("task-registry.json: tasks must be an array")
    result: list[dict[str, Any]] = []
    identifiers: set[str] = set()
    for index, raw in enumerate(raw_tasks):
        if not isinstance(raw, dict):
            raise ScannerError(f"task-registry.json: tasks[{index}] must be an object")
        task_id = raw.get("id")
        if not isinstance(task_id, str) or not task_id.strip():
            raise ScannerError(f"task-registry.json: tasks[{index}].id must be a non-empty string")
        if task_id in identifiers:
            raise ScannerError(f"task-registry.json: duplicate task id {task_id!r}")
        identifiers.add(task_id)
        dependencies = raw.get("depends_on", raw.get("dependencies", []))
        if not isinstance(dependencies, list) or not all(isinstance(item, str) for item in dependencies):
            raise ScannerError(f"task-registry.json: task {task_id!r} depends_on must be a string array")
        normalized = dict(raw)
        normalized["id"] = task_id
        normalized["depends_on"] = dependencies
        result.append(normalized)
    return result


def task_log_activity(log_dir: Path) -> dict[str, dt.datetime]:
    latest: dict[str, dt.datetime] = {}
    agents_dir = log_dir / "agents"
    if not agents_dir.is_dir():
        return latest
    for path in sorted(agents_dir.glob("*.jsonl")):
        for event in read_jsonl(path):
            task_id = event.get("task_id")
            if not isinstance(task_id, str):
                continue
            timestamp = parse_time(event.get("ts"), field=f"{path}:ts")
            if timestamp and (task_id not in latest or timestamp > latest[task_id]):
                latest[task_id] = timestamp
    return latest


def safe_artifact_evidence(repo: Path, raw_paths: Any) -> dict[str, Any]:
    if raw_paths is None:
        paths: list[Any] = []
    elif isinstance(raw_paths, list):
        paths = raw_paths
    else:
        return {"present": [], "missing": [], "unsafe": [], "invalid": True, "latest_mtime": None}

    present: list[str] = []
    missing: list[str] = []
    unsafe: list[str] = []
    mtimes: list[dt.datetime] = []
    for raw in paths:
        if not isinstance(raw, str) or not raw.strip():
            unsafe.append(repr(raw))
            continue
        candidate = (repo / raw).resolve() if not Path(raw).is_absolute() else Path(raw).resolve()
        try:
            candidate.relative_to(repo)
        except ValueError:
            unsafe.append(raw)
            continue
        if candidate.exists():
            present.append(raw)
            with contextlib.suppress(OSError):
                mtimes.append(dt.datetime.fromtimestamp(candidate.stat().st_mtime, tz=dt.timezone.utc))
        else:
            missing.append(raw)
    return {
        "present": present,
        "missing": missing,
        "unsafe": unsafe,
        "invalid": False,
        "latest_mtime": format_time(max(mtimes)) if mtimes else None,
    }


def latest_task_activity(
    task: Mapping[str, Any], artifact_evidence: Mapping[str, Any], log_activity: dt.datetime | None
) -> tuple[dt.datetime | None, str | None]:
    candidates: list[tuple[dt.datetime, str]] = []
    for key in ("last_heartbeat", "last_progress_at", "updated_at", "started_at", "assigned_at"):
        timestamp = parse_time(task.get(key), field=f"task {task['id']}.{key}")
        if timestamp:
            candidates.append((timestamp, key))
    artifact_time = parse_time(
        artifact_evidence.get("latest_mtime"), field=f"task {task['id']}.artifact_mtime"
    )
    if artifact_time:
        candidates.append((artifact_time, "artifact_mtime"))
    if log_activity:
        candidates.append((log_activity, "agent_log"))
    return max(candidates, default=(None, None), key=lambda item: item[0] or dt.datetime.min.replace(tzinfo=dt.timezone.utc))


def blocker_text(task: Mapping[str, Any]) -> str | None:
    raw = task.get("blocker")
    if raw is None or raw is False or raw == "":
        return None
    if isinstance(raw, str):
        return raw.strip() or None
    if isinstance(raw, Mapping):
        summary = raw.get("summary") or raw.get("reason") or raw.get("message")
        return str(summary) if summary else json.dumps(raw, sort_keys=True, ensure_ascii=False)
    return str(raw)


def blocker_fingerprint(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.casefold().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


def classify_task(
    task: Mapping[str, Any],
    *,
    all_tasks: Mapping[str, Mapping[str, Any]],
    evidence: Mapping[str, Any],
    log_activity: dt.datetime | None,
    previous: Mapping[str, Any] | None,
    policy: ScanPolicy,
    now: dt.datetime,
) -> dict[str, Any]:
    task_id = str(task["id"])
    raw_status = str(task.get("status", "unknown")).strip().casefold().replace(" ", "_")
    blocker = blocker_text(task)
    fingerprint = blocker_fingerprint(blocker)
    dependencies = list(task.get("depends_on", []))
    unknown_dependencies = [item for item in dependencies if item not in all_tasks]
    unresolved_dependencies = [
        item
        for item in dependencies
        if item in all_tasks
        and str(all_tasks[item].get("status", "")).strip().casefold() not in TERMINAL_SUCCESS
    ]
    artifact_evidence = dict(evidence)
    last_activity, activity_source = latest_task_activity(task, artifact_evidence, log_activity)
    age_minutes = None
    if last_activity:
        age_minutes = max(0.0, (now - last_activity).total_seconds() / 60)

    quiet_until = parse_time(task.get("quiet_until"), field=f"task {task_id}.quiet_until")
    in_quiet_window = bool(quiet_until and quiet_until > now)
    failed_test = str(task.get("test_result", "")).casefold() in {"failed", "failure", "error"}

    if blocker or raw_status == "blocked":
        classification = "blocked"
        reason = blocker or "registry status is blocked"
    elif unknown_dependencies:
        classification = "integration-risk"
        reason = "unknown dependencies: " + ", ".join(unknown_dependencies)
    elif raw_status in TERMINAL_FAILURE or failed_test:
        classification = "integration-risk"
        reason = "task or test result is failed"
    elif raw_status in TERMINAL_SUCCESS and (artifact_evidence["missing"] or artifact_evidence["unsafe"]):
        classification = "integration-risk"
        reason = "completed task is missing or references unsafe expected artifacts"
    elif unresolved_dependencies:
        classification = "waiting-dependency"
        reason = "waiting for: " + ", ".join(unresolved_dependencies)
    elif in_quiet_window:
        classification = "healthy"
        reason = f"quiet window active until {format_time(quiet_until)}"
    elif raw_status in TERMINAL_SUCCESS:
        classification = "healthy"
        reason = "task is complete"
    elif age_minutes is None:
        classification = "stale"
        reason = "no heartbeat or progress evidence"
    elif age_minutes >= policy.stale_after_minutes:
        classification = "stale"
        reason = f"no progress evidence for {age_minutes:.1f} minutes"
    else:
        classification = "healthy"
        reason = "recent progress evidence"

    warning = bool(
        classification == "healthy"
        and raw_status not in TERMINAL_SUCCESS
        and not in_quiet_window
        and age_minutes is not None
        and age_minutes >= policy.warning_after_minutes
    )
    if warning:
        reason = f"warning: no progress evidence for {age_minutes:.1f} minutes"

    previous_fingerprint = previous.get("blocker_fingerprint") if previous else None
    previous_count = previous.get("consecutive_blocked_scans", 0) if previous else 0
    if classification == "blocked" and fingerprint and previous_fingerprint == fingerprint:
        consecutive_blocked = int(previous_count) + 1
    elif classification == "blocked":
        consecutive_blocked = 1
    else:
        consecutive_blocked = 0
    escalated = classification == "blocked" and (
        consecutive_blocked >= policy.escalate_same_blocker_after_scans
    )

    return {
        "id": task_id,
        "title": task.get("title", task_id),
        "owner": task.get("owner"),
        "registry_status": raw_status,
        "classification": classification,
        "reason": reason,
        "warning": warning,
        "last_activity": format_time(last_activity) if last_activity else None,
        "activity_source": activity_source,
        "age_minutes": round(age_minutes, 1) if age_minutes is not None else None,
        "dependencies": dependencies,
        "unresolved_dependencies": unresolved_dependencies,
        "unknown_dependencies": unknown_dependencies,
        "blocker": blocker,
        "blocker_fingerprint": fingerprint,
        "consecutive_blocked_scans": consecutive_blocked,
        "escalated": escalated,
        "quiet_until": format_time(quiet_until) if quiet_until else None,
        "expected_artifacts": artifact_evidence,
        "risk": task.get("risk"),
        "next_action": task.get("next_action"),
    }


def queue_state(events: Sequence[Mapping[str, Any]]) -> tuple[dict[str, dt.datetime], set[str]]:
    last_created: dict[str, dt.datetime] = {}
    acknowledged: set[str] = set()
    for event in events:
        kind = event.get("event")
        if kind == "created" and isinstance(event.get("task_id"), str):
            timestamp = parse_time(event.get("ts"), field="nudge event ts")
            if timestamp:
                task_id = str(event["task_id"])
                if task_id not in last_created or timestamp > last_created[task_id]:
                    last_created[task_id] = timestamp
        elif kind == "acknowledged" and isinstance(event.get("nudge_id"), str):
            acknowledged.add(str(event["nudge_id"]))
    return last_created, acknowledged


def make_nudge(task: Mapping[str, Any], now: dt.datetime) -> dict[str, Any]:
    material = f"{task['id']}|{task['classification']}|{format_time(now)}"
    suffix = hashlib.sha256(material.encode("utf-8")).hexdigest()[:10]
    compact = now.astimezone(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    level = "escalation" if task.get("escalated") else "warning"
    return {
        "schema_version": SCHEMA_VERSION,
        "event": "created",
        "nudge_id": f"nudge-{compact}-{suffix}",
        "ts": format_time(now),
        "task_id": task["id"],
        "owner": task.get("owner"),
        "classification": task["classification"],
        "level": level,
        "reason": task["reason"],
        "blocker_fingerprint": task.get("blocker_fingerprint"),
        "next_action": task.get("next_action"),
    }


def scan_repository(repo: Path, *, now: dt.datetime | None = None) -> dict[str, Any]:
    now = (now or utc_now()).astimezone(dt.timezone.utc)
    log_dir = repo / "codex_logs"
    registry_path = log_dir / "task-registry.json"
    queue_path = log_dir / "nudges" / "queue.jsonl"
    latest_path = log_dir / "scans" / "latest.json"

    registry = json_load(registry_path)
    if not isinstance(registry, dict):
        raise ScannerError("task-registry.json must contain a JSON object")
    policy = ScanPolicy.from_registry(registry)
    tasks = validated_tasks(registry)
    task_by_id = {task["id"]: task for task in tasks}
    previous_snapshot = json_load(latest_path, required=False)
    previous_tasks = {}
    if isinstance(previous_snapshot, Mapping):
        previous_tasks = {
            item["id"]: item
            for item in previous_snapshot.get("tasks", [])
            if isinstance(item, Mapping) and isinstance(item.get("id"), str)
        }
    activity = task_log_activity(log_dir)

    classified: list[dict[str, Any]] = []
    for task in tasks:
        evidence = safe_artifact_evidence(repo, task.get("expected_artifacts"))
        classified.append(
            classify_task(
                task,
                all_tasks=task_by_id,
                evidence=evidence,
                log_activity=activity.get(task["id"]),
                previous=previous_tasks.get(task["id"]),
                policy=policy,
                now=now,
            )
        )

    queue_events = read_jsonl(queue_path)
    last_nudges, _ = queue_state(queue_events)
    nudges: list[dict[str, Any]] = []
    cooldown = dt.timedelta(minutes=policy.nudge_cooldown_minutes)
    for task in classified:
        needs_nudge = task["classification"] in NUDGEABLE or task["warning"]
        last_nudge = last_nudges.get(task["id"])
        cooldown_elapsed = last_nudge is None or now - last_nudge >= cooldown
        task["nudge_eligible"] = bool(needs_nudge and cooldown_elapsed)
        task["nudge_cooldown_until"] = (
            format_time(last_nudge + cooldown) if last_nudge and not cooldown_elapsed else None
        )
        if task["nudge_eligible"]:
            nudge = make_nudge(task, now)
            append_jsonl(queue_path, nudge)
            nudges.append(nudge)
            task["nudge_id"] = nudge["nudge_id"]
        else:
            task["nudge_id"] = None

    counts = {key: 0 for key in ("healthy", "waiting-dependency", "stale", "blocked", "integration-risk")}
    for task in classified:
        counts[task["classification"]] += 1
    warning_count = sum(1 for task in classified if task["warning"])
    overall = "attention" if any(counts[key] for key in NUDGEABLE) or warning_count else "healthy"
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "scan_id": now.strftime("scan-%Y%m%dT%H%M%S.%fZ"),
        "scanned_at": format_time(now),
        "repository": str(repo),
        "registry_updated_at": registry.get("updated_at"),
        "overall": overall,
        "policy": {
            "warning_after_minutes": policy.warning_after_minutes,
            "stale_after_minutes": policy.stale_after_minutes,
            "nudge_cooldown_minutes": policy.nudge_cooldown_minutes,
            "escalate_same_blocker_after_scans": policy.escalate_same_blocker_after_scans,
        },
        "summary": {**counts, "warnings": warning_count, "nudges_created": len(nudges), "total": len(classified)},
        "tasks": classified,
        "nudges_created": nudges,
    }

    scans_dir = log_dir / "scans"
    snapshot_path = scans_dir / f"{snapshot['scan_id']}.json"
    atomic_write_json(snapshot_path, snapshot)
    atomic_write_json(latest_path, snapshot)
    snapshot["snapshot_path"] = str(snapshot_path)
    return snapshot


def acknowledge_nudge(repo: Path, nudge_id: str, *, now: dt.datetime | None = None) -> dict[str, Any]:
    now = (now or utc_now()).astimezone(dt.timezone.utc)
    queue_path = repo / "codex_logs" / "nudges" / "queue.jsonl"
    events = read_jsonl(queue_path)
    created = [event for event in events if event.get("event") == "created" and event.get("nudge_id") == nudge_id]
    if not created:
        raise ScannerError(f"unknown nudge id: {nudge_id}")
    if any(event.get("event") == "acknowledged" and event.get("nudge_id") == nudge_id for event in events):
        raise ScannerError(f"nudge is already acknowledged: {nudge_id}")
    event = {
        "schema_version": SCHEMA_VERSION,
        "event": "acknowledged",
        "nudge_id": nudge_id,
        "task_id": created[-1].get("task_id"),
        "ts": format_time(now),
    }
    append_jsonl(queue_path, event)
    return event


def current_status(repo: Path) -> dict[str, Any]:
    value = json_load(repo / "codex_logs" / "scans" / "latest.json")
    if not isinstance(value, dict):
        raise ScannerError("latest scan must contain a JSON object")
    return value


def timer_kind(requested: str) -> str:
    if requested != "auto":
        return requested
    if sys.platform == "darwin":
        return "launchd"
    if sys.platform.startswith("linux"):
        return "systemd"
    raise ScannerError("automatic timer installation supports Linux systemd and macOS launchd only")


def scanner_command(repo: Path) -> list[str]:
    return [sys.executable, str(Path(__file__).resolve()), "--repo", str(repo), "scan"]


def systemd_units(repo: Path) -> tuple[str, str]:
    command = " ".join(shlex.quote(part) for part in scanner_command(repo))
    service = "\n".join(
        [
            "[Unit]",
            "Description=Graph Engineering progress scan",
            "",
            "[Service]",
            "Type=oneshot",
            f"WorkingDirectory={repo}",
            f"ExecStart={command}",
            "",
        ]
    )
    timer = "\n".join(
        [
            "[Unit]",
            "Description=Run Graph Engineering progress scan every 30 minutes",
            "",
            "[Timer]",
            "OnBootSec=5min",
            "OnUnitActiveSec=30min",
            "Persistent=true",
            "Unit=graph-progress.service",
            "",
            "[Install]",
            "WantedBy=timers.target",
            "",
        ]
    )
    return service, timer


def launchd_plist(repo: Path) -> bytes:
    value = {
        "Label": "dev.graphengineering.progress-scanner",
        "ProgramArguments": scanner_command(repo),
        "WorkingDirectory": str(repo),
        "StartInterval": 1800,
        "RunAtLoad": True,
        "StandardOutPath": str(repo / "codex_logs" / "scanner.stdout.log"),
        "StandardErrorPath": str(repo / "codex_logs" / "scanner.stderr.log"),
    }
    return plistlib.dumps(value, sort_keys=True)


def install_timer(repo: Path, *, kind: str, dry_run: bool = False) -> dict[str, Any]:
    selected = timer_kind(kind)
    home = Path.home()
    if selected == "systemd":
        directory = home / ".config" / "systemd" / "user"
        service_path = directory / "graph-progress.service"
        timer_path = directory / "graph-progress.timer"
        service, timer = systemd_units(repo)
        result = {
            "kind": selected,
            "files": {str(service_path): service, str(timer_path): timer},
            "commands": [
                ["systemctl", "--user", "daemon-reload"],
                ["systemctl", "--user", "enable", "--now", "graph-progress.timer"],
            ],
            "dry_run": dry_run,
        }
        if not dry_run:
            directory.mkdir(parents=True, exist_ok=True)
            atomic_write_text(service_path, service)
            atomic_write_text(timer_path, timer)
            run_commands(result["commands"])
        return result

    directory = home / "Library" / "LaunchAgents"
    plist_path = directory / "dev.graphengineering.progress-scanner.plist"
    payload = launchd_plist(repo)
    commands = [["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist_path)]]
    result = {
        "kind": selected,
        "files": {str(plist_path): payload.decode("utf-8")},
        "commands": commands,
        "dry_run": dry_run,
    }
    if not dry_run:
        directory.mkdir(parents=True, exist_ok=True)
        atomic_write_bytes(plist_path, payload)
        run_commands(commands)
    return result


def uninstall_timer(*, kind: str, dry_run: bool = False) -> dict[str, Any]:
    selected = timer_kind(kind)
    home = Path.home()
    if selected == "systemd":
        paths = [
            home / ".config" / "systemd" / "user" / "graph-progress.service",
            home / ".config" / "systemd" / "user" / "graph-progress.timer",
        ]
        commands = [
            ["systemctl", "--user", "disable", "--now", "graph-progress.timer"],
            ["systemctl", "--user", "daemon-reload"],
        ]
    else:
        paths = [home / "Library" / "LaunchAgents" / "dev.graphengineering.progress-scanner.plist"]
        commands = [["launchctl", "bootout", f"gui/{os.getuid()}", str(paths[0])]]
    result = {
        "kind": selected,
        "files": [str(path) for path in paths],
        "commands": commands,
        "dry_run": dry_run,
    }
    if not dry_run:
        # Disable first while the definition is still available.  A missing unit/job
        # is harmless and keeps uninstall idempotent.
        run_commands(commands, tolerate_failure=True)
        for path in paths:
            with contextlib.suppress(FileNotFoundError):
                path.unlink()
    return result


def atomic_write_text(path: Path, value: str) -> None:
    atomic_write_bytes(path, value.encode("utf-8"))


def atomic_write_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def run_commands(commands: Iterable[Sequence[str]], *, tolerate_failure: bool = False) -> None:
    for command in commands:
        try:
            subprocess.run(command, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError) as exc:
            if not tolerate_failure:
                raise ScannerError(f"timer command failed: {shlex.join(command)}: {exc}") from exc


def print_human_scan(snapshot: Mapping[str, Any]) -> None:
    summary = snapshot["summary"]
    print(
        f"Graph progress: {snapshot['overall']} — {summary['total']} tasks, "
        f"{summary['healthy']} healthy, {summary['waiting-dependency']} waiting, "
        f"{summary['stale']} stale, {summary['blocked']} blocked, "
        f"{summary['integration-risk']} integration risk, {summary['warnings']} warnings"
    )
    for task in snapshot["tasks"]:
        marker = "!" if task["classification"] in NUDGEABLE or task["warning"] else "·"
        print(f"{marker} {task['id']} [{task['classification']}] {task['reason']}")
    if snapshot.get("nudges_created"):
        print(f"Queued {len(snapshot['nudges_created'])} nudge(s) for supervisor delivery.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="graph-progress", description=__doc__)
    parser.add_argument("--repo", help="repository root (default: discover from cwd)")
    parser.add_argument("--json", action="store_true", help="emit stable JSON")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("scan", help="scan registry and append eligible nudges")
    subparsers.add_parser("status", help="show the most recent scan without rescanning")
    install = subparsers.add_parser("install-timer", help="install a 30-minute user timer")
    install.add_argument("--kind", choices=("auto", "systemd", "launchd"), default="auto")
    install.add_argument("--dry-run", action="store_true", help="print files and commands without changing anything")
    uninstall = subparsers.add_parser("uninstall-timer", help="remove the user timer")
    uninstall.add_argument("--kind", choices=("auto", "systemd", "launchd"), default="auto")
    uninstall.add_argument("--dry-run", action="store_true", help="print actions without changing anything")
    acknowledge = subparsers.add_parser("acknowledge", help="append an acknowledgement for a nudge")
    acknowledge.add_argument("nudge_id")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        repo = discover_repo(args.repo)
        log_dir = repo / "codex_logs"
        if args.command in {"scan", "acknowledge"}:
            with repository_lock(log_dir):
                if args.command == "scan":
                    value = scan_repository(repo)
                else:
                    value = acknowledge_nudge(repo, args.nudge_id)
        elif args.command == "status":
            value = current_status(repo)
        elif args.command == "install-timer":
            value = install_timer(repo, kind=args.kind, dry_run=args.dry_run)
        elif args.command == "uninstall-timer":
            value = uninstall_timer(kind=args.kind, dry_run=args.dry_run)
        else:  # pragma: no cover - argparse guarantees the command
            parser.error(f"unsupported command: {args.command}")
            return 2
    except ScannerBusy as exc:
        print(f"graph-progress: {exc}", file=sys.stderr)
        return 75
    except ScannerError as exc:
        print(f"graph-progress: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True))
    elif args.command in {"scan", "status"}:
        print_human_scan(value)
    elif args.command == "acknowledge":
        print(f"Acknowledged {value['nudge_id']}")
    else:
        action = "Would configure" if value["dry_run"] else "Configured"
        print(f"{action} {value['kind']} progress timer")
        for path in value["files"]:
            print(f"  file: {path}")
        for command in value["commands"]:
            print(f"  command: {shlex.join(command)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
