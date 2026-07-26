# `@graph-engineering/core`

The deterministic TypeScript authoring and compiler core for Graph Engineering.
It provides the v1alpha1 Graph IR, safe JSON/YAML decoding, a general graph
builder, canonical serialization and hashing, opt-in strict typed ports, and
revision-1 compiled component identities.

The package requires Node.js 20 or newer and is ESM-only.

```bash
npm install @graph-engineering/core
```

## Decode and compile graph source

`decodeGraphSource` accepts a string or `Uint8Array`. JSON is the API default;
select YAML explicitly. Format inference belongs to the CLI, not this package.

```ts
import {
  GraphSourceError,
  compileGraph,
  decodeGraphSource,
} from "@graph-engineering/core";

const source = new TextEncoder().encode(`
apiVersion: graphengineering.reacher-z.github.io/v1alpha1
kind: Graph
metadata: { name: hello-graph, version: "1" }
inputSchema: {}
outputSchema: {}
entrypoints: [hello]
outputs:
  result: { node: hello }
nodes:
  - id: hello
    kind: transform
    inputSchema: {}
    outputSchema: {}
    config: null
edges: []
`);

try {
  const document = decodeGraphSource(source, { format: "yaml" });
  const result = compileGraph(document);
  if (!result.valid) console.error(result.diagnostics);
  else console.log(result.graphHash, result.topologicalLayers);
} catch (error) {
  if (error instanceof GraphSourceError) console.error(error.toJSON());
  else throw error;
}
```

The decoder returns detached, recursively frozen portable JSON. Source mapping
insertion order and sequence order are retained; object keys are sorted only by
canonical serialization. `parseGraphSource` is an alias of
`decodeGraphSource`.

Strict JSON rejects duplicate normalized keys, trailing data, non-standard
numeric constants, unsafe integers, and malformed UTF-8. The safe YAML 1.2
profile supports ordinary mappings, sequences, comments, block strings, and
JSON-compatible scalars. It rejects multiple documents, duplicate keys,
anchors, aliases, merge keys, tags, directives, complex keys, timestamps,
non-finite numbers, and unsafe integers. Quoted timestamp-shaped text remains a
string. YAML 1.2 unsigned `0o`/`0x` radix forms become numbers, while signed
radix forms, numeric underscores, and `0b` tokens remain strings.

The cross-parser profile also fails closed on three host-specific ambiguities:
quoted continuations nested in a block collection must remain indented; a plain
key inside a flow collection requires whitespace after its `:` (`{a:[]}` is
rejected while `{"a":[]}` is valid); and comments after quoted or flow values
require separation (`"x"#c` is rejected while `"x" #c` is valid). A `#`
without preceding whitespace inside an ordinary plain scalar remains data.

The raw YAML lexical profile accepts LF and paired CRLF line endings. It rejects
lone CR, raw tabs, NEL, C0/C1 controls, raw U+2028/U+2029, U+FFFE, and U+FFFF
before AST parsing. Double-quoted `\t`, `\L`, and `\P` escapes remain valid and
construct their corresponding characters in the decoded string value.
A single U+FEFF byte-order mark is allowed only at source position zero;
directives immediately after it are still rejected, and every later BOM is a
syntax error.

Hard source ceilings are 1 MiB of UTF-8, depth 100, and 100,000 scalar or
collection AST nodes. Mapping keys count as nodes, so `{ "a": 1 }` contains
three. Callers may lower, but never raise, a ceiling:

```ts
decodeGraphSource(text, {
  format: "json",
  limits: { maxBytes: 64_000, maxDepth: 20, maxNodes: 5_000 },
});
```

Source failures have stable `code`, `format`, `message`, `path`, `line`, and
`column` fields. Location fields are `null` when a safe location is unavailable.
Codes range from `GE_SOURCE_INVALID_UTF8` and `GE_SOURCE_SYNTAX` to dedicated
duplicate-key, unsafe-YAML, non-JSON-value, multi-document, and resource-limit
failures. Messages never include the complete source or parser stack.

## Build a graph programmatically

The builder is deliberately inference-free: authors supply every ID, schema,
entrypoint, edge, and public output.

```ts
import { graphBuilder } from "@graph-engineering/core";

const built = graphBuilder({
  metadata: { name: "hello-graph", version: "1" },
  inputSchema: {},
  outputSchema: {},
})
  .addNode({
    id: "hello",
    kind: "transform",
    inputSchema: {},
    outputSchema: {},
    config: null,
  })
  .addEntrypoint("hello")
  .addOutput("result", { node: "hello" })
  .build();

console.log(built.graphHash);
console.log(built.canonicalGraph);
console.log(built.identity.revisionHash);
```

