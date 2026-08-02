#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "../../packages/sqlite/node_modules/typescript/lib/typescript.js";

import * as publicApi from "../../packages/sqlite/dist/index.js";
import { readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic } from
  "../../packages/sqlite/dist/cursor-publication-clock-authority.js";
import {
  adoptSQLiteCursorInitialPublicationStageIntrinsic,
  assertSQLiteCursorPublicationSessionIntrinsic,
  createSQLiteCursorPublicationSessionCancellationControllerIntrinsic,
  observeSQLiteCursorPublicationSessionClockIntrinsic,
  prepareSQLiteCursorPublicationSessionIntrinsic,
  publishSQLiteCursorPublicationSessionIntrinsic,
  readSQLiteCursorInitialStageAdoptionReceiptSnapshotIntrinsic,
  readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic,
  readSQLiteCursorPublicationSessionSnapshotIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-outer-authority.js";
import {
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
  SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256,
  readSQLiteCursorPublicationTargetCatalogObservationIntrinsic,
} from "../../packages/sqlite/dist/cursor-publication-target-catalog.js";
import { readSQLiteConnectionOwnerSnapshot } from
  "../../packages/sqlite/dist/sqlite-connection.js";
import { retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic } from
  "../../packages/sqlite/dist/operation-baseline-cursor-stage-ownership.js";
import {
  CounterRecorder,
  createGraph,
  detachActiveRecorder,
  disposeGraph,
  executeThroughInitialWrites,
  invariant,
  recordFromObservation,
  recordInitialAdoptionCounts,
} from "./sqlite_cursor_publication_initial_typescript_report.mjs";
import { auditSQLiteCursorPublicationSessionTypescriptTail } from
  "./sqlite_cursor_publication_session_typescript_tail_audit.mjs";

const OUTER_SOURCE_PATH = resolve(
  "packages/sqlite/src/cursor-publication-outer-authority.ts",
);
const CLOCK_SOURCE_PATH = resolve(
  "packages/sqlite/src/cursor-publication-clock-authority.ts",
);
const OWNERSHIP_SOURCE_PATH = resolve(
  "packages/sqlite/src/operation-baseline-cursor-stage-ownership.ts",
);
const STAGE_SOURCE_PATH = resolve("packages/sqlite/src/operation-baseline-stage.ts");
const OUTER_DIST_PATH = resolve(
  "packages/sqlite/dist/cursor-publication-outer-authority.js",
);
const OWNERSHIP_DIST_PATH = resolve(
  "packages/sqlite/dist/operation-baseline-cursor-stage-ownership.js",
);
const STAGE_DIST_PATH = resolve("packages/sqlite/dist/operation-baseline-stage.js");
const ROOT_DECLARATION_PATH = resolve("packages/sqlite/dist/index.d.ts");

class SessionCounterRecorder extends CounterRecorder {
  constructor() {
    super();
    this.publicationSessionMintCount = 0;
    this.publicationSessionAssertionCount = 0;
    this.cancellationObservationCount = 0;
  }

  publicationSessionMinted() { this.publicationSessionMintCount += 1; }
  publicationSessionAsserted() { this.publicationSessionAssertionCount += 1; }
  cancellationObserved() { this.cancellationObservationCount += 1; }

  sessionProbeSnapshot() {
    return Object.freeze({
      ...this.normalizedSnapshot(),
      publicationSessionMintCount: this.publicationSessionMintCount,
      publicationSessionAssertionCount: this.publicationSessionAssertionCount,
      cancellationObservationCount: this.cancellationObservationCount,
      rollbackCount: this.rollbackCount,
    });
  }
}

function adoptedGraph(recorder) {
  const graph = createGraph(recorder);
  const writes = executeThroughInitialWrites(graph, recorder);
  const adoptionReceipt = adoptSQLiteCursorInitialPublicationStageIntrinsic(
    graph.authority,
    writes.bundle,
    writes.fence,
    writes.readerLease,
  );
  const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
    graph.authority,
  );
  invariant(
    authority.writePhase === "initial-stage-adoption-complete",
    "TypeScript session graph did not complete initial stage adoption",
  );
  recordInitialAdoptionCounts(recorder, authority);
  return Object.freeze({ adoptionReceipt, graph, writes });
}

