#!/usr/bin/env node

/**
 * Conservative, read-only SQLite native-callsite discovery for P11 audits.
 *
 * This scanner intentionally does not claim route closure. It records a route
 * classification only when an exact SQL digest is already present in the P11
 * route fixture. Dynamic SQL, unresolved aliases, uncertain receivers, and
 * exact-but-unregistered SQL remain `unknown`.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_FIXTURE = "spec/sqlite-cursor-publication-owner-composition-p11.routes.json";
const SQL_ENTRY_METHODS = new Set([
  "exec", "execute", "executemany", "executescript", "prepare", "cursor",
  "execTrusted", "executeTrusted", "prepareTrusted", "prepareInternal",
]);
const STATEMENT_METHODS = new Set(["get", "all", "run", "iterate"]);
const ALL_METHODS = new Set([...SQL_ENTRY_METHODS, ...STATEMENT_METHODS]);
const COMPUTED_METHOD = "<computed>";
const SQLITE_CONNECTION_NATIVE_HELPERS = new Map([
  ["prepareSQLiteConnectionIntrinsic", Object.freeze({
    canonicalMethod: "prepareSQLiteConnectionIntrinsic",
    receiverKind: "database",
    sqlArgumentIndex: 1,
    sqlOrigin: "native-helper-direct-argument",
  })],
  ["iterateSQLiteStatementNativeIntrinsic", Object.freeze({
    canonicalMethod: "iterateSQLiteStatementNativeIntrinsic",
    receiverKind: "statement",
    sqlArgumentIndex: null,
    sqlOrigin: "native-statement-lineage",
  })],
  ["nextSQLiteStatementIteratorNativeIntrinsic", Object.freeze({
    canonicalMethod: "nextSQLiteStatementIteratorNativeIntrinsic",
    receiverKind: "iterator",
    sqlArgumentIndex: null,
    sqlOrigin: "native-iterator-lineage",
  })],
  ["returnSQLiteStatementIteratorNativeIntrinsic", Object.freeze({
    canonicalMethod: "returnSQLiteStatementIteratorNativeIntrinsic",
    receiverKind: "iterator",
    sqlArgumentIndex: null,
    sqlOrigin: "native-iterator-lineage",
  })],
]);
const WRITE_TOKENS = new Set(["ALTER", "CREATE", "DELETE", "DROP", "INSERT", "REPLACE", "UPDATE"]);
const READ_TOKENS = new Set(["EXPLAIN", "PRAGMA", "SELECT", "WITH"]);
const CONTROL_TOKENS = new Set(["ATTACH", "BEGIN", "COMMIT", "DETACH", "END", "RELEASE", "ROLLBACK", "SAVEPOINT", "VACUUM"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slash(value) {
  return value.split(path.sep).join("/");
}

export function compareUnicodeCodePoints(left, right) {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index].codePointAt(0) - rightPoints[index].codePointAt(0);
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function walkFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    compareUnicodeCodePoints(a.name, b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(target, predicate));
    else if (entry.isFile() && predicate(target)) result.push(target);
  }
  return result;
}

function canonicalDirectory(directory) {
  const resolved = path.resolve(directory);
  let canonical;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(`Repository root does not resolve to a directory: ${resolved}: ${error.message}`, {
      cause: error,
    });
  }
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error(`Repository root is not a directory: ${resolved}`);
  }
  return canonical;
}

function isContainedFilePath(root, target) {
  const relative = path.relative(root, target);
  return relative.length > 0
    && !path.isAbsolute(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`);
}

function resolveExplicitFile(root, input, optionName) {
  if (typeof input !== "string" || input.length === 0) {
    throw new Error(`${optionName} path must be a non-empty relative path`);
  }
  if (path.isAbsolute(input)) {
    throw new Error(`${optionName} path must be relative to the repository root: ${input}`);
  }
  const normalized = path.normalize(input);
  if (normalized === "." || normalized === ".." || slash(normalized) !== slash(input)) {
    throw new Error(`${optionName} path must use its canonical root-relative spelling: ${input}`);
  }
  const resolved = path.resolve(root, normalized);
  if (!isContainedFilePath(root, resolved)) {
    throw new Error(`${optionName} path escapes the repository root: ${input}`);
  }
  let canonical;
  try {
    canonical = fs.realpathSync(resolved);
  } catch (error) {
    throw new Error(`${optionName} path does not resolve to a file: ${input}: ${error.message}`, {
      cause: error,
    });
  }
  if (!isContainedFilePath(root, canonical)) {
    throw new Error(`${optionName} path resolves outside the repository root: ${input}`);
  }
  if (canonical !== resolved) {
    throw new Error(`${optionName} path is a non-canonical alias or symbolic link: ${input}`);
  }
  if (!fs.statSync(canonical).isFile()) {
    throw new Error(`${optionName} path is not a file: ${input}`);
  }
  return canonical;
}

function resolveExplicitFiles(root, inputs, optionName) {
  const files = inputs.map((input) => resolveExplicitFile(root, input, optionName));
  if (new Set(files).size !== files.length) {
    throw new Error(`${optionName} paths must not contain duplicate files`);
  }
  return files.sort(compareUnicodeCodePoints);
}

function loadTypeScript() {
  const packageJson = path.join(REPOSITORY_ROOT, "packages/sqlite/package.json");
  try {
    return createRequire(pathToFileURL(packageJson))("typescript");
  } catch (error) {
    throw new Error(`TypeScript compiler API is required for discovery: ${error.message}`);
  }
}

function createScope(parent = null) {
  return {
    expressions: new Map(),
    helpers: new Map(),
    methods: new Map(),
    parent,
    properties: new Map(),
    receivers: new Map(),
    thisReceiver: parent?.thisReceiver,
  };
}

function lookup(scope, field, name) {
  for (let current = scope; current; current = current.parent) {
    if (current[field].has(name)) return current[field].get(name);
  }
  return undefined;
}

function unwrapTs(ts, node) {
  let current = node;
  while (current && (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression?.(current)
  )) current = current.expression;
  return current;
}

function tsMember(ts, expression) {
  const node = unwrapTs(ts, expression);
  if (ts.isPropertyAccessExpression(node)) return { receiver: node.expression, method: node.name.text };
  if (ts.isElementAccessExpression(node) && node.argumentExpression && (
    ts.isStringLiteral(node.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)
  )) return { receiver: node.expression, method: node.argumentExpression.text };
  return null;
}

function tsNameHeuristic(name) {
  if (/^(audit|conn|connection|database|db)$/iu.test(name)) return "database";
  if (/(connection|database)$/iu.test(name)) return "database";
  if (/(cursor)$/iu.test(name)) return "cursor";
  if (/(statement|stmt)$/iu.test(name)) return "statement";
  return "unknown";
}

function unknownTsReceiver(name = null) {
  const hint = name === null ? "unknown" : tsNameHeuristic(name);
  return {
    aliasDepth: null,
    confidence: "unknown",
    evidence: "unresolved",
    family: "unknown",
    hint,
    kind: "unknown",
  };
}

function provenTsReceiver(kind, family, evidence, aliasDepth = 0) {
  return { aliasDepth, confidence: "proven", evidence, family, hint: kind, kind };
}

function aliasedTsReceiver(receiver, evidence) {
  if (receiver.confidence !== "proven") return unknownTsReceiver();
  return {
    ...receiver,
    aliasDepth: (receiver.aliasDepth ?? 0) + 1,
    evidence: `${evidence}:${receiver.evidence}`,
  };
}

function tsPropertyName(ts, name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)
      || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function tsHasModifier(ts, node, kind) {
  return node.modifiers?.some((modifier) => modifier.kind === kind) ?? false;
}

function isExactSQLiteConnectionModule(absolute, moduleSpecifier) {
  if (moduleSpecifier !== "./sqlite-connection.js") return false;
  const sourcePath = path.join(path.dirname(absolute), "sqlite-connection.ts");
  try {
    return fs.realpathSync(sourcePath) === sourcePath && fs.statSync(sourcePath).isFile();
  } catch {
    return false;
  }
}

function collectTsReceiverMetadata(ts, source, absolute) {
  const nativeTypes = new Map();
  const nativeHelpers = new Map();
  const wrapperTypes = new Set();
  const localClasses = new Map();
  const localInterfaces = new Set();
  const ambiguousLocalTypes = new Set();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
      for (const specifier of clause.namedBindings.elements) {
        const imported = specifier.propertyName?.text ?? specifier.name.text;
        const local = specifier.name.text;
        if (statement.moduleSpecifier.text === "node:sqlite") {
          if (imported === "DatabaseSync") nativeTypes.set(local, "database");
          if (imported === "StatementSync") nativeTypes.set(local, "statement");
        }
        if (isExactSQLiteConnectionModule(absolute, statement.moduleSpecifier.text)
            && imported === "SQLiteConnection") wrapperTypes.add(local);
        if (!clause.isTypeOnly && !specifier.isTypeOnly
            && isExactSQLiteConnectionModule(absolute, statement.moduleSpecifier.text)
            && SQLITE_CONNECTION_NATIVE_HELPERS.has(imported)) {
          nativeHelpers.set(local, SQLITE_CONNECTION_NATIVE_HELPERS.get(imported));
        }
      }
    }
  }
  function collectLocalTypes(node) {
    if (ts.isClassDeclaration(node) && node.name) {
      if (localClasses.has(node.name.text) || localInterfaces.has(node.name.text)) {
        ambiguousLocalTypes.add(node.name.text);
      }
      localClasses.set(node.name.text, node);
    }
    if (ts.isInterfaceDeclaration(node) && node.name) {
      if (localClasses.has(node.name.text) || localInterfaces.has(node.name.text)) {
        ambiguousLocalTypes.add(node.name.text);
      }
      localInterfaces.add(node.name.text);
    }
    ts.forEachChild(node, collectLocalTypes);
  }
  collectLocalTypes(source);
  if (path.basename(absolute) === "sqlite-connection.ts") wrapperTypes.add("SQLiteConnection");
  const classLineages = new Map();
  const resolving = new Set();
  function resolveClassLineage(name) {
    if (classLineages.has(name)) return classLineages.get(name);
    if (resolving.has(name)) return unknownTsReceiver(name);
    const declaration = localClasses.get(name);
    if (!declaration) return unknownTsReceiver(name);
    if (ambiguousLocalTypes.has(name)) {
      const unknown = unknownTsReceiver(name);
      classLineages.set(name, unknown);
      return unknown;
    }
    if (wrapperTypes.has(name)) {
      const known = provenTsReceiver("database", "wrapper", `sqlite-wrapper-class:${name}`);
      classLineages.set(name, known);
      return known;
    }
    resolving.add(name);
    const heritage = declaration.heritageClauses?.find(({ token }) =>
      token === ts.SyntaxKind.ExtendsKeyword)?.types;
    let lineage = unknownTsReceiver(name);
    if (heritage?.length === 1) {
      const expression = heritage[0].expression;
      const baseName = expression.getText().split(".").at(-1) ?? expression.getText();
      if (localClasses.has(baseName)) {
        const base = resolveClassLineage(baseName);
        if (base.confidence === "proven" && base.family !== "non-sqlite") {
          lineage = aliasedTsReceiver(base, `local-class-extends:${name}:${baseName}`);
        }
      } else if (localInterfaces.has(baseName)) {
        lineage = unknownTsReceiver(name);
      } else if (nativeTypes.has(baseName)) {
        const nativeKind = nativeTypes.get(baseName);
        lineage = provenTsReceiver(
          nativeKind,
          "native",
          `local-class-extends-node:sqlite:${name}:${baseName}`,
        );
      } else if (wrapperTypes.has(baseName)) {
        lineage = provenTsReceiver(
          "database",
          "wrapper",
          `local-class-extends-sqlite-wrapper:${name}:${baseName}`,
        );
      }
    }
    resolving.delete(name);
    classLineages.set(name, lineage);
    return lineage;
  }
  for (const name of localClasses.keys()) resolveClassLineage(name);
  return {
    ambiguousLocalTypes,
    classLineages,
    localClasses,
    localInterfaces,
    nativeTypes,
    nativeHelpers,
    wrapperTypes,
  };
}

function resolveTsNativeHelper(ts, expression, scope) {
  const node = unwrapTs(ts, expression);
  if (!ts.isIdentifier(node)) return null;
  return lookup(scope, "helpers", node.text) ?? null;
}

function tsBindingNames(ts, name, result = []) {
  if (ts.isIdentifier(name)) result.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) tsBindingNames(ts, element.name, result);
    }
  }
  return result;
}

function predeclareTsLexicalBindings(ts, statements, scope) {
  for (const statement of statements ?? []) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
        && statement.name) {
      scope.helpers.set(statement.name.text, null);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    const lexical = (statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) !== 0;
    if (!lexical) continue;
    for (const declaration of statement.declarationList.declarations) {
      for (const name of tsBindingNames(ts, declaration.name)) scope.helpers.set(name, null);
    }
  }
}

function predeclareTsVarBindings(ts, node, scope, root = node) {
  if (node !== root && ts.isFunctionLike(node)) return;
  if (ts.isVariableDeclarationList(node)
      && (node.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0) {
    for (const declaration of node.declarations) {
      for (const name of tsBindingNames(ts, declaration.name)) scope.helpers.set(name, null);
    }
  }
  ts.forEachChild(node, (child) => predeclareTsVarBindings(ts, child, scope, root));
}

function tsNativeHelperSql(ts, call, helper, scope) {
  if (helper.sqlArgumentIndex === null) {
    return {
      origin: helper.sqlOrigin,
      evidence: { shape: helper.sqlOrigin, status: "unknown" },
    };
  }
  return {
    origin: helper.sqlOrigin,
    evidence: resolveTsString(ts, call.arguments[helper.sqlArgumentIndex], scope),
  };
}

function tsReceiverFromType(ts, type, metadata) {
  if (!type) return unknownTsReceiver();
  if (ts.isUnionTypeNode(type)) {
    const material = type.types.filter((entry) => ![
      ts.SyntaxKind.NullKeyword,
      ts.SyntaxKind.UndefinedKeyword,
      ts.SyntaxKind.VoidKeyword,
    ].includes(entry.kind));
    if (material.length !== 1) return unknownTsReceiver();
    return tsReceiverFromType(ts, material[0], metadata);
  }
  const text = type.getText().replace(/^readonly\s+/u, "").replace(/<.*>$/u, "");
  const name = text.split(".").at(-1) ?? text;
  if (metadata.localClasses.has(name)) {
    return metadata.classLineages.get(name) ?? unknownTsReceiver(name);
  }
  if (metadata.localInterfaces.has(name)) return unknownTsReceiver(name);
  const nativeKind = metadata.nativeTypes.get(name);
  if (nativeKind) return provenTsReceiver(nativeKind, "native", `node:sqlite-type:${name}`);
  if (metadata.wrapperTypes.has(name)) {
    return provenTsReceiver("database", "wrapper", `sqlite-wrapper-type:${name}`);
  }
  if (name === "RegExp" || ["string", "number", "bigint", "boolean", "symbol"].includes(name)) {
    return provenTsReceiver("non-sqlite", "non-sqlite", `non-sqlite-type:${name}`);
  }
  return unknownTsReceiver();
}

function resolveTsString(ts, expression, scope, seen = new Set(), aliasShape = null) {
  const node = unwrapTs(ts, expression);
  if (!node) return { shape: aliasShape ?? "absent", status: "absent" };
  if (ts.isStringLiteral(node)) return { shape: aliasShape ?? "literal", status: "exact", value: node.text };
  if (ts.isNoSubstitutionTemplateLiteral(node)) return { shape: aliasShape ?? "static-template", status: "exact", value: node.text };
  if (ts.isTemplateExpression(node)) {
    const preview = [node.head.text, ...node.templateSpans.map((span) => "${" + span.expression.getText() + "}" + span.literal.text)].join("");
    return { interpolationCount: node.templateSpans.length, preview, shape: "interpolated-template", status: "dynamic" };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveTsString(ts, node.left, scope, seen);
    const right = resolveTsString(ts, node.right, scope, seen);
    if (left.status === "exact" && right.status === "exact") return { shape: aliasShape ?? "concatenated", status: "exact", value: left.value + right.value };
    return { shape: "interpolated-concatenation", status: "dynamic" };
  }
  if (ts.isIdentifier(node)) {
    const key = `id:${node.text}`;
    if (seen.has(key)) return { identifier: node.text, shape: "identifier-alias", status: "unknown" };
    const bound = lookup(scope, "expressions", node.text);
    if (!bound) return { identifier: node.text, shape: "identifier-alias", status: "unknown" };
    seen.add(key);
    const resolved = resolveTsString(ts, bound, scope, seen, "identifier-alias");
    seen.delete(key);
    return { ...resolved, identifier: node.text, shape: resolved.status === "exact" ? "identifier-alias" : resolved.shape };
  }
  const member = tsMember(ts, node);
  if (member) {
    const base = unwrapTs(ts, member.receiver);
    let object = base;
    if (ts.isIdentifier(base)) object = unwrapTs(ts, lookup(scope, "expressions", base.text) ?? base);
    if (ts.isObjectLiteralExpression(object)) {
      for (const property of object.properties) {
        if (ts.isPropertyAssignment(property) && property.name.getText().replace(/^['"]|['"]$/gu, "") === member.method) {
          const resolved = resolveTsString(ts, property.initializer, scope, seen, "member-alias");
          return { ...resolved, member: member.method, shape: resolved.status === "exact" ? "member-alias" : resolved.shape };
        }
      }
    }
    return { member: member.method, shape: "member-alias", status: "unknown" };
  }
  if (ts.isConditionalExpression(node)) {
    const yes = resolveTsString(ts, node.whenTrue, scope, seen);
    const no = resolveTsString(ts, node.whenFalse, scope, seen);
    if (yes.status === "exact" && no.status === "exact" && yes.value === no.value) return { shape: "conditional-same-exact", status: "exact", value: yes.value };
    return { shape: "conditional", status: "dynamic" };
  }
  return { preview: node.getText().slice(0, 160), shape: "expression", status: "unknown" };
}

function inferTsReceiver(ts, expression, scope, metadata, seen = new Set()) {
  const node = unwrapTs(ts, expression);
  if (!node) return unknownTsReceiver();
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return unknownTsReceiver(node.text);
    const known = lookup(scope, "receivers", node.text);
    if (known) return known;
    const bound = lookup(scope, "expressions", node.text);
    if (bound) {
      seen.add(node.text);
      const inferred = inferTsReceiver(ts, bound, scope, metadata, seen);
      seen.delete(node.text);
      if (inferred.confidence === "proven") return aliasedTsReceiver(inferred, `identifier:${node.text}`);
    }
    return unknownTsReceiver(node.text);
  }
  if (node.kind === ts.SyntaxKind.ThisKeyword) {
    return scope.thisReceiver ?? unknownTsReceiver("this");
  }
  if (ts.isRegularExpressionLiteral(node)) {
    return provenTsReceiver("non-sqlite", "non-sqlite", "regexp-literal");
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)
      || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return provenTsReceiver("non-sqlite", "non-sqlite", "primitive-literal");
  }
  if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) {
    return provenTsReceiver("non-sqlite", "non-sqlite", "local-literal");
  }
  if (ts.isNewExpression(node)) {
    const name = node.expression.getText().split(".").at(-1) ?? node.expression.getText();
    if (metadata.localClasses.has(name)) {
      return metadata.classLineages.get(name) ?? unknownTsReceiver(name);
    }
    if (metadata.localInterfaces.has(name)) return unknownTsReceiver(name);
    const nativeKind = metadata.nativeTypes.get(name);
    if (nativeKind) return provenTsReceiver(nativeKind, "native", `node:sqlite-constructor:${name}`);
    if (metadata.wrapperTypes.has(name)) {
      return provenTsReceiver("database", "wrapper", `sqlite-wrapper-constructor:${name}`);
    }
    if (name === "RegExp") {
      return provenTsReceiver("non-sqlite", "non-sqlite", `non-sqlite-constructor:${name}`);
    }
  }
  if (ts.isCallExpression(node)) {
    const called = tsMember(ts, node.expression);
    if (called && /^prepare/u.test(called.method)) {
      const lower = inferTsReceiver(ts, called.receiver, scope, metadata, seen);
      // A wrapper instance's own method name does not prove its return type.
      // Imported/typed wrapper handles and properties are separately trusted,
      // but cross-method flow stays unknown without a local native lineage.
      return lower.kind === "database" && lower.confidence === "proven"
          && !lower.evidence.startsWith("sqlite-wrapper-class:")
        ? { ...aliasedTsReceiver(lower, `prepare-return:${called.method}`), hint: "statement", kind: "statement" }
        : unknownTsReceiver();
    }
    if (called?.method === "cursor") {
      const lower = inferTsReceiver(ts, called.receiver, scope, metadata, seen);
      return lower.kind === "database" && lower.confidence === "proven"
        ? { ...aliasedTsReceiver(lower, "cursor-return"), hint: "cursor", kind: "cursor" }
        : unknownTsReceiver();
    }
  }
  const member = tsMember(ts, node);
  if (member) {
    const property = member.method.replace(/^#/u, "");
    const base = unwrapTs(ts, member.receiver);
    if (base.kind === ts.SyntaxKind.ThisKeyword) {
      const known = lookup(scope, "properties", property);
      return known ? aliasedTsReceiver(known, `this-property:${property}`) : unknownTsReceiver(property);
    }
    if (ts.isIdentifier(base)) {
      const bound = lookup(scope, "expressions", base.text);
      const object = unwrapTs(ts, bound);
      if (object && ts.isObjectLiteralExpression(object)) {
        for (const entry of object.properties) {
          if (!ts.isPropertyAssignment(entry) || tsPropertyName(ts, entry.name) !== property) continue;
          const inferred = inferTsReceiver(ts, entry.initializer, scope, metadata, seen);
          return inferred.confidence === "proven"
            ? aliasedTsReceiver(inferred, `object-property:${base.text}.${property}`)
            : unknownTsReceiver(property);
        }
      }
    }
    return unknownTsReceiver(property);
  }
  return unknownTsReceiver();
}

function tsSqlForCall(ts, call, method, receiver, scope) {
  if (method === "cursor") return { origin: "none", evidence: { shape: "absent", status: "absent" } };
  if (STATEMENT_METHODS.has(method) && (receiver.kind === "statement" || receiver.hint === "statement")) {
    const target = unwrapTs(ts, tsMember(ts, call.expression)?.receiver);
    let source = target;
    if (ts.isIdentifier(target)) source = unwrapTs(ts, lookup(scope, "expressions", target.text) ?? target);
    if (ts.isCallExpression(source)) {
      const prepared = tsMember(ts, source.expression);
      if (prepared && /^prepare/u.test(prepared.method)) {
        return { origin: "prepared-statement", evidence: resolveTsString(ts, source.arguments[0], scope) };
      }
    }
    return { origin: "prepared-statement-unresolved", evidence: { shape: "prepared-lineage", status: "unknown" } };
  }
  return { origin: "direct-argument", evidence: resolveTsString(ts, call.arguments[0], scope) };
}

function scanTypeScriptFile(ts, absolute, root) {
  const text = fs.readFileSync(absolute, "utf8");
  const source = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const metadata = collectTsReceiverMetadata(ts, source, absolute);
  const callsites = [];

  function visit(node, scope) {
    let active = scope;
    if (ts.isBlock(node)) {
      active = createScope(scope);
      predeclareTsLexicalBindings(ts, node.statements, active);
    }
    if (ts.isCatchClause(node)) {
      active = createScope(scope);
      if (node.variableDeclaration) {
        for (const name of tsBindingNames(ts, node.variableDeclaration.name)) {
          active.helpers.set(name, null);
        }
      }
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
      active = createScope(scope);
      const initializer = node.initializer;
      if (initializer && ts.isVariableDeclarationList(initializer)) {
        for (const declaration of initializer.declarations) {
          for (const name of tsBindingNames(ts, declaration.name)) active.helpers.set(name, null);
        }
      }
    }
    if (ts.isSwitchStatement(node)) {
      active = createScope(scope);
      predeclareTsLexicalBindings(
        ts,
        node.caseBlock.clauses.flatMap((clause) => [...clause.statements]),
        active,
      );
    }
    if (ts.isClassLike(node)) {
      active = createScope(scope);
      const className = node.name?.text ?? "<anonymous>";
      active.thisReceiver = metadata.classLineages.get(className) ?? unknownTsReceiver("this");
      for (const member of node.members) {
        if (!ts.isPropertyDeclaration(member)) continue;
        if (tsHasModifier(ts, member, ts.SyntaxKind.StaticKeyword)) continue;
        const name = tsPropertyName(ts, member.name)?.replace(/^#/u, "");
        if (!name) continue;
        const typed = tsReceiverFromType(ts, member.type, metadata);
        if (typed.confidence === "proven") active.properties.set(name, typed);
        else if (member.initializer) {
          const inferred = inferTsReceiver(ts, member.initializer, active, metadata);
          if (inferred.confidence === "proven") active.properties.set(name, inferred);
        }
      }
    }
    if (ts.isPropertyDeclaration(node)
        && tsHasModifier(ts, node, ts.SyntaxKind.StaticKeyword)) {
      active = createScope(scope);
      active.thisReceiver = unknownTsReceiver("this");
    }
    if (ts.isClassStaticBlockDeclaration?.(node)) {
      active = createScope(scope);
      active.thisReceiver = unknownTsReceiver("this");
    }
    if (ts.isFunctionLike(node) && node !== source) {
      active = createScope(scope);
      if (!ts.isArrowFunction(node)) {
        const instanceClassMember = ts.isClassLike(node.parent)
          && !tsHasModifier(ts, node, ts.SyntaxKind.StaticKeyword);
        active.thisReceiver = instanceClassMember
          ? scope.thisReceiver ?? unknownTsReceiver("this")
          : unknownTsReceiver("this");
      }
      if (node.name && ts.isIdentifier(node.name)) active.helpers.set(node.name.text, null);
      if (node.body) predeclareTsVarBindings(ts, node.body, active);
      for (const parameter of node.parameters ?? []) {
        for (const name of tsBindingNames(ts, parameter.name)) active.helpers.set(name, null);
        if (!ts.isIdentifier(parameter.name)) continue;
        const typed = tsReceiverFromType(ts, parameter.type, metadata);
        active.receivers.set(parameter.name.text, typed.confidence === "proven"
          ? typed
          : unknownTsReceiver(parameter.name.text));
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.initializer) active.expressions.set(node.name.text, node.initializer);
      const declarationList = node.parent;
      const immutable = ts.isVariableDeclarationList(declarationList)
        && (declarationList.flags & ts.NodeFlags.Const) !== 0;
      const helper = immutable && node.initializer
        ? resolveTsNativeHelper(ts, node.initializer, active)
        : null;
      active.helpers.set(node.name.text, helper);
      const typed = tsReceiverFromType(ts, node.type, metadata);
      const inferred = node.initializer
        ? inferTsReceiver(ts, node.initializer, active, metadata)
        : unknownTsReceiver(node.name.text);
      active.receivers.set(node.name.text, typed.confidence === "proven"
        ? typed
        : inferred.confidence === "proven"
          ? aliasedTsReceiver(inferred, `variable:${node.name.text}`)
          : unknownTsReceiver(node.name.text));
      const member = node.initializer && tsMember(ts, node.initializer);
      if (member && ALL_METHODS.has(member.method)) {
        active.methods.set(node.name.text, { method: member.method, receiver: member.receiver });
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      active.expressions.set(node.left.text, node.right);
      const inferred = inferTsReceiver(ts, node.right, active, metadata);
      active.receivers.set(node.left.text, inferred.confidence === "proven"
        ? aliasedTsReceiver(inferred, `assignment:${node.left.text}`)
        : unknownTsReceiver(node.left.text));
      active.methods.delete(node.left.text);
      active.helpers.set(node.left.text, null);
    }

    if (ts.isCallExpression(node)) {
      const nativeHelper = resolveTsNativeHelper(ts, node.expression, active);
      if (nativeHelper !== null) {
        const position = source.getLineAndCharacterOfPosition(node.getStart(source));
        const sql = tsNativeHelperSql(ts, node, nativeHelper, active);
        callsites.push({
          column: position.character + 1,
          language: "typescript",
          line: position.line + 1,
          method: nativeHelper.canonicalMethod,
          methodAlias: ts.isIdentifier(unwrapTs(ts, node.expression))
            && unwrapTs(ts, node.expression).text !== nativeHelper.canonicalMethod,
          path: slash(path.relative(root, absolute)),
          receiverConfidence: "proven",
          receiverEvidence: `sqlite-connection-native-helper-import:${nativeHelper.canonicalMethod}`,
          receiverEvidenceAliasDepth: 1,
          receiverFamily: "native",
          receiverKindHint: nativeHelper.receiverKind,
          receiverKind: nativeHelper.receiverKind,
          sqlEvidence: sql.evidence,
          sqlOrigin: sql.origin,
        });
      }
      let method;
      let receiverExpression;
      let alias = false;
      const member = tsMember(ts, node.expression);
      if (member) ({ method, receiver: receiverExpression } = member);
      else if (ts.isIdentifier(node.expression)) {
        const bound = lookup(active, "methods", node.expression.text);
        if (bound) ({ method, receiver: receiverExpression } = bound, alias = true);
      } else {
        const callable = unwrapTs(ts, node.expression);
        if (ts.isElementAccessExpression(callable) && callable.argumentExpression) {
          method = COMPUTED_METHOD;
          receiverExpression = callable.expression;
        }
      }
      if (method && (ALL_METHODS.has(method) || method === COMPUTED_METHOD)) {
        const receiver = inferTsReceiver(ts, receiverExpression, active, metadata);
        const include = SQL_ENTRY_METHODS.has(method)
          || (receiver.kind !== "unknown" && receiver.kind !== "non-sqlite")
          || (STATEMENT_METHODS.has(method) && receiver.hint === "statement");
        if (include) {
          const position = source.getLineAndCharacterOfPosition(node.getStart(source));
          const sql = method === COMPUTED_METHOD
            ? { origin: "computed-method", evidence: resolveTsString(ts, node.arguments[0], active) }
            : tsSqlForCall(ts, node, method, receiver, active);
          callsites.push({
            column: position.character + 1,
            language: "typescript",
            line: position.line + 1,
            method,
            methodAlias: alias,
            path: slash(path.relative(root, absolute)),
            receiverConfidence: receiver.confidence,
            receiverEvidence: receiver.evidence,
            receiverEvidenceAliasDepth: receiver.aliasDepth,
            receiverFamily: receiver.family,
            receiverKindHint: receiver.hint,
            receiverKind: receiver.kind,
            sqlEvidence: sql.evidence,
            sqlOrigin: sql.origin,
          });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, active));
  }
  const rootScope = createScope();
  for (const [name, helper] of metadata.nativeHelpers) rootScope.helpers.set(name, helper);
  predeclareTsLexicalBindings(ts, source.statements, rootScope);
  predeclareTsVarBindings(ts, source, rootScope);
  visit(source, rootScope);
  return callsites;
}

const PYTHON_SCANNER = String.raw`
import ast, hashlib, json, pathlib, sys

METHODS={"exec","execute","executemany","executescript","prepare","cursor","get","all","run","iterate"}
SQL_ENTRY={"exec","execute","executemany","executescript","prepare","cursor"}

class Scope:
 def __init__(self,parent=None): self.parent=parent; self.expr={}; self.recv={}; self.methods={}; self.helpers={}
 def get(self,field,name):
  cur=self
  while cur:
   table=getattr(cur,field)
   if name in table:return table[name]
   cur=cur.parent
  return None

def guess(name):
 low=name.lower()
 if low in {"audit","conn","connection","database","db"} or low.endswith(("connection","database")):return {"kind":"database","confidence":"heuristic"}
 if low.endswith("cursor"):return {"kind":"cursor","confidence":"heuristic"}
 if low.endswith(("statement","stmt")):return {"kind":"statement","confidence":"heuristic"}
 return {"kind":"unknown","confidence":"unknown"}

def member(node):
 return (node.value,node.attr) if isinstance(node,ast.Attribute) else (None,None)

def resolve_string(node,scope,seen=None,alias_shape=None):
 seen=set() if seen is None else seen
 if node is None:return {"status":"absent","shape":alias_shape or "absent"}
 if isinstance(node,ast.Constant) and isinstance(node.value,str):return {"status":"exact","shape":alias_shape or "literal","value":node.value}
 if isinstance(node,ast.JoinedStr):
  if all(isinstance(x,ast.Constant) and isinstance(x.value,str) for x in node.values):return {"status":"exact","shape":alias_shape or "static-fstring","value":"".join(x.value for x in node.values)}
  return {"status":"dynamic","shape":"interpolated-fstring","interpolationCount":sum(isinstance(x,ast.FormattedValue) for x in node.values)}
 if isinstance(node,ast.BinOp) and isinstance(node.op,ast.Add):
  a=resolve_string(node.left,scope,seen);b=resolve_string(node.right,scope,seen)
  if a["status"]==b["status"]=="exact":return {"status":"exact","shape":alias_shape or "concatenated","value":a["value"]+b["value"]}
  return {"status":"dynamic","shape":"interpolated-concatenation"}
 if isinstance(node,ast.Name):
  if node.id in seen:return {"status":"unknown","shape":"identifier-alias","identifier":node.id}
  bound=scope.get("expr",node.id)
  if bound is None:return {"status":"unknown","shape":"identifier-alias","identifier":node.id}
  seen.add(node.id);out=resolve_string(bound,scope,seen,"identifier-alias");seen.remove(node.id);out["identifier"]=node.id
  if out["status"]=="exact":out["shape"]="identifier-alias"
  return out
 if isinstance(node,ast.Attribute):return {"status":"unknown","shape":"member-alias","member":node.attr}
 if isinstance(node,ast.IfExp):
  a=resolve_string(node.body,scope,seen);b=resolve_string(node.orelse,scope,seen)
  if a.get("status")==b.get("status")=="exact" and a.get("value")==b.get("value"):return {"status":"exact","shape":"conditional-same-exact","value":a["value"]}
  return {"status":"dynamic","shape":"conditional"}
 return {"status":"unknown","shape":"expression","preview":ast.unparse(node)[:160]}

def infer(node,scope,seen=None):
 seen=set() if seen is None else seen
 if node is None:return {"kind":"unknown","confidence":"unknown"}
 if isinstance(node,ast.Name):
  known=scope.get("recv",node.id)
  if known:return known
  if node.id not in seen:
   bound=scope.get("expr",node.id)
   if bound is not None:
    seen.add(node.id);out=infer(bound,scope,seen);seen.remove(node.id)
    if out["kind"]!="unknown":return out
  return guess(node.id)
 if isinstance(node,ast.Call):
  base,name=member(node.func);lower=infer(base,scope,seen)
  if name=="cursor" and lower["kind"]=="database":return {"kind":"cursor","confidence":lower["confidence"]}
  if name and name.startswith("prepare") and lower["kind"]=="database":return {"kind":"statement","confidence":lower["confidence"]}
  if name in {"execute","executemany"} and lower["kind"] in {"database","cursor"}:return {"kind":"cursor","confidence":lower["confidence"]}
 if isinstance(node,ast.Attribute):
  own=guess(node.attr)
  if own["kind"]!="unknown":return own
  return infer(node.value,scope,seen)
 return {"kind":"unknown","confidence":"unknown"}

NATIVE_PROJECTION_HELPERS={
 "owner_execute":("database","native-helper-direct-argument",1),
 "cursor_fetchmany":("cursor","native-cursor-fetch-lineage",None),
 "cursor_close":("cursor","native-cursor-retirement-lineage",None),
}
NATIVE_PROJECTION_BINDINGS={
 "owner_execute":("_NATIVE_PROJECTION_OWNER_EXECUTE","SQLiteV1BaselineConnectionOwner.execute"),
 "cursor_fetchmany":("_NATIVE_PROJECTION_CURSOR_FETCHMANY","_SQLiteCursorCapability.fetchmany"),
 "cursor_close":("_NATIVE_PROJECTION_CURSOR_CLOSE","_SQLiteCursorCapability.close"),
}

def dotted(node):
 if isinstance(node,ast.Name):return node.id
 if isinstance(node,ast.Attribute):
  base=dotted(node.value)
  return f"{base}.{node.attr}" if base else None
 return None

def exact_named_function(tree,name):
 found=[node for node in tree.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name==name]
 return found[0] if len(found)==1 else None

def direct_assignments(function):
 result={}
 for statement in function.body:
  if isinstance(statement,ast.Assign) and len(statement.targets)==1 and isinstance(statement.targets[0],ast.Name):
   result.setdefault(statement.targets[0].id,[]).append(statement.value)
  elif isinstance(statement,ast.AnnAssign) and isinstance(statement.target,ast.Name) and statement.value is not None:
   result.setdefault(statement.target.id,[]).append(statement.value)
 return result

def prove_native_projection_helpers(tree):
 implementation=exact_named_function(tree,"_produce_sqlite_v1_baseline_native_projection_receipt_implementation")
 binder=exact_named_function(tree,"_bind_sqlite_v1_baseline_native_projection_producer")
 if implementation is None or binder is None:return (None,{})
 parameters=[argument.arg for argument in implementation.args.posonlyargs+implementation.args.args]
 if len(parameters)<11 or parameters[8:11]!=list(NATIVE_PROJECTION_HELPERS):return (None,{})
 module_assignments={}
 for statement in tree.body:
  if isinstance(statement,ast.Assign) and len(statement.targets)==1 and isinstance(statement.targets[0],ast.Name):
   module_assignments.setdefault(statement.targets[0].id,[]).append(statement.value)
  elif isinstance(statement,ast.AnnAssign) and isinstance(statement.target,ast.Name) and statement.value is not None:
   module_assignments.setdefault(statement.target.id,[]).append(statement.value)
 binder_assignments=direct_assignments(binder)
 for parameter,(binding,qualified) in NATIVE_PROJECTION_BINDINGS.items():
  if len(module_assignments.get(binding,()))!=1 or dotted(module_assignments[binding][0])!=qualified:return (None,{})
  if len(binder_assignments.get(parameter,()))!=1 or dotted(binder_assignments[parameter][0])!=binding:return (None,{})
  if any(isinstance(node,ast.Name) and isinstance(node.ctx,ast.Store) and node.id==parameter for node in ast.walk(implementation)):
   return (None,{})
 produce=[node for node in binder.body if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)) and node.name=="produce"]
 if len(produce)!=1:return (None,{})
 binder_returns=[node for node in binder.body if isinstance(node,ast.Return)]
 if len(binder_returns)!=1 or dotted(binder_returns[0].value)!="produce":return (None,{})
 if any(isinstance(node,ast.Name) and isinstance(node.ctx,ast.Store) and node.id=="implementation" for node in ast.walk(binder)):return (None,{})
 if any(isinstance(node,ast.Name) and isinstance(node.ctx,ast.Store) and node.id in NATIVE_PROJECTION_HELPERS for node in ast.walk(produce[0])):return (None,{})
 returns=[node for node in ast.walk(produce[0]) if isinstance(node,ast.Return)]
 if len(returns)!=1 or not isinstance(returns[0].value,ast.Call):return (None,{})
 implementation_call=returns[0].value
 if dotted(implementation_call.func)!="implementation" or len(implementation_call.args)<11:return (None,{})
 if [dotted(implementation_call.args[index]) for index in (8,9,10)]!=list(NATIVE_PROJECTION_HELPERS):return (None,{})
 install_name="_install_sqlite_cursor_publication_native_projection_producer_intrinsic"
 all_installs=[node for node in ast.walk(tree) if isinstance(node,ast.Call) and dotted(node.func)==install_name]
 top_level_installs=[statement.value for statement in tree.body if isinstance(statement,ast.Expr) and isinstance(statement.value,ast.Call) and dotted(statement.value.func)==install_name]
 if len(all_installs)!=1 or len(top_level_installs)!=1 or all_installs[0] is not top_level_installs[0]:return (None,{})
 install=top_level_installs[0]
 if len(install.args)!=1 or install.keywords:return (None,{})
 bound=install.args[0]
 if not isinstance(bound,ast.Call) or dotted(bound.func)!="_bind_sqlite_v1_baseline_native_projection_producer" or len(bound.args)!=1 or bound.keywords or dotted(bound.args[0])!=implementation.name:return (None,{})
 return (implementation,NATIVE_PROJECTION_HELPERS)

class Scanner(ast.NodeVisitor):
 def __init__(self,file,root,tree):
  self.file=file;self.root=root;self.scope=Scope();self.out=[]
  self.native_projection_implementation,self.native_projection_helpers=prove_native_projection_helpers(tree)
 def visit_FunctionDef(self,node):
  old=self.scope;self.scope=Scope(old)
  for arg in node.args.posonlyargs+node.args.args+node.args.kwonlyargs:
   self.scope.helpers[arg.arg]=None
   ann=ast.unparse(arg.annotation) if arg.annotation else ""
   if "sqlite3.Connection" in ann or ann.endswith("Connection"):self.scope.recv[arg.arg]={"kind":"database","confidence":"proven"}
   else:
    g=guess(arg.arg)
    if g["kind"]!="unknown":self.scope.recv[arg.arg]=g
  if node is self.native_projection_implementation:
   self.scope.helpers.update(self.native_projection_helpers)
  for item in node.body:self.visit(item)
  self.scope=old
 def visit_AsyncFunctionDef(self,node):self.visit_FunctionDef(node)
 def visit_Assign(self,node):
  for target in node.targets:
   if isinstance(target,ast.Name):
    self.scope.expr[target.id]=node.value
    r=infer(node.value,self.scope)
    if r["kind"]!="unknown":self.scope.recv[target.id]=r
    self.scope.helpers[target.id]=None
    base,name=member(node.value)
    if name in METHODS:self.scope.methods[target.id]=(name,base)
  self.generic_visit(node)
 def visit_AnnAssign(self,node):
  if isinstance(node.target,ast.Name) and node.value is not None:
   self.scope.expr[node.target.id]=node.value
   self.scope.helpers[node.target.id]=None
   r=infer(node.value,self.scope)
   if r["kind"]!="unknown":self.scope.recv[node.target.id]=r
  self.generic_visit(node)
 def visit_Call(self,node):
  if isinstance(node.func,ast.Name):
   helper=self.scope.get("helpers",node.func.id)
   if helper is not None:
    kind,origin,sql_index=helper
    evidence=resolve_string(node.args[sql_index] if sql_index is not None and len(node.args)>sql_index else None,self.scope) if sql_index is not None else {"status":"unknown","shape":origin}
    self.out.append({"language":"python","path":self.file.relative_to(self.root).as_posix(),"line":node.lineno,"column":node.col_offset+1,"method":node.func.id,"methodAlias":True,"receiverKind":kind,"receiverConfidence":"proven","sqlOrigin":origin,"sqlEvidence":evidence})
  base,name=member(node.func);alias=False
  if name is None and isinstance(node.func,ast.Call) and isinstance(node.func.func,ast.Name) and node.func.func.id=="getattr" and len(node.func.args)>=2:
   base=node.func.args[0];attribute=node.func.args[1]
   name=attribute.value if isinstance(attribute,ast.Constant) and isinstance(attribute.value,str) and attribute.value in METHODS else "<computed>"
   alias=True
  if name is None and isinstance(node.func,ast.Name):
   bound=self.scope.get("methods",node.func.id)
   if bound:name,base=bound;alias=True
  if name in METHODS or name=="<computed>":
   recv=infer(base,self.scope)
   if name in SQL_ENTRY or recv["kind"]!="unknown":
    if name=="cursor":origin="none";evidence={"status":"absent","shape":"absent"}
    elif name=="<computed>":origin="computed-method";evidence=resolve_string(node.args[0] if node.args else None,self.scope)
    elif name in {"get","all","run","iterate"} and recv["kind"] in {"statement","cursor"}:
     origin="prepared-statement-unresolved";evidence={"status":"unknown","shape":"prepared-lineage"}
    else:origin="direct-argument";evidence=resolve_string(node.args[0] if node.args else None,self.scope)
    self.out.append({"language":"python","path":self.file.relative_to(self.root).as_posix(),"line":node.lineno,"column":node.col_offset+1,"method":name,"methodAlias":alias,"receiverKind":recv["kind"],"receiverConfidence":recv["confidence"],"sqlOrigin":origin,"sqlEvidence":evidence})
  self.generic_visit(node)

root=pathlib.Path(sys.argv[1]).resolve();files=[pathlib.Path(x).resolve() for x in sys.argv[2:]];result=[]
for file in files:
 tree=ast.parse(file.read_text(encoding="utf-8"),filename=str(file));scanner=Scanner(file,root,tree);scanner.visit(tree);result.extend(scanner.out)
print(json.dumps(result,separators=(",",":"),sort_keys=True))
`;

function scanPythonFiles(files, root, spawn = spawnSync) {
  if (files.length === 0) return [];
  const python = process.env.PYTHON ?? "python3";
  const result = spawn(python, ["-c", PYTHON_SCANNER, root, ...files], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`Python AST discovery spawn failed: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.signal !== null && result.signal !== undefined) {
    throw new Error(`Python AST discovery was terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    throw new Error(`Python AST discovery failed with status ${String(result.status)}: ${result.stderr || result.stdout}`);
  }
  if (typeof result.stderr !== "string" || result.stderr.length !== 0) {
    throw new Error(`Python AST discovery wrote stderr despite success: ${String(result.stderr)}`);
  }
  if (typeof result.stdout !== "string") {
    throw new Error("Python AST discovery returned a non-text stdout payload");
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Python AST discovery returned invalid JSON: ${error.message}`, {
      cause: error,
    });
  }
}

export function scanPythonFilesForTest(files, root, spawn) {
  return scanPythonFiles(files, root, spawn);
}

function digestIndex(fixture) {
  const index = new Map();
  function add(digest, classification, pointer, routeId) {
    if (!/^[0-9a-f]{64}$/u.test(digest)) return;
    const entries = index.get(digest) ?? [];
    entries.push({ classification: classification ?? "unknown", pointer, routeId: routeId ?? null });
    index.set(digest, entries);
  }
  function walk(value, pointer = "", inherited = {}) {
    if (Array.isArray(value)) {
      value.forEach((entry, indexValue) => walk(entry, `${pointer}/${indexValue}`, inherited));
      return;
    }
    if (!value || typeof value !== "object") return;
    const next = {
      classification: value.classification ?? inherited.classification,
      routeId: value.id ?? value.setId ?? inherited.routeId,
    };
    if (pointer.startsWith("/fixedReadRoutes") && !next.classification) next.classification = "authenticated-fixed-read";
    for (const [key, entry] of Object.entries(value)) {
      const child = `${pointer}/${key}`;
      if (/sha256$/iu.test(key)) {
        for (const digest of Array.isArray(entry) ? entry : [entry]) add(digest, next.classification, child, next.routeId);
      }
      walk(entry, child, next);
    }
  }
  walk(fixture);
  return index;
}

function sqlToken(sql) {
  const withoutComments = sql.replace(/^\s*(?:(?:--[^\n]*(?:\n|$))|(?:\/\*[\s\S]*?\*\/\s*))*/u, "").trimStart();
  return withoutComments.match(/^([A-Za-z]+)/u)?.[1]?.toUpperCase() ?? null;
}

