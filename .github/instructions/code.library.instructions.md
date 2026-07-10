---
applyTo: 'src/**/*.ts'
---

# Code Review Instructions — publishable library (`@bymax-one/*`)

Rules for a NestJS/TypeScript library that ships to consumers.

## Supply-chain contract

- **`dependencies` in `package.json` stays empty** — everything runtime is a
  `peerDependency`. Adding a real dependency is a breaking change to the
  supply-chain contract; flag it.
- The **subpath export model** is authoritative: the server root (`.`) is
  server-only; browser-safe code ships under `./shared` (and `./react`, …).

## NestJS shape

- Dynamic module via `forRoot` + `forRootAsync({ useFactory, useClass, useExisting })`.
- **DI injection tokens are `Symbol()`**, never string literals — string tokens
  collide silently across modules.
- Ports are `interface` (the `I` prefix is reserved for these); unions are `type`.
- Singletons only; no `console.*` in `src/` — log through the injected logger port.

## TypeScript

- `strict` with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `verbatimModuleSyntax`.
- **Zero `any`** — use `unknown` with type guards; generics for typed APIs.
- Import types with `import type { … }` when the value is not used at runtime.
- No suppression comments without a written justification.
- Every exported symbol carries JSDoc.
