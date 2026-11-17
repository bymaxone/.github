# Script templates

A script or a spec that every library copies, kept here once so that a copy that drifts is named.

- A template is a directory with a `template.json` listing `{ source, target }` files: the canonical file here,
  and where a library keeps its copy.
- A library adopts a template by copying the files byte for byte and adding itself to
  [`script-adopters.txt`](../script-adopters.txt) in a pull request here. `script-family-check.yml` then
  compares its copy with the template every week.
- Data a template reads (a baseline, a list of exclusions) stays in the library and is not compared.
- To change a template, change it here, then update each adopter's copy. The check is red for an adopter
  until it has.

## check-double-assertions

Fails when a tracked `src/` or `test/` TypeScript file holds an `x as unknown as T` that is not on a baseline
that can only shrink (`scripts/double-assertion-baseline.json`, written with `--write-baseline`). Its spec runs
the script against throwaway git repositories under the library's own jest, so it needs `typescript` and a jest
that matches `src/**/*.spec.ts`. Wire it as `"check:double-assertions": "node scripts/check-double-assertions.mjs"`
and run it in the CI job that runs the other `check:*` scripts, with `--base origin/<default branch>` on pull requests.

## check-function-length

Fails when a function, a method or a test body in a tracked `src/` or `test/` TypeScript file spans more than 50
lines and is not on a baseline that can only shrink (`scripts/function-length-baseline.json`, written with
`--write-baseline`). A setup or teardown hook (`beforeEach`, `afterEach`, `beforeAll`, `afterAll`) is measured like
a test body; only the callback of a `describe`-style grouping is a container. Same-named offenders are numbered
in document order and a function within the limit is not counted, so adding a small function never renames an entry,
while an offender that drops to the limit renumbers the same-named offenders after it. Wire it as
`"check:function-length": "node scripts/check-function-length.mjs"`, with `--base origin/<default branch>` on pull requests.

## published-surface-links

The link check of a library's published-surface gate, as a module of its own that exports exactly
`checkLinks({ readme, root, fail })` and uses Node built-ins only. It checks every link of the README: anchors
against its headings (fenced code ignored), relative paths against the repository (confined to `root`), and
external URLs over the network. A non-https, loopback, private or IP-literal target, a name that resolves to a
private address, and a redirect into one fail without being requested. HTTP 404, 410, 403 and 401 fail. A 5xx, a 429
that survives the GET retry, and a transport error are notes, never failures: the gate guards `prepublishOnly`, and
someone else's outage must not block a release. An npmjs.com package page is asked of the registry, where a 404 is a
note until the first publish.

To adopt: copy `published-surface-links.mjs` to `scripts/` byte for byte, delete the embedded link-check block
(from `/** Slug a Markdown heading` to the end of `checkLinks`) from `scripts/check-published-surface.mjs`, add
`import { checkLinks } from './published-surface-links.mjs'`, and keep calling it as the script did, now with the
context: `await checkLinks({ readme, root, fail })`. Remove imports the script no longer uses (`lookup`, `existsSync`,
`resolve`, `sep`), then add the library to `script-adopters.txt`. A library that checks more than the README (several
documents, links into other pages) does not fit this signature and keeps its own check until the template grows one.

The link-gate family check (`link-gate-family.yml`) measures a library that keeps this module by running it, in module
form, against the 18 cases of the matrix with `fetch` and DNS stubbed.

## check-spec-headers

Fails when a tracked spec does not open with a `/** */` block comment that says what it tests in at least a few
words and names its layer (`@layer <layer>` opening its own line, or `Layer: <layer>.`), unless the spec is on a
baseline that can only shrink (`scripts/spec-header-baseline.json`). A shebang line ahead of the comment is skipped.
It is plain Node with no dependencies; the spec needs a jest that matches `src/**/*.spec.ts`. Wire it as
`"check:spec-headers": "node scripts/check-spec-headers.mjs"`.

## stryker-scope

A jest spec that pins the mutation-testing scope to the code that ships. The shipped source is the closure of the
relative imports of the package entries in `tsup.config.ts`; every file in it must be selected by `mutate` in
`stryker.config.json` or be listed, with a reason, in the library's data file. It copies to `src/stryker-scope.spec.ts`
and needs `typescript`, a jest that matches `src/**/*.spec.ts`, a `tsup.config.ts` whose entries are written
`entry: { 'name': 'path' }`, and a `stryker.config.json` with a `mutate` array.

The spec holds the engine and every generic check. What differs between libraries lives in a sibling file,
`src/stryker-scope.data.ts`, which the library owns and the family check does not compare (it is not in
`template.json`). The spec imports these exports from `./stryker-scope.data`:

| Export          | Type                                                                          | Meaning                                                                                                             |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `EXCLUSIONS`    | `readonly Exclusion[]`                                                        | Every shipped file `mutate` leaves out: `{ kind, reason, files, ownedBy? }`, `files` being paths or `*` / `**` globs |
| `EXPECTED`      | `{ entries: number; includes: readonly string[]; minShipped: number }`        | Entry count, entries that must be in the closure, and the closure size it must exceed                               |
| `SHIPPED_DATA`  | `readonly { path: string; tsupNeedle: string }[]`                             | Non-TypeScript files the build copies; `[]` when none                                                               |
| `E2E_OWNED`     | `{ suites: readonly string[]; subpath: string } \| null`                      | Suites (repository-relative paths) that must mention `subpath`; `null` when no exclusion is `e2e-owned`             |

**Where the types live.** `Exclusion` and `ExclusionKind` are declared and exported by the spec, and the data file
brings them in with `import type { Exclusion } from './stryker-scope.spec'`. That keeps one declaration, so the union of
kinds cannot drift between libraries, and the spec can compare against any kind without a "no overlap" type error under
ts-jest. The import is type-only and erased, so the spec is not loaded twice and there is no runtime cycle. The opposite
direction (the data file declaring the types) would copy the union into every library and make every kind a per-library
edit.

Kinds, each checked against the files it covers:

- `barrel`: re-exports only (a leading `'use client'` is allowed).
- `types`: the compiler emits no statement for the file.
- `constants`: no logic (an optional `ownedBy` names the package
  script and the file that judge the table instead of Stryker, and both must exist).
- `const-table`: only type declarations and exported `as const` literals.
- `e2e-owned`: judged by an end-to-end suite; `E2E_OWNED` must name suites that mention the subpath.

Notes. The self-tests of the constants and const-table detectors run in every library, because the detectors are part
of the byte-identical file; they are cheap and need no library data. A library that gains a kind it did not use before
(for example its first `const-table`) needs only a data edit.

To adopt: copy `stryker-scope.spec.ts` to `src/`, write `src/stryker-scope.data.ts` from the library's current
exclusions, delete the old spec, run `jest src/stryker-scope.spec.ts`, and add the library to `script-adopters.txt` here.
A library whose `mutate` selects `src/**/*.ts` adds `!src/stryker-scope.data.ts`, which is not shipped and is not a spec.
Every pair of an `entry: { ... }` object in `tsup.config.ts` counts, with a quoted or a bare key.
