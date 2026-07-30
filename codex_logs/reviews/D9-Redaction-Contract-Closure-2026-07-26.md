# D9 redaction machine-contract closure handoff

- Date: `2026-07-26`
- Author lane: `/root/d9_redaction_contract_closure`
- Task: `D9-REDACTION-039`
- Risk: critical / R3
- Working branch observed at final validation: `feat/authoring-foundation`
- Working-tree HEAD observed at final validation:
  `f57dab96d2f970e6a1c90231a3f2a1f3d4f5e58d`
- Status: **AUTHOR HANDOFF — independent R3 contract review required**
- Acceptance statement: **not accepted, not release evidence, and not a claim
  that D9 or the master plan is complete**

## 1. Honest boundary

This handoff closes the eight previously reported blockers at the written and
machine-contract level. It does not change the current TypeScript or Python
runtime, both of which still persist raw v1alpha1 payloads while asserting
`redacted: true`. It does not execute installed-package sink-byte scans, supply
cryptographic fixed vectors, integrate the corpus into the shared repository
validator, or provide an independent security disposition.

Therefore `D9-REDACTION-039` remains `in_progress` pending independent review.
`D9-TS-REDACTION-087`, `D9-PY-REDACTION-088`, and
`D9-REDACTION-CONFORMANCE-089` remain `planned`/Open. No registry, release map,
release checklist, shared validator, runtime, package, or CI file was edited by
this lane.

The author read the complete 368-line canonical master plan and the complete
577-line
`codex_logs/reviews/MASTER-PLAN-EXHAUSTIVE-GAP-AUDIT-2026-07-26.md`, in
addition to the D9 registry entry, dependency DAG, ownership map,
implementation brief, prior D9 audit, persistence/recovery schemas and
semantics, both native persistence/runtime implementations, and the security
architecture. This handoff follows the exhaustive audit's evidence boundary:
working-tree schema/corpus presence is not runtime or release acceptance.

## 2. Contract artifact manifest

Hashes are SHA-256 of the exact author-handoff bytes. Integration must
recompute them after any review edit and bind the accepted set to one immutable
commit.

| Artifact | SHA-256 |
| --- | --- |
| `spec/redaction-semantics.md` | `2a5cc0528c1bd3999d5bb67e229a4b4f9c6dd59972ebef6f4ed1f282176fddf7` |
| `spec/capture-source.schema.json` | `33c224a8e2e5ae01c2982f56336bcacb3767fb8c65fbe0effd9c4f2bea263504` |
| `spec/capture-sink.schema.json` | `40c269c072711f4de8497cb0b25ba43a84579c2c3b059bf2d5beb306622e77b3` |
| `spec/redaction-rule.schema.json` | `18e5646dece9b359b907bb540e85febf3bf71783a93ee291df1a1b4a43cef821` |
| `spec/redaction-receipt.schema.json` | `e4e0ee2bf6426dc7d195337e1471e1eae39d240658377626d940de8419ea6d33` |
| `spec/capture-policy.schema.json` | `efe0f5d9b5ca00fcfe52258fe1eab247d9bbb6d0a9860954ee020fc6586c2e7f` |
| `spec/protected-value.schema.json` | `1bb2adbab65beab0c1ba64db590963ca942fe68a0f23be9fdf09c614e2537453` |
| `spec/protected-blob.schema.json` | `5dc764b76e12a77921dfce737b789ec2c27289514f67adff4bee1b2cea11fa78` |
| `spec/protected-aad.schema.json` | `651f8c3e7e2f1d99bacbec60cf4baedf777d0197af452f1bf49ee1f51d6ddf3a` |
| `spec/payload-disposition.schema.json` | `0986f97368e5745e0ed57428051fcedf1e0aa8469a21a351ca90fe6fd19195ab` |
| `spec/sink-guard-decision.schema.json` | `f4da05e432c67e38a1bed614d2873821d8f2a71a00dbeaafd826c33b448b106f` |
| `spec/protected-store-envelope.schema.json` | `16062f1125695223f7d58e51988b96e56402d76ccad1749bfffa017e44962787` |
| `spec/event-v1alpha2.schema.json` | `16fcf1107c25c1fda3d4f206614a51a8130b03b8795d264094484a40a658ede1` |
| `spec/checkpoint-v1alpha2.schema.json` | `f2bdc1a343e1cba29cc7f484b1854a677845b16510fbdee996d348dd67264971` |
| `spec/redaction-conformance.schema.json` | `b7cb28376e19f208632f697da5245a6423a7ce46b0f0589474c0a1f1f620b082` |
| `spec/conformance/redaction.case.json` | `baca1cba640cd85aa63866367341a8012956708fe016304de8a6af7f3d82427d` |

