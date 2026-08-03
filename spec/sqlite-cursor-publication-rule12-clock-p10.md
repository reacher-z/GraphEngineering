# SQLite cursor publication Rule 12 and pre-verification clock P10

Status: implementation candidate. This contract does not authorize COMMIT,
cursor-clock completion, publication success, a public API, or a release claim.

## Accepted boundary

P10 closes exactly two consecutive package-private transitions:

```text
exact active Rule 11 owner
  -> one bounded main/TEMP seal verification
  -> exact Rule 12 success receipt
  -> one authenticated before-verification clock observation
  -> exact unconsumed third-clock evidence
```

The terminal successful P10 clock accounting is `observed/consumed = 3/2`.
Consuming the third evidence belongs to the later cursor-clock atomic completion
tail. P10 must not manufacture a placeholder consumer or mark any outer,
session, ownership, or stage object `cursor/clock-complete`.

## Rule 12 predecessor and one-way transition

Rule 12 is `BLR_CURSOR_SEAL_MISMATCH`, position 12. Its only predecessor is the
exact live opaque Rule 11 owner minted by the rebind subprotocol. Scalars,
snapshots, structural clones, proxies, cross-run objects, replayed Rule 11
owners, raw lower seal evidence, and caller-provided expected values carry no
authority.

The Rule 11 owner exposes a package-private one-shot transition:

```text
active -> rule12-pending -> rule12-complete
                       \-> poisoned
```

Beginning Rule 12 consumes the right to begin it again. Successful receipt
registration precedes the transition to `rule12-complete`. A failure after the
one-way begin poisons the selected retained publication graph, mints no receipt,
and permanently prevents the third clock observation. Registration failure is
therefore a terminal Rule 12 failure, not a retry point.

## Bounded seal proof

The upper owner reuses the connection-owned lower post-rebind seal read. The
caller cannot provide SQL, decoded rows, counts, hashes, expected identities,
or a database callback. The lower read remains responsible for the fixed main
key scan, TEMP key driver, reusable point lookup, 18-column decoder, binary
ordering, and O(1)-memory accumulator.

For cursor count `N`, success proves all of the following at once:

1. main, driver, lookup, accumulator, point execute, point-created, and
   point-closed counts all equal the retained B2 cursor count `N`;
2. main count prepare/terminal-fetch/close is `1/1/1`, driver
   prepare/terminal-fetch/close is `1/1/1`, and point
   prepare/execute/release is `1/N/1`;
3. current active cursors, live physical rows, and decoded carriers are all
   zero; maximum active cursors is at most two and maximum live rows/carriers
   is at most one each;
4. each point cursor is closed before cancellation is observed and before the
   next TEMP driver row is fetched;
5. the computed immutable root equals the retained B2 root;
6. for `N > 0`, every row's observed descriptor and schema identities equal
   the retained target identities; for `N = 0`, both observed identities are
   absent and the computed root equals the canonical empty root;
7. the fixed SQL texts and SHA-256 identities are the frozen post-rebind
   main-count, TEMP-driver, and point-lookup statements;
8. transaction lineage, transaction epoch, and total changes equal the Rule 11
   retained watermarks before and after all seal I/O; and
9. violation count is zero and diagnostics truncation is false.

Missing, extra, duplicate, or reordered keys; zero or multiple point rows;
count, root, descriptor, schema, blob, or immutable-field drift; resource
budget escape; SQL identity drift; cancellation; native failure; close/release
failure; replay; or registration failure poisons the selected graph and mints
no Rule 12 receipt. One aggregate seal mismatch is sufficient; the runtime
must not emit one unbounded diagnostic per row.

The opaque Rule 12 receipt retains the exact Rule 11 predecessor, its exact
rebind write receipt and publication session graph, the lower read execution,
all accepted scalar proof fields, and the selected connection/transaction
lineage. A snapshot may expose immutable scalar evidence and opaque predecessor
identities, but never raw SQLite rows, native cursors/statements, decoded
carriers, filesystem paths, or mutable buffers.

## Authenticated third clock

Only the exact live Rule 12 receipt may request the
`before-verification`/`cursor-clock-capability` observation. The wrapper reuses
the existing provider-clock capability and must prove before observation that:

- the clock head is exactly two and its exact predecessor is the session's
  retained `before-cursor-rebind` evidence;
- the exact provider-clock capability, migration-lock capability, connection,
  publication session, Rule 11 owner, and Rule 12 receipt are retained by one
  selected graph;
- the connection is still in the same exclusive transaction lineage and all
  post-rebind watermarks remain unchanged; and
- Rule 12 is complete and has not previously authorized a clock read.

The generic clock primitive then performs its existing live-lock-before,
provider-callback, and live-lock-after proof. The resulting time must be a
nonnegative safe integer, monotonically nondecreasing from the second
observation, and strictly earlier than the exact live lock expiry. The new
evidence must have the exact boundary, consumer, predecessor, connection,
transaction lineage, and capability identities.

Successful registration of the retained third-clock graph is one-way and
precedes publishing the P10 result. The evidence remains unconsumed. Any
provider throw, unsafe time, clock regression, expiry, lock drift, lineage
drift, predecessor substitution, registration failure, reentrancy, replay, or
fourth observation attempt poisons the selected P10 graph. A failure must not
expose a partially registered result or a cursor-clock capability.

## Runtime and parity evidence

TypeScript and Python implement this contract independently with package-private
opaque identities and exact-object registries. Acceptance requires:

- real SQLite cases for `N = 0`, `N = 1`, and `N = 3`;
- Rule 12 count/root/identity/resource and lifecycle failures;
- clone, proxy where applicable, cross-run, replay, and registration failures;
- cancellation between point close and the next driver fetch;
- provider throw, unsafe integer, regression, expiry, lock/lineage drift, and
  wrong-predecessor failures;
- primary-versus-cleanup precedence, registry cleanup, forced-GC probes, and
  package-root privacy checks;
- exact normalized cross-runtime reports for the successful cases and a closed
  representative failure set; and
- focused gates plus affected session, rebind, seal, clock, transaction-owner,
  type/lint/static, and full SQLite regressions.

Portable claims may become true only after both native reporters execute the
same real cases. Runtime-local exception text, interpreter/driver details, and
GC timing are excluded from portable equality but remain required native
evidence.

## Strict nonclaims

P10 does not consume the third evidence, mint or activate cursor-clock
capability, publish `cursor/clock-complete`, publish lineage/metadata/rules,
prove fresh-v2 or physical/semantic final state, adopt a pre-retirement fence,
retire the cursor TEMP stage, observe the fourth clock, mint the final
migration-lock transaction fence, select success, execute COMMIT, classify
complete-v2 after reopen, export a public package API, activate a release
manifest, complete the 21-day master plan, or guarantee GitHub stars.
