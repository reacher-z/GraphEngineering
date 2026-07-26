# D2 authoring/canonical independent hostile review

- Review duty: independent D2 builder, source, typed-port, identity, and
  canonical-number audit
- Reviewed at: `2026-07-26T21:17:19Z`
- Base revision: `582b78ba9c0db9eab698b18c9cebf12bf547627a`
- Decision: **accepted for commit and integration**
- Completion boundary: **not candidate-complete yet**; immutable commit SHA,
  candidate evidence, and registry binding must be added after the commit

## Scope and method

The reviewer audited the D2 definition of done against the frozen authoring
contract, both language implementations, the CLI source path, shared fixtures,
package smokes, and the cross-language join. The audit deliberately attacked
numeric boundaries, parser disagreement, hostile host objects, mutation,
resource ceilings, component identity, and packaging rather than relying only
on the authors' green summary.

The final reviewed surface includes:

- inference-free TypeScript and Python general builders;
- strict JSON and the bounded safe-YAML profile;
- opt-in strict-exact typed ports and `GE1201` through `GE1208`;
- domain-separated node, edge, schema, and revision-1 identity;
- ECMAScript finite-binary64 rendering for accepted Graph IR values;
- JSON, YAML, TypeScript builder, and Python builder convergence; and
- actual npm tarball plus Python wheel/sdist installation.

GraphPatch/revision 2+, stream/artifact execution, general schema
assignability, runtime value validation, state reducers, and subgraph execution
remain explicit non-goals of D2.

## Findings and disposition

### P0-01 — fractional graph hashes diverged between TypeScript and Python — closed

The original Python canonical encoder emitted tokens such as `1e-06`, while
ECMAScript emitted `0.000001`, producing different whole-graph and component
hashes. The final contract adopts only RFC 8785 section 3.2.2.3 / ECMA-262
number rendering; project key order remains Unicode-code-point order and does
not claim full JCS.

The final implementation passed:

- all 24 committed RFC formatter vectors;
- 13 values accepted by the public portable boundary;
- 15 non-finite or unsafe-integer-valued public rejections;
- 10,000 deterministic SplitMix64 finite-bit patterns in the shared join;
- an additional independent 100,000 random finite-bit differential against
  Node `JSON.stringify` with zero drift; and
- exact JSON/YAML/compiler/builder graph bytes, graph hash, node content hash,
  component identity, and revision hash against committed golden values.

### P0-02 — Python public canonicalization was wider and more dispatchable — closed

Raw Python canonicalization previously accepted host values which TypeScript
rejects, including unsafe integers, tuples, and subclasses. An intermediate
fix still invoked virtual `BaseModel.model_dump`, allowing hostile caller code
to execute before capture.

The final boundary captures only exact portable built-ins and projects an
exact `GraphSpec` from sealed Pydantic storage. Tests prove that hostile
BaseModel methods and a tampered nested mapping receive zero calls and that no
secret marker appears in the error. `canonical_json` and `canonical_sha256`
now reject the same nonportable numeric and host-value classes as the public
TypeScript boundary.

### P0-03 — tightening canonicalization initially broke event persistence — closed

Restricting public model handling initially made `canonical_json(GraphEvent)`
fail in the JSONL event store. The final persistence paths explicitly project
exact owned `GraphEvent` and `StoredCheckpoint` instances without virtual
dispatch. Event/checkpoint, durable recovery, and bidirectional terminal
history conformance are green after the correction.

### P1-01 — Python exact rendering cost and repeated whole-graph work — closed

Exact rational rendering is materially slower than CPython's C JSON encoder.
The accepted ADR records that tradeoff and its bounded 17-digit search.
Compiler hashing now reuses one canonical string, builders reuse the compiler
artifact, and identity construction rehydrates the trusted compiler bytes
instead of repeatedly rendering the whole graph. The end-to-end 1,000-node
fractional builder/compiler/component-identity test is capped at five seconds;
the independent focused run completed with the hostile tests in 1.53 seconds.

### P1-02 — source resource and parser-profile disagreements — closed

