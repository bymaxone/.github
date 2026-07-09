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

| Path | What it is | Shows up… |
| --- | --- | --- |
| 🏠 [`profile/README.md`](profile/README.md) | The **organization profile** | On the [org overview page](https://github.com/bymaxone) |
| 🔁 [`.github/workflows/node-ci.yml`](.github/workflows/node-ci.yml) | **Reusable CI** — lint · typecheck · format · coverage · e2e · export-audit · mutation | Called by each repo's `ci.yml` |
| 🛡️ [`.github/workflows/security.yml`](.github/workflows/security.yml) | **Reusable dependency-review** (GitHub-owned action only) | Called on pull requests |
| 🧩 [`.github/actions/setup-node-pnpm`](.github/actions/setup-node-pnpm) | **Composite action** — pnpm + Node + cache + local `file:` lib build + install | Used by the reusable jobs |
| 📋 [`.github/workflow-templates/`](.github/workflow-templates) | **Starter workflows + `dependabot.yml`** | In the repo "New workflow" gallery |

> 🩺 **Community health files** (`CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`, issue/PR
> templates) also belong here — they are the next addition and will apply org-wide.

---

## 🔁 Shared CI

Define the toolchain and pipeline **once**; each repo becomes a thin caller. Fixing a
step (a Node bump, an action allow-list workaround, a cache tweak) is a one-line change
here that every repo inherits.

### 💸 Cost philosophy

- ⏱️ **Tests never run on a schedule** — unit, e2e, and mutation are event-driven
  (push / pull_request) or on-demand (`workflow_dispatch`).
- 🧬 **Mutation is the deepest gate** — it runs **only** on a default-branch push (or
  manual dispatch), and only when application source changed, with the Stryker
  incremental state cached. PRs stay gated by 100% coverage + e2e, which is fast.
- 🤖 **The only scheduled work is third-party dependency/security**, handled by
  **Dependabot** on GitHub infrastructure (≈ zero Action minutes) — not a cron CI job.

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

| Input | Default | Notes |
| --- | --- | --- |
| `node-version` | `24` | |
| `library-repo` | `""` | sibling `file:` library to check out + build |
| `has-web` | `true` | web build + web coverage + Playwright e2e |
| `run-format-check` | `true` | `pnpm format:check` |
| `run-e2e-api` | `true` | `pnpm test:e2e:api` (Testcontainers) |
| `run-e2e-web` | `true` | Playwright web smoke (needs `has-web`) |
| `run-export-audit` | `false` | `pnpm audit:exports` (library export contract) |
| `run-mutation` | `false` | Stryker on default-branch push / dispatch only |
| `mutation-source-globs` | api/web/src regex | which changed paths trigger mutation |

### 🏷️ Versioning

Pin callers to **`@v1`** (a moving major tag): a deliberate `v1.x` release propagates to
every repo, while a breaking change lands as `v2` behind an explicit bump. Never pin a
caller to `@main`.

---

## 🧭 Project types

| Stack | Reusable | Status |
| --- | --- | --- |
| 🟢 **Node** — `@bymax-one/nest-*` libraries + `nest-*-example` apps | `node-ci.yml` · `security.yml` | ✅ Live (`@v1`) |
| 🦀 **Rust** — `rust-auth`, `rust-auth-example` | `rust-ci.yml` · `rust-mutation.yml` | 🛠️ Planned |

---

## 🔒 Third-party action allow-list

The org restricts Actions to **GitHub-owned + verified-marketplace + an explicit
allow-list**. The reusables here use `pnpm/action-setup` (allow-listed) and otherwise
only GitHub-owned actions — so consuming repos need **no per-repo allow-list changes**.

---

<div align="center">

**Bymax One** — architecting AI-native systems for production.
[🏠 Profile](https://github.com/bymaxone) · [🌐 bymax.one](https://bymax.one)

</div>
