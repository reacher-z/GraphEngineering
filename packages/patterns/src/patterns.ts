import {
  validateRouteSelectionPolicy,
  type EdgeSpec,
  type NodeSpec,
  type RouteSelectionPolicySnapshot,
} from "@graph-engineering/core";
import { PatternInputError } from "./errors.js";
import {
  MAX_PATTERN_ITEMS,
  assertEntryFields,
  assertUniqueNodeIds,
  buildGraph,
  edgeId,
  expectRecord,
  fields,
  parseKeyedNodes,
  parseNode,
  safeKey,
  snapshotOptions,
  type ParsedKeyedNode,
  type PatternIdentity,
  type PatternKind,
} from "./internal.js";
import type {
  DiamondOptions,
  LoopUntilDryOptions,
  PatternGraph,
  RoutedBranchesOptions,
  VerifiedFanoutOptions,
} from "./types.js";

const ANNOTATION_API_VERSION =
  "graphengineering.reacher-z.github.io/pattern-conditions/v1alpha1";

const IDENTITIES: Readonly<Record<PatternKind, PatternIdentity>> = {
  diamond: { pattern: "diamond/v1alpha1", capability: "dag/v1alpha1" },
  "routed-branches": {
    pattern: "routed-branches/v1alpha1",
    capability: "edge-condition-routing/v1alpha1",
  },
  "verified-fanout": { pattern: "verified-fanout/v1alpha1", capability: "dag/v1alpha1" },
  "loop-until-dry": {
    pattern: "loop-until-dry/v1alpha1",
    capability: "edge-condition-routing-and-early-stop/v1alpha1",
  },
};

function edge(
  pattern: PatternKind,
  index: number,
  from: string,
  to: string,
  options: { port?: string; condition?: Readonly<Record<string, unknown>> } = {},
): EdgeSpec {
  return {
    id: edgeId(pattern, index),
    from: { node: from },
    to: { node: to, ...(options.port === undefined ? {} : { port: options.port }) },
    mode: "value",
    ...(options.condition === undefined ? {} : { condition: options.condition }),
  };
}

function nodeRef(node: NodeSpec, path: string): { node: NodeSpec; path: string } {
  return { node, path };
}

/**
 * Build a split → parallel workers → merge DAG.
 *
 * The split node is the sole entrypoint. Its complete output flows to every
 * worker. Each worker result flows into a unique merge input port named by the
 * worker key. The merge node is the graph's named output endpoint.
 */
export function diamond(options: DiamondOptions): PatternGraph {
  const input = snapshotOptions(options, fields("split", "workers", "merge"));
  const split = parseNode(input.split, "#/split");
  const workers = parseKeyedNodes(input.workers, "#/workers");
  const merge = parseNode(input.merge, "#/merge");
  assertUniqueNodeIds([
    nodeRef(split, "#/split"),
    ...workers.map((item) => nodeRef(item.node, item.path)),
    nodeRef(merge, "#/merge"),
  ]);

  const edges: EdgeSpec[] = [];
  let index = 1;
  for (const worker of workers) {
    edges.push(edge("diamond", index++, split.id, worker.node.id));
  }
  for (const worker of workers) {
    edges.push(edge("diamond", index++, worker.node.id, merge.id, { port: worker.key }));
  }
  return buildGraph(
    input,
    IDENTITIES.diamond,
    split.id,
    merge.id,
    [split, ...workers.map((item) => item.node), merge],
    edges,
  );
}

/**
 * Build classify → condition-annotated branches → merge. Each classifier edge
 * carries a package-owned, versioned `RouteEquals` annotation; callers cannot
 * supply or replace it. Native runtimes advertising the metadata-declared
 * `edge-condition-routing/v1alpha1` capability execute the selected route and
 * settle inactive branches without attempts.
 */
