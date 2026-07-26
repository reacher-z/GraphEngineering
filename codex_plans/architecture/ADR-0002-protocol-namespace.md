# ADR-0002: Use a controlled protocol namespace

Status: accepted
Date: 2026-07-26

## Context

The initial draft used `graphengineering.dev` in schema identifiers and API
versions. A live DNS and HTTPS check showed that domain is already operated by
an unrelated third party. Using it would incorrectly imply ownership and allow
someone outside this project to control schema URLs.

## Decision

- Graph API version: `graphengineering.reacher-z.github.io/v1alpha1`.
- Event API version: `graphengineering.reacher-z.github.io/events/v1alpha1`.
- Schema URLs live below `https://reacher-z.github.io/GraphEngineering/`.

## Consequences

The pre-release canonical fixture hash changes. All native runtimes and CLI
implementations must update before integration. GitHub Pages must publish the
versioned schema files before stable release. A future custom domain may host a
redirect, but released API-version strings remain immutable.
