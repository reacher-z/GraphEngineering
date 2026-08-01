# Python cursor B3 initial-publication foundations — 2026-08-01

## Outcome

This checkpoint adds and independently validates the three package-private
Python foundations required before the Python outer publication/adoption
authority can be implemented:

1. the portable initial-write parameter/result digest codec;
2. the immutable migration-0002 installed-resource proof; and
3. the exact v2 target physical-catalog observation and validation proof.

This checkpoint is intentionally narrower than §31.37.38. It does **not**
claim that Python initial publication or atomic adoption is complete.

## Production files

- `python/src/graph_engineering/sqlite_cursor_publication_initial_write_digest.py`
- `python/src/graph_engineering/sqlite_cursor_publication_migration_0002_asset.py`
- `python/src/graph_engineering/sqlite_cursor_publication_target_catalog.py`

All three modules remain package-private. No symbol was added to
`graph_engineering.__init__` or its `__all__` list.

## Test and release-harness files

- `python/tests/test_sqlite_cursor_publication_initial_write_digest.py`
- `python/tests/test_sqlite_cursor_publication_migration_0002_asset.py`
- `python/tests/test_sqlite_cursor_publication_target_catalog.py`
- `scripts/check-python-artifacts.py`

The artifact checker now locks all three module paths into both the wheel and
sdist inventories. Its isolated-install smoke executes all seven digest goldens,
rereads and verifies the installed 0002 SQL and preview manifest, executes the
20 verified statements against an installed v1 SQLite schema, and proves the
resulting 34-row v2 physical-catalog digest and descriptor. It separately rejects
root-package API leakage.

## Contract evidence

### Initial-write digest

- exact NUL-terminated parameter and result domains;
- exact tagged `null`, `text`, `integer`, and `blob` shapes;
- signed int64 bounds and canonical decimal spelling;
- strict Unicode-scalar rejection;
- code-point object-key ordering;
- canonical unpadded base64url;
- preservation of the two-dimensional execution frame and parameter order;
- all seven frozen cross-runtime fixture vectors; and
- caller-container snapshotting before encoding.

### Migration 0002 asset

- installed regular resource is reread for every logical load;
- `lstat`, `O_NOFOLLOW` where available, open/fstat device+inode comparison,
  bounded reading, exact byte length and SHA-256 checks;
- exact 9,523-byte SQL and 4,908-byte preview-manifest commitments;
- strict UTF-8/LF framing and duplicate-key-rejecting manifest JSON;
- quote/comment-aware framing of exactly 20 statements;
- opaque weak-identity proof registries with exact type and object identity;
- exact schema/migration/manifest cross-commitments; and
- no SQLite execution, transaction ownership, or `executescript()` in the
  asset-proof module.

### Target catalog

- exact frozen query and query digest;
- strict Unicode scalar validation for all four catalog text fields;
- bounded `fetchmany(35)` observation;
- exactly 34 ordered rows and 5,785 canonical UTF-8 bytes;
- complete inventory, catalog SHA-256, application ID, user version, and target
  descriptor proof;
- primary read failures dominate cleanup failures while sole cleanup failures
  remain observable; and
- validation performs no commit, rollback, rebind, DDL, or transaction takeover.

## Adversarial findings and dispositions

- **M1, fixed:** caller-owned nested containers could otherwise change between
  validation and encoding. Exact list/dict snapshots and alias-detachment tests
  now close that boundary.
- **M1, fixed:** equality/hash-based weak registries could accept hostile
  substitutable objects. The migration proof now uses `id` plus weakref and
  exact identity, with guarded cleanup for ID reuse.
- **M1, fixed:** catalog Unicode failures could leak raw encoder errors. Every
  text position now receives an explicit Unicode-scalar gate and stable code.
- **M2, fixed:** catalog read/close failure precedence and cleanup reporting were
  incomplete. The shared read-then-close primitive now preserves the primary
  failure and reports sole cleanup failure deterministically.
- **M2, fixed:** wheel/sdist checks did not require or execute the new modules.
  Archive inventory, isolated imports, installed resources, all digest goldens,
  real migration execution, catalog validation, and negative root exports now
  run for both artifact kinds.
- **H1, fixed:** the general artifact checker accepted Windows-drive,
  backslash/UNC and normalized-alias archive paths and did not reject every
  special member type before installation. It now has executable hostile-path
  self-tests, cross-platform path checks, wheel symlink rejection and an
  sdist regular-file/directory allowlist.
- **M1, fixed:** a caller could use `object.__setattr__` on a returned migration
  snapshot and persistently alter the registry's execution plan. The registry
  now retains an unexposed canonical record and reconstructs every snapshot;
  hostile changes to names, hashes, statements and manifest identity do not
  survive a second read.
- **M2, fixed:** migration-resource FD cleanup could leak an `OSError` or replace
  the primary validation error. Sole cleanup failure now maps to the stable
  boundary error, while a primary validation/read failure wins a double fault.
- **M3, fixed:** a frozen dataclass target descriptor remained susceptible to
  `object.__setattr__` and could poison every later snapshot. The descriptor is
  now tuple-backed, resists both normal and hostile mutation, and retains exact
  shared identity across real SQLite validation.

## Final-byte verification

- focused pytest: **57 passed**;
- Ruff check: **passed** for all seven changed Python files;
- Ruff format check: **7 files already formatted**;
- strict mypy: **passed** for all three production modules;
- `scripts/check-python-artifacts.py`: **passed** for wheel and sdist, with 114
  wheel entries and 115 sdist entries;
- installed-artifact smoke: both artifact kinds passed all seven digest goldens,
  installed migration proof, real v1→v2 execution, target-catalog proof, shared
  YAML authoring, `validate`, and `doctor`;
- `scripts/check-sqlite-python-artifacts.py`: **passed**, including exact release,
  preview, and support assets plus two installed-provider checks; and
- `git diff --check`: **passed**;
- independent final-byte adversarial audit: **H0 / M0 / L0**, with all earlier
  H1/M1/M2/M3 findings confirmed closed and no repair regression found.

An earlier complete-Python-suite attempt reached **2,780 passed with no failures
at 79%**, then was deliberately interrupted during the slow B2 hostile section
after 1,354.66 seconds. Its exit status was 130. It is partial baseline evidence,
not a completed-suite pass and not final-byte acceptance evidence.

## Bounded residual risks

- Cross-runtime execution-count, text/blob-size, and `affectedRows` resource
  ceilings are not yet frozen by the TypeScript protocol. This leaf does not
  invent Python-only limits; the shared contract must define them first.
- On platforms without `O_NOFOLLOW`, same-inode symlink replacement remains a
  theoretical race, although exact size and content hashes still dominate the
  accepted bytes.
- The fixed SQL scanner is intentionally bound to the current hashed asset. A
  future migration containing `CREATE TRIGGER` bodies with internal semicolons
  would require a new framing contract and scanner version.

## Explicit non-claims and next dependency

This checkpoint does not implement the Python outer authority, post-DDL reader,
entries/header/sequence receipts, four receipt tombstones, stage/ownership tail
bridges, cancellation, poison propagation, or atomic adoption. It also does not
provide the TypeScript/Python 28-field parity report, complete 145-case runner,
publication session, cursor rebind, rules 11/12, final semantic audits, TEMP
retirement, commit, or active-v2 manifest publication.

The next implementation dependency is the package-private Python stage/ownership
bridge followed by the outer authority that composes these three proven
foundations under one caller-owned EXCLUSIVE transaction.
