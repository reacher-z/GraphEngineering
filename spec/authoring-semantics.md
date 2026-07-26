# Graph authoring and initial identity semantics v1alpha1

Status: **normative protocol contract; GraphPatch and revision 2+ excluded**

This document defines the portable authoring boundary shared by the TypeScript
and Python SDKs. It covers strict JSON decoding, a deliberately small safe-YAML
profile, general graph builders, opt-in strict typed ports, and the immutable
identity of initial graph revision 1.

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**,
and **MAY** are normative.

## 1. One compilation pipeline

Every authoring path MUST converge before semantic compilation:

```text
strict JSON bytes ---- source decoder --+
safe YAML bytes ------ source decoder --+-- portable JSON snapshot
TypeScript builder --- detached calls --+             |
Python builder ------- detached calls --+             v
                                                canonical compiler
                                                   |   |   |
                                               graph  hash identity
```

Source decoders and builders produce Graph IR only. They MUST NOT implement a
second graph validator, repair invalid graphs, infer omitted graph structure,
or calculate a graph identity from a different snapshot. The canonical
compiler remains authoritative for the Graph IR envelope, references,
topology, policies, typed-port proof, canonical graph text, and `graphHash`.

The source document and every caller-owned builder argument are untrusted.
Implementations MUST reach a detached portable-JSON boundary before retaining
or compiling them. Accessor execution, proxy traps, custom mappings, aliases,
cycles, non-finite numbers, unsafe integers, and host-language objects MUST NOT
leak into stored graph state.

## 2. Source decoding

### 2.1 Formats and selection

The source API accepts `json` or `yaml`. A CLI may additionally expose `auto`:

- `.json` selects JSON;
- `.yaml` and `.yml` select YAML;
- stdin (`-`) defaults to JSON and MUST NOT use content sniffing;
- YAML on stdin requires an explicit `--input-format yaml`; and
- an unknown or missing file extension in `auto` is an input error.

Input format is independent from any output renderer format. In particular,
`visualize --format mermaid|dot` does not select the input decoder.

Source APIs accept bytes or text. Bytes MUST be decoded as strict UTF-8. An
implementation MUST reject malformed byte sequences rather than insert a
replacement character. A text API is already decoded but remains subject to
the UTF-8 byte limit after strict encoding.

### 2.2 Resource ceilings

The hard v1alpha1 ceilings are:

| Resource | Ceiling |
| --- | ---: |
| UTF-8 source bytes | 1,048,576 |
| constructed collection depth | 100 |
| total scalar and collection nodes | 100,000 |

Callers MAY lower a ceiling but MUST NOT raise it. A limit is a positive safe
integer. Root depth is one. Node counting includes the root and every mapping,
sequence, scalar, and null value. Implementations MUST enforce byte bounds
before parser allocation and MUST bound parser/event work before constructing
an unbounded object tree. Every mapping key is itself a scalar AST node and is
counted in addition to the mapping and its value. For example, `{"a":1}` has
three nodes: the mapping, key string, and number. A streaming lexical/CST guard
MAY use a fixed linear allowance above a caller's semantic ceiling so that it
can stop pathological input without materializing the complete AST; the
constructed AST pass MUST still enforce the exact requested depth/node ceiling
and preserve its precise JSON Pointer for ordinary boundary failures. Trivia
and bytes inside one scalar do not consume semantic node budget.

### 2.3 Strict JSON

JSON decoding MUST:

- reject duplicate mapping keys at every depth;
- reject `NaN`, `Infinity`, `-Infinity`, and non-standard constants;
- reject integer values outside `[-(2^53-1), 2^53-1]`;
- reject an integer-valued float outside that same range;
- reject invalid UTF-8, trailing tokens, and partial documents;
- preserve array order, object property names, explicit `null`, and Unicode;
- normalize strings according to the canonical portable-JSON boundary; and
- apply the source depth and node ceilings before returning.

The source decoder MAY accept a non-integer finite binary64 number. Every such
accepted number MUST be hashed using the ECMAScript shortest-round-trip number
serialization defined by RFC 8785 Section 3.2.2.3 and ECMA-262
`Number::toString`, including negative-zero normalization, closest-value
selection, and round-to-even ties. The shared canonical-number corpus freezes
the fixed/scientific thresholds and adversarial binary64 boundaries. This
adopts only the RFC 8785 number rule: Graph IR object keys remain ordered by
Unicode code point, so implementations MUST NOT claim full JCS conformance.

### 2.4 Safe YAML profile

YAML input is restricted to a single YAML 1.2 document whose constructed value
is JSON-compatible. The accepted data model is:

