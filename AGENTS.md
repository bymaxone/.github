# AGENTS.md — working in `bymaxone/.github`

Read this before changing anything here. It is written for AI coding agents and
for anyone who has not worked in this repository before.

---

## What makes this repository different

Every other repository in the organization runs **the CI that lives here**. They
do not hold a copy — they reference it:

```yaml
jobs:
  ci:
    uses: bymaxone/.github/.github/workflows/node-lib-ci.yml@v1
```

That `@v1` is resolved **when the caller runs**, not when the line was written.
So whatever `v1` points at _is_ the CI of roughly twenty repositories, right now.

**A change here is not a change to one repository. Publishing it is a deploy.**

---

## The tag contract

| Ref      | What it is                                                                            | Who moves it                                                         |
| -------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `v1.4.2` | An immutable release. Protected by a ruleset: it cannot be moved or deleted.          | Created once, by a release. Never touched again.                     |
| `v1`     | A **moving alias** pointing at the newest `v1.x.y`. This is what consumers reference. | **Only** `.github/workflows/release-major-alias.yml`, automatically. |
| `main`   | Where work lands. **Not** what consumers run.                                         | Pull requests.                                                       |

### Rules

1. **Never move `v1` by hand.** Not with `git push --force`, not with
   `gh api ... PATCH git/refs/tags/v1`. Moving it re-deploys CI to every
   consuming repository with no commit in those repositories for anyone to
   review. If `v1` is behind, the answer is to cut a release, not to nudge the
   tag.

2. **Never re-point or delete a `vX.Y.Z` tag.** A ruleset blocks it, and that is
   deliberate: someone pinning `v1.4.2` must get the same bytes forever.

3. **Merging to `main` publishes nothing.** It sits there until a release. This
   is the gate — do not work around it.

---

## Cutting a release

```bash
# From an up-to-date main, after the change has merged.
git tag v1.5.0
git push origin v1.5.0
```

Pushing the version tag triggers `release-major-alias.yml`, which verifies the
tag is on the default branch and then moves `v1` onto it. Nothing else is
needed, and nothing else should be done by hand.

Version numbering follows the impact **on callers**:

| Change                                                                   | Bump                                                                             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| A new optional input; a fix that does not change how callers are written | minor / patch                                                                    |
| A required input, a removed input, a renamed job, a changed check name   | **major** — and a new alias (`v2`), because moving `v1` would break every caller |

Renaming a job is a breaking change even though nothing in the YAML looks
breaking: the job id prefixes the reported check name (`codeql / Analyze (…)`),
and repositories require those names in their rulesets. A rename turns every
required check into one that is never reported, and every pull request in those
repositories deadlocks.

---

## How consuming repositories should reference this

**Use the alias, not a commit SHA:**

```yaml
uses: bymaxone/.github/.github/workflows/node-lib-ci.yml@v1 # correct
```

This is deliberate and was decided after trying the opposite. Pinning these
references to a commit was reverted, because:

- The whole reason this repository exists is that a fix lands **once** and every
  repository gets it. Pinning removes exactly that.
- Dependabot treats each reusable workflow path as a separate dependency. Ten
  libraries × ~6 references is **~58 pull requests to propagate one change**,
  throttled by `open-pull-requests-limit`. In practice they are merged in bulk,
  so the review those pull requests were supposed to buy does not happen — the
  cost is paid and the benefit is not collected.
- The threat that SHA-pinning addresses is a repository you do not control being
  compromised. This repository is first-party, its default branch is protected,
  and its version tags are immutable.

**The opposite rule applies to third-party actions.** Inside the workflows here,
and in every consuming repository, actions from outside the organization are
pinned to a full commit SHA with the version in a trailing comment:

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

That is where the supply-chain risk actually lives. Do not "simplify" those to
tags.

---

## Before changing a reusable workflow

It ships to every consumer at the next release. Ask:

- **Does any caller pass an input I am removing or renaming?** Search the
  organization before assuming: `gh search code 'uses: bymaxone/.github' --owner bymaxone`.
- **Am I changing a job name?** Then check which repositories require that check
  name in a ruleset. Changing it deadlocks their pull requests.
- **Am I removing a step?** A caller _cannot_ add steps around a `uses:` job. If
  a repository needs a step this workflow drops, the only way to give it back is
  an input here. This has already happened once: converting local CodeQL
  workflows into callers silently dropped `step-security/harden-runner` in three
  repositories, because the audit compared inputs and versions but not steps.
- **Is it breaking?** Then it is `v2` and a new alias — not a `v1` move.

---

## Permissions, briefly

A job that declares `permissions:` **replaces** the workflow-level set rather
than intersecting with it, and a called workflow can never hold more than its
caller granted. So the caller's job block is the real ceiling — that is why
callers in this organization declare permissions on the calling job, not at the
top of their file.

Keep the workflow-level default here at `contents: read` and raise it per job.
