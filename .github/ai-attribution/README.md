# AI attribution patterns

The pattern that refuses a commit message, a pull request title or a pull request body that names an AI tool as its
author or its reviewer, in one place.

- `lists.json` holds the two lists the patterns are built from: the tool names, and the verbs that attribute work to them.
  A tool added there is covered by every phrasing; a verb added there applies to every tool.
- `build-patterns.mjs` builds the strict and the narrow pattern and writes every copy: `patterns.json`, the two ruleset
  bodies under `rulesets/` and the commitlint plugin template. Run it after a change to `lists.json`;
  `node .github/ai-attribution/build-patterns.mjs --check` fails when a copy differs.
- `patterns.json` also holds the repositories on the narrow profile and the table of cases the tests run.
- The organisation rulesets cannot read a file, so a changed pattern reaches them by an update of each ruleset with the body
  under `rulesets/`; the commitlint plugin and the pull-request job reach each repository by a re-copy and by a release.
