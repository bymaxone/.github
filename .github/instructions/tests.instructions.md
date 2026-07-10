---
applyTo: '**/*.spec.ts,**/*.spec.tsx,**/*.e2e.spec.ts,**/*.e2e-spec.ts,**/*.test.ts,**/*.test.tsx'
---

# Test Review Instructions

## Coverage

- 100% on all metrics for files that carry logic. Non-executable glue
  (`main.ts` / `main.rs`, generated code, pure type modules, `*.d.ts`) is out of scope.
- Every branch of a conditional is exercised by at least one test.

## Test design

- Name the scenario and the rule each test protects — describe behavior, not
  implementation: `it('rejects an expired reset token')`, not `it('path 2')`.
- One observable behavior per test; a single, focused assertion target.
- Mock at the boundary (the dependency), not inside the unit under test.
- Deterministic — mock time, randomness, and timers; restore mocks in `afterEach`.
- No focused/skipped tests committed (`it.only`, `describe.only`, Rust `#[ignore]`).
- Assert on the specific error class and message, not just that something threw.
- Mutation-aware — no generic matchers (`toBeDefined()`, `toBeTruthy()`) where a
  concrete value assertion is possible.

## Memory safety (mandatory)

When a library is consumed via a local link its code is recompiled into every test
runner. **Bound the pools** and run suites **sequentially**:

- TypeScript: Vitest / Jest `maxWorkers: '50%'` baked into the config.
- Rust: `cargo nextest run` with a capped `--test-threads` (≤ cores / 2).
- Never fan out parallel test agents, and never run two package suites at once.

## Integration tests

- Use real backends (Testcontainers / the test compose stack) for e2e, not
  in-memory fakes; run migrations against a dedicated test stack first.
