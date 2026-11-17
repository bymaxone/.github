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
 * @param {Record<string, string[]>} lists The lists of `lists.json`.
 * @returns {{ strict: string, narrow: string }} The patterns.
 */
export function build(lists) {
  const tools = alternation([...lists.tools, ...lists.toolSpellings])
  // What may stand between a connector and the tool: marks of emphasis, quotes, brackets or a handle, and words that
  // are not the tool (an article, a vendor, an adjective).
  // A tool name ends where a letter or a digit does not continue it: an underscore of emphasis closes it too.
  const before = `(^|[^a-z0-9])`
  const after = `([^a-z0-9]|$)`
  const marks = `[\\s:*_\`"'\\[(@<>{}~|“”‘’-]`
  const gap = `${marks}+((${alternation(lists.fillers)})${marks}+)*`
  const subject = alternation(lists.subjectVerbs)
  const nouns = alternation(lists.nounsBy)
  // The start of a line, with the marks a list item, a quote, a heading or an emphasis puts before the text.
  const lineStart = `^[ \\t>*_\`(\\[-]*(\\d+[.)][ \\t]*)?`
  const common = [
    // A trailer of any `-by` kind, in a list or a quote or bold, whose value names a tool, or is only `AI` or `LLM`.
    `^[ \\t>*_\`-]*(\\d+[.)][ \\t]*)?[*_\`]*[a-z][a-z-]*-by[*_\`]*[ \\t]*:(([^\\n]*[^a-z0-9])?(${tools})${after}|[ \\t]*(ai|llm)[ \\t]*(<[^>\\n]*>)?[ \\t]*\\r?$)`,
    `noreply@(anthropic|openai|claude)\\.`,
    `${before}(${tools})\\[bot\\]`,
    `^[ \\t>*_-]*(${tools})[ -]bot[ \\t.]*\\r?$`,
    `🤖([^\\n]*[^a-z0-9])?(${tools})${after}`,
    `\\b(made|built|crafted)\\s+with\\s+[^\\n]{1,12}\\s+and\\s+(${tools})${after}`,
    `\\bwith\\s+(the\\s+)?help\\s+(of|from)\\s+(${tools})${after}`,
    `\\b(thanks\\s+to|courtesy\\s+of|powered\\s+by)\\s+(${tools})${after}`,
    `\\bpair[- ]programm(ed|ing)\\s+with\\s+(${tools})${after}`,
    `${before}(${tools})\\s+(${subject})\\s+(this|it|these|the\\s+(change|commit|pr|patch|code))\\b`,
    `\\b(${nouns})\\s+(by|from)\\s+(the\\s+)?(${tools})${after}`,
    // A signature line that says only that an AI wrote it; a sentence about AI-generated content is not one.
    `^[ \\t>*_-]*[\\[(]?(ai[- ](generated|assisted|authored|written)|(generated|assisted|authored|written|created|made)\\s+(with|by)\\s+ai)[\\])]?[ \\t.]*\\r?$`,
  ]
  const production = `(${alternation(lists.productionVerbs)})\\s+(with|by|using|via|through)`
  const judgement = `(${alternation(lists.judgementVerbs)})\\s+by`
  const strictBy = `(${alternation(lists.strictByVerbs)})\\s+by`
  // Verbs that count in the narrow profile only at the start of a line, where `by` or `with` follows.
  const lineStart2 = `(${alternation(lists.lineStartVerbs)})\\s+(by|with)`
  const phrase = `(${production}|${judgement}|${lineStart2})${gap}(${tools})${after}`
  const strict = [
    ...common,
    `\\b(${production}|${judgement}|${strictBy})${gap}(${tools})${after}`,
    `${before}(${tools})[ -](agent|assistant)\\b`,
    `(^|[^@\\w])(${alternation(lists.bareWordsStrict)})\\b`,
    `\\bclaude([^.]|$)`,
  ]
  const near = alternation(lists.narrowNear)
  const nearWords = alternation(lists.narrowNearWords)
  const narrow = [
    ...common,
    // A verb phrase counts only at the start of a line: a sentence that cites a vendor's documents or says what its
    // models generate is not an attribution.
    `${lineStart}${phrase}`,
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
