/**
 * The shell adapter: declaration, argument construction, and a refusal.
 *
 * No test here executes a process, and none can: the package imports no
 * `node:child_process` (see `no-host-io.test.ts`), so there is no code path to
 * enable and nothing to stub out.
 */

import { describe, expect, it } from "vitest";

import {
  SHELL_EXECUTION_BLOCKING_TASK,
  SHELL_EXECUTION_CAPABILITY_DOMAIN,
  SHELL_EXECUTION_DENIAL_REASON,
  SHELL_EXECUTION_ISOLATION_CODE,
  createShellAdapter,
  validateDescriptor,
  validateErrorEnvelope,
} from "../src/index.js";
import { corpus, descriptorFor, requestFrom } from "./corpus.js";

const descriptor = descriptorFor("shell-mock");
const profile = descriptor.process;

function adapter() {
  return createShellAdapter({
    descriptor,
    budgetPolicyAllowedProviderMetrics: corpus.budgetPolicyAllowedProviderMetrics,
    forbiddenMarkers: corpus.forbiddenMarkers,
  });
}

describe("declaration", () => {
  it("declares exactly one process profile, no network and no MCP", () => {
    expect(validateDescriptor(descriptor)).toBe(true);
    expect(descriptor.adapterKind).toBe("shell");
    expect(descriptor.network).toBeNull();
    expect(descriptor.mcp).toBeNull();
    expect(profile).not.toBeNull();
  });

  it("has no implicit shell and an explicit executable identity", () => {
    expect(profile?.shellExpansion).toBe(false);
    expect(profile?.argumentVector[0]).toBe(profile?.executablePath);
  });

  it("declares only the capabilities it can honour", () => {
    expect(adapter().capabilities()).toEqual(["cancellation"]);
    expect(adapter().supports("tool-calling")).toBe(false);
  });
});

describe("argument construction", () => {
  it("keeps the declared vector as an exact prefix and orders the environment", () => {
    const call = adapter().buildProcessCall({
      arguments: ["--input", "value"],
      environment: ["PATH", "GE_MOCK_MODE"],
    });
    expect(call.argumentVector).toEqual([
      "/usr/bin/ge-mock-tool",
      "--mock",
      "--input",
      "value",
    ]);
    expect(call.environment).toEqual(["GE_MOCK_MODE", "PATH"]);
    expect(call.stdinBytes).toBe(0);
  });

  it("produces a fully bounded launch plan without performing anything", () => {
    const planned = adapter().planLaunch(requestFrom(), { arguments: ["--list"] });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value).toEqual({
      executablePath: "/usr/bin/ge-mock-tool",
      argumentVector: ["/usr/bin/ge-mock-tool", "--mock", "--list"],
      workingDirectory: profile?.workingDirectory,
      environmentNames: [],
      stdinPolicy: profile?.stdinPolicy,
      stdinBytes: 0,
      shellExpansion: false,
      maxOutputBytes: profile?.maxOutputBytes,
      maxDurationMs: profile?.maxDurationMs,
      maxProcesses: profile?.maxProcesses,
      maxMemoryBytes: profile?.maxMemoryBytes,
      cancelSignal: profile?.cancelSignal,
    });
  });

  it.each([
    ["an environment variable outside the allowlist", { environment: ["SECRET_TOKEN"] }, "P-025", "environment-not-allowlisted"],
    ["stdin bytes against a closed stdin policy", { stdinBytes: 8 }, "P-026", "stdin-policy"],
    ["a NUL byte in an argument", { arguments: [`payload${String.fromCharCode(0)}injected`] }, "P-027", "executable-not-authorized"],
  ])("refuses %s", (_label, spec, rule, reason) => {
    const planned = adapter().planLaunch(requestFrom(), spec);
    expect(planned.ok).toBe(false);
    if (planned.ok) return;
    expect(planned.error.code).toBe("GE_ADAPTER_POLICY_DENIED");
    expect(planned.error.denialReason).toBe(reason);
    expect(
      planned.error.detail.providerSafeFields.find((field) => field.name === "rule")?.value,
    ).toBe(rule);
  });
});

describe("execution refuses while no isolation provider exists", () => {
  it("refuses with a structured, contract-valid capability denial", async () => {
    const outcome = await adapter().call(requestFrom());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const error = outcome.error;
    expect(error.code).toBe("GE_ADAPTER_POLICY_DENIED");
    expect(error.denialReason).toBe(SHELL_EXECUTION_DENIAL_REASON);
    expect(error.denialReason).toBe("capability-approval");
    // A pre-dispatch refusal: provably no external effect, no usage, no
    // provider identity, and the reservation may be released.
    expect(error.boundary).toBe("pre-dispatch");
    expect(error.effectDisposition).toBe("not-applied");
    expect(error.usageDisposition).toBe("none");
    expect(error.usage).toBeNull();
    expect(error.providerRequestId).toBeNull();
    expect(validateErrorEnvelope(descriptor, error, corpus.forbiddenMarkers)).toEqual({
      code: "GE_ADAPTER_POLICY_DENIED",
      ledgerAction: "release-reservation",
      requiresInDoubtRecord: false,
    });
  });

  it("carries the isolation contract's own vocabulary as provider-safe detail", async () => {
    const outcome = await adapter().call(requestFrom());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    const fields = new Map(
      outcome.error.detail.providerSafeFields.map((field) => [field.name, field.value]),
    );
    expect(fields.get("isolation-code")).toBe("GE_ISO_PROVIDER_UNSUPPORTED");
    expect(SHELL_EXECUTION_ISOLATION_CODE).toBe("GE_ISO_PROVIDER_UNSUPPORTED");
    expect(fields.get("capability-domain")).toBe(SHELL_EXECUTION_CAPABILITY_DOMAIN);
    expect(fields.get("blocking-task")).toBe(SHELL_EXECUTION_BLOCKING_TASK);
    expect(SHELL_EXECUTION_BLOCKING_TASK).toBe("D12-TS-ISOLATION-045");
    // The rule register names no rule for this refusal, and an implementation
    // may never invent a register identifier.
    expect(fields.get("rule")).toBe("none");
    expect(corpus.ruleRegister.map((row) => row.rule)).not.toContain("none");
  });

  it("reports the process rule first when the call itself is malformed", async () => {
    const outcome = await createShellAdapter({ descriptor }).call(
      requestFrom([
        {
          op: "replace",
          path: "/processCall",
          value: {
            argumentVector: ["/usr/bin/other-tool", "--mock"],
            environment: [],
            stdinBytes: 0,
          },
        },
      ]),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.denialReason).toBe("executable-not-authorized");
  });

  it("never returns a successful outcome", async () => {
    for (const spec of [{}, { arguments: ["--version"] }, { arguments: [] }]) {
      const planned = adapter().planLaunch(requestFrom(), spec);
      expect(planned.ok).toBe(true);
      const outcome = await adapter().call(requestFrom());
      expect(outcome.ok).toBe(false);
    }
  });
});