The final negative corpus covers 77 source failures, including duplicate keys,
directives after explicit empty documents, multiple-document precedence,
comment separation, flow-colon ambiguity, quoted continuation indentation,
invalid controls, exact byte/depth/node ceilings, and JSON resource failures.
Wide YAML checks are linear and retain an internal 10,000-item performance
assertion. The test itself has explicit CI-contention headroom rather than
depending on Vitest's five-second default.

### P2-01 — same-worktree pack/build commands share mutable `dist/` — open, non-blocking

Running CLI tests or package-content checks concurrently with another
`prepack`/workspace build can remove `packages/cli/dist` between discovery and
execution. This audit observed that operational race twice while another agent
was rebuilding the same shared directory. Both gates passed when isolated
(`147/147` CLI and all seven package tarballs), so this is not a shipped package
defect. Future multi-agent automation should serialize build/pack operations
for the same package or use isolated staging worktrees.

### P2-02 — two internal Python portable-capture helpers remain — open, non-blocking

Public identity/canonical paths use `portable_json_snapshot`, while the
low-level compact JSON helper maintains a second exact-built-in capture for
internal envelopes. Current hostile and conformance tests show no behavioral
drift. A later refactor may consolidate them, but it must preserve the frozen
error and number behavior and is not required for this D2 commit.

## Independent verification evidence

Commands were executed from `/home/nick/work/GraphEngineering` after author
writes quiesced. Final observed results:

```text
uv run --project python pytest -q
  1012 passed, 2 subtests passed

uv run --project python mypy --config-file python/pyproject.toml python/src
  Success: no issues found in 28 source files

uv run --project python ruff check python/src/graph_engineering python/tests tools/conformance/python_authoring_report.py
  All checks passed

corepack pnpm --filter @graph-engineering/core test
  166 passed

corepack pnpm --filter @graph-engineering/cli test
  147 passed

corepack pnpm test:conformance
  14 graph fixtures
  canonical numbers: 24 formatter / 13 accepted / 15 rejected / 10,000 seeded
  persistence, durable recovery, terminal interop, and pipeline green
  authoring: 2 equivalence / 6 valid / 21 builder / 77 source / 13 typed / 10 identity

corepack pnpm validate:fixtures
  49 JSON fixtures, 14 case manifests, 11 YAML fixtures, 3 compiled identities

corepack pnpm check:docs
  201 local Markdown links

corepack pnpm check:packages
  7 npm manifests and dry-run tarballs passed

corepack pnpm check:packed-install
  7 installed tarballs passed their consumer smoke

uv build --project python && python3 scripts/check-python-artifacts.py
  wheel: 35 entries; sdist: 36 entries; installed YAML/builder/identity/CLI smoke passed

corepack pnpm audit:prod
  no known production vulnerabilities

git diff --check
  clean
```

The complete workspace build, typecheck, lint, and test chain also exited
successfully. One earlier CLI/package failure is excluded from product evidence
because a separately confirmed concurrent `prepack` deleted the shared `dist`
directory; isolated reruns are the evidence above.

Reviewed working-tree hashes:

```text
92064ed193d14421cdaddcb4f0cc61f2ba20511ca7a82e1ce18759fa94c45079  spec/conformance/canonical-number.case.json
2bed6d06d48e9306f237d79e6a3de7097bfb5ad7d80f923661299ee7555882fa  spec/conformance/authoring/component-identity.expected.json
1da0201aa30a6992f30cff3e1d5be5d8ad770876b0b0dbdf8652cca9f1622318  spec/authoring-semantics.md
7d55572aaafad4e445d8d769881284e13e89877d2953d3d011f2fe08f5a8fbcc  codex_logs/decisions/ADR-0002-strict-authoring-and-initial-identity.md
```

## Acceptance boundary

No P0 or P1 finding remains open in the reviewed D2 surface. The changes are
accepted for commit and push. D2 must remain `in_progress` until the integration
owner commits the exact reviewed tree, reruns or binds the candidate gates,
stores immutable evidence under that commit SHA, and records the independent
review in the registry. This decision does not imply that the 21-day master
plan, stable v1, or the 6,000-star stretch outcome is complete or guaranteed.
