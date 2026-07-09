# bymaxone/.github — shared CI

Centralized, reusable CI for every Bymax repository. Define the toolchain and the
pipeline **once here**; each repo calls it with a few inputs. Fixing a step (a Node
bump, an action allow-list workaround, a cache tweak) is a one-line change here that
every repo inherits.

## Cost philosophy

- **Tests never run on a schedule.** Unit, e2e, and mutation are event-driven
  (push / pull_request) or on-demand (`workflow_dispatch`).
- **Mutation is the deepest gate** and runs **only** on a push to the default branch
  (or manual dispatch), and only when application source changed — with its Stryker
  incremental state cached. PRs stay gated by 100% coverage + e2e, which is fast.
- **The only scheduled work is dependency/security that depends on third parties**,
  and it runs on GitHub infrastructure via **Dependabot** (≈ zero Action minutes) —
  not a cron CI job. New-CVE detection for unchanged deps is exactly what Dependabot
  is for.

## What's here

| File | Type | Purpose |
| --- | --- | --- |
| `.github/actions/setup-node-pnpm` | composite action | pnpm + Node + pnpm-store cache, optional local `file:` library build, frozen install |
| `.github/workflows/node-ci.yml` | reusable (`workflow_call`) | lint · typecheck · format · unit+coverage · e2e-api · web-build · e2e-web · export-audit · mutation · coverage-report |
| `.github/workflows/security.yml` | reusable (`workflow_call`) | dependency-review on PRs (GitHub-owned action — unaffected by the third-party allow-list) |
| `.github/workflow-templates/` | org starters | shown in the repo "New workflow" gallery |
| `.github/workflow-templates/dependabot.yml` | reference | copy to each repo's `.github/dependabot.yml` |

## Using it in a repo

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  workflow_dispatch:

jobs:
  ci:
    uses: bymaxone/.github/.github/workflows/node-ci.yml@v1
    with:
      library-repo: bymaxone/nest-cache # a sibling file: dep; "" to skip
      has-web: true
      run-export-audit: true
      run-mutation: true
    secrets: inherit

  security:
    uses: bymaxone/.github/.github/workflows/security.yml@v1
    secrets: inherit
```

Then copy `.github/workflow-templates/dependabot.yml` to `.github/dependabot.yml`.

### node-ci inputs

| Input | Default | Notes |
| --- | --- | --- |
| `node-version` | `24` | |
| `library-repo` | `""` | sibling `file:` library to check out + build |
| `has-web` | `true` | run web build + web coverage + Playwright e2e |
| `run-format-check` | `true` | `pnpm format:check` |
| `run-e2e-api` | `true` | `pnpm test:e2e:api` (Testcontainers) |
| `run-e2e-web` | `true` | Playwright web smoke (needs `has-web`) |
| `run-export-audit` | `false` | `pnpm audit:exports` (library export contract) |
| `run-mutation` | `false` | Stryker on default-branch push / dispatch only |
| `mutation-source-globs` | api/web/src regex | which changed paths trigger mutation |

## Versioning

Pin callers to `@v1` (a moving major tag) so a deliberate `v1.x` release propagates
to every repo, while a breaking change lands as `v2` behind an explicit bump. Never
pin callers to `@main`.

## Project types

- **Node** (libraries `@bymax-one/nest-*` and `nest-*-example` apps) → `node-ci.yml`.
- **Rust** (`rust-auth`, `rust-auth-example`) → `rust-ci.yml` / `rust-mutation.yml`
  _(planned — same philosophy: clippy/fmt/test on events, `cargo-mutants` on the
  default branch only, sharded)_.

## Third-party action allow-list

The org restricts Actions to GitHub-owned + verified-marketplace + an explicit
allow-list. The reusables here use `pnpm/action-setup` (allow-listed) and otherwise
only GitHub-owned actions, so consuming repos need no per-repo allow-list changes.
