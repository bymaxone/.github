---
applyTo: 'apps/**/*.ts,apps/**/*.tsx,packages/**/*.ts,packages/**/*.tsx'
---

# Code Review Instructions — app consuming `@bymax-one/*`

Rules for an app (Next.js / NestJS / React-Native) that consumes a library via
`link:` / `file:` and never modifies it here.

## Library consumption

- Consume the library through its **published subpaths only**; never reach into
  its internals. Never import the server root (`.`) in browser/client code — use
  `/shared` (and `/react`), or the browser bundle breaks.
- Every consumed export is **demonstrated** (referenced) in the app — no
  undemonstrated export slipping past the export audit.

## TypeScript

- `strict` with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `verbatimModuleSyntax`. **Zero `any`.**
- Build optional object fields with conditional spread; `import type` for
  type-only imports.
- No suppression comments without a written justification.

## Web

- Never store a token in `localStorage` — cookies or in-memory only.
- Localize every `auth.*` / domain error; never render a raw error code.
- `'use client'` only on leaf interactive components, never in `layout.tsx`.
- The shared design system is reused verbatim — never re-styled.