function assertExactSessionCommitments(subject, preparedOwner, evidence, session) {
  const { adoptionReceipt, graph, writes } = subject;
  const before = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(graph.authority);
  const snapshot = readSQLiteCursorPublicationSessionSnapshotIntrinsic(session);
  const outerClock = readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
    snapshot.providerClockCapability,
    snapshot.outerClockEvidence,
  );
  const preRebindClock = readSQLiteCursorProviderClockEvidenceSnapshotIntrinsic(
    snapshot.providerClockCapability,
    evidence,
  );
  invariant(Object.isFrozen(preparedOwner) && Object.getPrototypeOf(preparedOwner) === null,
    "TypeScript prepared publication owner is not frozen opaque state");
  invariant(Object.isFrozen(session) && Object.getPrototypeOf(session) === null,
    "TypeScript publication session is not frozen opaque state");
  invariant(Object.isFrozen(snapshot) && Object.isFrozen(snapshot.migrationLockIdentity),
    "TypeScript publication session snapshot is not immutable");
  invariant(snapshot.outerAuthority === graph.authority, "session outer authority drifted");
  invariant(snapshot.initialStageAdoptionReceipt === adoptionReceipt,
    "session adoption receipt drifted");
  invariant(snapshot.receipt === graph.preRebindReceipt, "session B2 receipt drifted");
  invariant(snapshot.projectionReference === graph.projectionReference,
    "session projection reference drifted");
  invariant(snapshot.projectionIdentity === graph.projectionIdentity,
    "session projection identity drifted");
  invariant(snapshot.stage === graph.stage && snapshot.connection === graph.connection,
    "session stage/connection drifted");
  invariant(snapshot.transactionLineage === graph.initialLineage,
    "session transaction generation drifted");
  invariant(snapshot.transfer === graph.transfer, "session transfer drifted");
  invariant(snapshot.migrationLockCapability === before.migrationLockCapability,
    "session migration-lock capability drifted");
  invariant(snapshot.providerClockCapability === before.providerClockCapability,
    "session provider-clock capability drifted");
  invariant(snapshot.outerClockEvidence === before.outerClockEvidence,
    "session outer clock evidence drifted");
  invariant(outerClock.boundary === "before-first-permanent-mutation"
      && outerClock.consumer === "outer-publication-authority"
      && snapshot.outerProviderNowMs === outerClock.providerNowMs,
    "session outer provider-clock value drifted");
  invariant(snapshot.preRebindClockEvidence === evidence,
    "session pre-rebind clock evidence drifted");
  invariant(preRebindClock.boundary === "before-cursor-rebind"
      && preRebindClock.consumer === "cursor-publication-session"
      && snapshot.preRebindProviderNowMs === preRebindClock.providerNowMs,
  "session pre-rebind provider-clock value drifted");
  invariant(snapshot.postDdlCatalogFence === writes.fence,
    "session catalog fence drifted");
  invariant(snapshot.migrationLockIdentity.lockId === "b3-initial-parity-lock"
      && snapshot.migrationLockIdentity.ownerId === "b3-initial-parity-owner"
      && snapshot.migrationLockIdentity.lockEpoch === 1
      && snapshot.migrationLockIdentity.fencingToken === 1
      && snapshot.migrationLockIdentity.sourceSchemaVersion === 1
      && snapshot.migrationLockIdentity.targetSchemaVersion === 2
      && snapshot.migrationLockIdentity.activeExpiresAtMs
        === preRebindClock.activeExpiresAtMs,
  "session migration-lock identity drifted");
  invariant(snapshot.sourceDescriptorHash === before.sourceDescriptorHash
      && snapshot.sourceSchemaIdentitySha256 === before.sourceSchemaIdentitySha256,
  "session source descriptor/schema identity drifted");
  invariant(snapshot.targetDescriptorHash === before.target.descriptorHash
      && snapshot.targetSchemaIdentitySha256 === before.target.schemaIdentitySha256,
  "session target descriptor/schema identity drifted");
  invariant(snapshot.lifecycle === "publication-active",
    "session snapshot lifecycle drifted");
}

function publishSession(subject, recorder) {
  const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
    subject.graph.authority,
    subject.adoptionReceipt,
  );
  const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
  const session = publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence);
  recorder.clockEvidenceConsumed();
  recorder.publicationSessionMinted();
  return Object.freeze({ evidence, preparedOwner, session });
}

