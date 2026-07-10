# Copilot Review Instructions — Bymax org baseline

Organization-wide baseline for GitHub Copilot code review across `bymaxone`
repositories. It captures the invariants that hold in **every** repo, regardless
of stack. Each repository **appends its own domain rules** below this baseline
(supply-chain contract, crypto/tenant rules, PII handling, pixel parity, fiscal
math, …) — those live in the consuming repo, not here.

Path-specific rules live alongside this file:

- `.github/instructions/code.rust.instructions.md` — Rust crates
- `.github/instructions/code.library.instructions.md` — publishable `@bymax-one/*` libraries
- `.github/instructions/code.app.instructions.md` — apps that consume those libraries
- `.github/instructions/tests.instructions.md` — test suites
- `.github/agents/agent-code-reviewer.agent.md` — the reviewer agent definition

> **These files do not propagate automatically.** Unlike community health files,
> GitHub reads Copilot instructions only from the repository being reviewed. Copy
> the ones you need into a new repo, then extend them. The universal core below is
> also mirrored in **Org → Settings → Copilot → Custom instructions**, which *does*
> apply to every repository's Copilot code review automatically.

## CRITICAL — block the PR

- **Zero `any`** (`any`, `as any`) in TypeScript; use `unknown` with type guards.
- **No suppression comments** without a written justification: `@ts-ignore`,
  `@ts-expect-error`, `eslint-disable`, Rust `#[allow(...)]`, or `unsafe`.
- **Rust** (where present): edition 2024; `#![forbid(unsafe_code)]` +
  `#![deny(missing_docs)]` per crate; **no `unwrap`, `expect`, `panic!`, `todo!`,
  or `unreachable!`** in non-test code — return a typed `thiserror` error instead.
- **No secrets, tokens, or credentials** in any committed file — only local/dev
  fixtures (Mailpit, test values). **Never log** secrets, tokens, OTP codes, or PII.
- The HTTP/transport layer **maps internal errors to a stable envelope** and never
  leaks an internal error string to the client.

## HIGH — block unless justified

- Every exported symbol carries **JSDoc / rustdoc** (with an `@example` where non-trivial).
- **Functions ≤ 50 lines; files ≤ 800 lines**; one responsibility per unit.
- **100% coverage** (statements, branches, functions, lines) on files that carry
  logic; non-executable glue is out of scope.
- **Reuse `@bymax-one/*` libraries verbatim** — never reimplement a shared
  capability. The shared design system is reused, never re-styled.

## MEDIUM — flag for discussion

- **Conventional Commits**; never a `Co-Authored-By` or any AI-attribution trailer.
- **English-only, timeless** comments and identifiers — describe what the code does
  and why, never which roadmap step or task produced it.
- **Mutation-aware tests** — no generic matchers (`toBeDefined()`, `toBeTruthy()`)
  where a concrete value assertion is possible.