function stableCallsiteIdentity(callsite) {
  const fields = {
    column: callsite.column,
    line: callsite.line,
    method: callsite.method,
    path: callsite.path,
    sqlOrigin: callsite.sqlOrigin,
  };
  return { ...fields, sha256: sha256(JSON.stringify(fields)) };
}

function classifyTypeScriptCallsite(callsite) {
  const context = /(?:^|\/)(?:[^/]*(?:integrity|invariants|audit)[^/]*)\.ts$/u.test(callsite.path)
    ? "test-like-production-probe"
    : callsite.receiverFamily === "wrapper" || /(?:owner|guard)/u.test(path.basename(callsite.path))
      ? "wrapper-or-guard"
      : "production-runtime";
  const disposition = callsite.receiverFamily === "non-sqlite"
    ? "false-positive"
    : callsite.receiverFamily === "native" && callsite.receiverConfidence === "proven"
      ? "confirmed-native-receiver"
      : callsite.receiverFamily === "wrapper" && callsite.receiverConfidence === "proven"
        ? "wrapper-guard-or-test-like-production-probe"
        : "unknown";
  return {
    context,
    disposition,
    receiverEvidence: callsite.receiverEvidence,
    receiverEvidenceAliasDepth: callsite.receiverEvidenceAliasDepth,
    receiverFamily: callsite.receiverFamily,
  };
}