function catalogMatches(connection) {
  const catalog = readSQLiteCursorPublicationTargetCatalogObservationIntrinsic(connection);
  invariant(catalog.rowCount === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_ROW_COUNT,
    "TypeScript session target catalog row count drifted");
  return catalog.catalogSha256 === SQLITE_CURSOR_PUBLICATION_TARGET_CATALOG_EXPECTED_SHA256;
}

function runSuccessControl() {
  const recorder = new SessionCounterRecorder();
  let subject;
  try {
    subject = adoptedGraph(recorder);
    const ownerBefore = readSQLiteConnectionOwnerSnapshot(subject.graph.connection);
    const authorityBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      subject.graph.authority,
    );
    const published = publishSession(subject, recorder);
    assertExactSessionCommitments(
      subject, published.preparedOwner, published.evidence, published.session,
    );
    const assertionOwnerBefore = readSQLiteConnectionOwnerSnapshot(subject.graph.connection);
    const assertionLedgerBefore = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      subject.graph.authority,
    ).outerLedger;
    invariant(assertSQLiteCursorPublicationSessionIntrinsic(published.session) === published.session,
      "TypeScript publication session first assertion changed identity");
    recorder.publicationSessionAsserted();
    invariant(assertSQLiteCursorPublicationSessionIntrinsic(published.session) === published.session,
      "TypeScript publication session second assertion changed identity");
    recorder.publicationSessionAsserted();
    const assertionOwnerAfter = readSQLiteConnectionOwnerSnapshot(subject.graph.connection);
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      subject.graph.authority,
    );
    invariant(authority.lifecycle === "active" && authority.writePhase === "publication-active",
      "TypeScript session did not activate the outer layer");
    invariant(authority.publicationPreparedOwner === published.preparedOwner
        && authority.publicationSession === published.session,
    "TypeScript outer publication identities drifted");
    invariant(assertionOwnerAfter.transactionEpoch === assertionOwnerBefore.transactionEpoch
        && assertionOwnerAfter.transactionLineage === assertionOwnerBefore.transactionLineage,
    "TypeScript session assertion changed transaction ownership");
    invariant(assertionLedgerBefore.logicalWriteSequence === authority.outerLedger.logicalWriteSequence
        && assertionLedgerBefore.fixedStatementCount === authority.outerLedger.fixedStatementCount
        && assertionLedgerBefore.affectedRowsWatermark
          === authority.outerLedger.affectedRowsWatermark,
    "TypeScript session assertion changed the outer ledger");
    invariant(recorder.providerClockReadCount === 2,
      "TypeScript session assertion observed a third provider clock");
    invariant(recorder.rollbackCount === 0, "TypeScript session success rolled back");
    return recordFromObservation({
      authority,
      bundleRetryable: false,
      caseId: "publication-session-success-control",
      catalogFenceMatches: catalogMatches(subject.graph.connection),
      failureBoundary: null,
      initialLineage: ownerBefore.transactionLineage,
      outcome: "success",
      recorderSnapshot: recorder.normalizedSnapshot(),
      state: "publication-active",
    });
  } finally {
    detachActiveRecorder();
    if (subject !== undefined) disposeGraph(subject.graph);
  }
}