- mappings with string keys;
- sequences;
- strings, finite numbers, booleans, and null;
- comments;
- flow or block collections; and
- ordinary literal or folded block strings.

An empty or comment-only YAML stream is one implicit null document. The source
decoder returns null; a graph command then rejects it as `GE1007_INVALID_GRAPH`.
It is not a source syntax error.

The accepted lexical subset uses LF or CRLF source line endings. A lone CR, a
raw TAB, NEL (`U+0085`), the other C0/C1 controls, `U+007F`, `U+FFFE`, and
`U+FFFF` fail as `GE_SOURCE_SYNTAX` before the YAML parser runs. Raw Unicode
line/paragraph separators (`U+2028` and `U+2029`) are rejected for the same
cross-parser reason. This removes host-parser normalization differences. A
JSON-style `\t` escape, and YAML `\L`/`\P` escapes, inside a double-quoted YAML
scalar remain valid and construct their represented characters; the restriction
is on the raw source character. An explicit end marker for an otherwise empty
single document (`...`, with or without an initial `---`) decodes to null just
like an empty stream.

One Unicode BOM (`U+FEFF`) is permitted only at source position zero. It is not
part of the constructed scalar stream and directive preflight proceeds after
it. A BOM anywhere else, or a second leading BOM, fails as
`GE_SOURCE_SYNTAX`. Consequently a leading BOM cannot hide a forbidden `%`
directive.

Sequence order and mapping insertion are preserved into the Graph IR snapshot.
Canonical object-key sorting happens only during serialization; it does not
reorder node or edge arrays.

The following are always rejected before Graph IR compilation:

- a second YAML document or trailing document stream;
- duplicate mapping keys at any depth;
- anchors, aliases, and merge keys (`<<`);
- `%YAML`, `%TAG`, or other directives;
- explicit, custom, or implementation-specific tags;
- complex keys or any non-string mapping key;
- timestamps, dates, binary values, sets, ordered maps, and host objects;
- `.nan`, `.inf`, non-finite values, and unsafe integers;
- YAML 1.1 implicit boolean coercion; and
- parser recovery warnings, unknown tokens, cycles, or shared alias graphs.

Plain scalar resolution follows the YAML 1.2 core lexical forms: decimal,
`0o` octal, `0x` hexadecimal, and ordinary finite float/exponent tokens become
numbers; `null`/`~`, `true`, and `false` use their core meanings. Numeric
underscores and `0b` binary tokens remain strings. Plain `yes`, `no`, `on`, and
`off` are also strings. A parser's default schema MUST NOT silently reinterpret
them as booleans. Core null/boolean spelling is case-sensitive to the YAML 1.2
set: lower-case, title-case, and upper-case spellings resolve, while arbitrary
mixed-case spellings such as `nUlL` or `tRuE` remain strings. The
timestamp-shaped lexical form is explicitly denied by this safety profile even
when a core parser would return it as a string; the same text in a quoted scalar
remains a string. All quoted scalars remain strings.

A column-zero `%` token in a stream or document preamble is a forbidden
directive, even when its name is malformed or absent, and fails as
`GE_SOURCE_UNSAFE_YAML_FEATURE` before empty-document or parser handling. A
column-zero `%` line that the YAML lexer has already joined into a multiline
plain, single-quoted, or double-quoted scalar remains scalar content; preflight
MUST NOT classify it as a directive. A leading `%` token reached as an indented
plain scalar is not a directive and fails as `GE_SOURCE_SYNTAX`; literal/folded
block string content also remains data. After an explicit `...` end marker,
`---` begins a second document and fails as `GE_SOURCE_MULTIPLE_DOCUMENTS`; any
other significant trailing token (including another `...`) is syntax, except
that a preamble `%` token retains the unsafe-directive classification. A
document marker is column-zero and may be followed by nothing, spaces only, or
spaces plus a comment; leading indentation prevents marker interpretation.

Multiline single- and double-quoted scalars at the document root may continue
at column zero. When the scalar is a mapping value or sequence item, every
non-empty continuation line MUST remain indented beyond its containing block;
host parsers that fold a column-zero continuation are rejected as syntax. To
avoid a known YAML-parser divergence, a plain key/pair inside any flow
collection requires whitespace or a line break after its separating `:`.
Compact JSON-style flow syntax remains available with a quoted key, so
`{"a":[]}` is valid while `{a:[]}` and `[a:]` fail closed.

A comment following a quoted scalar or a closed flow collection requires at
least one separating space. Inputs such as `"x"#comment` or `[]#comment` fail
as syntax instead of permitting a host parser to discard trailing bytes.
Within a plain scalar, `#` without preceding whitespace remains scalar content;
for example `a#b` constructs the string `a#b`.

