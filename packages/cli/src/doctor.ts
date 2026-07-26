import { readFile } from "node:fs/promises";

const API_VERSION = "graphengineering.reacher-z.github.io/v1alpha1";
const DIAMOND_HASH = "24819fe69f3b9449c79bcdd85b2049000c7cc8f313aab5957657a6078a80d288";
const SCHEMA_URL = new URL("../../assets/spec/graph.schema.json", import.meta.url);
const FIXTURE_URL = new URL("../../assets/spec/conformance/diamond.graph.json", import.meta.url);

export type DoctorCheckId =
  | "node.version"
  | "asset.graph-schema"
  | "asset.diamond-fixture"
  | "dependency.core"
  | "dependency.runtime";

export interface DoctorCheck {
  id: DoctorCheckId;
  status: "pass" | "fail";
  summary: string;
  detail: string;
}

export interface DoctorReport {
  healthy: boolean;
  checks: readonly DoctorCheck[];
  remediations: readonly string[];
}

interface DoctorProbes {
  nodeVersion?: string;
  readText?: (url: URL) => Promise<string>;
  importCore?: () => Promise<unknown>;
  importRuntime?: () => Promise<unknown>;
}

interface SuccessfulAttempt<T> {
  ok: true;
  value: T;
}

interface FailedAttempt {
  ok: false;
  message: string;
}

type Attempt<T> = SuccessfulAttempt<T> | FailedAttempt;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim() || "unknown error";
}

async function attempt<T>(operation: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }
}

function check(
  id: DoctorCheckId,
  summary: string,
  result: { ok: true; detail: string } | { ok: false; detail: string },
): DoctorCheck {
  return { id, status: result.ok ? "pass" : "fail", summary, detail: result.detail };
}

function nodeVersionCheck(version: string): DoctorCheck {
  const majorText = version.replace(/^v/, "").split(".")[0];
  const major = majorText === undefined ? Number.NaN : Number.parseInt(majorText, 10);
  return check(
    "node.version",
    "Node.js 20 or newer",
    Number.isInteger(major) && major >= 20
      ? { ok: true, detail: `Node.js ${version}` }
      : { ok: false, detail: `Detected Node.js ${version}; version 20 or newer is required.` },
  );
}

function schemaCheck(result: Attempt<unknown>): DoctorCheck {
  if (!result.ok) {
    return check("asset.graph-schema", "Bundled canonical Graph IR schema", {
      ok: false,
      detail: result.message,
    });
  }
  const properties = isRecord(result.value) && isRecord(result.value.properties)
    ? result.value.properties
    : null;
  const apiVersion = properties !== null && isRecord(properties.apiVersion)
    ? properties.apiVersion.const
    : undefined;
  const valid = result.value !== null && apiVersion === API_VERSION;
  return check(
    "asset.graph-schema",
    "Bundled canonical Graph IR schema",
    valid
      ? { ok: true, detail: `Readable schema for ${API_VERSION}.` }
      : { ok: false, detail: "Schema is readable but does not declare the supported API version." },
  );
}

type CoreCompiler = (document: unknown) => {
  valid: boolean;
  graphHash: string | null;
};

function coreCompiler(moduleValue: unknown): CoreCompiler | null {
  if (!isRecord(moduleValue) || typeof moduleValue.compileGraph !== "function") return null;
  return moduleValue.compileGraph as CoreCompiler;
}

function coreCheck(result: Attempt<unknown>): DoctorCheck {
  if (!result.ok) {
    return check("dependency.core", "Canonical core compiler", {
      ok: false,
      detail: result.message,
    });
  }
  return check(
    "dependency.core",
    "Canonical core compiler",
    coreCompiler(result.value) === null
      ? { ok: false, detail: "@graph-engineering/core does not export compileGraph." }
      : { ok: true, detail: "@graph-engineering/core exports compileGraph." },
  );
}

