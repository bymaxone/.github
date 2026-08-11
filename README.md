<div align="center">

<img src="https://avatars.githubusercontent.com/u/274851014?s=120" alt="Bymax One logo" width="110" height="110" />

# `.github` · Organization Defaults

### 🏛️ The special repository that powers every Bymax One repo.

Org-wide defaults live **here, once** — the public profile, shared CI, workflow
templates, and community health files — and propagate to every repository automatically.

[![Org profile](https://img.shields.io/badge/🏠_Org_profile-bymaxone-0ea5e9?style=flat-square)](https://github.com/bymaxone)
[![Website](https://img.shields.io/badge/🌐_Website-bymax.one-0ea5e9?style=flat-square)](https://bymax.one)
![License](https://img.shields.io/badge/License-MIT-000000?style=flat-square)

</div>

---

## ℹ️ Why this repo exists

`bymaxone/.github` is GitHub's **special organization repository**. Files placed here
become **defaults for every repo in the org** that doesn't define its own — so we
maintain them in one place instead of copy-pasting across dozens of repositories.
It is public because organization-wide defaults require a public repo.

---

## 📂 What lives here

| Path                                                                                                                                            | What it is                                                                                                                                              | Shows up…                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 🏠 [`profile/README.md`](profile/README.md)                                                                                                     | The **organization profile**                                                                                                                            | On the [org overview page](https://github.com/bymaxone)    |
| 🔁 [`.github/workflows/node-ci.yml`](.github/workflows/node-ci.yml)                                                                             | **Reusable CI — Node example apps** — lint · typecheck · format · coverage · e2e · export-audit · mutation                                              | Called by each `nest-*-example` repo's `ci.yml`            |
| 📚 [`.github/workflows/node-lib-ci.yml`](.github/workflows/node-lib-ci.yml)                                                                     | **Reusable CI — Node libraries** — lint · typecheck · format · unit+coverage · build · mutation                                                         | Called by each `@bymax-one/nest-*` library's `ci.yml`      |
| 🦀 [`.github/workflows/rust-ci.yml`](.github/workflows/rust-ci.yml)                                                                             | **Reusable CI — Rust workspaces** — fmt · clippy · build & test · llvm-cov · MSRV · cargo-mutants                                                       | Called by `rust-auth` / `rust-auth-example`                |
| 🛡️ [`.github/workflows/security.yml`](.github/workflows/security.yml)                                                                           | **Reusable dependency-review** (GitHub-owned action only)                                                                                               | Called on public-repo pull requests                        |
| 🗓️ [`.github/workflows/peer-advisory-drift.yml`](.github/workflows/peer-advisory-drift.yml)                                                     | **Reusable advisory-drift audit** — cross-checks the ranges a package _declares_ against the advisory database; files and closes its own tracking issue | Called weekly by each publishable repo                     |
| 🔎 [`.github/workflows/osv-scanner.yml`](.github/workflows/osv-scanner.yml)                                                                     | **Reusable OSV-Scanner** — scans the full resolved dependency tree (lockfile) against the OSV database; the audit dependency-review (PR diff) and peer-advisory-drift (declared ranges) don't do        | Being wired into each library and the template — on push/PR + weekly |
| 🏷️ [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml)                                                                           | **Reusable PR-title check** — Conventional Commits grammar on the pull-request title, which squash merges turn into the commit subject                  | Called by each repo's `pr-title.yml` on every title change |
| 🔬 [`.github/workflows/codeql.yml`](.github/workflows/codeql.yml)                                                                               | **Reusable CodeQL analysis** — gated on the repository being public, since code scanning is free there and licensed on private repos                    | Called by each public repo's `codeql.yml`                  |
| 🚀 [`.github/workflows/release-major-alias.yml`](.github/workflows/release-major-alias.yml)                                                     | **Release** — on a pushed `vN.Y.Z` tag, moves the `vN` alias onto it. The only thing that moves `v1`; merging to `main` publishes nothing               | Runs here, on every release                                |
| 🧩 [`.github/actions/setup-node-pnpm`](.github/actions/setup-node-pnpm)                                                                         | **Composite action** — pnpm + Node + cache + local `file:` lib build + install                                                                          | Used by the reusable jobs                                  |
| 📋 [`.github/workflow-templates/`](.github/workflow-templates)                                                                                  | **Starter workflows + `dependabot.yml`**                                                                                                                | In the repo "New workflow" gallery                         |
| 🤖 [`.github/copilot-instructions.md`](.github/copilot-instructions.md) · [`instructions/`](.github/instructions) · [`agents/`](.github/agents) | **Copilot code-review reference set** — org baseline + per-stack rules + reviewer agent                                                                 | Copied into a repo (does **not** auto-propagate)           |

> 🩺 **Community health files** (`CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, issue/PR
> templates) also belong here — they are the next addition and will apply org-wide.

---

## 🤖 Copilot code review

Two independent layers configure Copilot review across the org:

1. **Automatic trigger** — the org ruleset **`copilot-code-review`** requests a
   Copilot review on the default branch of **every** repo (`~ALL`), new ones
   included. No per-repo setup.
2. **The rules Copilot applies** — split by reach:

| Layer                          | Where it lives                                                                                    | Applies to                |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------- |
| **Universal baseline**         | **Org → Settings → Copilot → Custom instructions**                                                | Every repo, automatically |
| **Per-repo instruction files** | each repo's own `.github/copilot-instructions.md` · `.github/instructions/*` · `.github/agents/*` | Only that repo            |

> ⚠️ **Unlike community health files, Copilot instruction files do _not_ propagate
> from this repo.** GitHub reads them only from the repository under review. The set
> below is the **canonical reference** — copy what a new repo needs, then append its
> domain rules (supply-chain contract, crypto/tenant, PII, pixel parity, fiscal math…).

| File                                                                                             | For                                            |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| [`copilot-instructions.md`](.github/copilot-instructions.md)                                     | org baseline (mirror of the org-settings text) |
| [`instructions/code.rust.instructions.md`](.github/instructions/code.rust.instructions.md)       | Rust crates                                    |
| [`instructions/code.library.instructions.md`](.github/instructions/code.library.instructions.md) | `@bymax-one/*` libraries                       |
| [`instructions/code.app.instructions.md`](.github/instructions/code.app.instructions.md)         | apps consuming those libraries                 |
| [`instructions/tests.instructions.md`](.github/instructions/tests.instructions.md)               | test suites                                    |
| [`agents/agent-code-reviewer.agent.md`](.github/agents/agent-code-reviewer.agent.md)             | reviewer agent definition                      |

---

## 🔁 Shared CI

Define the toolchain and pipeline **once**; each repo becomes a thin caller. Fixing a
step (a Node bump, an action allow-list workaround, a cache tweak) is a one-line change
here that every repo inherits.

### 💸 Cost philosophy

- ⏱️ **Tests never run on a schedule** — unit, e2e, and mutation are event-driven
  (push / pull_request) or on-demand (`workflow_dispatch`).
- 🧬 **Mutation is the deepest gate** — it runs **only** on a default-branch push (or
  manual dispatch), and only when application source changed (Stryker incremental for
  Node, `cargo-mutants --in-diff` for Rust). PRs stay gated by 100% coverage + e2e,
  which is fast. No mutation runs on a schedule or on the PR path anywhere in the org.
- 🤖 **Third-party dependency/security updates are handled by Dependabot** on GitHub
  infrastructure (≈ zero Action minutes) — not a cron CI job.
- 🗓️ **One cron CI job exists**, and only because Dependabot structurally cannot answer
  the question: [`peer-advisory-drift.yml`](.github/workflows/peer-advisory-drift.yml).
  Dependabot audits what is **installed** in a repo — the lockfile — and stays quiet
  while a published `peerDependencies` range still admits a version with an advisory.
  The range never changes and becomes wrong anyway, because the advisory database is
  what moves; the drift arrives with no commit and no alert. That is why it is
  scheduled rather than event-driven: the degradation happens **between** releases,
  when nothing is being pushed. It costs a handful of read-only GraphQL queries; it
  never builds, and never installs the **caller's** dependency tree — only `semver`,
  into a throwaway `$RUNNER_TEMP` directory, so the workspace it audits is left
  untouched.

### 🚀 Using it in a repo

```yaml
# .github/workflows/ci.yml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  workflow_dispatch:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  ci:
    uses: bymaxone/.github/.github/workflows/node-ci.yml@v1
    with:
      library-repo: bymaxone/nest-cache # a sibling file: dep; "" to skip
      has-web: true
      run-export-audit: true
      run-mutation: true

  security:
    if: github.event_name == 'pull_request'
    uses: bymaxone/.github/.github/workflows/security.yml@v1
```

Then copy [`.github/workflow-templates/dependabot.yml`](.github/workflow-templates/dependabot.yml)
to your repo's `.github/dependabot.yml`.

### ⚙️ `node-ci` inputs

| Input                   | Default           | Notes                                          |
| ----------------------- | ----------------- | ---------------------------------------------- |
| `node-version`          | `24`              |                                                |
| `library-repo`          | `""`              | sibling `file:` library to check out + build   |
| `has-web`               | `true`            | web build + web coverage + Playwright e2e      |
| `run-format-check`      | `true`            | `pnpm format:check`                            |
| `run-e2e-api`           | `true`            | `pnpm test:e2e:api` (Testcontainers)           |
| `run-e2e-web`           | `true`            | Playwright web smoke (needs `has-web`)         |
| `run-export-audit`      | `false`           | `pnpm audit:exports` (library export contract) |
| `run-mutation`          | `false`           | Stryker on default-branch push / dispatch only |
| `mutation-source-globs` | api/web/src regex | which changed paths trigger mutation           |

### 📚 `node-lib-ci` inputs (libraries)

A library caller routes the generic jobs (lint · typecheck · format · unit+coverage ·
build · mutation) through `node-lib-ci.yml` and keeps repo-specific jobs (`verify`
build+integrity+size, Testcontainers `e2e`, `secret-scan`) local, plus a
visibility-gated `security` job.

| Input                   | Default         | Notes                                                                      |
| ----------------------- | --------------- | -------------------------------------------------------------------------- |
| `node-version`          | `24`            |                                                                            |
| `library-repo`          | `""`            | sibling `file:` library to check out + build (usually empty for a library) |
| `run-format-check`      | `true`          | `pnpm format:check`                                                        |
| `unit-command`          | `pnpm test:cov` | the gated unit+coverage command (e.g. `pnpm test:cov:all`)                 |
| `build-command`         | `pnpm build`    | the library build command                                                  |
| `run-build`             | `true`          | run the build job (set `false` when a local `verify` job builds)           |
| `database-url`          | `""`            | `DATABASE_URL` for libs with a Prisma client (empty to skip)               |
| `post-install`          | `""`            | command after install in every job (e.g. `prisma generate`)                |
| `run-mutation`          | `false`         | Stryker on default-branch push / dispatch only                             |
| `mutation-source-globs` | `^(src/)`       | which changed paths trigger mutation                                       |

### 🦀 `rust-ci` inputs (Rust workspaces)

A Rust caller routes the universal Cargo gates (fmt · clippy · build & test ·
`cargo-llvm-cov` · MSRV · `cargo-mutants`) through `rust-ci.yml` and keeps every
bespoke job (wasm, fuzz, feature matrix, supply-chain, public-api, npm/web bundles,
e2e) local.

| Input                   | Default                                   | Notes                                                  |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `run-build`             | `true`                                    | `cargo build` before the test job                      |
| `run-coverage`          | `true`                                    | `cargo llvm-cov` line+function gate                    |
| `coverage-fail-under`   | `100`                                     | minimum line & function coverage percent               |
| `run-msrv`              | `true`                                    | build on the declared MSRV floor                       |
| `msrv-version`          | `1.90`                                    | the MSRV toolchain (matches `rust-version`)            |
| `run-mutation`          | `false`                                   | `cargo-mutants` on default-branch push / dispatch only |
| `mutation-command`      | `cargo mutants --all-features --in-place` | the mutation command                                   |
| `mutation-source-globs` | `^(crates/\|src/\|bindings/)`             | which changed paths trigger mutation                   |

### 🗓️ `peer-advisory-drift` inputs (publishable packages)

Audits the ranges a package **declares** — what consumers are told they may install —
rather than what its own lockfile pins. Reports one row per declared range with the
floor to move to, opens a tracking issue, rewrites it as findings change, and **closes
it automatically** once every range is clear.

| Input                | Default               | Notes                                                                                                                  |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `manifest-path`      | `package.json`        | the manifest whose declared ranges are audited                                                                         |
| `dependency-types`   | `peerDependencies`    | comma-separated manifest fields; every field listed is a public claim of support                                       |
| `severity-threshold` | `low`                 | lowest advisory severity to report — raise per repo rather than discovering later that a moderate finding was filtered |
| `issue-label`        | `peer-advisory-drift` | label on the tracking issue, and the key used to find it again                                                         |
| `fail-on-drift`      | `false`               | also fail the job; off by default because a permanently red scheduled run trains people to ignore it                   |

| Output           | Notes                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `drift-count`    | number of declared **ranges** that admit a vulnerable version — the number of lines to edit, not the number of advisories behind them |
| `advisory-count` | total advisory matches, for reporting                                                                                                 |

The caller must grant `issues: write`: permissions on a reusable workflow can only
narrow what the caller granted.

```yaml
# .github/workflows/peer-advisory-drift.yml
name: Peer Advisory Drift

on:
  schedule:
    - cron: "17 6 * * 1"
  workflow_dispatch:

# Single-flight across the repository, deliberately NOT keyed by `github.ref`: the
# shared state is one tracking issue per repo, so a ref-scoped group would put a
# dispatch and the scheduled run in different groups and leave the race intact.
concurrency:
  group: peer-advisory-drift
  cancel-in-progress: false

permissions:
  contents: read
  issues: write

jobs:
  drift:
    # `workflow_dispatch` can fire from any branch; auditing an unmerged manifest
    # would write findings that do not describe what the package declares.
    if: github.ref_name == github.event.repository.default_branch
    uses: bymaxone/.github/.github/workflows/peer-advisory-drift.yml@v1
```

### 🔎 `osv-scanner` inputs (dependency-tree audit)

Scans the whole resolved dependency tree — every package the lockfile pins, direct and
transitive — against the OSV database. This is the audit `dependency-review` (which only
sees a PR's added dependencies) and `peer-advisory-drift` (which only reads declared
ranges) leave uncovered: a transitive package already installed that turns vulnerable
between releases. The scanner surfaces findings in the log and fails the run; it uploads
nothing, so it is callable from private repos (the template included) as-is.

| Input       | Default            | Notes                                                                                          |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `scan-args` | `--recursive` `./` | newline-separated OSV-Scanner arguments; the default scans the whole checkout recursively      |

```yaml
# .github/workflows/osv-scanner.yml
name: OSV-Scanner

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    # Weekly, off the hour so the scheduled run does not cluster at :00.
    - cron: "42 6 * * 3"

permissions:
  contents: read

jobs:
  scan:
    uses: bymaxone/.github/.github/workflows/osv-scanner.yml@v1
```

### 🏷️ Versioning

Point callers at **`@v1`** (a moving major alias): a deliberate `v1.x` release propagates
to every repo, while a breaking change lands as `v2` behind an explicit bump. Never point
a caller at `@main`.

**Do not pin these references to a commit SHA.** It was tried and reverted — see
[AGENTS.md](AGENTS.md#how-consuming-repositories-should-reference-this). Propagating one
change becomes ~58 Dependabot pull requests across the libraries, which removes the only
reason this repository exists. The opposite rule holds for **third-party** actions: those
are pinned to a full SHA with the version in a trailing comment, because that is where the
supply-chain risk actually is.

---

## 🧭 Project types

| Stack                                                           | Reusable                                                       | Status          |
| --------------------------------------------------------------- | -------------------------------------------------------------- | --------------- |
| 🟢 **Node libraries** — `@bymax-one/nest-*`                     | `node-lib-ci.yml` · `security.yml` · `peer-advisory-drift.yml` | ✅ Live (`@v1`) |
| 🟢 **Node example apps** — `nest-*-example`                     | `node-ci.yml` · `security.yml`                                 | ✅ Live (`@v1`) |
| 🦀 **Rust** — `rust-auth` (library) + `rust-auth-example` (app) | `rust-ci.yml` · `security.yml`                                 | ✅ Live (`@v1`) |

> 🗓️ **`peer-advisory-drift` is Node-only.** Example apps are not published, so nothing
> reads the ranges they declare. Rust is a genuine gap rather than an exclusion: the
> advisory database exposes the same data under `ecosystem: RUST`, but auditing it means
> parsing `Cargo.toml` and `[workspace.dependencies]` and honouring Cargo's version
> semantics, where a bare `"1.2"` already means `^1.2`. `cargo-audit` covers the
> **installed** side there — the same blind spot Dependabot has on the Node side.

---

## 🔒 Third-party action allow-list

The org restricts Actions to **GitHub-owned + verified-marketplace + an explicit
pattern allow-list** (`orgs/bymaxone/actions/permissions/selected-actions`). GitHub's
**verified-creator** flag does **not** cover several actions the Node and Rust pipelines
depend on, so those are pattern-allowed explicitly. Current `patterns_allowed`:

```
pnpm/action-setup@*                          actions-rust-lang/setup-rust-toolchain@*
Swatinem/rust-cache@*                         taiki-e/install-action@*
ossf/scorecard-action@*                       dtolnay/rust-toolchain@*
dorny/paths-filter@*                          stefanzweifel/git-auto-commit-action@*
docker/build-push-action@*                    docker/login-action@*
docker/metadata-action@*                      docker/setup-buildx-action@*
trufflesecurity/trufflehog@*
```

Workflows still pin every action to a full commit SHA — `@*` here only **permits** the
action, it does not relax the pin.

---

## 🩹 Gotchas / operational notes

Hard-won lessons from rolling these reusables across every repo — read before touching
org-level Actions settings or a repo's security workflows.

### The allow-list `PUT` is destructive — always merge

`gh api --method PUT orgs/bymaxone/actions/permissions/selected-actions` **replaces the
entire policy**. A `PUT` that sends only the one pattern you're adding silently drops all
the others. A workflow that references a now-blocked action fails at **startup**
(`startup_failure`, "workflow file issue") with **no job logs** — and, worst of all, the
PR shows a **misleading `CLEAN` mergeStateStatus** with an empty check-run list, so it
would merge with **zero CI**. Always read the current `patterns_allowed`, append, and
`PUT` the full set. (`verified_allowed: true` does **not** cover `taiki-e/install-action`,
`Swatinem/rust-cache`, `actions-rust-lang/setup-rust-toolchain`, `dtolnay/rust-toolchain`,
`dorny/paths-filter`, `ossf/scorecard-action`, `stefanzweifel/*`, or `docker/*` — they
must be explicit.)

### CodeQL: default setup vs. a version-controlled `codeql.yml`

A repo cannot run **both** the code-scanning **default setup** and an advanced
`.github/workflows/codeql.yml`. When both are on, the advanced workflow fails its SARIF
upload with _"CodeQL analyses from advanced configurations cannot be processed when the
default setup is enabled."_ Since the workflow is the source of truth, disable default
setup:

```bash
gh api --method PATCH repos/OWNER/REPO/code-scanning/default-setup -f state=not-configured
```

### Dependency review is gated on visibility

`actions/dependency-review-action` needs the dependency graph, which is free only on
**public** repos (or private + GitHub Advanced Security). Gate the `security` caller so it
stays green while a repo is private and activates automatically once it's public:

```yaml
security:
  if: github.event_name == 'pull_request' && github.event.repository.visibility == 'public'
  uses: bymaxone/.github/.github/workflows/security.yml@v1
```

### Publishing a change — never move `@v1` by hand

Merging to `main` publishes **nothing**. Callers run `@v1`, and `v1` only moves when a
version tag is pushed:

```bash
git checkout main && git pull
git tag v1.5.0 && git push origin v1.5.0
```

[`release-major-alias.yml`](.github/workflows/release-major-alias.yml) picks that up,
verifies the tag is on `main`, and moves `v1` onto it.

**Do not run `git push -f origin v1`.** That was the old instruction and it is what made
`v1` a synonym for `main`: eight merges became eight silent deploys to every consuming
repository in a single day. The version tag is the gate — `v*.*.*` is immutable by
ruleset, so a caller pinning one gets the same bytes forever.

Breaking changes get `v2` and a new alias rather than a `v1` move. Renaming a job counts
as breaking: the job id prefixes the reported check name, and repositories require those
names in their rulesets.

Full contract, including what to check before touching a reusable: [AGENTS.md](AGENTS.md).

---

<div align="center">

**Bymax One** — architecting AI-native systems for production.
[🏠 Profile](https://github.com/bymaxone) · [🌐 bymax.one](https://bymax.one)

</div>