function classifyCallsite(callsite, index) {
  const evidence = { ...callsite.sqlEvidence };
  let digest = null;
  let matches = [];
  if (evidence.status === "exact") {
    digest = sha256(evidence.value);
    matches = index.get(digest) ?? [];
  }
  const classifications = [...new Set(matches.map(({ classification }) => classification).filter((value) => value !== "unknown"))];
  // A digest match is only a discovery hint. P11 classification also requires
  // phase, exact authority identity, parameter provenance, and budgets that a
  // syntax-only scanner cannot prove.
  const fixtureClassificationCandidate = evidence.status === "exact" && classifications.length === 1
    ? classifications[0]
    : null;
  const routeClassification = "unknown";
  const token = evidence.status === "exact" ? sqlToken(evidence.value) : null;
  const operationClass = CONTROL_TOKENS.has(token) ? "transaction-or-forbidden-candidate"
    : WRITE_TOKENS.has(token) ? "mutation-candidate"
      : READ_TOKENS.has(token) ? "read-candidate" : "unknown";
  delete evidence.value;
  return {
    ...callsite,
    fixtureMatches: matches,
    fixtureClassificationCandidate,
    operationClass,
    routeClassification,
    sqlEvidence: { ...evidence, sha256: digest, token },
    stableIdentity: stableCallsiteIdentity(callsite),
    ...(callsite.language === "typescript"
      ? { typescriptClassification: classifyTypeScriptCallsite(callsite) }
      : {}),
    unknown: routeClassification === "unknown",
  };
}

