# FINAL audit — Python Cursor Slice B captured-source fence correction

Date: 2026-07-28
Mode: independent read-only implementation audit plus hostile runtime probes
Scope: corrected Python source-summary registry, connection-witness registry,
closed-owner normalization and the 13-test focused suite

## Final disposition

**Accepted: HIGH 0 / MEDIUM 0 / LOW 0** for the declared Python pre-cursor-TEMP
captured-source connection-fence tranche.

The original MEDIUM finding was valid: a frozen token-guarded dataclass was not
an exact module-minted capability because `dataclasses.replace` copied the real
token and all state. The corrected implementation closes that path with exact
witness identity in a module-private `WeakKeyDictionary`. The source summary
uses a separate weak exact-identity registry. Neither structural equality nor
possession of the real construction token is sufficient for acceptance.

This disposition does not claim the future B0 stage-owner/epoch-transfer gate,
cursor TEMP creation, rules 1-10 or Slice B completion.

## Source-summary identity registry

The capture function registers only its final successful exact
`SQLiteV1BaselineSourceSummary`. The registry is `id(summary) -> weakref.ref`
because the frozen summary is not hashable enough to be a weak-key mapping.
The assertion requires all of:

- exact summary runtime type;
- an entry at the presented object's exact `id`; and
- `reference() is summary`.

The cleanup closure captures both the integer identity and its own weak
reference. It removes an entry only when the dictionary still contains that
same reference. Therefore:

- the registry does not retain a summary;
- direct construction, `dataclasses.replace` and `copy.copy` identities have
  no provenance;
- a stale callback cannot remove a later registration at a reused integer ID;
  and
- a live object cannot collide with another live object at the same ID.

The focused weak-lifecycle test confirms final-reference deletion and registry
cleanup. The callback identity guard closes the practical ID-reuse race.

## Connection-witness identity registry

The corrected witness has `eq=False`, frozen slots and a weak-reference slot.
It is keyed by exact identity in `_WITNESSES`, whose frozen metadata retains the
exact connection, receipt, A2b provenance, source summary, clock and capture
epoch. The metadata does not retain the witness key.

Every `_assert_current()` performs these gates in order:

1. non-consuming A2b receipt provenance;
2. exact witness runtime type;
3. exact witness presence in `_WITNESSES`;
4. identity equality for every retained object plus epoch equality; and
5. exact source-summary registry, clock, connection, EXCLUSIVE and double-read
   epoch validation.

Registration is followed by a complete pre-publication `_assert_current()`.
If that proof fails, the new weak entry is removed synchronously. The original
witness remains repeatably valid while all clones remain unregistered.

## Hostile construction and copying matrix

The committed focused tests and an additional read-only probe produced:

| Attempt | Result |
|---|---|
| `dataclasses.replace(witness)` | distinct identity; rejected by witness provenance |
| `copy.copy(witness)` | distinct identity; rejected by witness provenance |
| direct exact-type construction with every real field and copied real token | rejected by witness provenance |
| `copy.deepcopy(witness)` | construction fails closed because the retained SQLite connection is not pickleable |
| pickle round trip | construction fails closed because the retained SQLite connection is not pickleable |
| exact-field subclass with copied real token | rejected by the exact-type gate |
| original witness after all attacks | still accepted |

The independent probe output was:

```text
replace  -> ValueError: witness provenance is invalid
copy     -> ValueError: witness provenance is invalid
deepcopy -> TypeError during construction: sqlite3.Connection is not pickleable
pickle   -> TypeError during construction: sqlite3.Connection is not pickleable
subclass -> TypeError: witness has the wrong type
original -> accepted
```

Deep copy and pickle do not currently reach registry validation, but they fail
closed. If the retained connection representation ever becomes copyable, the
new identity would still lack a `_WITNESSES` entry and fail the same provenance
gate.

## Closed connection behavior and receipt-first ordering

The live connection reads are enclosed in a deterministic private boundary.
Closed/unavailable observations are normalized to exact `ValueError` ownership
vocabulary rather than leaking `sqlite3.ProgrammingError`.

The 13-test suite proves all three relevant paths:

- forged receipt plus closed connection fails at the A2b receipt gate before a
  connection property is read;
- valid receipt plus closed connection reaches the normalized
  `closed or unavailable` `ValueError`; and
- a previously valid retained witness reports the same normalized error.

The monkeypatch trace for initial construction and pre-publication
revalidation is exactly:

```text
receipt -> source -> receipt -> witness -> source
```

Retained `_assert_current()` likewise begins with A2b before consulting its own
registry or the connection. Receipt failure therefore remains authoritative.

## Epoch and change-counter ownership

The live fence requires an exact connection type, exact captured connection,
active EXCLUSIVE transaction and two equal epoch reads matching the source
capture epoch. A hostile between-read epoch value is rejected, as is a real
PRAGMA-driven epoch advance.

The fence intentionally contains no live or historical `total_changes`
comparison. The integrated fixture reaches the real baseline TEMP stage and
all predecessor campaigns, where the stage's allowed count has legitimately
advanced beyond `summary._source_total_changes`. A later no-op TEMP DML still
allows this source-only witness to revalidate. That is the intended nonclaim:
the next B0 gate must immediately pair this proof with the stage's exact
`_allowed_total_changes == connection.total_changes` assertion.

No source witness alone may authorize cursor TEMP creation.

## Verification performed by this audit

- focused corrected suite: **13 passed**;
- scoped Ruff lint: passed;
- scoped Ruff format check: 3 files already formatted;
- strict MyPy: **50 source files, no issues**;
- independent replace/copy/deepcopy/pickle/subclass runtime probe: all clone
  paths rejected; original remained valid;
- source and witness weak-registry/id-reuse logic inspected line by line.

The earlier lane evidence additionally records 224 adjacent tests and the
complete Python suite at 1,762 tests plus 2 subtests. This audit did not rerun
the complete suite because its task was bounded to independent correction
review; it did rerun every corrected focused test and all relevant static
gates.

## Remaining next-gate requirements, not findings in this tranche

B0 must accept only `(connection, stage, receipt, options?)`, derive source and
projection exclusively from A2b provenance, prove the exact completed stage and
its current allowed-change fence, and atomically transfer ownership from the
historical capture epoch to a stage-owned campaign epoch before cursor DDL.
After that transfer, owned DDL may advance only the exact expected epoch; it
must never mutate the captured source evidence.
