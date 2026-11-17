# AI attribution patterns

The pattern that refuses a commit message, a pull request title or a pull request body that names an AI tool as its
author or its reviewer, in one place.

- `lists.json` holds the lists the patterns are built from: the tool names, the verbs that attribute work to them, and
  the word lists of the strict-only and narrow-only phrasings. A tool added to `tools` is covered by the phrasings that
  take a tool; a verb added to `verbs` applies to every tool.
- `build-patterns.mjs` builds the strict and the narrow pattern and writes every copy: `patterns.json`, the two ruleset
  bodies under `rulesets/` and the commitlint plugin template. Run it after a change to `lists.json`;
  `node .github/ai-attribution/build-patterns.mjs --check` fails when a copy differs.
- `patterns.json` also holds the narrow-profile repositories and the case table the tests run.
- The organisation rulesets cannot read a file: a changed pattern is applied to each ruleset from the body under `rulesets/`.
