# SQLite B3 portable initial-write digest codec closure — 2026-07-29

## Outcome

The package-private TypeScript portable initial-write digest codec is complete
for its pure, no-SQL leaf. It implements the exact structured carrier used by
future four-write receipts without executing migration `0002`, opening a
connection, writing permanent state, rebinding a cursor or controlling a
transaction.

The implementation lives in
`packages/sqlite/src/cursor-publication-initial-write-digest.ts`; its hostile
and known-answer oracle lives in
`packages/sqlite/test/cursor-publication-initial-write-digest.test.ts`. Neither
module is exported from the SQLite package root.

## Frozen codec behavior

- Parameter domain: `graph-engineering/sqlite-initial-write-parameters/v1\0`.
- Result domain: `graph-engineering/sqlite-initial-write-result/v1\0`.
- Digest: lowercase SHA-256 of the domain UTF-8 bytes immediately followed by
  canonical JSON UTF-8 bytes, with no added delimiter or length prefix.
- Parameters retain both dimensions: outer logical-execution order and inner
  parameter order. `[]` and `[[]]` are distinct.
- Scalar carriers are exact objects for text, canonical signed-int64 decimal,
  canonical unpadded RFC 4648 section 5 base64url BLOB, or null.
- Text preserves Unicode scalar values without normalization and rejects lone
  surrogates.
- Results are exact `{affectedRows: string}` objects using an unbounded
  canonical nonnegative decimal aggregate. Driver result arrays and
  `lastInsertRowid` are not accepted.
- The production API accepts structured values only. Raw JSON/UTF-8 decoding,
  duplicate-key detection and corrupt-byte rejection remain fixture/parser
  responsibilities rather than a hidden second codec surface.
- Empty BLOB is accepted as the canonical encoding of zero bytes. Padding,
  standard base64 alphabet, impossible length and non-zero pad-bit aliases are
  rejected by decode/re-encode equality.

## Security and determinism closure

Inputs are inspected through captured descriptor and prototype intrinsics.
Only ordinary dense arrays and plain/null-prototype exact objects are accepted.
Proxies, revoked proxies, accessors, inherited carriers, sparse arrays,
symbols, non-enumerable extras, extra properties and unsupported scalar types
fail with structured `GE_CYCLE_STORE_INVALID_ARGUMENT` errors without invoking
caller traps or getters.

The final implementation uses a fixed-shape local serializer. It does not
delegate these protocol carriers to ambient driver/debug serialization or a
generic mutable canonicalizer. The relevant JSON stringifier, character scan,
Buffer conversion, Reflect application and Hash update/digest methods are
captured at module initialization. Explicit loops replace ambient array
methods. A hostile test replaces `Object.keys`, array map/sort/some,
`RegExp.prototype.test`, `Object.freeze`, global `BigInt` and `Buffer.from`
after import; all seven known-answer vectors remain exact.

Signed-int64 rejection uses canonical lexical validation, magnitude length and
lexicographic comparison. It never constructs a caller-sized BigInt. A
100,000-digit hostile integer is rejected immediately after the length bound.
Affected rows intentionally remain an unbounded lexical decimal because the
frozen result contract specifies no numeric upper bound.

## Verification on final bytes

- Frozen known-answer vectors: 7/7 exact canonical bytes and digests.
- Codec focused suite: 13/13 passed.
- B3 fixture/conformance suite: 34/34 passed.
- Complete SQLite package suite: 25 files, 872/872 tests passed.
- Workspace typecheck: passed across all eight implementation packages.
- Workspace lint: passed across all eight implementation packages.
- `git diff --check`: passed.
- Independent final production/test audit: HIGH 0 / MEDIUM 0 / LOW 0.

## Contract maintenance note

The conformance validator still contains a dead historical one-dimensional
codec constant that is not referenced by the live schema/trusted validation
path. The current case, schema, seven-vector gate and append-only plan are
authoritative and two-dimensional. Removing or updating that dead constant is
a separate fixture-guardian maintenance change; it is not mixed into this
production leaf.

## Nonclaims and next boundary

This codec does not mint a write receipt or authorize any write. It does not
implement the post-DDL catalog fence, reader lease/terminal proof, outer write
ledger, stage adoption, rebind, rules 11/12, TEMP retirement or commit. The next
production leaf remains the TypeScript post-DDL fence and reader terminal proof
defined by the append-only master plan.