export function routedBranches(options: RoutedBranchesOptions): PatternGraph {
  const input = snapshotOptions(options, fields("classify", "branches", "merge", "routePolicy"));
  const parsedClassify = parseNode(input.classify, "#/classify");
  const branches = parseKeyedNodes(input.branches, "#/branches");
  const merge = parseNode(input.merge, "#/merge");
  const branchRoutes = branches.map((branch) => branch.key);
  const configsEqualRoutes = (policy: RouteSelectionPolicySnapshot): boolean =>
    policy.allowedRoutes.length === branchRoutes.length
      && policy.allowedRoutes.every((route, index) => route === branchRoutes[index]);
  const emptyClassifierConfig = expectRecord(parsedClassify.config, "#/classify/config");
  let classifierConfig: unknown;
  if (input.routePolicy !== undefined) {
    if (Object.keys(emptyClassifierConfig).length !== 0) {
      throw new PatternInputError(
        "GE_PATTERN_INVALID_INPUT",
        "routePolicy conflicts with a preconfigured classifier",
        "#/routePolicy",
      );
    }
    const validated = validateRouteSelectionPolicy(input.routePolicy);
    if (!validated.valid) {
      throw new PatternInputError(
        "GE_PATTERN_INVALID_INPUT",
        "routePolicy must be an exact route-selection policy",
        `#/routePolicy${validated.relativePath}`,
      );
    }
    if (!configsEqualRoutes(validated.policy)) {
      throw new PatternInputError(
        "GE_PATTERN_INVALID_INPUT",
        "routePolicy.allowedRoutes must equal normalized branch keys",
        "#/routePolicy/allowedRoutes",
      );
    }
    classifierConfig = input.routePolicy;
  } else if (Object.keys(emptyClassifierConfig).length === 0) {
    classifierConfig = { kind: "single", allowedRoutes: branchRoutes };
  } else {
    const validated = validateRouteSelectionPolicy(emptyClassifierConfig);
    if (!validated.valid) {
      throw new PatternInputError(
        "GE_PATTERN_INVALID_INPUT",
        "classifier config must be an exact route-selection policy",
        `#/classify/config${validated.relativePath}`,
      );
    }
    if (!configsEqualRoutes(validated.policy)) {
      throw new PatternInputError(
        "GE_PATTERN_INVALID_INPUT",
        "classifier allowedRoutes must equal normalized branch keys",
        "#/classify/config/allowedRoutes",
      );
    }
    classifierConfig = emptyClassifierConfig;
  }
  const classify = { ...parsedClassify, config: classifierConfig } as NodeSpec;
  assertUniqueNodeIds([
    nodeRef(classify, "#/classify"),
    ...branches.map((item) => nodeRef(item.node, item.path)),
    nodeRef(merge, "#/merge"),
  ]);

  const edges: EdgeSpec[] = [];
  let index = 1;
  for (const branch of branches) {
    edges.push(
      edge("routed-branches", index++, classify.id, branch.node.id, {
        condition: {
          apiVersion: ANNOTATION_API_VERSION,
          kind: "RouteEquals",
          routeKey: branch.key,
        },
      }),
    );
  }
  for (const branch of branches) {
    edges.push(
      edge("routed-branches", index++, branch.node.id, merge.id, { port: branch.key }),
    );
  }
  return buildGraph(
    input,
    IDENTITIES["routed-branches"],
    classify.id,
    merge.id,
    [classify, ...branches.map((item) => item.node), merge],
    edges,
  );
}

/**
 * Build work → parallel lens verifiers → adjudicate.
 *
 * Every verifier sees the complete work result. Each verifier verdict reaches a
 * unique adjudicator input port named by its lens key. The adjudicator is the
 * graph's named output endpoint.
 */
export function verifiedFanout(options: VerifiedFanoutOptions): PatternGraph {
  const input = snapshotOptions(options, fields("work", "verifiers", "adjudicate"));
  const work = parseNode(input.work, "#/work");
  const verifiers = parseKeyedNodes(input.verifiers, "#/verifiers");
  const adjudicate = parseNode(input.adjudicate, "#/adjudicate");
  assertUniqueNodeIds([
    nodeRef(work, "#/work"),
    ...verifiers.map((item) => nodeRef(item.node, item.path)),
    nodeRef(adjudicate, "#/adjudicate"),
  ]);

  const edges: EdgeSpec[] = [];
  let index = 1;
  for (const verifier of verifiers) {
    edges.push(edge("verified-fanout", index++, work.id, verifier.node.id));
  }
  for (const verifier of verifiers) {
    edges.push(
      edge("verified-fanout", index++, verifier.node.id, adjudicate.id, {
        port: verifier.key,
      }),
    );
  }
  return buildGraph(
    input,
    IDENTITIES["verified-fanout"],
    work.id,
    adjudicate.id,
    [work, ...verifiers.map((item) => item.node), adjudicate],
    edges,
  );
}

interface ParsedRound extends ParsedKeyedNode {
  find: NodeSpec;
  checkDry: NodeSpec;
}