Syntactically complete aliases, anchors, and tags are unsafe-profile failures.
A bare `*`, bare `&`, incomplete `!`, or malformed tag/flow-token combination
is syntax instead; implementations do not label an incomplete token as a
successfully recognized unsafe feature.

Explicit null is preserved and is later accepted or rejected by the Graph IR
schema at its exact field. A valid YAML document whose root is not a Graph IR
object reaches the compiler and is rejected as `GE1007_INVALID_GRAPH`; it is not
repaired by the source layer.

### 2.5 Source error projection

A source failure is projected as:

```json
{
  "code": "GE_SOURCE_DUPLICATE_KEY",
  "format": "yaml",
  "message": "YAML mapping contains a duplicate key",
  "path": "#/nodes/1/id",
  "line": 12,
  "column": 5
}
```

`line` and `column` are one-based when available. `path`, `line`, and `column`
may be null when the parser cannot safely identify them. Messages MUST NOT
contain the entire input, secret values, parser stacks, or an absolute user
path. Stable codes are:

| Code | Meaning |
| --- | --- |
| `GE_SOURCE_INVALID_UTF8` | the input is not strict UTF-8 |
| `GE_SOURCE_TOO_LARGE` | a byte, depth, or node ceiling was exceeded |
| `GE_SOURCE_SYNTAX` | syntax or trailing content is invalid |
| `GE_SOURCE_MULTIPLE_DOCUMENTS` | more than one document was observed |
| `GE_SOURCE_DUPLICATE_KEY` | a mapping repeats a normalized key |
| `GE_SOURCE_UNSAFE_YAML_FEATURE` | an alias, anchor, tag, merge, or directive was used |
| `GE_SOURCE_NON_JSON_VALUE` | the YAML/JSON value is outside the portable JSON model |

For the CLI, a source failure exits with code 2. A decoded document rejected by
the graph compiler exits with code 1.

When one source contains several defects, implementations apply this stable
precedence: byte/size and lexical checks, forbidden directive preflight, a
recognized second-document boundary, parser syntax/errors/warnings, then AST
semantic checks such as aliases, duplicate keys, non-JSON scalars, and resource
depth/node ceilings. A later AST defect cannot hide an earlier parser failure,
and a first-document semantic defect cannot hide a recognized second document.
Profile syntax discovered by streaming preflight (such as an adjacent flow
colon) is retained until document counting completes, so a recognized second
document still wins; an actual directive line remains earlier than that count.

## 3. General builder

### 3.1 Required inputs and explicit structure

A builder constructor requires `metadata`, `inputSchema`, and `outputSchema`.
It may accept `stateSchema` and `policies`. It MUST NOT generate a graph name,
version, node ID, edge ID, entrypoint, public output, schema, capability, or
policy.

The builder supports these operations in language-idiomatic spelling:

- add one node;
- add one edge;
- add one explicit entrypoint node ID;
- bind one public output name to an endpoint;
- replace the complete graph policy object;
- enable the exact strict typed-port policy; and
- build once.

Node and edge arrays preserve `add` call order. Entrypoints preserve call order.
Public outputs preserve their names as data, including names such as
`__proto__`; they MUST NOT invoke prototype behavior or be lost during object
construction.

### 3.2 Snapshot and mutation rules

The constructor and every mutating call MUST immediately capture a detached
portable JSON snapshot. Later caller mutation MUST NOT alter the builder.
Builder methods MUST NOT retain caller mappings, arrays, model instances,
getters, proxies, or custom collection behavior.

Successful `build()` invokes the canonical compiler exactly once over a final
detached graph snapshot. The returned graph, `canonicalGraph`, `graphHash`, and
compiled identity all correspond to that same snapshot.

TypeScript returns a recursively frozen plain graph. Python may expose a fresh
validated copy on each graph access; its internal canonical bytes and identity
MUST remain immutable even if a returned nested dictionary or list is mutated.

`build()` succeeds at most once. A successful build seals the builder. Every
later mutation or build attempt fails with `GE_BUILDER_SEALED`. A failed build
does not return a partial graph or identity; the implementation MAY remain open
so the caller can add missing structure, provided this behavior is tested and
identical for equivalent operations within that SDK.

### 3.3 Duplicate and required-value behavior

The builder rejects, at the call that introduces it:

- a duplicate node ID;
- a duplicate edge ID;
- a duplicate entrypoint;
- a duplicate public output name; and
- a non-portable or malformed immediate value.

It does not replace the earlier value. Missing entrypoints, missing outputs, or
required constructor fields produce a structured builder error. Other graph
defects are reported by the canonical compiler with its complete ordered
diagnostic list.

