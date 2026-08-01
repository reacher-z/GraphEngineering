"""The closed v1alpha2 source and sink inventories.

``redaction-semantics.md`` Section 1.2 fixes exactly 57 source classes and
exactly 54 sink classes, one classification row per source and one policy row per
sink.  Adding or removing an enum member without updating its row, the counts,
and the evaluator corpus is a conformance failure, so the rows live here as
native data and the conformance tests assert byte equality with
``spec/conformance/redaction.case.json``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, TypeAlias

DefaultAction: TypeAlias = Literal["protected-ref", "metadata-only-allowlist", "off"]

IdentifierTreatment: TypeAlias = Literal[
    "not-applicable",
    "replace-with-runtime-opaque-and-protect-original",
    "generated-opaque-metadata",
]

PolicyControl: TypeAlias = Literal[
    "durableValues",
    "checkpointValues",
    "events",
    "errors",
    "logs",
    "traces",
    "prompts",
    "responses",
    "tools",
    "artifacts",
    "metrics",
    "mcp",
    "plugins",
    "isolationOutputs",
    "database",
    "exports",
    "supportBundles",
    "testArtifacts",
    "identifiers",
    "deny",
]

POLICY_CONTROLS: Final[tuple[PolicyControl, ...]] = (
    "durableValues",
    "checkpointValues",
    "events",
    "errors",
    "logs",
    "traces",
    "prompts",
    "responses",
    "tools",
    "artifacts",
    "metrics",
    "mcp",
    "plugins",
    "isolationOutputs",
    "database",
    "exports",
    "supportBundles",
    "testArtifacts",
    "identifiers",
    "deny",
)


@dataclass(frozen=True, slots=True)
class SourceRow:
    """One complete source classification."""

    source_class: str
    policy_control: PolicyControl
    default_action: DefaultAction
    may_be_metadata: bool
    may_feed_scheduler: bool
    identifier_treatment: IdentifierTreatment


@dataclass(frozen=True, slots=True)
class SinkRow:
    """One complete sink policy row."""

    sink: str
    family: str
    policy_controls: tuple[PolicyControl, ...]
    accepts_protected: bool
    accepts_metadata: bool
    default_enabled: bool


SOURCE_ROWS: Final[tuple[SourceRow, ...]] = (
    SourceRow(
        source_class='graph-input',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='graph-output',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='bound-node-input',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='node-output',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='node-result',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='run-result',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='event-data',
        policy_control='events',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='checkpoint-state',
        policy_control='checkpointValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='artifact-body',
        policy_control='artifacts',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='artifact-metadata',
        policy_control='artifacts',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='graph-metadata',
        policy_control='events',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='node-metadata',
        policy_control='events',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='edge-metadata',
        policy_control='events',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='node-config',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='planner-output',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='router-output',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='verifier-evidence',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='approval-context',
        policy_control='durableValues',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='prompt',
        policy_control='prompts',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='model-request',
        policy_control='prompts',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='model-response',
        policy_control='responses',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='provider-request',
        policy_control='prompts',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='provider-response',
        policy_control='responses',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='provider-usage',
        policy_control='responses',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='provider-error',
        policy_control='errors',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='tool-request',
        policy_control='tools',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='tool-response',
        policy_control='tools',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='tool-error',
        policy_control='tools',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='exception-message',
        policy_control='errors',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='exception-stack',
        policy_control='errors',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='filesystem-path',
        policy_control='logs',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='process-environment',
        policy_control='deny',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='secret-value',
        policy_control='deny',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='trace-attribute',
        policy_control='traces',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='metrics-attribute',
        policy_control='metrics',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='log-field',
        policy_control='logs',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='cli-argument',
        policy_control='logs',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='mcp-request',
        policy_control='mcp',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='mcp-response',
        policy_control='mcp',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='plugin-request',
        policy_control='plugins',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='plugin-response',
        policy_control='plugins',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='explorer-payload',
        policy_control='exports',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='worktree-output',
        policy_control='isolationOutputs',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='process-output',
        policy_control='isolationOutputs',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='container-output',
        policy_control='isolationOutputs',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='database-index-value',
        policy_control='database',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='database-projection-value',
        policy_control='database',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='backup-source',
        policy_control='database',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='export-source',
        policy_control='exports',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='replay-report',
        policy_control='exports',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='fork-report',
        policy_control='exports',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='support-field',
        policy_control='supportBundles',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='migration-source',
        policy_control='exports',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='test-failure-artifact',
        policy_control='testArtifacts',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='benchmark-artifact',
        policy_control='testArtifacts',
        default_action='off',
        may_be_metadata=False,
        may_feed_scheduler=False,
        identifier_treatment='not-applicable',
    ),
    SourceRow(
        source_class='caller-controlled-identifier',
        policy_control='identifiers',
        default_action='protected-ref',
        may_be_metadata=False,
        may_feed_scheduler=True,
        identifier_treatment='replace-with-runtime-opaque-and-protect-original',
    ),
    SourceRow(
        source_class='runtime-generated-identifier',
        policy_control='identifiers',
        default_action='metadata-only-allowlist',
        may_be_metadata=True,
        may_feed_scheduler=True,
        identifier_treatment='generated-opaque-metadata',
    ),
)

SINK_ROWS: Final[tuple[SinkRow, ...]] = (
    SinkRow(
        sink='event-memory',
        family='event',
        policy_controls=('events',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='event-journal-buffer',
        family='event',
        policy_controls=('events',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='event-journal',
        family='event',
        policy_controls=('events',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='checkpoint-memory',
        family='checkpoint',
        policy_controls=('checkpointValues',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='checkpoint-temporary',
        family='checkpoint',
        policy_controls=('checkpointValues',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='checkpoint-final',
        family='checkpoint',
        policy_controls=('checkpointValues',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='protected-blob-memory',
        family='protected-store',
        policy_controls=('durableValues',),
        accepts_protected=True,
        accepts_metadata=False,
        default_enabled=True,
    ),
    SinkRow(
        sink='protected-blob-temporary',
        family='protected-store',
        policy_controls=('durableValues',),
        accepts_protected=True,
        accepts_metadata=False,
        default_enabled=True,
    ),
    SinkRow(
        sink='protected-blob-final',
        family='protected-store',
        policy_controls=('durableValues',),
        accepts_protected=True,
        accepts_metadata=False,
        default_enabled=True,
    ),
    SinkRow(
        sink='artifact-memory',
        family='artifact',
        policy_controls=('artifacts',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='artifact-temporary',
        family='artifact',
        policy_controls=('artifacts',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='artifact-final',
        family='artifact',
        policy_controls=('artifacts',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='retry-buffer',
        family='queue-transport',
        policy_controls=('events',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='dead-letter',
        family='queue-transport',
        policy_controls=('events', 'errors'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='transport-buffer',
        family='queue-transport',
        policy_controls=('exports',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='provider-request-transport',
        family='provider-tool',
        policy_controls=('prompts',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='provider-response-buffer',
        family='provider-tool',
        policy_controls=('responses',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='tool-request-transport',
        family='provider-tool',
        policy_controls=('tools',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='tool-response-buffer',
        family='provider-tool',
        policy_controls=('tools',),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='stdout',
        family='process-diagnostic',
        policy_controls=('logs', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='stderr',
        family='process-diagnostic',
        policy_controls=('logs', 'errors', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='runtime-log',
        family='process-diagnostic',
        policy_controls=('logs', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='application-log-adapter',
        family='process-diagnostic',
        policy_controls=('logs', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='trace-buffer',
        family='trace',
        policy_controls=('traces', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='trace-export',
        family='trace',
        policy_controls=('traces', 'exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='metrics-buffer',
        family='metrics',
        policy_controls=('metrics', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='metrics-export',
        family='metrics',
        policy_controls=('metrics', 'exports', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='error-envelope',
        family='error',
        policy_controls=('errors', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='error-aggregator',
        family='error',
        policy_controls=('errors', 'exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='cli-json',
        family='cli-mcp',
        policy_controls=('events', 'errors', 'logs', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='cli-diagnostic',
        family='cli-mcp',
        policy_controls=('errors', 'logs', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=True,
    ),
    SinkRow(
        sink='mcp-request-buffer',
        family='cli-mcp',
        policy_controls=('mcp', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='mcp-response',
        family='cli-mcp',
        policy_controls=('mcp', 'errors', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='plugin-request',
        family='plugin',
        policy_controls=('plugins', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='plugin-response',
        family='plugin',
        policy_controls=('plugins', 'errors', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='worktree-output',
        family='isolation',
        policy_controls=('isolationOutputs', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='process-output',
        family='isolation',
        policy_controls=('isolationOutputs', 'errors', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='container-output',
        family='isolation',
        policy_controls=('isolationOutputs', 'errors', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='explorer-response',
        family='explorer-http',
        policy_controls=('events', 'errors', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='explorer-cache',
        family='explorer-http',
        policy_controls=('events', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='http-response',
        family='explorer-http',
        policy_controls=('exports', 'errors', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='network-export',
        family='explorer-http',
        policy_controls=('exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='database-index',
        family='database',
        policy_controls=('database', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='database-materialized-projection',
        family='database',
        policy_controls=('database', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='database-backup',
        family='database',
        policy_controls=('database', 'exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='export-report',
        family='export-replay-fork',
        policy_controls=('exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='replay-report',
        family='export-replay-fork',
        policy_controls=('exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='fork-report',
        family='export-replay-fork',
        policy_controls=('exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='support-bundle-staging',
        family='support-migration',
        policy_controls=('supportBundles', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='support-bundle-final',
        family='support-migration',
        policy_controls=('supportBundles', 'exports', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='migration-manifest',
        family='support-migration',
        policy_controls=('exports', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='test-failure-artifact',
        family='test-evidence',
        policy_controls=('testArtifacts', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='benchmark-artifact',
        family='test-evidence',
        policy_controls=('testArtifacts', 'identifiers'),
        accepts_protected=True,
        accepts_metadata=True,
        default_enabled=False,
    ),
    SinkRow(
        sink='release-evidence',
        family='test-evidence',
        policy_controls=('testArtifacts', 'identifiers'),
        accepts_protected=False,
        accepts_metadata=True,
        default_enabled=False,
    ),
)


SOURCE_CLASSES: Final[tuple[str, ...]] = tuple(row.source_class for row in SOURCE_ROWS)
SINK_CLASSES: Final[tuple[str, ...]] = tuple(row.sink for row in SINK_ROWS)

SOURCE_BY_CLASS: Final[dict[str, SourceRow]] = {row.source_class: row for row in SOURCE_ROWS}
SINK_BY_CLASS: Final[dict[str, SinkRow]] = {row.sink: row for row in SINK_ROWS}

SOURCE_CLASS_COUNT: Final = 57
SINK_CLASS_COUNT: Final = 54
CARTESIAN_PAIR_COUNT: Final = SOURCE_CLASS_COUNT * SINK_CLASS_COUNT

# Section 1.2 row 1: authoritative; protect, never redact. Section 2.2 forbids
# redacted data from ever being authoritative.
NEVER_REDACTABLE_SOURCE_CLASSES: Final[frozenset[str]] = frozenset(
    {
        "bound-node-input",
        "checkpoint-state",
        "event-data",
        "graph-input",
        "graph-output",
        "node-output",
        "node-result",
        "run-result",
    }
)

# Section 2.3: encryption is not redaction; the protected-store family carries
# authenticated ciphertext only.
NEVER_REDACTABLE_SINKS: Final[frozenset[str]] = frozenset(
    {
        "protected-blob-final",
        "protected-blob-memory",
        "protected-blob-temporary",
    }
)

AUTHORITATIVE_SOURCE_CLASSES: Final[frozenset[str]] = NEVER_REDACTABLE_SOURCE_CLASSES


def source_row(source_class: str) -> SourceRow | None:
    """Return the unique classification row, or ``None`` for an unknown class."""

    if type(source_class) is not str:
        return None
    return SOURCE_BY_CLASS.get(source_class)


def sink_row(sink: str) -> SinkRow | None:
    """Return the unique sink policy row, or ``None`` for an unknown sink.

    An implementation must never map an unknown sink to the nearest known enum
    value; the caller treats ``None`` as denial.
    """

    if type(sink) is not str:
        return None
    return SINK_BY_CLASS.get(sink)

