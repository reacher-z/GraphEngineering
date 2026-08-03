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
const WRITE_TOKENS = new Set(["ALTER", "CREATE", "DELETE", "DROP", "INSERT", "REPLACE", "UPDATE"]);
const READ_TOKENS = new Set(["EXPLAIN", "PRAGMA", "SELECT", "WITH"]);
const CONTROL_TOKENS = new Set(["ATTACH", "BEGIN", "COMMIT", "DETACH", "END", "RELEASE", "ROLLBACK", "SAVEPOINT", "VACUUM"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function walkFiles(directory, predicate) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(target, predicate));
    else if (entry.isFile() && predicate(target)) result.push(target);
  }
  return result;
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
  return { expressions: new Map(), methods: new Map(), parent, receivers: new Map() };
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
  if (/^(audit|conn|connection|database|db)$/iu.test(name)) return { confidence: "heuristic", kind: "database" };
  if (/(connection|database)$/iu.test(name)) return { confidence: "heuristic", kind: "database" };
  if (/(cursor)$/iu.test(name)) return { confidence: "heuristic", kind: "cursor" };
  if (/(statement|stmt)$/iu.test(name)) return { confidence: "heuristic", kind: "statement" };
  return { confidence: "unknown", kind: "unknown" };
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

function inferTsReceiver(ts, expression, scope, seen = new Set()) {
  const node = unwrapTs(ts, expression);
  if (!node) return { confidence: "unknown", kind: "unknown" };
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return { confidence: "unknown", kind: "unknown" };
    const known = lookup(scope, "receivers", node.text);
    if (known) return known;
    const bound = lookup(scope, "expressions", node.text);
    if (bound) {
      seen.add(node.text);
      const inferred = inferTsReceiver(ts, bound, scope, seen);
      seen.delete(node.text);
      if (inferred.kind !== "unknown") return inferred;
    }
    return tsNameHeuristic(node.text);
  }
  if (ts.isNewExpression(node)) {
    const name = node.expression.getText();
    if (/(DatabaseSync|Database|Connection)$/u.test(name)) return { confidence: "proven", kind: "database" };
  }
  if (ts.isCallExpression(node)) {
    const called = tsMember(ts, node.expression);
    if (called && /^prepare/u.test(called.method)) {
      const lower = inferTsReceiver(ts, called.receiver, scope, seen);
      return lower.kind === "database"
        ? { confidence: lower.confidence, kind: "statement" }
        : { confidence: "unknown", kind: "unknown" };
    }
    if (called?.method === "cursor") {
      const lower = inferTsReceiver(ts, called.receiver, scope, seen);
      return lower.kind === "database"
        ? { confidence: lower.confidence, kind: "cursor" }
        : { confidence: "unknown", kind: "unknown" };
    }
  }
  const member = tsMember(ts, node);
  if (member) {
    const direct = tsNameHeuristic(member.method.replace(/^#/u, ""));
    if (direct.kind !== "unknown") return direct;
    return inferTsReceiver(ts, member.receiver, scope, seen);
  }
  return { confidence: "unknown", kind: "unknown" };
}

function tsSqlForCall(ts, call, method, receiver, scope) {
  if (method === "cursor") return { origin: "none", evidence: { shape: "absent", status: "absent" } };
  if (STATEMENT_METHODS.has(method) && receiver.kind === "statement") {
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
  const callsites = [];

  function visit(node, scope) {
    let active = scope;
    if (ts.isFunctionLike(node) && node !== source) {
      active = createScope(scope);
      for (const parameter of node.parameters ?? []) {
        if (!ts.isIdentifier(parameter.name)) continue;
        const typeText = parameter.type?.getText() ?? "";
        if (/(DatabaseSync|SqliteConnection|SQLite.*Connection)/u.test(typeText)) active.receivers.set(parameter.name.text, { confidence: "proven", kind: "database" });
        else {
          const guess = tsNameHeuristic(parameter.name.text);
          if (guess.kind !== "unknown") active.receivers.set(parameter.name.text, guess);
        }
      }
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      active.expressions.set(node.name.text, node.initializer);
      const inferred = inferTsReceiver(ts, node.initializer, active);
      if (inferred.kind !== "unknown") active.receivers.set(node.name.text, inferred);
      const member = tsMember(ts, node.initializer);
      if (member && ALL_METHODS.has(member.method)) active.methods.set(node.name.text, { method: member.method, receiver: member.receiver });
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      active.expressions.set(node.left.text, node.right);
      const inferred = inferTsReceiver(ts, node.right, active);
      if (inferred.kind !== "unknown") active.receivers.set(node.left.text, inferred);
    }

    if (ts.isCallExpression(node)) {
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
        const receiver = inferTsReceiver(ts, receiverExpression, active);
        const include = SQL_ENTRY_METHODS.has(method) || receiver.kind !== "unknown";
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
            receiverKind: receiver.kind,
            sqlEvidence: sql.evidence,
            sqlOrigin: sql.origin,
          });
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, active));
  }
  visit(source, createScope());
  return callsites;
}