Missing and explicit null are distinct. Required `node.config: null` is
preserved. A known optional non-null Graph IR field supplied as null is rejected
by the compiler. A null inside an unknown versioned policy extension remains a
portable policy value and is preserved.

### 3.4 Builder result and error

A successful result contains:

```json
{
  "graph": {},
  "canonicalGraph": "{...}",
  "graphHash": "<64 lowercase hex>",
  "identity": {}
}
```

A builder failure projects at least:

```json
{
  "code": "GE_BUILDER_CORE_REJECTED",
  "message": "Canonical compiler rejected the graph",
  "path": "#",
  "diagnostics": []
}
```

Stable builder codes are:

| Code | Meaning |
| --- | --- |
| `GE_BUILDER_INVALID_INPUT` | a supplied value is malformed or non-portable |
| `GE_BUILDER_DUPLICATE_NODE` | a node ID already exists |
| `GE_BUILDER_DUPLICATE_EDGE` | an edge ID already exists |
| `GE_BUILDER_DUPLICATE_ENTRYPOINT` | an entrypoint already exists |
| `GE_BUILDER_DUPLICATE_OUTPUT` | a public output name already exists |
| `GE_BUILDER_MISSING_REQUIRED` | a required envelope member, entrypoint, or output is missing |
| `GE_BUILDER_CORE_REJECTED` | the canonical compiler rejected the final graph |
| `GE_BUILDER_SEALED` | a successful builder was used again |

Paths use RFC 6901 JSON Pointer with `#` as the root. Builder messages are not
part of cross-language conformance; code, path, and normalized compiler
diagnostics are.

## 4. Opt-in strict typed ports

### 4.1 Policy

Static typed-port proof is disabled for legacy graphs. It is enabled only by
the exact versioned policy:

```json
{
  "graphengineering.reacher-z.github.io/typed-ports": {
    "apiVersion": "graphengineering.reacher-z.github.io/typed-ports/v1alpha1",
    "mode": "strict-exact"
  }
}
```

A builder helper may add this exact value but MUST NOT mutate caller-owned
policy state. An existing key with a different value fails closed. A graph
without the policy retains the current named-port runtime behavior and makes no
claim of static schema compatibility.

### 4.2 Schema profile

Every participating graph, node, and edge schema MUST pass Draft 2020-12
meta-validation. The v1alpha1 strict-exact profile rejects every `$ref` and
`$dynamicRef`, including local fragments, as `GE1205_INVALID_PORT_SCHEMA`.
Comparing the same local reference token across two different schema roots can
otherwise falsely equate incompatible definitions. Reference resolution
requires a later versioned profile and shared resolution corpus.

If a participating schema declares `$schema`, its value MUST be exactly
`https://json-schema.org/draft/2020-12/schema`; an omitted declaration uses that
dialect. A trailing fragment, a historical draft, or an unknown dialect fails
with `GE1205_INVALID_PORT_SCHEMA` instead of silently selecting host-library
behavior. The v1alpha1 profile rejects the `pattern` and `patternProperties`
keywords at any depth, including inside unreferenced `$defs`. Native JavaScript
and Python regular-expression grammars are not equivalent, so accepting either
host validator would make the same schema compile differently. Regex-bearing
schemas require a later versioned profile with one portable grammar and shared
execution corpus. This is schema-syntax validation only; v1alpha1 does not claim
runtime instance validation.

Compatibility is canonical identity, not general JSON Schema assignability.
No integer-to-number widening, union reasoning, default insertion, coercion, or
subsumption is performed in v1alpha1.

### 4.3 Edge algorithm

For each edge in declaration order:

1. If `from.port` exists, the producer output schema must be an object schema
   with that property and list it in `required`; that property is the transfer
   schema. Otherwise the complete producer output schema is transferred.
2. The target binding key is `to.port` when present and otherwise the source
   node ID. The consumer input schema must be an object schema with that
   property and list it in `required`.
3. Source, target, and an optional `edge.schema` must be canonical-identical.
4. No two incoming edges may resolve to the same target node and binding key.
5. `mode` may be absent or `value`. `stream` and `artifact-ref` fail because no
   typed runtime lowering exists for them.

Every entrypoint node input schema must be canonical-identical to the graph
input schema.

For each public output, the graph output schema must define and require a
property with the public output name. If the endpoint has a port, the node
output schema must define and require that port; otherwise the full node output
schema is selected. The selected schema and public property schema must be
canonical-identical.

### 4.4 Compiler diagnostics

Typed-port validation runs only after envelope, identity/reference, DAG, and
ordinary policy validation. Its stable diagnostics are:

