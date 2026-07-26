# `@graph-engineering/core`

The dependency-free TypeScript core for Graph Engineering. It defines the
v1alpha1 Graph IR, canonical serialization/hash rules, and the deterministic
static compiler used by runtimes and developer tools.

```ts
import { canonicalHash, compileGraph, type GraphSpec } from "@graph-engineering/core";

const result = compileGraph(graph as GraphSpec);
if (!result.valid) {
  console.error(result.diagnostics);
}
console.log(canonicalHash(graph));
```

## Compiler guarantees

- object keys are recursively ordered by Unicode code point before hashing;
- duplicate node/edge IDs and missing edge endpoints are rejected;
- entrypoints and named graph outputs must reference existing nodes;
- entrypoints are roots and therefore cannot have incoming edges;
- every node must be reachable from an explicit entrypoint;
- implicit cycles are rejected and topological peers retain semantic node declaration order;
- malformed envelopes are reported with the stable `GE1007_INVALID_GRAPH` code.
- `maxFanOut` and `maxDepth` policies are checked statically.

The package intentionally does not choose a JSON Schema validation library.
Schema validation at I/O boundaries belongs to runtime adapters; the canonical
IR remains portable between TypeScript and Python.
