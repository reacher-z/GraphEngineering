#!/usr/bin/env node

import { open, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GraphSourceFormat } from "@graph-engineering/core";
import { runDoctor, type DoctorReport } from "./doctor.js";
import type { InitReport } from "./init.js";
import type { GraphPlan } from "./planner.js";
import {
  decodeGraphInput,
  GraphInputFormatError,
  GraphInputSourceError,
  resolveGraphSourceFormat,
  type GraphInputFormat,
} from "./source-loader.js";
import type { ValidationResult } from "./validation.js";
import type { VisualizationFormat, VisualizationResult } from "./visualize.js";

const VERSION = "0.1.0-alpha.1";
export const MACHINE_SCHEMA_VERSION = "graph-engineering.cli/v1alpha1" as const;

export const EXIT_CODES = {
  success: 0,
  invalidGraph: 1,
  input: 2,
  unhealthy: 3,
  internal: 70,
} as const;

export type CommandName =
  | "validate"
  | "plan"
  | "compile"
  | "visualize"
  | "doctor"
  | "init";
export type CliExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export interface MachineError {
  code: string;
  message: string;
  format?: "json" | "yaml";
  path?: string | null;
  line?: number | null;
  column?: number | null;
}

export interface MachineEnvelope {
  schemaVersion: typeof MACHINE_SCHEMA_VERSION;
  command: CommandName | null;
  ok: boolean;
  exitCode: CliExitCode;
  data: Record<string, unknown> | null;
  error: MachineError | null;
}

interface ParsedCommand {
  command: CommandName;
  file: string | null;
  json: boolean;
  dryRun: boolean;
  format: VisualizationFormat | null;
  inputFormat: GraphInputFormat | null;
}

class CliError extends Error {
  readonly code: string;
  readonly exitCode: CliExitCode;
  readonly machineError: MachineError;
  readonly humanMessage: string;

  constructor(
    code: string,
    message: string,
    exitCode: CliExitCode = EXIT_CODES.input,
    details: Omit<MachineError, "code" | "message"> = {},
    humanMessage = message,
  ) {
    super(message);
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.machineError = { code, message, ...details };
    this.humanMessage = humanMessage;
  }
}

class InputTooLargeError extends Error {
  constructor() {
    super("Graph IR source exceeds the hard byte ceiling");
    this.name = "InputTooLargeError";
  }
}

function usage(): string {
  return `Graph Engineering CLI ${VERSION}

Usage:
  graph validate <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
  graph plan <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
  graph compile <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--json]
  graph visualize <graph.json|graph.yaml|-> [--input-format json|yaml|auto] [--format mermaid|dot] [--json]
  graph doctor [--json]
  graph init [directory] [--dry-run] [--json]
  graph --version
  graph --help

Commands:
  validate  Compile Graph IR and report stable diagnostics
  plan      Show deterministic topological layers without executing nodes
  compile   Return core-owned canonical Graph IR and SHA-256 without writing files
  visualize Render a read-only Mermaid (default) or DOT topology after compilation
  doctor    Run bounded, read-only local installation checks
  init      Safely create graph.json from the bundled research-diamond template

Exit codes:
  0 success/healthy
  1 invalid Graph IR
  2 usage/input error or refused safe initialization
  3 doctor found an unhealthy local installation
  70 unexpected internal error`;
}

function requestedJson(argv: readonly string[]): boolean {
  return argv.includes("--json");
}

function inferCommand(argv: readonly string[]): CommandName | null {
  return argv.find((argument): argument is CommandName =>
    argument === "validate" ||
    argument === "plan" ||
    argument === "compile" ||
    argument === "visualize" ||
    argument === "doctor" ||
    argument === "init"
  ) ?? null;
}