The machine set contains 14 strict schemas plus one corpus. The corpus contains
109 uniquely named cases: 20 wire, 16 RFC 6901 transform, 15 guard/failure, 6
store-bypass, 10 derivative/replay/fork, 35 source-classification, and 7
legacy-history cases. Its inventory is exactly 34 sinks and 35 source classes.

## 3. Eight original blocker dispositions

| # | Prior blocker | Contract-level disposition | Machine evidence | Native/security evidence still required |
| ---: | --- | --- | --- | --- |
| 1 | No total pre-sink transform | Closed in contract: every classified source/sink returns suppression, a structured failure, or an opaque single-use `PreparedSinkWrite`; partial/null/throwing results cannot write | `sink-guard-decision.schema.json`; pointer and guard cases | 087/088 must make every default adapter accept only the opaque host capability; 089 must attempt forged/partial paths |
| 2 | Sink inventory incomplete | Closed enum of all 34 memory, buffer, temporary, final, queue, diagnostic, protocol, export, support, migration, and evidence sinks; exact policy intersection is normative | `capture-sink.schema.json`; 34-entry fixture equality check | 087/088 must inventory actual call sites and 089 must scan actual bytes from every reachable sink |
| 3 | RFC 6901/key/index/missing/collision behavior ambiguous | Exact canonical escape, object-key, array-index, order, overlap, root/remove, immutable-snapshot, normalized-key collision, and deepest-first rules frozen | `redaction-rule.schema.json`, `redaction-receipt.schema.json`; 16 hostile pointer cases executed by an independent ephemeral reference transform | Native implementations and cross-language output/error parity |
| 4 | Store/default-adapter bypass authority undefined | Closed store envelope never accepts plaintext; serialized decisions/envelopes/hashes are not authority; default sinks require unforgeable host capability; unsafe APIs cannot schedule/release/prove conformance | `protected-store-envelope.schema.json`; 6 bypass cases | Native API/capability construction, hostile direct memory/file/network/store calls, package API review |
| 5 | Derivative/replay/fork inheritance incomplete | Every derivative is reclassified/re-guarded; checkpoint and terminal records use new occurrences; replay/fork use new run/policy/key/identity/AAD; redacted observations never become authority | 10 derivative cases | Durable native recovery/replay work and later approval/reconciliation; 089 parity |
| 6 | Secret-bearing metadata/error/tool/provider coverage incomplete | Closed 35-class source inventory; prompt/model/provider/tool/error/stack/path/environment/config/metadata/UI/support/migration values default off, closed metadata, or protected as specified | `capture-source.schema.json`; exactly one classification case per class | Actual provider/tool/CLI/MCP/Explorer/support adapters, privacy policy, package byte scans |
| 7 | Executor success then output protection failure could lie/retry unsafely | Success is not durable until protected success batch commit; no false `NodeAttemptFailed`/success/edge/terminal write; open `NodeStarted` is conservative evidence; pure work gets only a new bounded attempt, effectful work is in doubt | Guard cases for pure, idempotent, non-idempotent, safe orphan, sink failure, terminal projection failure | Native crash/fault injection at every phase; reconciliation/approval and race evidence |
| 8 | No security dependency join | Normative DAG is 039 -> independent 087/088 -> 089; durable extension 031 requires 089 plus approval 077 | Corpus dependency join matches the live registry exactly | Independent 089 canary/security acceptance and downstream release joins remain Open |

