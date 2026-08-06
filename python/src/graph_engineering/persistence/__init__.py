"""Local durable event and checkpoint storage."""

from ..models import MAX_SAFE_INTEGER
from .checkpoint_store import (
    CHECKPOINT_API_VERSION,
    CheckpointInput,
    CheckpointStore,
    CheckpointSummary,
    FileCheckpointStore,
    StoredCheckpoint,
)
from .errors import (
    CheckpointProtectionRequiredError,
    CorruptCheckpointError,
    CorruptEventLogError,
    PersistenceError,
    PersistenceErrorCode,
    PersistenceIOError,
    PersistenceValidationError,
    UnsafeIdentifierError,
    ValidationIssue,
    VersionConflictError,
)
from .event_store import EventStore, JsonlEventStore, MemoryEventStore
from .identifiers import assert_safe_identifier, identifier_hash
from .protected_checkpoint import (
    CHECKPOINT_PROJECTION_TYPE,
    CHECKPOINT_V1ALPHA2_API_VERSION,
    CheckpointNodeSpec,
    GuardedFileCheckpointStore,
    ProtectedCheckpointSpec,
    ProtectedCheckpointWriter,
    prepare_protected_checkpoint,
    resolve_protected_checkpoint_value,
)
from .protected_journal import (
    GuardedJsonlEventStore,
    GuardedMemoryEventStore,
    ProtectedEventJournal,
    ProtectedEventStore,
    UnguardedWriteError,
)

__all__ = [
    "CHECKPOINT_API_VERSION",
    "CHECKPOINT_PROJECTION_TYPE",
    "CHECKPOINT_V1ALPHA2_API_VERSION",
    "MAX_SAFE_INTEGER",
    "CheckpointInput",
    "CheckpointNodeSpec",
    "CheckpointProtectionRequiredError",
    "CheckpointStore",
    "CheckpointSummary",
    "CorruptCheckpointError",
    "CorruptEventLogError",
    "EventStore",
    "FileCheckpointStore",
    "GuardedFileCheckpointStore",
    "GuardedJsonlEventStore",
    "GuardedMemoryEventStore",
    "JsonlEventStore",
    "MemoryEventStore",
    "PersistenceError",
    "PersistenceErrorCode",
    "PersistenceIOError",
    "PersistenceValidationError",
    "ProtectedCheckpointSpec",
    "ProtectedCheckpointWriter",
    "ProtectedEventJournal",
    "ProtectedEventStore",
    "StoredCheckpoint",
    "UnguardedWriteError",
    "UnsafeIdentifierError",
    "ValidationIssue",
    "VersionConflictError",
    "assert_safe_identifier",
    "identifier_hash",
    "prepare_protected_checkpoint",
    "resolve_protected_checkpoint_value",
]