function parseArguments(argv: string[]): ParsedCommand | "help" | "version" {
  if (argv.includes("--help") || argv.includes("-h")) return "help";
  if (argv.includes("--version") || argv.includes("-v")) return "version";

  const jsonCount = argv.filter((argument) => argument === "--json").length;
  if (jsonCount > 1) {
    throw new CliError("GECLI_USAGE", "--json may be specified at most once");
  }
  const json = jsonCount === 1;
  const dryRunCount = argv.filter((argument) => argument === "--dry-run").length;
  if (dryRunCount > 1) {
    throw new CliError("GECLI_USAGE", "--dry-run may be specified at most once");
  }
  const dryRun = dryRunCount === 1;
  let formatValue: string | null = null;
  let formatCount = 0;
  let inputFormatValue: string | null = null;
  let inputFormatCount = 0;
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--json" || argument === "--dry-run") continue;
    if (argument === "--format") {
      formatCount += 1;
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliError("GECLI_USAGE", "--format requires mermaid or dot");
      }
      formatValue = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--format=")) {
      formatCount += 1;
      formatValue = argument.slice("--format=".length);
      continue;
    }
    if (argument === "--input-format") {
      inputFormatCount += 1;
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new CliError("GECLI_USAGE", "--input-format requires json, yaml, or auto");
      }
      inputFormatValue = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--input-format=")) {
      inputFormatCount += 1;
      inputFormatValue = argument.slice("--input-format=".length);
      continue;
    }
    if (argument !== undefined) positionals.push(argument);
  }
  if (formatCount > 1) {
    throw new CliError("GECLI_USAGE", "--format may be specified at most once");
  }
  if (inputFormatCount > 1) {
    throw new CliError("GECLI_USAGE", "--input-format may be specified at most once");
  }
  const [rawCommand, ...operands] = positionals;
  if (
    rawCommand !== "validate" &&
    rawCommand !== "plan" &&
    rawCommand !== "compile" &&
    rawCommand !== "visualize" &&
    rawCommand !== "doctor" &&
    rawCommand !== "init"
  ) {
    throw new CliError(
      "GECLI_USAGE",
      "expected command validate, plan, compile, visualize, doctor, or init",
    );
  }
  if (dryRun && rawCommand !== "init") {
    throw new CliError("GECLI_USAGE", "--dry-run is supported only by init");
  }
  if (formatCount > 0 && rawCommand !== "visualize") {
    throw new CliError("GECLI_USAGE", "--format is supported only by visualize");
  }
  if (inputFormatCount > 0 && (rawCommand === "doctor" || rawCommand === "init")) {
    throw new CliError(
      "GECLI_USAGE",
      `--input-format is not supported by ${rawCommand}`,
    );
  }
  const inputFormat = inputFormatValue === null || inputFormatValue === "auto"
    ? "auto"
    : inputFormatValue === "json" || inputFormatValue === "yaml"
      ? inputFormatValue
      : null;
  if (inputFormat === null) {
    throw new CliError(
      "GECLI_USAGE",
      `unsupported input format ${inputFormatValue}; expected json, yaml, or auto`,
    );
  }
  const format: VisualizationFormat | null = rawCommand === "visualize"
    ? formatValue === null || formatValue === "mermaid"
      ? "mermaid"
      : formatValue === "dot"
        ? "dot"
        : null
    : null;
  if (rawCommand === "visualize" && format === null) {
    throw new CliError(
      "GECLI_USAGE",
      `unsupported visualization format ${formatValue}; expected mermaid or dot`,
    );
  }

  if (rawCommand === "doctor") {
    if (operands.length > 0) {
      throw new CliError("GECLI_USAGE", "doctor does not accept a file or other operand");
    }
    return {
      command: rawCommand,
      file: null,
      json,
      dryRun: false,
      format: null,
      inputFormat: null,
    };
  }

  if (rawCommand === "init") {
    if (operands.length > 1) {
      throw new CliError("GECLI_USAGE", "init accepts at most one target directory");
    }
    const directory = operands[0] ?? ".";
    if (directory.startsWith("-") && directory !== "-") {
      throw new CliError(
        "GECLI_USAGE",
        `unknown option ${directory}; prefix a directory name with ./ if it begins with '-'`,
      );
    }
    return {
      command: rawCommand,
      file: directory,
      json,
      dryRun,
      format: null,
      inputFormat: null,
    };
  }

  if (operands.length !== 1 || operands[0] === undefined || operands[0].length === 0) {
    throw new CliError("GECLI_USAGE", `${rawCommand} requires exactly one Graph IR source`);
  }
  return {
    command: rawCommand,
    file: operands[0],
    json,
    dryRun: false,
    format,
    inputFormat,
  };
}

