# ADR-0001: Explicit entrypoints and output bindings

Status: accepted
Date: 2026-07-26

## Context

The initial Graph IR listed nodes and edges but did not identify which nodes
consume graph input or which node values form public graph output. Inferring all
zero-indegree nodes as entries makes disconnected components indistinguishable
from intentional independent roots and makes stable output assembly ambiguous.

## Decision

`GraphSpec` requires:

- `entrypoints`: a non-empty unique list of node IDs.
- `outputs`: a non-empty mapping from public result fields to node endpoints.

Reachability begins at explicit entrypoints. Multiple roots remain fully
supported when all are declared. A root omitted from entrypoints is an invalid
unreachable component. Runtime output is assembled only from named bindings.

## Consequences

- Compilers can implement `GE1006_UNREACHABLE_NODE` consistently.
- Builders and manifests are slightly more verbose but no longer rely on array order.
- Dynamic graph patches cannot silently create a new execution root or public output.
- Existing v1alpha1 fixtures and canonical hashes changed before any release.