function parseRounds(value: unknown): ParsedRound[] {
  const path = "#/rounds";
  if (!Array.isArray(value)) {
    throw new PatternInputError("GE_PATTERN_INVALID_INPUT", "expected an array", path);
  }
  if (value.length === 0) {
    throw new PatternInputError("GE_PATTERN_EMPTY_COLLECTION", "at least one round is required", path);
  }
  if (value.length > MAX_PATTERN_ITEMS) {
    throw new PatternInputError(
      "GE_PATTERN_TOO_MANY_ITEMS",
      `at most ${MAX_PATTERN_ITEMS} rounds are allowed`,
      path,
    );
  }
  const keys = new Set<string>();
  return value.map((item, index) => {
    const itemPath = `${path}/${index}`;
    const round = expectRecord(item, itemPath);
    assertEntryFields(round, new Set(["key", "find", "checkDry"]), itemPath);
    const key = safeKey(round.key, `${itemPath}/key`, "round key");
    if (keys.has(key)) {
      throw new PatternInputError(
        "GE_PATTERN_DUPLICATE_KEY",
        `duplicate round key '${key}'`,
        `${itemPath}/key`,
      );
    }
    keys.add(key);
    const findPath = `${itemPath}/find`;
    const checkPath = `${itemPath}/checkDry`;
    const find = parseNode(round.find, findPath);
    const checkDry = parseNode(round.checkDry, checkPath);
    return { key, node: checkDry, path: checkPath, find, checkDry };
  });
}

/**
 * **DECLARATIVE-ONLY WITH THE V1ALPHA1 SCHEDULER.**
 *
 * Statically unroll a bounded loop into an acyclic graph. `maxRounds` is
 * mandatory (1..100) and must equal `rounds.length`. Every round is explicitly
 * `find → checkDry`; each verdict flows to a unique finalize port, and every
 * non-final verdict also has a versioned `LoopContinue` annotation toward the
 * next finder. `finalize` is specified to select the earliest dry verdict.
 *
 * The graph this returns compiles, but **no scheduler in this repository runs
 * it**. The v1alpha1 runtime fails it closed before any executor is invoked:
 * every `LoopDryVerdict` / `LoopContinue` / `LoopVerdictAtBound` condition is
 * rejected as `UNSUPPORTED_EDGE_CONDITION`, because `edgeConditionError` admits
 * `RouteEquals` on a router and nothing else. Execution additionally requires
 * the metadata-declared `edge-condition-routing-and-early-stop/v1alpha1`
 * runtime capability, which no runtime implements. Treat this constructor as a
 * blueprint, not a runnable pattern.
 */
export function loopUntilDry(options: LoopUntilDryOptions): PatternGraph {
  const input = snapshotOptions(options, fields("maxRounds", "rounds", "finalize"));
  if (
    typeof input.maxRounds !== "number" ||
    !Number.isSafeInteger(input.maxRounds) ||
    input.maxRounds < 1 ||
    input.maxRounds > MAX_PATTERN_ITEMS
  ) {
    throw new PatternInputError(
      "GE_PATTERN_INVALID_MAX_ROUNDS",
      `maxRounds must be an integer from 1 through ${MAX_PATTERN_ITEMS}`,
      "#/maxRounds",
    );
  }
  const maxRounds = input.maxRounds;
  const rounds = parseRounds(input.rounds);
  if (rounds.length !== maxRounds) {
    throw new PatternInputError(
      "GE_PATTERN_ROUND_COUNT_MISMATCH",
      `rounds.length ${rounds.length} must equal maxRounds ${maxRounds}`,
      "#/rounds",
    );
  }
  const finalize = parseNode(input.finalize, "#/finalize");
  assertUniqueNodeIds([
    ...rounds.flatMap((round, index) => [
      nodeRef(round.find, `#/rounds/${index}/find`),
      nodeRef(round.checkDry, `#/rounds/${index}/checkDry`),
    ]),
    nodeRef(finalize, "#/finalize"),
  ]);

  const edges: EdgeSpec[] = [];
  let edgeIndex = 1;
  for (let index = 0; index < rounds.length; index += 1) {
    const round = rounds[index] as ParsedRound;
    const roundNumber = index + 1;
    edges.push(
      edge("loop-until-dry", edgeIndex++, round.find.id, round.checkDry.id, { port: "items" }),
    );
    edges.push(
      edge("loop-until-dry", edgeIndex++, round.checkDry.id, finalize.id, {
        port: round.key,
        condition: {
          apiVersion: ANNOTATION_API_VERSION,
          kind: index === rounds.length - 1 ? "LoopVerdictAtBound" : "LoopDryVerdict",
          maxRounds,
          round: roundNumber,
          roundKey: round.key,
        },
      }),
    );
    const next = rounds[index + 1];
    if (next !== undefined) {
      edges.push(
        edge("loop-until-dry", edgeIndex++, round.checkDry.id, next.find.id, {
          port: "previousVerdict",
          condition: {
            apiVersion: ANNOTATION_API_VERSION,
            kind: "LoopContinue",
            maxRounds,
            round: roundNumber,
            roundKey: round.key,
          },
        }),
      );
    }
  }

  return buildGraph(
    input,
    IDENTITIES["loop-until-dry"],
    (rounds[0] as ParsedRound).find.id,
    finalize.id,
    [
      ...rounds.flatMap((round) => [round.find, round.checkDry]),
      finalize,
    ],
    edges,
  );
}
