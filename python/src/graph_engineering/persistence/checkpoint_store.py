"""Content-hashed checkpoints with atomic local-file replacement."""

from __future__ import annotations

import asyncio
import json
import os
import re
import tempfile
from collections.abc import Mapping
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Literal, Protocol, cast, runtime_checkable

from pydantic import Field, ValidationError, field_validator

from .._json import JsonKeyCollisionError, normalize_json_strings
from ..canonical import canonical_json, canonical_sha256
from ..models import (
    MAX_SAFE_INTEGER,
    JsonValue,
    StrictModel,
    capture_graph_model_document,
)
from .errors import (
    CorruptCheckpointError,
    PersistenceIOError,
    PersistenceValidationError,
    ValidationIssue,
)
from .identifiers import assert_safe_identifier, identifier_hash
from .locks import process_lock

CHECKPOINT_API_VERSION = "graphengineering.reacher-z.github.io/checkpoints/v1alpha1"
_RFC3339 = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
)


def _validate_timestamp(value: str) -> str:
    if not _RFC3339.fullmatch(value):
        raise ValueError("createdAt must be an ISO 8601 date-time")
    if int(value[11:13]) > 23 or int(value[14:16]) > 59 or int(value[17:19]) > 59:
        raise ValueError("createdAt contains an invalid time of day")
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise ValueError("createdAt must be an ISO 8601 date-time") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("createdAt must include a UTC offset")
    return value


def _state_number_issues(value: object, path: str = "#/state") -> list[ValidationIssue]:
    if value is None or isinstance(value, (str, bool)):
        return []
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            return [ValidationIssue(path, "integer exceeds the cross-language safe range")]
        return []
    if isinstance(value, float):
        return [ValidationIssue(path, "floating-point checkpoint values are not supported")]
    if isinstance(value, list):
        issues: list[ValidationIssue] = []
        for index, item in enumerate(value):
            issues.extend(_state_number_issues(item, f"{path}/{index}"))
        return issues
    if isinstance(value, dict):
        issues = []
        for key, item in value.items():
            escaped = key.replace("~", "~0").replace("/", "~1")
            issues.extend(_state_number_issues(item, f"{path}/{escaped}"))
        return issues
    return [ValidationIssue(path, f"unsupported JSON value {type(value).__name__}")]


def _normalize_state_strings(value: JsonValue) -> JsonValue:
    try:
        return cast(JsonValue, normalize_json_strings(value))
    except JsonKeyCollisionError as exc:
        raise ValueError(str(exc)) from exc


class CheckpointInput(StrictModel):
    run_id: Annotated[str, Field(min_length=1)] = Field(alias="runId")
    checkpoint_id: Annotated[str, Field(min_length=1)] = Field(alias="checkpointId")
    sequence: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER)]
    created_at: str | None = Field(default=None, alias="createdAt")
    state: JsonValue

    @field_validator("created_at")
    @classmethod
    def created_at_is_timezone_aware(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("present createdAt cannot be null")
        return _validate_timestamp(value)

    @field_validator("state")
    @classmethod
    def state_strings_are_portable(cls, value: JsonValue) -> JsonValue:
        return _normalize_state_strings(value)


class StoredCheckpoint(StrictModel):
    api_version: Literal[
        "graphengineering.reacher-z.github.io/checkpoints/v1alpha1"
    ] = Field(alias="apiVersion")
    run_id: Annotated[str, Field(min_length=1)] = Field(alias="runId")
    checkpoint_id: Annotated[str, Field(min_length=1)] = Field(alias="checkpointId")
    sequence: Annotated[int, Field(ge=0, le=MAX_SAFE_INTEGER)]
    created_at: str = Field(alias="createdAt")
    state: JsonValue
    content_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")] = Field(
        alias="contentHash"
    )

    @field_validator("created_at")
    @classmethod
    def created_at_is_timezone_aware(cls, value: str) -> str:
        return _validate_timestamp(value)

    @field_validator("state")
    @classmethod
    def state_strings_are_portable(cls, value: JsonValue) -> JsonValue:
        return _normalize_state_strings(value)


class CheckpointSummary(StrictModel):
    api_version: Literal[
        "graphengineering.reacher-z.github.io/checkpoints/v1alpha1"
    ] = Field(alias="apiVersion")
    run_id: str = Field(alias="runId")
    checkpoint_id: str = Field(alias="checkpointId")
    sequence: int
    created_at: str = Field(alias="createdAt")
    content_hash: str = Field(alias="contentHash")