function runCancellationControl() {
  const recorder = new SessionCounterRecorder();
  let subject;
  try {
    subject = adoptedGraph(recorder);
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      subject.graph.authority,
      subject.adoptionReceipt,
    );
    const evidence = observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    const cancellation = createSQLiteCursorPublicationSessionCancellationControllerIntrinsic();
    cancellation.cancel();
    recorder.cancellationObserved();
    let cancelled = false;
    try {
      publishSQLiteCursorPublicationSessionIntrinsic(
        preparedOwner, evidence, cancellation.signal,
      );
    } catch (error) {
      cancelled = error?.code === "GE_CYCLE_STORE_UNAVAILABLE"
        && error?.message === "SQLite publication session was cancelled";
    }
    invariant(cancelled, "TypeScript publication session cancellation was not observed");
    const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
      subject.graph.authority,
    );
    invariant(authority.lifecycle === "active"
        && authority.writePhase === "initial-stage-adoption-complete"
        && authority.publicationPreparedOwner === preparedOwner
        && authority.publicationSession === undefined,
    "TypeScript cancelled publication session changed ownership");
    const frozen = Object.freeze({
      caseId: "publication-session-cancelled-before-tail",
      outcome: "cancelled",
      state: "pre-rebind-complete",
      poisoned: false,
      providerClockReadCount: recorder.providerClockReadCount,
      clockEvidenceConsumeCount: recorder.clockEvidenceConsumeCount,
      sessionRetryable: true,
      cursorRebindPrepareCount: recorder.cursorRebindPrepareCount,
      cursorRebindExecuteCount: recorder.cursorRebindExecuteCount,
      commitCount: recorder.commitCount,
    });
    const session = publishSQLiteCursorPublicationSessionIntrinsic(preparedOwner, evidence);
    recorder.clockEvidenceConsumed();
    recorder.publicationSessionMinted();
    invariant(assertSQLiteCursorPublicationSessionIntrinsic(session) === session,
      "TypeScript cancelled session did not retry with the same owner/evidence");
    invariant(recorder.rollbackCount === 0, "TypeScript cancellation control rolled back");
    return frozen;
  } finally {
    detachActiveRecorder();
    if (subject !== undefined) disposeGraph(subject.graph);
  }
}

function rawError(error) {
  return `${String(error?.constructor?.name)}|${String(error?.code)}|`
    + `${String(error?.operation)}|${String(error?.message)}`;
}

function normalizedHostile(recorder, subject, ordinal, id, failureBoundary) {
  const authority = readSQLiteCursorOuterPublicationAuthoritySnapshotIntrinsic(
    subject.graph.authority,
  );
  invariant(authority.lifecycle === "poisoned" && authority.writePhase === "poisoned",
    `TypeScript hostile ordinal ${String(ordinal)} did not poison its graph`);
  return recordFromObservation({
    authority,
    bundleRetryable: false,
    caseId: id,
    catalogFenceMatches: catalogMatches(subject.graph.connection),
    failureBoundary,
    initialLineage: subject.graph.initialLineage,
    outcome: "poisoned",
    recorderSnapshot: recorder.normalizedSnapshot(),
    state: "poisoned",
  });
}

function proveFreshGraphSucceeded() {
  const recorder = new SessionCounterRecorder();
  let subject;
  try {
    subject = adoptedGraph(recorder);
    const published = publishSession(subject, recorder);
    return assertSQLiteCursorPublicationSessionIntrinsic(published.session) === published.session;
  } finally {
    detachActiveRecorder();
    if (subject !== undefined) disposeGraph(subject.graph);
  }
}

function activatedRecord({ error, normalized, ordinal }) {
  invariant(proveFreshGraphSucceeded(),
    `TypeScript hostile ordinal ${String(ordinal)} did not require a successful fresh graph`);
  return Object.freeze({
    ordinal,
    runtimeError: rawError(error),
    semanticErrorCode: "GE_CURSOR_B3_INVARIANT",
    sameGraphRetryable: false,
    freshGraphSucceeded: true,
    normalized,
  });
}

function runOrdinal20() {
  const oldRecorder = new SessionCounterRecorder();
  const recorder = new SessionCounterRecorder();
  let oldSubject;
  let subject;
  try {
    oldSubject = adoptedGraph(oldRecorder);
    const oldPublished = publishSession(oldSubject, oldRecorder);
    subject = adoptedGraph(recorder);
    const preparedOwner = prepareSQLiteCursorPublicationSessionIntrinsic(
      subject.graph.authority, subject.adoptionReceipt,
    );
    observeSQLiteCursorPublicationSessionClockIntrinsic(preparedOwner);
    let error;
    try {
      publishSQLiteCursorPublicationSessionIntrinsic(
        preparedOwner, oldPublished.evidence,
      );
    } catch (caught) { error = caught; }
    invariant(error !== undefined, "TypeScript hostile ordinal 20 was not rejected");
    const normalized = normalizedHostile(
      recorder,
      subject,
      20,
      "stale-provider-clock-evidence-replay",
      "pre-rebind-clock-evidence-validation",
    );
    return activatedRecord({ error, normalized, ordinal: 20 });
  } finally {
    detachActiveRecorder();
    if (subject !== undefined) disposeGraph(subject.graph);
    if (oldSubject !== undefined) disposeGraph(oldSubject.graph);
  }
}

function cloneOpaque(value) {
  return Object.freeze(Object.assign(Object.create(null), value));
}