const PYTHON_SCANNER = String.raw`
import ast, hashlib, json, pathlib, sys

METHODS={"exec","execute","executemany","executescript","prepare","cursor","get","all","run","iterate"}
SQL_ENTRY={"exec","execute","executemany","executescript","prepare","cursor"}

class Scope:
 def __init__(self,parent=None): self.parent=parent; self.expr={}; self.recv={}; self.methods={}
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

class Scanner(ast.NodeVisitor):
 def __init__(self,file,root):self.file=file;self.root=root;self.scope=Scope();self.out=[]
 def visit_FunctionDef(self,node):
  old=self.scope;self.scope=Scope(old)
  for arg in node.args.posonlyargs+node.args.args+node.args.kwonlyargs:
   ann=ast.unparse(arg.annotation) if arg.annotation else ""
   if "sqlite3.Connection" in ann or ann.endswith("Connection"):self.scope.recv[arg.arg]={"kind":"database","confidence":"proven"}
   else:
    g=guess(arg.arg)
    if g["kind"]!="unknown":self.scope.recv[arg.arg]=g
  for item in node.body:self.visit(item)
  self.scope=old
 def visit_AsyncFunctionDef(self,node):self.visit_FunctionDef(node)
 def visit_Assign(self,node):
  for target in node.targets:
   if isinstance(target,ast.Name):
    self.scope.expr[target.id]=node.value
    r=infer(node.value,self.scope)
    if r["kind"]!="unknown":self.scope.recv[target.id]=r
    base,name=member(node.value)
    if name in METHODS:self.scope.methods[target.id]=(name,base)
  self.generic_visit(node)
 def visit_AnnAssign(self,node):
  if isinstance(node.target,ast.Name) and node.value is not None:
   self.scope.expr[node.target.id]=node.value
   r=infer(node.value,self.scope)
   if r["kind"]!="unknown":self.scope.recv[node.target.id]=r
  self.generic_visit(node)
 def visit_Call(self,node):
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
 tree=ast.parse(file.read_text(encoding="utf-8"),filename=str(file));scanner=Scanner(file,root);scanner.visit(tree);result.extend(scanner.out)
print(json.dumps(result,separators=(",",":"),sort_keys=True))
`;

function scanPythonFiles(files, root) {
  if (files.length === 0) return [];
  const python = process.env.PYTHON ?? "python3";
  const result = spawnSync(python, ["-c", PYTHON_SCANNER, root, ...files], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Python AST discovery failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
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
  const root = path.resolve(options.root ?? process.cwd());
  const tsFiles = (options.typescript?.length ? options.typescript.map((file) => path.resolve(root, file)) : walkFiles(path.join(root, "packages/sqlite/src"), (file) => file.endsWith(".ts") && !file.endsWith(".d.ts"))).sort();
  const pythonFiles = (options.python?.length ? options.python.map((file) => path.resolve(root, file)) : walkFiles(path.join(root, "python/src/graph_engineering"), (file) => /^sqlite_.*\.py$/u.test(path.basename(file)))).sort();
  const fixturePath = options.fixture === null ? null : path.resolve(root, options.fixture ?? DEFAULT_FIXTURE);
  const fixture = fixturePath && fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, "utf8")) : {};
  const index = digestIndex(fixture);
  const ts = loadTypeScript();
  const raw = [
    ...tsFiles.flatMap((file) => scanTypeScriptFile(ts, file, root)),
    ...scanPythonFiles(pythonFiles, root),
  ];
  const callsites = raw.map((callsite) => classifyCallsite(callsite, index)).sort((a, b) =>
    a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column || a.method.localeCompare(b.method));
  const byLanguage = Object.fromEntries(["python", "typescript"].map((language) => [language, callsites.filter((item) => item.language === language).length]));
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
      "This inventory is evidence for closing future gaps, not evidence that native-callsite closure has been achieved.",
    ],
    policy: {
      dynamicOrUnresolvedSql: "unknown",
      exactDigestMatchIsAuthorization: false,
      exactSqlWithoutUniqueFixtureClassification: "unknown",
      heuristicOrUnknownReceiver: "unknown",
      routeClosureClaimed: false,
    },
    routeClosureClaimed: false,
    schemaVersion: 1,
    summary: {
      byLanguage,
      callsiteCount: callsites.length,
      exactSqlCount: callsites.filter(({ sqlEvidence }) => sqlEvidence.status === "exact").length,
      filesWithCallsites: new Set(callsites.map(({ path: file }) => file)).size,
      fixtureClassifiedCount: callsites.length - unknownCount,
      fixtureDigestCandidateCount: callsites.filter(({ fixtureClassificationCandidate }) => fixtureClassificationCandidate !== null).length,
      unknownCount,
      scannedFileCount: tsFiles.length + pythonFiles.length,
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
