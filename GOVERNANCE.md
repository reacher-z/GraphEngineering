# Governance

Graph Engineering begins with a maintainer-led governance model while its
v1alpha1 protocol is being established. Maintainers are responsible for
protocol consistency, security response, releases, and community moderation.

## Decision process

- Documentation, examples, and isolated adapters use normal pull-request review.
- Graph IR, canonical serialization, runtime semantics, persistence, security
  defaults, or compatibility changes require a public design issue and ADR.
- Stable protocol changes require TypeScript and Python implementations,
  migrations when applicable, and shared conformance fixtures.
- Security-sensitive changes may be developed privately until coordinated
  disclosure is safe.

When reviewers disagree, the decision record must state the alternatives,
evidence, compatibility impact, and why one option was selected. Popularity is
not a substitute for technical evidence.

## Maintainer path

Consistent contributors can become reviewers after demonstrating sound review,
reliable follow-through, and respect for security and cross-language parity.
Maintainer additions and removals are documented publicly except where privacy
or safety requires otherwise. This policy will be revisited before v1.
