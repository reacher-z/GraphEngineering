import type {
  GraphMetadata,
  GraphPolicies,
  GraphSpec,
  JsonSchema,
  NodeSpec,
  RouteSelectionPolicySnapshot,
} from "@graph-engineering/core";

export type DeepReadonly<T> =
  T extends (...arguments_: never[]) => unknown
    ? T
    : T extends readonly (infer Item)[]
      ? readonly DeepReadonly<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
        : T;

/** Type-level view of the recursively frozen Graph IR returned at runtime. */
export type PatternGraph = DeepReadonly<GraphSpec>;

export interface PatternBaseOptions {
  metadata: GraphMetadata;
  inputSchema?: JsonSchema;
  outputSchema?: JsonSchema;
  stateSchema?: JsonSchema;
  outputKey?: string;
  policies?: GraphPolicies;
}

export interface KeyedNode {
  key: string;
  node: NodeSpec;
}

export interface DiamondOptions extends PatternBaseOptions {
  split: NodeSpec;
  workers: readonly KeyedNode[];
  merge: NodeSpec;
}

export interface RoutedBranchesOptions extends PatternBaseOptions {
  classify: NodeSpec;
  branches: readonly KeyedNode[];
  merge: NodeSpec;
  routePolicy?: RouteSelectionPolicySnapshot;
}

export interface VerifiedFanoutOptions extends PatternBaseOptions {
  work: NodeSpec;
  verifiers: readonly KeyedNode[];
  adjudicate: NodeSpec;
}

export interface LoopRound {
  key: string;
  find: NodeSpec;
  checkDry: NodeSpec;
}

export interface LoopUntilDryOptions extends PatternBaseOptions {
  /** Required static bound; must be an integer from 1 through 100. */
  maxRounds: number;
  /** Explicit round definitions; length must equal maxRounds exactly. */
  rounds: readonly LoopRound[];
  finalize: NodeSpec;
}
