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

## Security defaults

- Shell, network, filesystem writes, and secrets require explicit capabilities.
- MCP mutation is disabled by default.
- Prompt and response bodies are not recorded by default.
- External side effects require idempotency declarations or human approval.
- Worktree cleanup never targets an unresolved broad path.