function fixtureCheck(fixture: Attempt<unknown>, core: Attempt<unknown>): DoctorCheck {
  if (!fixture.ok) {
    return check("asset.diamond-fixture", "Bundled diamond conformance fixture", {
      ok: false,
      detail: fixture.message,
    });
  }
  if (!isRecord(fixture.value) || fixture.value.kind !== "Graph") {
    return check("asset.diamond-fixture", "Bundled diamond conformance fixture", {
      ok: false,
      detail: "Fixture is readable but is not a Graph document.",
    });
  }

  const compiler = core.ok ? coreCompiler(core.value) : null;
  if (compiler === null) {
    return check("asset.diamond-fixture", "Bundled diamond conformance fixture", {
      ok: true,
      detail: "Fixture is readable; canonical compilation is covered by the core dependency check.",
    });
  }

  try {
    const compilation = compiler(fixture.value);
    const valid = compilation.valid && compilation.graphHash === DIAMOND_HASH;
    return check(
      "asset.diamond-fixture",
      "Bundled diamond conformance fixture",
      valid
        ? { ok: true, detail: `Canonical fixture hash ${DIAMOND_HASH}.` }
        : { ok: false, detail: "Fixture did not compile to the canonical diamond hash." },
    );
  } catch (error) {
    return check("asset.diamond-fixture", "Bundled diamond conformance fixture", {
      ok: false,
      detail: errorMessage(error),
    });
  }
}

function runtimeCheck(result: Attempt<unknown>): DoctorCheck {
  if (!result.ok) {
    return check("dependency.runtime", "Graph runtime package", {
      ok: false,
      detail: result.message,
    });
  }
  const available = isRecord(result.value) && typeof result.value.runGraph === "function";
  return check(
    "dependency.runtime",
    "Graph runtime package",
    available
      ? { ok: true, detail: "@graph-engineering/runtime exports runGraph." }
      : { ok: false, detail: "@graph-engineering/runtime does not export runGraph." },
  );
}

function remediations(checks: readonly DoctorCheck[]): string[] {
  const failed = new Set(checks.filter((item) => item.status === "fail").map((item) => item.id));
  const items: string[] = [];
  if (failed.has("node.version")) {
    items.push("Install Node.js 20 or newer and rerun graph doctor.");
  }
  if (failed.has("asset.graph-schema") || failed.has("asset.diamond-fixture")) {
    items.push("Reinstall @graph-engineering/cli so its bundled Graph IR assets are restored.");
  }
  if (failed.has("dependency.core") || failed.has("dependency.runtime")) {
    items.push(
      "Reinstall package dependencies and rebuild @graph-engineering/core and @graph-engineering/runtime.",
    );
  }
  return items.slice(0, 3);
}

/**
 * Run bounded, read-only local health checks.
 *
 * The production path reads only the two fixed package-owned asset URLs above
 * and resolves local package dependencies. It never inspects credentials,
 * accepts a filesystem path, or performs network I/O.
 */
export async function runDoctor(probes: DoctorProbes = {}): Promise<DoctorReport> {
  const readText = probes.readText ?? ((url: URL) => readFile(url, "utf8"));
  const [schema, fixture, core, runtime] = await Promise.all([
    attempt(async () => JSON.parse(await readText(SCHEMA_URL)) as unknown),
    attempt(async () => JSON.parse(await readText(FIXTURE_URL)) as unknown),
    attempt(probes.importCore ?? (async () => import("@graph-engineering/core"))),
    attempt(probes.importRuntime ?? (async () => import("@graph-engineering/runtime"))),
  ]);

  const checks: DoctorCheck[] = [
    nodeVersionCheck(probes.nodeVersion ?? process.versions.node),
    schemaCheck(schema),
    fixtureCheck(fixture, core),
    coreCheck(core),
    runtimeCheck(runtime),
  ];
  return {
    healthy: checks.every((item) => item.status === "pass"),
    checks,
    remediations: remediations(checks),
  };
}
