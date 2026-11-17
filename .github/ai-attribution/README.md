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

## The two profiles

- **Strict** is the default, for every repository that is not listed as narrow. It refuses a credit verb (a past
  participle with `with`, `by`, `using`, `via` or `through`) before a tool name at the start of a line, so `Built with
  <tool> bindings` is refused there too.
- **Narrow** is for a repository whose subject matter names the products: it lets a vendor be cited (`Made by <vendor>,
  priced per token`, a SDK, a version) and refuses an attribution only where the tool ends the phrase, where an
  authorship verb leads, or in a trailer. Its repositories are `narrowRepos` in `patterns.json`.
- **A repository that integrates an AI vendor's API moves to the narrow list**: its ordinary commits and pull request
  text name the vendor (`Add the <vendor> SDK`, `Tested with <vendor>`), and the strict profile would refuse them. To
  move one, add it to `narrowRepos` in `patterns.json` and to the include list of the narrow ruleset body (and remove
  it from the exclude list of the strict one) under `rulesets/`; a test fails when the three differ. Then apply both
  bodies to the live rulesets. No application repository integrates an AI vendor's API today (checked 2026-11-17).

## Where the patterns run, and the limits

| Where | Engine | Reads |
| --- | --- | --- |
| The two organisation rulesets (`rulesets/`) | RE2 | every commit message at push; stays in `evaluate` until the organisation activates it |
| `no-ai-attribution.yml`, the reusable workflow | RE2-compatible, run in Node | a pull request's title, body and every commit message, at the workflow's own commit (a caller on `@v1` sees a change only after a release) |
| The commitlint plugin template | the engine of the repository's Node, which backtracks | the message at commit time; it refuses a message with a run of 300 or more blank or mark characters as padding |
| The weekly family check | Node | the last eight days of issue comments and review replies in the public, non-archived repositories; bots are skipped; warnings only |

- A name that is also an ordinary word (cursor, gemini) counts after a credit verb unless a hyphen and a letter follow
  (`cursor-based`) or an ordinary noun does; a product word, a number or a mark leaves it the tool. The list of product
  words only grows.
- A person whose name begins with a tool's (a name that continues with letters) passes; a person named exactly like a
  tool (a given name) is refused after an authorship verb.
- A trailer whose value is only words that name an agent is refused; one other word makes it a name.
- The patterns cannot read a message written in a language that no list covers, or an attribution with no verb.
- Adopters re-copy the plugin when the template changes; the weekly family check lists a copy that differs.