function runAdoptionReceiptOrdinal(ordinal) {
  const recorder = new SessionCounterRecorder();
  const foreignRecorder = new SessionCounterRecorder();
  let subject;
  let foreign;
  try {
    let candidate;
    if (ordinal === 100) {
      subject = adoptedGraph(recorder);
      candidate = cloneOpaque(subject.adoptionReceipt);
    } else {
      foreign = adoptedGraph(foreignRecorder);
      if (ordinal === 101) {
        retireSQLiteCursorStageOwnershipOuterPublicationIntrinsic(
          foreign.graph.transfer,
          foreign.graph.authority,
        );
      }
      subject = adoptedGraph(recorder);
      candidate = foreign.adoptionReceipt;
    }
    let error;
    try {
      prepareSQLiteCursorPublicationSessionIntrinsic(subject.graph.authority, candidate);
    } catch (caught) { error = caught; }
    invariant(error !== undefined,
      `TypeScript hostile ordinal ${String(ordinal)} was not rejected`);
    const id = ordinal === 100
      ? "stage-adoption-receipt-clone"
      : ordinal === 101
        ? "stage-adoption-receipt-cross-run-or-post-retirement-replay"
        : "stage-adoption-receipt-substitution";
    const normalized = normalizedHostile(
      recorder, subject, ordinal, id, "stage-adoption-receipt-presentation",
    );
    return activatedRecord({ error, normalized, ordinal });
  } finally {
    detachActiveRecorder();
    if (subject !== undefined) disposeGraph(subject.graph);
    if (foreign !== undefined) disposeGraph(foreign.graph);
  }
}

function findFunction(sourceFile, name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  invariant(found !== undefined, `TypeScript reporter could not locate ${name}`);
  return found;
}

