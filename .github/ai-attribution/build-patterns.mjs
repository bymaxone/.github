#!/usr/bin/env node
// Builds the strict and the narrow pattern from `lists.json`, and writes them where they are copied: the patterns
// file, the two organisation ruleset bodies and the commitlint plugin template. Run it after a change to
// `lists.json`; `--check` reports a copy that differs.
//
// Usage: node .github/ai-attribution/build-patterns.mjs [--check]
//   --check  write nothing and exit 1 when a copy differs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))
/** A JavaScript string literal in single quotes, the form the formatter keeps. */
const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const alternation = (words) =>
  words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')

/**
 * The two patterns a set of lists builds, in the form the organisation rulesets carry (RE2, leading `(?im)`).
 *
 * @param {{ tools: string[], verbs: string[], strictVerbs: string[], bareWordsStrict: string[], narrowNear: string[], narrowNearWords: string[] }} lists The lists.
 * @returns {{ strict: string, narrow: string }} The patterns.
 */
export function build(lists) {
  const tools = alternation(lists.tools)
  const common = [
    // A trailer of any `-by` kind that names a tool: Co-authored-by, Signed-off-by, Reviewed-by, Assisted-by, ...
    `^[ \\t>]*[a-z][a-z-]*-by[ \\t]*:[^\\n]*\\b(${tools})\\b`,
    `noreply@(anthropic|openai|claude)\\.`,
    `\\b(${tools})\\[bot\\]`,
    `🤖[^\\n]*\\b(${tools})\\b`,
    // A signature line that says only that an AI wrote it; a sentence about AI-generated content is not one.
    `^[ \\t>*_-]*[\\[(]?(ai[- ](generated|assisted|authored|written)|(generated|assisted|authored|written|created|made)\\s+(with|by)\\s+ai)[\\])]?[ \\t.]*$`,
    `\\bwith\\s+(the\\s+)?help\\s+(of|from)\\s+(${tools})\\b`,
    `\\b(thanks\\s+to|courtesy\\s+of)\\s+(${tools})\\b`,
  ]
  const phrase = (verbs) =>
    `\\b(${alternation(verbs)})\\s+(with|by|using)\\s+(the\\s+|an?\\s+|\\[)?(${tools})\\b`
  const strict = [
    ...common,
    phrase([...lists.verbs, ...lists.strictVerbs]),
    `(^|[^@\\w])(${alternation(lists.bareWordsStrict)})\\b`,
    `\\bclaude([^.]|$)`,
  ]
  const near = alternation(lists.narrowNear)
  const nearWords = alternation(lists.narrowNearWords)
  const narrow = [
    ...common,
    phrase(lists.verbs),
    `\\b(${near})\\s*(\\+|and|&|/|,)\\s*(${near})\\b`,
    `\\b(${near})\\b[^\\n]{0,20}\\b(${nearWords})\\b`,
  ]
  return { strict: `(?im)(${strict.join('|')})`, narrow: `(?im)(${narrow.join('|')})` }
}

const paths = {
  lists: here('lists.json'),
  patterns: here('patterns.json'),
  strictRuleset: here('rulesets/forbid-ai-attribution.json'),
  narrowRuleset: here('rulesets/forbid-ai-attribution-narrow.json'),
  plugin: here('../script-templates/commitlint-no-ai-attribution/commitlint-no-ai-attribution.cjs'),
}

/** The text every copy should hold, by path. */
function expected() {
  const patterns = JSON.parse(readFileSync(paths.patterns, 'utf8'))
  const built = build(JSON.parse(readFileSync(paths.lists, 'utf8')))
  const out = new Map()
  out.set(paths.patterns, `${JSON.stringify({ ...patterns, ...built }, null, 2)}\n`)
  for (const [path, key] of [
    [paths.strictRuleset, 'strict'],
    [paths.narrowRuleset, 'narrow'],
  ]) {
    const ruleset = JSON.parse(readFileSync(path, 'utf8'))
    ruleset.rules[0].parameters.pattern = built[key]
    out.set(path, `${JSON.stringify(ruleset, null, 2)}\n`)
  }
  const plugin = readFileSync(paths.plugin, 'utf8')
    .replace(/(const STRICT =\n  )'.*'/, (_, head) => `${head}${quote(built.strict)}`)
    .replace(/(const NARROW =\n  )'.*'/, (_, head) => `${head}${quote(built.narrow)}`)
  out.set(paths.plugin, plugin)
  return out
}

/** Writes the copies, or with `--check` reports the ones that differ. */
function main() {
  const check = process.argv.includes('--check')
  let differs = 0
  for (const [path, text] of expected()) {
    if (readFileSync(path, 'utf8') === text) continue
    differs += 1
    if (check) console.error(`${path} differs from what lists.json builds`)
    else writeFileSync(path, text)
  }
  return check && differs > 0 ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main())
