import ts from "../../packages/sqlite/node_modules/typescript/lib/typescript.js";

const CLOSURE_SPECS = Object.freeze([
  Object.freeze({
    calls: Object.freeze([
      "lowerTransition.burn",
      "consumeSQLiteCursorProviderClockEvidenceIntrinsic",
      "lowerTransition.publish",
    ]),
    statements: Object.freeze([
      'prepared.lifecycle="published";',
      "prepared.lowerTail=undefined;",
      "lowerTransition.burn();",
      'consttombstone=consumeSQLiteCursorProviderClockEvidenceIntrinsic(state.providerClockCapability,evidence,"cursor-publication-session");',
      "sessionState.consumedTombstone=tombstone;",
      "lowerTransition.publish();",
      "state.publicationSession=session;",
      'state.writePhase="publication-active";',
      'sessionState.lifecycle="publication-active";',
      "returnsession;",
    ]),
  }),
  Object.freeze({
    calls: Object.freeze(["stageTransition.burn"]),
    statements: Object.freeze([
      "state.publicationSessionTail=undefined;",
      "state.publicationSession=session;",
      'state.lifecycle="publication-session-burned";',
      "stageTransition.burn();",
    ]),
  }),
  Object.freeze({
    calls: Object.freeze(["stageTransition.publish"]),
    statements: Object.freeze([
      "stageTransition.publish();",
      "state.publicationSession=session;",
      'state.lifecycle="publication-active";',
    ]),
  }),
  Object.freeze({
    calls: Object.freeze([]),
    statements: Object.freeze([
      "this.#cursorPublicationSessionTail=undefined;",
      "this.#cursorPublicationSession=session;",
      'this.#cursorPublicationSessionState="burned";',
    ]),
  }),
  Object.freeze({
    calls: Object.freeze([]),
    statements: Object.freeze([
      "this.#cursorPublicationSession=session;",
      'this.#cursorPublicationSessionState="active";',
    ]),
  }),
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseSource(path, source) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  );
  invariant(sourceFile.parseDiagnostics.length === 0,
    `${path} has TypeScript parse diagnostics`);
  return sourceFile;
}

function findFunction(sourceFile, name) {
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  invariant(matches.length === 1,
    `${sourceFile.fileName} must contain exactly one function ${name}`);
  return matches[0];
}

function findMethod(sourceFile, name) {
  const matches = [];
  function visit(node) {
    if (ts.isMethodDeclaration(node) && node.name.getText(sourceFile) === `[${name}]`) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  invariant(matches.length === 1,
    `${sourceFile.fileName} must contain exactly one method [${name}]`);
  return matches[0];
}

function findTransitionClosure(sourceFile, container, name) {
  const matches = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node)
        && node.name.getText(sourceFile) === name
        && ts.isArrowFunction(node.initializer)
        && ts.isBlock(node.initializer.body)) {
      matches.push(node.initializer.body);
    }
    ts.forEachChild(node, visit);
  }
  visit(container);
  invariant(matches.length === 1,
    `${sourceFile.fileName} must contain exactly one ${name} transition closure`);
  return matches[0];
}

function compactStatement(sourceFile, statement) {
  return statement.getText(sourceFile).replace(/\s+/gu, "").replace(/,\)/gu, ")");
}

function inspectClosure(sourceFile, body, spec) {
  const calls = [];
  let forbiddenExpression = false;
  function visit(node) {
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(sourceFile));
    if (ts.isNewExpression(node)
        || ts.isAwaitExpression(node)
        || ts.isYieldExpression(node)
        || ts.isTaggedTemplateExpression(node)
        || ts.isDeleteExpression(node)) {
      forbiddenExpression = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  const statements = body.statements.map((statement) => compactStatement(sourceFile, statement));
  return Object.freeze({
    exact: !forbiddenExpression
      && JSON.stringify(calls) === JSON.stringify(spec.calls)
      && JSON.stringify(statements) === JSON.stringify(spec.statements),
    text: body.getText(sourceFile),
  });
}

/**
 * Audit the complete closed recursive TypeScript/JavaScript publication tail.
 * The outer closure permits exactly burn, clock-consume and publish calls; the
 * lower continuations are assignment-only except for their exact next-layer
 * calls. The three inputs must all come from one source tree (src TS or
 * executed dist JS); callers audit both trees independently.
 */
export function auditSQLiteCursorPublicationSessionTypescriptTail({
  outerPath,
  outerSource,
  ownershipPath,
  ownershipSource,
  stagePath,
  stageSource,
}) {
  const outerFile = parseSource(outerPath, outerSource);
  const ownershipFile = parseSource(ownershipPath, ownershipSource);
  const stageFile = parseSource(stagePath, stageSource);
  const publish = findFunction(outerFile, "publishSQLiteCursorPublicationSessionIntrinsic");
  const outerTails = publish.body.statements.filter(ts.isTryStatement);
  invariant(outerTails.length === 3,
    `${outerPath} publication session must contain exactly three try statements`);
  const outerTail = outerTails[2];
  const ownershipTransition = findFunction(
    ownershipFile, "prepareSQLiteCursorStageOwnershipPublicationSessionTransitionIntrinsic",
  );
  const stageTransition = findMethod(
    stageFile, "SQLITE_BASELINE_PREPARE_CURSOR_PUBLICATION_SESSION_TRANSITION",
  );
  const closures = [
    Object.freeze({ body: outerTail.tryBlock, sourceFile: outerFile }),
    Object.freeze({
      body: findTransitionClosure(ownershipFile, ownershipTransition, "burn"),
      sourceFile: ownershipFile,
    }),
    Object.freeze({
      body: findTransitionClosure(ownershipFile, ownershipTransition, "publish"),
      sourceFile: ownershipFile,
    }),
    Object.freeze({
      body: findTransitionClosure(stageFile, stageTransition, "burn"),
      sourceFile: stageFile,
    }),
    Object.freeze({
      body: findTransitionClosure(stageFile, stageTransition, "publish"),
      sourceFile: stageFile,
    }),
  ];
  invariant(closures.length === CLOSURE_SPECS.length,
    "publication-session tail closure inventory drifted");
  const inspected = closures.map(({ body, sourceFile }, index) =>
    inspectClosure(sourceFile, body, CLOSURE_SPECS[index]));
  return Object.freeze({
    exact: inspected.every(({ exact }) => exact),
    text: inspected.map(({ text }) => text).join("\n"),
  });
}