function staticGates() {
  const outerSource = readFileSync(OUTER_SOURCE_PATH, "utf8");
  const clockSource = readFileSync(CLOCK_SOURCE_PATH, "utf8");
  const ownershipSource = readFileSync(OWNERSHIP_SOURCE_PATH, "utf8");
  const stageSource = readFileSync(STAGE_SOURCE_PATH, "utf8");
  const outerDist = readFileSync(OUTER_DIST_PATH, "utf8");
  const ownershipDist = readFileSync(OWNERSHIP_DIST_PATH, "utf8");
  const stageDist = readFileSync(STAGE_DIST_PATH, "utf8");
  const rootDeclaration = readFileSync(ROOT_DECLARATION_PATH, "utf8");
  const sourceFile = ts.createSourceFile(
    OUTER_SOURCE_PATH, outerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  const prepare = findFunction(sourceFile, "prepareSQLiteCursorPublicationSessionIntrinsic");
  const observe = findFunction(sourceFile, "observeSQLiteCursorPublicationSessionClockIntrinsic");
  const publish = findFunction(sourceFile, "publishSQLiteCursorPublicationSessionIntrinsic");
  const readSnapshot = findFunction(
    sourceFile, "readSQLiteCursorPublicationSessionSnapshotIntrinsic",
  );
  const sessionSlice = outerSource.slice(prepare.getStart(sourceFile), readSnapshot.end);
  const sourceTail = auditSQLiteCursorPublicationSessionTypescriptTail({
    outerPath: OUTER_SOURCE_PATH,
    outerSource,
    ownershipPath: OWNERSHIP_SOURCE_PATH,
    ownershipSource,
    stagePath: STAGE_SOURCE_PATH,
    stageSource,
  });
  const distTail = auditSQLiteCursorPublicationSessionTypescriptTail({
    outerPath: OUTER_DIST_PATH,
    outerSource: outerDist,
    ownershipPath: OWNERSHIP_DIST_PATH,
    ownershipSource: ownershipDist,
    stagePath: STAGE_DIST_PATH,
    stageSource: stageDist,
  });
  const tailText = `${sourceTail.text}\n${distTail.text}`;
  const hasCall = (pattern) => pattern.test(tailText);
  return Object.freeze({
    closedPrepareSignature: prepare.parameters.length === 2,
    closedObserveSignature: observe.parameters.length === 1,
    closedPublishSignature: publish.parameters.length === 3
      && publish.parameters[2].questionToken !== undefined,
    atomicTailNoCancellation: !hasCall(/cancell/iu),
    atomicTailNoFaultHook: !hasCall(/fault|hook/iu),
    atomicTailNoSql: !hasCall(/\b(?:SELECT|INSERT|UPDATE|DELETE|PRAGMA)\b/u),
    atomicTailNoProviderClock: !hasCall(/observeSQLiteCursorProviderClock|providerNow/iu),
    atomicTailNoCallerDispatch: sourceTail.exact && distTail.exact,
    atomicTailNoImport: !hasCall(/\bimport\s*\(/u),
    atomicTailNoTransactionControl: !hasCall(/\b(?:BEGIN|ROLLBACK)\b/iu),
    atomicTailNoCursorRebind: !hasCall(/rebind/iu),
    atomicTailNoCommit: !hasCall(/\bCOMMIT\b/iu),
    clockRegistryEncapsulated:
      !/\b(?:CAPABILITIES|CLOCK_SOURCES|EVIDENCE|LOCK_CAPABILITIES|TOMBSTONES)\b/u
        .test(sessionSlice),
    packageRootDeclarationPrivate:
      !/SQLiteCursorPublicationSession|prepareSQLiteCursorPublicationSessionIntrinsic/u
        .test(rootDeclaration)
      && /SQLiteCursorPublicationSessionClockGraphSnapshot/u.test(clockSource),
  });
}

function publicExports() {
  return Object.freeze({
    packageRootPrepare: Object.hasOwn(publicApi, "prepareSQLiteCursorPublicationSessionIntrinsic"),
    packageRootObserve: Object.hasOwn(publicApi, "observeSQLiteCursorPublicationSessionClockIntrinsic"),
    packageRootPublish: Object.hasOwn(publicApi, "publishSQLiteCursorPublicationSessionIntrinsic"),
    packageRootAssert: Object.hasOwn(publicApi, "assertSQLiteCursorPublicationSessionIntrinsic"),
    packageRootReadSnapshot:
      Object.hasOwn(publicApi, "readSQLiteCursorPublicationSessionSnapshotIntrinsic"),
    packageRootCancellation: Object.hasOwn(
      publicApi, "createSQLiteCursorPublicationSessionCancellationControllerIntrinsic",
    ),
    packageRootPreparedOwner: Object.hasOwn(publicApi, "SQLiteCursorPublicationSessionPreparedOwner"),
    packageRootSession: Object.hasOwn(publicApi, "SQLiteCursorPublicationSession"),
  });
}

function counterProbe() {
  const recorder = new SessionCounterRecorder();
  recorder.providerClockRead();
  recorder.clockEvidenceConsumed();
  recorder.outerAuthorityMinted();
  for (let index = 0; index < 4; index += 1) {
    recorder.writePrepared(index);
    recorder.writeExecuted(index);
    recorder.writeAffected(index);
    recorder.writeChanged(index);
  }
  recorder.ledgerLogicalWrite();
  recorder.ledgerFixedStatement();
  recorder.ledgerAffectedRow();
  recorder.catalogFenceMinted();
  recorder.readerLeaseMinted();
  recorder.readerLeaseClosed();
  recorder.initialWriteReceiptMinted();
  recorder.initialWriteReceiptConsumed();
  recorder.initialWriteReceiptTombstoned();
  recorder.stageAdoptionReceiptMinted();
  recorder.cursorRebindPrepared();
  recorder.cursorRebindExecuted();
  recorder.committed();
  recorder.publicationSessionMinted();
  recorder.publicationSessionAsserted();
  recorder.cancellationObserved();
  recorder.rolledBack();
  return recorder.sessionProbeSnapshot();
}

const gates = staticGates();
invariant(Object.keys(gates).length === 14 && Object.values(gates).every((gate) => gate === true),
  "TypeScript publication-session static gate failed before report emission");

const report = Object.freeze({
  runtime: "typescript",
  publicExports: publicExports(),
  staticGates: gates,
  counterProbe: counterProbe(),
  rollbackCount: 0,
  success: runSuccessControl(),
  cancellation: runCancellationControl(),
  activatedRecords: Object.freeze([
    runOrdinal20(),
    runAdoptionReceiptOrdinal(100),
    runAdoptionReceiptOrdinal(101),
    runAdoptionReceiptOrdinal(102),
  ]),
});

process.stdout.write(`${JSON.stringify(report)}\n`);
