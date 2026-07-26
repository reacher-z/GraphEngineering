# Graph Engineering source review

## Inspiration

- Codez, “Graph Engineering with Claude: 14-Step roadmap”: <https://x.com/0xCodez/status/2079165300625330317>
- Movez, “Graph Engineering” playbook post: <https://x.com/0xMovez/status/2080728910291959884>
- Anthropic, multi-agent research system: <https://www.anthropic.com/engineering/multi-agent-research-system>
- Anthropic, building effective agents: <https://www.anthropic.com/engineering/building-effective-agents>
- DeepLearning.AI, Andrew Ng Agentic AI course: <https://learn.deeplearning.ai/courses/agentic-ai/information>
- JSON Schema 2020-12: <https://json-schema.org/specification>
- OpenTelemetry semantic conventions: <https://opentelemetry.io/docs/specs/semconv/>
- Git worktree: <https://git-scm.com/docs/git-worktree.html>
- LangGraph persistence: <https://docs.langchain.com/oss/python/langgraph/persistence>
- Temporal durable execution: <https://docs.temporal.io/>

## Attribution guardrails

- The X posts are inspiration, not a stable public Anthropic SDK contract.
- Do not claim `parallel()` or `pipeline()` compatibility with an undocumented private API.
- Andrew Ng's public materials support Reflection, Tool Use, Planning, and Multi-Agent patterns; do not claim an official Andrew Ng Graph Engineering standard or endorsement.
- Performance statements from a particular research system cannot be generalized into guarantees for arbitrary graphs.
- Third-party PDFs, diagrams, and post text are linked and summarized, not repackaged.

## Product interpretation

Graph Engineering is graph orchestration for agent work, not knowledge-graph
construction, GraphRAG, or graph neural-network engineering. Its graph contains
model/tool/transform/human nodes and typed data/policy edges. Shared state is
external and durable, while deterministic orchestration remains replayable.