@runtime_checkable
class CheckpointStore(Protocol):
    async def save(
        self, checkpoint: CheckpointInput | Mapping[str, object]
    ) -> StoredCheckpoint: ...

    async def load(self, run_id: str, checkpoint_id: str) -> StoredCheckpoint | None: ...

    async def list(self, run_id: str) -> tuple[CheckpointSummary, ...]: ...


def _created_at_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _checkpoint_payload(
    *,
    run_id: str,
    checkpoint_id: str,
    sequence: int,
    created_at: str,
    state: JsonValue,
) -> dict[str, JsonValue]:
    return {
        "apiVersion": CHECKPOINT_API_VERSION,
        "runId": run_id,
        "checkpointId": checkpoint_id,
        "sequence": sequence,
        "createdAt": created_at,
        "state": state,
    }


def _summary(checkpoint: StoredCheckpoint) -> CheckpointSummary:
    return CheckpointSummary(
        apiVersion=checkpoint.api_version,
        runId=checkpoint.run_id,
        checkpointId=checkpoint.checkpoint_id,
        sequence=checkpoint.sequence,
        createdAt=checkpoint.created_at,
        contentHash=checkpoint.content_hash,
    )


class FileCheckpointStore:
    """Atomic, content-verified checkpoints for one coordinating process.

    Documented limitation: ``save`` persists the caller-supplied ``state``
    verbatim — plaintext application values reach the temporary and final
    ``checkpoints/v1alpha1`` files.  ``spec/redaction-semantics.md`` treats such
    content as legacy-inline data (Section 6.2).  For a write path where every
    application value is a checkpoint-bound protected reference and no
    plaintext byte ever reaches a temporary or final file, use
    :class:`~graph_engineering.persistence.protected_checkpoint.GuardedFileCheckpointStore`
    together with
    :class:`~graph_engineering.persistence.protected_checkpoint.ProtectedCheckpointWriter`
    (``checkpoints/v1alpha2``), which accept only guard-minted
    ``PreparedSinkWrite`` capabilities.
    """

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self.root = Path(root).resolve()
        self.checkpoints_directory = self.root / "checkpoints"
        try:
            self.checkpoints_directory.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise PersistenceIOError(
                "create checkpoint directory", str(self.checkpoints_directory), exc
            ) from exc
    def _lock(self, run_id: str) -> asyncio.Lock:
        return process_lock(f"checkpoint:{self._run_directory(run_id)}")

    def _run_directory(self, run_id: str) -> Path:
        assert_safe_identifier(run_id, "runId")
        return self.checkpoints_directory / identifier_hash(run_id)

    def path_for_checkpoint(self, run_id: str, checkpoint_id: str) -> Path:
        assert_safe_identifier(checkpoint_id, "checkpointId")
        return self._run_directory(run_id) / (
            f"{identifier_hash(checkpoint_id)}.checkpoint.json"
        )

    @staticmethod
    def _fsync_directory(path: Path) -> None:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        descriptor = os.open(path, flags)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    @staticmethod
    def _stored_checkpoint(checkpoint: CheckpointInput) -> StoredCheckpoint:
        assert_safe_identifier(checkpoint.run_id, "runId")
        assert_safe_identifier(checkpoint.checkpoint_id, "checkpointId")
        issues = _state_number_issues(checkpoint.state)
        if issues:
            raise PersistenceValidationError("checkpoint state is not portable JSON", issues)
        created_at = checkpoint.created_at or _created_at_now()
        payload = _checkpoint_payload(
            run_id=checkpoint.run_id,
            checkpoint_id=checkpoint.checkpoint_id,
            sequence=checkpoint.sequence,
            created_at=created_at,
            state=checkpoint.state,
        )
        return StoredCheckpoint.model_validate(
            {
                **payload,
                "contentHash": canonical_sha256(payload),
            }
        )

    @classmethod
    def _save_sync(cls, path: Path, checkpoint: StoredCheckpoint) -> None:
        run_directory = path.parent
        run_directory_created = not run_directory.exists()
        temporary_path: Path | None = None
        try:
            run_directory.mkdir(parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(
                prefix=f".{path.name}.",
                suffix=".tmp",
                dir=run_directory,
            )
            temporary_path = Path(temporary_name)
            with os.fdopen(descriptor, "wb") as handle:
                checkpoint_document = capture_graph_model_document(
                    checkpoint,
                    StoredCheckpoint,
                )
                handle.write(f"{canonical_json(checkpoint_document)}\n".encode())
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, path)
            temporary_path = None
            cls._fsync_directory(run_directory)
            if run_directory_created:
                cls._fsync_directory(run_directory.parent)
        except OSError as exc:
            raise PersistenceIOError("save checkpoint", str(path), exc) from exc
        finally:
            if temporary_path is not None:
                with suppress(OSError):
                    temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _load_path(
        path: Path,
        run_id: str,
        checkpoint_id: str | None = None,
    ) -> StoredCheckpoint:
        display_checkpoint = checkpoint_id or path.stem
        try:
            raw = path.read_bytes()
        except OSError as exc:
            raise PersistenceIOError("read checkpoint", str(path), exc) from exc
        if not raw.endswith(b"\n"):
            raise CorruptCheckpointError(
                run_id, display_checkpoint, "truncated checkpoint record"
            )
        try:
            document = json.loads(raw[:-1])
            checkpoint = StoredCheckpoint.model_validate(document)
        except (UnicodeDecodeError, json.JSONDecodeError, ValidationError) as exc:
            raise CorruptCheckpointError(run_id, display_checkpoint, str(exc)) from exc

        if checkpoint.run_id != run_id:
            raise CorruptCheckpointError(
                run_id, checkpoint.checkpoint_id, "stored runId does not match directory"
            )
        if checkpoint_id is not None and checkpoint.checkpoint_id != checkpoint_id:
            raise CorruptCheckpointError(
                run_id, checkpoint_id, "stored checkpointId does not match requested checkpoint"
            )
        expected_name = f"{identifier_hash(checkpoint.checkpoint_id)}.checkpoint.json"
        if path.name != expected_name:
            raise CorruptCheckpointError(
                run_id, checkpoint.checkpoint_id, "checkpoint filename does not match identifier"
            )
        issues = _state_number_issues(checkpoint.state)
        if issues:
            raise CorruptCheckpointError(
                run_id,
                checkpoint.checkpoint_id,
                "; ".join(f"{issue.path}: {issue.message}" for issue in issues),
            )
        payload = _checkpoint_payload(
            run_id=checkpoint.run_id,
            checkpoint_id=checkpoint.checkpoint_id,
            sequence=checkpoint.sequence,
            created_at=checkpoint.created_at,
            state=checkpoint.state,
        )
        expected_hash = canonical_sha256(payload)
        if checkpoint.content_hash != expected_hash:
            raise CorruptCheckpointError(
                run_id, checkpoint.checkpoint_id, "contentHash does not match checkpoint content"
            )
        return checkpoint

    async def save(
        self, checkpoint: CheckpointInput | Mapping[str, object]
    ) -> StoredCheckpoint:
        if not isinstance(checkpoint, CheckpointInput):
            try:
                checkpoint = CheckpointInput.model_validate(checkpoint)
            except ValidationError as exc:
                issues = tuple(
                    ValidationIssue(
                        f"#/checkpoint/{'/'.join(str(part) for part in error['loc'])}",
                        error["msg"],
                    )
                    for error in exc.errors()
                )
                raise PersistenceValidationError(
                    "checkpoint save validation failed", issues
                ) from exc
        stored = self._stored_checkpoint(checkpoint)
        path = self.path_for_checkpoint(stored.run_id, stored.checkpoint_id)
        async with self._lock(stored.run_id):
            await asyncio.to_thread(self._save_sync, path, stored)
        return stored.model_copy(deep=True)

    async def load(self, run_id: str, checkpoint_id: str) -> StoredCheckpoint | None:
        path = self.path_for_checkpoint(run_id, checkpoint_id)
        async with self._lock(run_id):
            if not path.exists():
                return None
            checkpoint = await asyncio.to_thread(
                self._load_path,
                path,
                run_id,
                checkpoint_id,
            )
        return checkpoint.model_copy(deep=True)

    async def list(self, run_id: str) -> tuple[CheckpointSummary, ...]:
        run_directory = self._run_directory(run_id)
        async with self._lock(run_id):
            if not run_directory.exists():
                return ()

            def load_all() -> list[StoredCheckpoint]:
                try:
                    paths = tuple(run_directory.glob("*.checkpoint.json"))
                except OSError as exc:
                    raise PersistenceIOError(
                        "list checkpoints", str(run_directory), exc
                    ) from exc
                return [self._load_path(path, run_id) for path in paths]

            checkpoints = await asyncio.to_thread(load_all)
        checkpoints.sort(key=lambda item: (item.sequence, item.checkpoint_id))
        return tuple(_summary(checkpoint) for checkpoint in checkpoints)
