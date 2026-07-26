# Security policy

Graph Engineering orchestrates tools, models, networks, and filesystem writes,
so security reports are treated as high priority.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub private
vulnerability reporting on this repository. Include the
affected version, reproduction, impact, and any suggested mitigation.

The maintainers will acknowledge a complete report within 72 hours, provide a
status update within seven days, and coordinate disclosure after a fix is
available. These are response targets, not a bounty commitment.

## Supported versions

Until v1, only the newest pre-release is supported. After v1, the latest minor
release receives security fixes. The policy will be revised before a second
stable major version.

## Security boundary and target defaults

The alpha validates graph structure, bounds scheduler work, keeps MCP read-only,
and gates ambiguous durable retries using the declared side-effect class. Node
executors still inherit the host process's ambient filesystem, network, shell,
and environment authority; capability metadata is not yet an enforcement
boundary. Run untrusted executors only inside isolation you configure outside
the runtime.

Target-v1 defaults are deny-by-default shell, network, filesystem-write, and
secret capabilities; explicit approval for non-idempotent external effects;
prompt/response capture off by default; and path-resolved worktree cleanup.
These are requirements, not claims about the current alpha. See the detailed
[security boundary](docs/SECURITY.md#controls-implemented-in-alpha).