“Closed” in this table means the prior ambiguity has an implementable,
testable contract answer. It does not mean the answer has been implemented or
accepted.

## 4. Master-plan and release-control mapping

| Requirement | What this handoff provides | What remains Open |
| --- | --- | --- |
| Day 9 durable execution | Truthful v1alpha1 hotfix requirements; closed v1alpha2 event/checkpoint/protected-value wire; recovery, failure, replay/fork identity and legacy migration contract | Current native writers remain unsafe; 087/088/089, approval 077, extended durability 031-034, production stores, leases, races, replay/fork runtime |
| Day 16 security preflight | A reviewable threat boundary, complete source/sink classes, fail-closed guard authority, stable sensitive-safe errors, and required R3 join | 089, `D16-PRIVACY-079`, `D16-SECURITY-062`, isolation/red-team, fuzz, secret/license/SBOM/package scans, zero unaccepted high/critical findings |
| `I06` / `REL-I06` | Default policy has telemetry/log/trace metadata-only and prompt/response/tool/support capture off; enabled observation requires policy plus guarded redaction/protection | Clean-installed runtime/package proof, trace/provider/support implementations, data-owner privacy/retention/withdrawal approval, and independent review. `REL-I06` remains Open |
| `T26` / `REL-T26` | Truth table, total sink-before-write contract, complete source/sink matrices, legacy behavior, canary requirements, and hostile corpus | Positive/negative seeded-secret scans over journal, checkpoint, artifact, stdout/stderr, log, trace, error, CLI/MCP/Explorer/network/support/migration/package bytes in both languages. `REL-T26` remains Open |

The D9 slice also feeds but does not close `REL-V1-02`, `REL-Q08`, `REL-SC07`,
`REL-SC12`, `REL-SC13`, or `REL-SUP06`. Release/provenance/external authority
cannot be inferred from a contract file.

## 5. `D9-REDACTION-039` expected-test mapping

| Registry expected test | Contract/corpus evidence | Result at author handoff |
| --- | --- | --- |
| Canonical wire flag truth table | v1alpha1 truth hotfix; v1alpha2 disposition schema; closed event/checkpoint schemas; 20 valid/invalid wire cases including protected-not-redacted, receipt requirements, inline rejection, and zero trace identity rejection | Contract shape passes; native v1alpha1 hotfix remains unimplemented |
| Sink-before-write transform and policy contract | Complete capture policy/source/sink schemas; exact RFC 6901 semantics; total guard and opaque capability boundary; 16 pointer, 15 guard, 6 bypass, and 35 classification cases | Contract/reference checks pass; native sink call-site and byte evidence Open |
| Replay identity and authority invariants | Keyed semantic MAC, occurrence AAD, ref/store authority, derivative inheritance table, 10 replay/fork/checkpoint/terminal/export/support cases | Contract cases pass; replay/fork runtime and approval/reconciliation Open |
| Legacy misleading-history migration contract | Detection precedence, reject-before-executor, quarantine, sealed archive, new-run prohibition/authority rules, 7 legacy cases | Contract cases pass; native migration tools/package evidence Open |

## 6. Validation transcript

Validation used Node Ajv `8.20.0`, Python `3.14.4`, and Python jsonschema
`4.19.2` against the exact hashes in Section 2.

1. Duplicate-key parsing plus `Draft202012Validator.check_schema`:

   ```text
   python meta-schema + duplicate-key OK: schemas=14 fixture=1
   ```

2. Ajv 2020 strict compilation, corpus validation, and every wire case checked
   against its referenced schema:

   ```text
   ajv strict + corpus OK: schemas=14 wire=20
   ```

3. Hostile semantic audit checked exact schema/corpus inventory equality,
   globally unique IDs, all denial/no-write expectations, post-executor retry
   classifications, replay/fork new-occurrence behavior, live-registry
   dependency edges, and all pointer expected values/errors:

   ```text
   semantic hostile OK: sinks=34 sources=35 ids=109 pointer=16 guard=15 bypass=6 derivative=10 dependencyJoin=exact
   ```