function parseArguments(argv) {
  const options = {
    fixture: DEFAULT_FIXTURE,
    json: true,
    python: [],
    root: process.cwd(),
    summary: false,
    typescript: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") options.root = argv[++index];
    else if (argument === "--fixture") options.fixture = argv[++index];
    else if (argument === "--ts") options.typescript.push(argv[++index]);
    else if (argument === "--python") options.python.push(argv[++index]);
    else if (argument === "--no-fixture") options.fixture = null;
    else if (argument === "--pretty") options.pretty = true;
    else if (argument === "--summary") options.summary = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

export function scanRepository(options = {}) {
  const root = canonicalDirectory(options.root ?? process.cwd());
  const tsFiles = options.typescript?.length
    ? resolveExplicitFiles(root, options.typescript, "TypeScript")
    : walkFiles(path.join(root, "packages/sqlite/src"), (file) =>
      file.endsWith(".ts") && !file.endsWith(".d.ts")).sort(compareUnicodeCodePoints);
  const pythonFiles = options.python?.length
    ? resolveExplicitFiles(root, options.python, "Python")
    : walkFiles(path.join(root, "python/src/graph_engineering"), (file) =>
      /^sqlite_.*\.py$/u.test(path.basename(file))).sort(compareUnicodeCodePoints);
  const fixturePath = options.fixture === null
    ? null
    : resolveExplicitFile(root, options.fixture ?? DEFAULT_FIXTURE, "Fixture");
  const fixture = fixturePath ? JSON.parse(fs.readFileSync(fixturePath, "utf8")) : {};
  const index = digestIndex(fixture);
  const ts = loadTypeScript();
  const raw = [
    ...tsFiles.flatMap((file) => scanTypeScriptFile(ts, file, root)),
    ...scanPythonFiles(pythonFiles, root),
  ];
  const callsites = raw.map((callsite) => classifyCallsite(callsite, index)).sort((a, b) =>
    compareUnicodeCodePoints(a.path, b.path)
    || a.line - b.line
    || a.column - b.column
    || compareUnicodeCodePoints(a.method, b.method));
  const byLanguage = Object.fromEntries(["python", "typescript"].map((language) => [language, callsites.filter((item) => item.language === language).length]));
  const typescriptCallsiteClassifications = Object.fromEntries([
    "confirmed-native-receiver",
    "wrapper-guard-or-test-like-production-probe",
    "false-positive",
    "unknown",
  ].map((classification) => [classification, callsites.filter((item) =>
    item.language === "typescript"
    && item.typescriptClassification.disposition === classification).length]));
  const unknownCount = callsites.filter(({ unknown }) => unknown).length;
  return {
    callsites,
    inputs: {
      fixture: fixturePath ? slash(path.relative(root, fixturePath)) : null,
      pythonFiles: pythonFiles.map((file) => slash(path.relative(root, file))),
      typescriptFiles: tsFiles.map((file) => slash(path.relative(root, file))),
    },
    limitations: [
      "Static discovery does not execute imports, callbacks, monkey patches, or runtime-generated method names.",
      "Cross-file and member SQL aliases that cannot be proven from a local immutable expression remain unknown.",
      "Receiver-name heuristics never authorize a fixture classification.",
      "TypeScript receiver names are candidate hints only and never increase receiver confidence.",
      "TypeScript confirmed-native status requires local node:sqlite syntax evidence; cross-file return values remain unknown.",
      "This inventory is evidence for closing future gaps, not evidence that native-callsite closure has been achieved.",
    ],
    policy: {
      dynamicOrUnresolvedSql: "unknown",
      exactDigestMatchIsAuthorization: false,
      exactSqlWithoutUniqueFixtureClassification: "unknown",
      heuristicOrUnknownReceiver: "unknown",
      routeClosureClaimed: false,
      typescriptReceiverEvidence: {
        aliasPropagation: "proven-only",
        definitionTimeNativeHelperAliasPropagation: "exact-sqlite-connection-import-and-const-only",
        nameHintsIncreaseConfidence: false,
        unknownCandidatesDropped: false,
      },
    },
    routeClosureClaimed: false,
    schemaVersion: 2,
    summary: {
      byLanguage,
      callsiteCount: callsites.length,
      exactSqlCount: callsites.filter(({ sqlEvidence }) => sqlEvidence.status === "exact").length,
      filesWithCallsites: new Set(callsites.map(({ path: file }) => file)).size,
      fixtureClassifiedCount: callsites.length - unknownCount,
      fixtureDigestCandidateCount: callsites.filter(({ fixtureClassificationCandidate }) => fixtureClassificationCandidate !== null).length,
      unknownCount,
      scannedFileCount: tsFiles.length + pythonFiles.length,
      typescriptCallsiteClassifications,
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const report = scanRepository(options);
  const selected = options.summary
    ? { routeClosureClaimed: report.routeClosureClaimed, summary: report.summary }
    : report;
  process.stdout.write(`${JSON.stringify(selected, null, options.pretty ? 2 : 0)}\n`);
}