| Code | Meaning |
| --- | --- |
| `GE1201_MISSING_SOURCE_PORT` | a selected source/public-output port is not defined and required |
| `GE1202_MISSING_TARGET_PORT` | a target binding is not defined and required |
| `GE1203_PORT_SCHEMA_MISMATCH` | source, edge, and target schemas are not canonical-identical |
| `GE1204_DUPLICATE_TARGET_BINDING` | multiple edges bind the same target input key |
| `GE1205_INVALID_PORT_SCHEMA` | the policy or a schema is outside the strict profile |
| `GE1206_OUTPUT_SCHEMA_MISMATCH` | a public output binding does not match graph output schema |
| `GE1207_ENTRYPOINT_SCHEMA_MISMATCH` | an entrypoint schema differs from graph input schema |
| `GE1208_UNSUPPORTED_TYPED_EDGE_MODE` | an opted-in edge uses a non-value mode |

Diagnostics preserve deterministic graph declaration order. Cross-language
reports compare code, path, edge ID, node identifier set, and output name after
normalizing language-specific field spelling.

## 5. Initial compiled identity

### 5.1 Component hashes

The existing whole-graph `graphHash` is unchanged. A component hash is:

```text
SHA-256(
  UTF8("graph-engineering/component/v1alpha1\0") ||
  UTF8(KIND) || 0x00 ||
  UTF8(canonical(value))
)
```

`KIND` is exactly `node`, `edge`, or `schema`. Node and edge hashes cover their
complete declarations, including IDs. Schema hashes cover only the schema
object, so identical schemas may share a hash across owners. Output is 64
lowercase hexadecimal characters.

### 5.2 Manifest

The initial identity conforms to `compiled-identity.schema.json`. It contains:

- the exact compiled identity API version and kind;
- `graphRevision: 1`;
- the canonical graph hash;
- node identities in node declaration order, with zero-based sequential index;
- edge identities in edge declaration order, with zero-based sequential index;
- input, output, and optional state graph-schema hashes; and
- a revision hash.

The revision hash is:

```text
SHA-256(
  UTF8("graph-engineering/revision/v1alpha1\0") ||
  UTF8(canonical(manifest-without-revisionHash))
)
```

The manifest and graph result MUST be derived from the same detached compiler
snapshot. Metadata changes therefore alter `graphHash` and `revisionHash` but
do not alter unrelated component hashes.

### 5.3 Verification

The verifier treats the candidate manifest as untrusted portable JSON, checks
that revision is the safe integer `1`, recompiles the graph, and recomputes the
complete expected manifest. It fails closed with:

| Code | Meaning |
| --- | --- |
| `GE1301_UNSUPPORTED_GRAPH_REVISION` | revision is absent, not a safe integer, or not 1 |
| `GE1302_GRAPH_IDENTITY_MISMATCH` | candidate `graphHash` differs from the graph |
| `GE1303_COMPONENT_IDENTITY_MISMATCH` | shape, order, component/schema hash, or revision hash differs |

The verifier never creates revision 2 and never emits `GraphPatched`.

## 6. Conformance requirements

Implementations are conformant only when an expected golden corpus, the
TypeScript report, and the Python report all agree. Equality of the two SDKs is
insufficient if both differ from the frozen expected result.

The corpus MUST cover:

- JSON, YAML, TypeScript builder, and Python builder equivalence;
- declaration-order preservation and explicit null behavior;
- Unicode keys and safe-integer boundaries;
- duplicate keys, unsafe YAML features, multi-document input, limits, and
  non-JSON scalars;
- every `GE1201` through `GE1208` diagnostic;
- golden graph, node, edge, schema, and revision hashes;
- revision 0, 2, unsafe revision, graph-hash mutation, component mutation,
  schema mutation, and order mutation; and
- caller mutation, returned nested mutation, hostile inputs, duplicate builder
  operations, and sealing.

Packaged-install tests MUST import the public builder, source, identity, and
typed-port APIs from actual npm and wheel/sdist artifacts. At least one packed
path must decode and compile the shared YAML graph.

## 7. Explicit non-goals

This contract does not implement or imply:

- `GraphPatched`, patch authorization, or graph mutation during a run;
- revision 2 or a parent revision chain;
- stream or artifact-reference edge execution;
- general JSON Schema assignability or external reference resolution;
- YAML round-tripping, arbitrary tags, anchors, aliases, or merge semantics;
- inference of graph structure, schemas, IDs, or public outputs; or
- durable storage, replay, migration, or signing of identity manifests.

Those capabilities require later versioned contracts and their own shared
failure and recovery evidence.