Constructor values and every added node, edge, endpoint, or policy are captured
immediately. Caller mutation cannot change later output. Malformed fragments
fail at the call that introduces them, duplicates receive dedicated builder
codes, and final cross-reference or graph-topology failures preserve the
compiler's complete ordered diagnostics. `setPolicies` replaces the complete
policy map; it does not merge.

A successful result contains one recursively frozen graph plus canonical bytes,
the whole-graph hash, and its component identity, all derived from the same
single compiler capture. This TypeScript builder seals on its first `build()`
attempt; later mutation or build calls fail with `GE_BUILDER_SEALED`.

## Opt in to strict typed ports

Legacy graphs retain ordinary named-port runtime behavior. Static proof is
enabled only by the exact versioned `strict-exact` policy. The builder helper
adds that policy without overwriting an existing value:

```ts
const stringSchema = { type: "string" };
const graphInput = {
  type: "object",
  properties: { query: stringSchema },
  required: ["query"],
};
const graphOutput = {
  type: "object",
  properties: { result: stringSchema },
  required: ["result"],
};

const typed = graphBuilder({
  metadata: { name: "typed-graph", version: "1" },
  inputSchema: graphInput,
  outputSchema: graphOutput,
})
  .addNode({
    id: "answer",
    kind: "transform",
    inputSchema: graphInput,
    outputSchema: graphOutput,
    config: null,
  })
  .addEntrypoint("answer")
  .addOutput("result", { node: "answer", port: "result" })
  .enableStrictTypedPorts()
  .build();
```

The v1alpha1 profile meta-validates participating schemas as JSON Schema Draft
2020-12. A declared `$schema` must be exactly
`https://json-schema.org/draft/2020-12/schema`; foreign dialects, trailing
fragments, every `pattern`/`patternProperties` keyword at any depth, empty
`enum` arrays, every `$ref`, and every `$dynamicRef` fail closed. Regex-bearing
schemas need a later portable-regex profile because native JavaScript and Python
grammars differ. Compatibility is proven only when selected schemas are
canonical-identical. The profile does not perform general schema assignability,
coercion, default insertion, or external reference resolution.
An edge mode must be absent or `value`; typed `stream` and `artifact-ref`
lowering are not implemented.

Typed diagnostics are stable `GE1201` through `GE1208` values covering missing
source/target ports, schema mismatch, duplicate target binding, invalid schema
profile, public-output mismatch, entrypoint mismatch, and unsupported edge
mode. `hasStrictTypedPorts`, `validateStrictTypedPorts`, and the versioned policy
constants are also exported for tooling.

## Component identity

`createCompiledGraphIdentity(graph)` produces a detached revision-1 manifest:

- the existing whole-graph `graphHash`;
- declaration-ordered node and edge identities;
- node input/output, edge, and graph-level schema hashes; and
- a domain-separated `revisionHash`.

`componentHash("node" | "edge" | "schema", value)` computes an individual
domain-separated hash. `verifyCompiledGraphIdentity(graph, candidate)` treats
the candidate as untrusted portable JSON and returns `{ valid, diagnostics }`.
It distinguishes unsupported revision (`GE1301`), graph hash mismatch
(`GE1302`), and component/order/schema/revision mismatch (`GE1303`). Creating an
identity for an invalid graph throws `CompiledIdentityCreationError` with the
compiler diagnostics.

Revision 1 is intentionally immutable. The verifier never creates revision 2,
a parent chain, or a `GraphPatched` event.

## Compiler guarantees

- Caller values are captured without executing accessors or proxy traps.
- Object keys are ordered by Unicode code point for canonical bytes and SHA-256.
- Duplicate node/edge IDs and missing endpoints are rejected deterministically.
- Entrypoints and public outputs must reference existing nodes.
- Entrypoints are explicit roots and cannot have incoming edges.
- Every node must be reachable from an entrypoint.
- Implicit cycles are rejected; topological peers retain node declaration order.
- `maxFanOut` and `maxDepth` are checked statically.
- Failures are structured diagnostics, never silent `null` substitutions.

The base compiler validates the Graph IR envelope and topology. JSON Schema
meta-validation is activated only by the strict typed-port policy; runtime
adapters remain responsible for validating actual node inputs and outputs.

## Explicit non-goals in v1alpha1

This package does not provide graph patches or revision 2, dynamic mutation
during a run, stream/artifact-reference execution, general JSON Schema
assignability, external reference resolution, YAML round-tripping, durable
storage/replay, migration, or identity signing. Those features require later
versioned contracts and cross-language conformance evidence.
