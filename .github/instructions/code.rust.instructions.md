---
applyTo: '**/*.rs'
---

# Code Review Instructions — Rust

- Every crate carries `#![forbid(unsafe_code)]` and `#![deny(missing_docs)]`;
  edition 2024.
- **No `unwrap`, `expect`, `panic!`, `todo!`, `unreachable!`** in non-test code —
  return a typed error instead. The workspace `[lints]` table denies them.
- Errors are typed `thiserror` enums, not `anyhow`, in library-shaped code.
- The controller/handler **maps the library error** to the stable error envelope;
  it never leaks an internal error string, and an `Internal` variant collapses to
  an opaque 500.
- Never log secrets, tokens, OTP codes, or PII; honor a redacting `Debug`.
- Dependencies are injected explicitly through constructors into shared state.
- Functions ≤ 50 lines; files ≤ 800 lines; every `pub` item carries rustdoc.