async function readGraph(path: string, inputFormat: GraphInputFormat): Promise<unknown> {
  let format: GraphSourceFormat;
  try {
    format = resolveGraphSourceFormat(path, inputFormat);
  } catch (error) {
    if (error instanceof GraphInputFormatError) {
      throw new CliError(error.code, error.message);
    }
    throw error;
  }

  const { MAX_GRAPH_SOURCE_BYTES: maxBytes } = await import("@graph-engineering/core");
  let source: Uint8Array;
  try {
    source = path === "-" ? await readStandardInput(maxBytes) : await readBoundedFile(path, maxBytes);
  } catch (error) {
    if (error instanceof InputTooLargeError) {
      const message = `Source exceeds the configured ${maxBytes}-byte limit`;
      const sourceName = path === "-" ? "standard input" : basename(path);
      throw new CliError("GE_SOURCE_TOO_LARGE", message, EXIT_CODES.input, {
        format,
        path: null,
        line: null,
        column: null,
      }, `invalid ${format.toUpperCase()} in ${sourceName}: ${message}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError("GECLI_INPUT_READ", `cannot read ${path}: ${message}`);
  }
  try {
    return await decodeGraphInput(source, path, format);
  } catch (error) {
    if (error instanceof GraphInputSourceError) {
      const projection = error.projection;
      const sourceName = path === "-" ? "standard input" : basename(path);
      const humanMessage =
        `invalid ${projection.format.toUpperCase()} in ${sourceName}: ${projection.message}`;
      throw new CliError(projection.code, projection.message, EXIT_CODES.input, {
        format: projection.format,
        path: projection.path,
        line: projection.line,
        column: projection.column,
      }, humanMessage);
    }
    throw error;
  }
}

async function readStandardInput(maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = maxBytes + 1 - total;
    if (remaining <= 0) throw new InputTooLargeError();
    const accepted = bytes.subarray(0, remaining);
    chunks.push(accepted);
    total += accepted.byteLength;
    if (total > maxBytes) throw new InputTooLargeError();
  }
  return Buffer.concat(chunks, total);
}

async function readBoundedFile(path: string, maxBytes: number): Promise<Uint8Array> {
  const handle = await open(path, "r");
  try {
    const metadata = await handle.stat();
    if (metadata.isFile() && metadata.size > maxBytes) {
      throw new InputTooLargeError();
    }

    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const buffer = Buffer.allocUnsafe(
        Math.min(64 * 1024, maxBytes + 1 - total),
      );
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) return Buffer.concat(chunks, total);
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      if (total > maxBytes) throw new InputTooLargeError();
    }
    throw new InputTooLargeError();
  } finally {
    await handle.close();
  }
}

function validationData(file: string, result: ValidationResult): Record<string, unknown> {
  return {
    file,
    valid: result.valid,
    graphName: result.graphName ?? null,
    graphHash: result.canonicalSha256,
    diagnosticCodes: result.diagnosticCodes,
    diagnostics: result.diagnostics,
  };
}

function planData(file: string, plan: GraphPlan): Record<string, unknown> {
  return {
    file,
    valid: true,
    graphName: plan.graphName,
    graphHash: plan.canonicalSha256,
    nodeCount: plan.nodeCount,
    edgeCount: plan.edgeCount,
    layerCount: plan.layerCount,
    maxParallelWidth: plan.maxParallelWidth,
    configuredMaxConcurrency: plan.configuredMaxConcurrency,
    topologicalLayers: plan.topologicalLayers,
  };
}

function compileData(file: string, result: ValidationResult): Record<string, unknown> {
  return {
    file,
    valid: result.valid,
    graphName: result.graphName ?? null,
    graphHash: result.canonicalSha256,
    canonicalGraph: result.canonicalGraph,
    canonicalBytes: result.canonicalGraph === null ? null : Buffer.byteLength(result.canonicalGraph, "utf8"),
    diagnosticCodes: result.diagnosticCodes,
    diagnostics: result.diagnostics,
  };
}

function visualizationData(
  graphHash: string,
  result: VisualizationResult,
): Record<string, unknown> {
  return {
    graphHash,
    format: result.format,
    content: result.content,
    nodeCount: result.nodeCount,
    edgeCount: result.edgeCount,
  };
}

function doctorData(report: DoctorReport): Record<string, unknown> {
  return {
    healthy: report.healthy,
    checks: report.checks,
    remediations: report.remediations,
  };
}

function initData(report: InitReport): Record<string, unknown> {
  return {
    targetDirectory: report.targetDirectory,
    dryRun: report.dryRun,
    created: report.created,
    directoryCreated: report.directoryCreated,
    wouldCreateDirectory: report.wouldCreateDirectory,
    files: report.files,
    template: report.template,
    graphHash: report.graphHash,
  };
}

function writeStdout(message: string): void {
  process.stdout.write(message.endsWith("\n") ? message : `${message}\n`);
}

function writeStderr(message: string): void {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
}

function isTerminalControl(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/** Preserve ordinary path text while making terminal controls visible and inert. */
function terminalSafeText(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isTerminalControl(codePoint)) {
      result += character;
      continue;
    }
    result += `\\u{${codePoint.toString(16).toUpperCase().padStart(4, "0")}}`;
  }
  return result;
}

function writeEnvelope(
  command: CommandName | null,
  exitCode: CliExitCode,
  data: Record<string, unknown> | null,
  error: MachineEnvelope["error"] = null,
): void {
  const envelope: MachineEnvelope = {
    schemaVersion: MACHINE_SCHEMA_VERSION,
    command,
    ok: exitCode === EXIT_CODES.success,
    exitCode,
    data,
    error,
  };
  // Machine mode has exactly one JSON document on stdout and no stderr output.
  writeStdout(JSON.stringify(envelope));
}

function printValidationHuman(file: string, result: ValidationResult): void {
  if (result.valid) {
    writeStdout(
      `✓ ${terminalSafeText(basename(file))} is a valid Graph Engineering graph\n` +
      `  sha256 ${result.canonicalSha256 ?? "unavailable"}`,
    );
    return;
  }
  let output =
    `✗ ${terminalSafeText(basename(file))} is invalid ` +
    `(${result.diagnostics.length} diagnostic(s))`;
  for (const item of result.diagnostics) {
    const location = item.path ?? item.nodeIds?.join(",") ?? item.edgeId;
    output +=
      `\n  ${item.code}` +
      `${location ? ` [${terminalSafeText(location)}]` : ""}: ` +
      terminalSafeText(item.message);
  }
  writeStderr(output);
}

function printPlanHuman(file: string, plan: GraphPlan): void {
  let output = `Graph plan: ${terminalSafeText(plan.graphName || basename(file))}`;
  output += `\n  ${plan.nodeCount} nodes · ${plan.edgeCount} edges · ${plan.layerCount} layers`;
  output +=
    `\n  max parallel width ${plan.maxParallelWidth} · concurrency ` +
    `${plan.configuredMaxConcurrency ?? "unbounded by graph policy"}`;
  plan.topologicalLayers.forEach((layer, index) => {
    output += `\n  ${index + 1}. ${layer.map(terminalSafeText).join(" | ")}`;
  });
  writeStdout(output);
}

function printCompileHuman(file: string, result: ValidationResult): void {
  if (!result.valid) {
    printValidationHuman(file, result);
    return;
  }
  const canonicalBytes = result.canonicalGraph === null
    ? "unavailable"
    : String(Buffer.byteLength(result.canonicalGraph, "utf8"));
  writeStdout(
    `✓ Compiled ${terminalSafeText(basename(file))}\n` +
    `  sha256 ${result.canonicalSha256 ?? "unavailable"}\n` +
    `  canonical bytes ${canonicalBytes}`,
  );
}

function printDoctorHuman(report: DoctorReport): void {
  let output = `Graph Engineering doctor: ${report.healthy ? "healthy" : "unhealthy"}`;
  for (const item of report.checks) {
    output +=
      `\n  ${item.status === "pass" ? "✓" : "✗"} ` +
      `${terminalSafeText(item.summary)}: ${terminalSafeText(item.detail)}`;
  }
  if (report.remediations.length > 0) {
    output += "\nRemediation:";
    report.remediations.forEach((item, index) => {
      output += `\n  ${index + 1}. ${terminalSafeText(item)}`;
    });
  }
  writeStdout(output);
}

function printInitHuman(report: InitReport): void {
  if (report.dryRun) {
    writeStdout(
      `Dry run: ${terminalSafeText(report.targetDirectory)}\n` +
      `${report.wouldCreateDirectory ? "  create target directory\n" : ""}` +
      `  create ${report.files.map(terminalSafeText).join(", ")}\n` +
      `  template ${terminalSafeText(report.template)}`,
    );
    return;
  }
  writeStdout(
    `✓ Initialized Graph Engineering project in ${terminalSafeText(report.targetDirectory)}\n` +
    `  created ${report.files.map(terminalSafeText).join(", ")}\n` +
    `  sha256 ${report.graphHash}`,
  );
}

function emitCliError(error: CliError, command: CommandName | null, json: boolean): CliExitCode {
  if (json) {
    writeEnvelope(command, error.exitCode, null, error.machineError);
  } else {
    writeStderr(
      `graph: ${terminalSafeText(error.humanMessage)}` +
      `${error.code === "GECLI_USAGE" ? "\nRun graph --help for usage." : ""}`,
    );
  }
  return error.exitCode;
}

function emitInternalError(error: unknown, command: CommandName | null, json: boolean): CliExitCode {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    writeEnvelope(command, EXIT_CODES.internal, null, {
      code: "GECLI_INTERNAL",
      message: `unexpected internal error: ${message}`,
    });
  } else {
    writeStderr(`graph: unexpected internal error: ${terminalSafeText(message)}`);
  }
  return EXIT_CODES.internal;
}

export async function run(argv: string[]): Promise<CliExitCode> {
  const json = requestedJson(argv);
  const inferredCommand = inferCommand(argv);
  let parsed: ParsedCommand | "help" | "version";
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    return error instanceof CliError
      ? emitCliError(error, inferredCommand, json)
      : emitInternalError(error, inferredCommand, json);
  }

  if (parsed === "help") {
    writeStdout(usage());
    return EXIT_CODES.success;
  }
  if (parsed === "version") {
    writeStdout(VERSION);
    return EXIT_CODES.success;
  }

  try {
    if (parsed.command === "init") {
      const directory = parsed.file;
      if (directory === null) throw new Error("init unexpectedly has no target directory");
      const { initializeGraphProject, InitError } = await import("./init.js");
      let report: InitReport;
      try {
        report = await initializeGraphProject(directory, { dryRun: parsed.dryRun });
      } catch (error) {
        if (error instanceof InitError) {
          throw new CliError(error.code, error.message);
        }
        throw error;
      }
      if (parsed.json) writeEnvelope(parsed.command, EXIT_CODES.success, initData(report));
      else printInitHuman(report);
      return EXIT_CODES.success;
    }

    if (parsed.command === "doctor") {
      const report = await runDoctor();
      const exitCode = report.healthy ? EXIT_CODES.success : EXIT_CODES.unhealthy;
      if (parsed.json) writeEnvelope(parsed.command, exitCode, doctorData(report));
      else printDoctorHuman(report);
      return exitCode;
    }

    const file = parsed.file;
    if (file === null) throw new Error(`${parsed.command} unexpectedly has no input file`);
    if (parsed.inputFormat === null) {
      throw new Error(`${parsed.command} unexpectedly has no input format`);
    }
    const document = await readGraph(file, parsed.inputFormat);
    const { validateGraphDocument } = await import("./validation.js");
    const validation = validateGraphDocument(document);
    const exitCode = validation.valid ? EXIT_CODES.success : EXIT_CODES.invalidGraph;

    if (parsed.command === "validate") {
      if (parsed.json) writeEnvelope(parsed.command, exitCode, validationData(file, validation));
      else printValidationHuman(file, validation);
      return exitCode;
    }

    if (parsed.command === "compile") {
      if (parsed.json) writeEnvelope(parsed.command, exitCode, compileData(file, validation));
      else printCompileHuman(file, validation);
      return exitCode;
    }

    if (parsed.command === "visualize") {
      if (!validation.valid || validation.graph === null) {
        if (parsed.json) writeEnvelope(parsed.command, exitCode, validationData(file, validation));
        else printValidationHuman(file, validation);
        return exitCode;
      }
      if (validation.canonicalSha256 === null || parsed.format === null) {
        throw new Error("valid visualization unexpectedly lacks a graph hash or format");
      }
      const { visualizeGraph } = await import("./visualize.js");
      const visualization = visualizeGraph(validation.graph, parsed.format);
      if (parsed.json) {
        writeEnvelope(
          parsed.command,
          EXIT_CODES.success,
          visualizationData(validation.canonicalSha256, visualization),
        );
      } else {
        writeStdout(visualization.content);
      }
      return EXIT_CODES.success;
    }

    if (!validation.valid || validation.graph === null) {
      if (parsed.json) writeEnvelope(parsed.command, exitCode, validationData(file, validation));
      else printValidationHuman(file, validation);
      return exitCode;
    }

    const { planGraph } = await import("./planner.js");
    const plan = planGraph(validation.graph, validation);
    if (parsed.json) writeEnvelope(parsed.command, EXIT_CODES.success, planData(file, plan));
    else printPlanHuman(file, plan);
    return EXIT_CODES.success;
  } catch (error) {
    return error instanceof CliError
      ? emitCliError(error, parsed.command, parsed.json)
      : emitInternalError(error, parsed.command, parsed.json);
  }
}

async function isEntrypoint(): Promise<boolean> {
  const argument = process.argv[1];
  if (argument === undefined) return false;
  try {
    return await realpath(fileURLToPath(import.meta.url)) === await realpath(resolve(argument));
  } catch {
    return fileURLToPath(import.meta.url) === resolve(argument);
  }
}

if (await isEntrypoint()) {
  process.exitCode = await run(process.argv.slice(2));
}
