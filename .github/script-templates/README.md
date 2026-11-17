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