4. Schema object-closure audit found only deliberate compositional overlays:
   event `allOf` identity/type branches and the non-instantiated protected-store
   property dictionary. Every instantiable payload object is closed by its
   base/root or leaf schema.

5. Repository-local Markdown links and D9 file hygiene:

   ```text
   Checked 229 local Markdown links.
   file hygiene OK: files=17
   git diff --check: passed
   ```

These checks validate structure and the fixture's executable reference rules.
They do not exercise native runtimes, provider crypto, actual files/network,
installed packages, or candidate-bound canary bytes.

## 7. Required independent R3 review

The independent reviewer should reject this handoff if any of the following is
not demonstrably answered:

1. Can any default adapter write without an unforgeable prepared capability?
2. Does every source and sink have one unambiguous policy intersection?
3. Can an RFC 6901 ambiguity produce cross-language output or path divergence?
4. Can a ref/blob/AAD/MAC be copied to a different occurrence and authenticate?
5. Can a serialized receipt, guard decision, envelope, or ref manufacture
   authority?
6. Can output protection failure append a false executor failure/success or
   automatically repeat an effect?
7. Can a redacted derivative enter scheduling, replay, fork, or approval?
8. Can v1alpha1 misleading history reach `RunResumed` or an executor?
9. Are exact base64url decoded lengths/pad bits, adjacent MAC equality,
   checkpoint state relations, policy/rule ordering, and all normalized-key
   collisions covered by semantic validation rather than assumed from schema?
10. Is the review disposition bound to the final immutable artifact hashes and
    free of open P0/P1 contract findings?

## 8. Explicitly Open downstream work

| Task/control | State after this handoff | Required evidence |
| --- | --- | --- |
| `D9-TS-REDACTION-087` | Open/planned | TypeScript guard, protected store/key provider, truthful writer/recovery, every sink call site, fault/bypass tests |
| `D9-PY-REDACTION-088` | Open/planned | Independent native Python implementation and the same tests |
| `D9-REDACTION-CONFORMANCE-089` | Open/planned | Cross-language wire/migration/identity/failure parity, fixed crypto vectors, packaged positive/negative canary scans, independent signed security disposition |
| `D9-APPROVAL-077` | Open/planned | Authority/revision/expiry/revoke/idempotency and in-doubt-effect reconciliation |
| `D9-DURABLE-EXT-SPEC-031` and 032-034 | Open/planned; blocked | May proceed only after accepted 089 plus 077 as encoded in registry/DAG |
| `D16-PRIVACY-079` | Open/planned/external in part | Default-off clean-install capture, retention, withdrawal, consent and human data-owner authority |
| `D16-SECURITY-062` | Open/planned | Full runtime/package threat, fuzz, secret, dependency, license, SBOM, isolation and zero-blocker evidence |
| `D18-SUPPORT-READINESS-080` | Open/planned/external in part | Real support sink, redaction, incident/tabletop, roster and authority evidence |
| `D20-PROVENANCE-066` | Open/planned/external in part | Trusted publication identities, SBOM/checksums/attestations and final package scans |
| Stable v1 / complete RC / 6,000 stars | Not established | All 175 mandatory release leaves, external acceptance, provenance, support and organic adoption remain outside this contract handoff |

No schema, fixture count, local test result, task status, tag, or star objective
may substitute for those native, byte-level, external, or candidate-bound
gates.

## 9. Integration handoff

The root/integration owner should:

1. isolate the D9 files from unrelated D7/shared working-tree changes;
2. obtain the independent R3 contract review and resolve every P0/P1;
3. recompute the artifact manifest after review;
4. integrate schema/corpus discovery into the shared validator without
   weakening its fail-closed behavior;
5. commit the reviewed D9 set with one immutable manifest, then run clean-tree
   schema/docs/diff gates;
6. dispatch independent 087 and 088 lanes only from those frozen bytes;
7. keep 089 owned by integration/QA/security, not either native implementer;
8. leave I06, T26, Day 16, privacy, security, support, provenance, RC, release,
   and growth outcomes Open until their own evidence exists.

This author lane intentionally did not commit, push, modify shared status, or
claim acceptance.
