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
a test body; only the callback of `describe`, `context` and `suite` is a container. It has three files:
the script, `function-length-key.mjs` (the identity of a function in the baseline) and the spec. Wire it as
`"check:function-length": "node scripts/check-function-length.mjs"`, with `--base origin/<default branch>` on pull requests.

## check-spec-headers

Fails when a tracked spec does not open with a `/** */` block comment that says what it tests in at least a few
words and names its layer (`@layer <layer>` opening its own line, or `Layer: <layer>.`), unless the spec is on a
baseline that can only shrink (`scripts/spec-header-baseline.json`). A shebang line ahead of the comment is skipped.
It is plain Node with no dependencies; the spec needs a jest that matches `src/**/*.spec.ts`. Wire it as
`"check:spec-headers": "node scripts/check-spec-headers.mjs"`.

Neither template has an adopter listed yet: each library adopts in its own pull request, which copies the files
byte for byte, lowers its baseline where the stricter rule finds more, and adds itself to
[`script-adopters.txt`](../script-adopters.txt).

