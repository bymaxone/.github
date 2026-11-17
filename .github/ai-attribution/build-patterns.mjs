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
  const toolEnd = `[ \\t]*[.!]+([ \\t]|\\r?$)|[ \\t]*\\r?$|[ \\t]+[-–—(]|[ \\t]*[–—]`
  // A name that is also an ordinary word (cursor, gemini, aider, mistral) is read as the tool after a credit verb only
  // where it ends the phrase: `Built with <tool>.`, not `Paginated with cursor-based offsets`.
  const ambiguous = new Set(lists.ambiguousTools)
  const clearTools = alternation(
    [...lists.tools, ...lists.toolSpellings].filter((w) => !ambiguous.has(w)),
  )
  const ambiguousTools = alternation(lists.tools.filter((w) => ambiguous.has(w)))
  // After an ambiguous name the tool is NOT meant when a hyphen and a letter follow (cursor-based) or an ordinary
  // noun does (cursor pagination); any other next character leaves it the tool: a mark, a comma, a colon, a slash, an
  // emoji, a number, the end of the line, `ai`, a product word, an and, or a spaced dash.
  const ambiguousEnd = `([^a-z0-9 \\t-]|-([^a-z]|$)|[ \\t]*\\r?$|[ \\t]+([^a-z0-9 \\t]|[0-9]|(ai|${alternation(lists.toolWords)}|${alternation(lists.productWords)}|${ambiguousTools}|and|or|[a-z]?[0-9]+)([^a-z0-9]|$)))`
  const creditTool = `((${clearTools})([^a-z0-9]|$)|(${ambiguousTools})${ambiguousEnd})`
  // What may stand between a connector and the tool: marks of emphasis, quotes, brackets or a handle, and words that
  // are not the tool (an article, a vendor, an adjective).
  // A tool name ends where a letter or a digit does not continue it: an underscore of emphasis closes it too.
  const before = `(^|[^a-z0-9])`
  const after = `([^a-z0-9]|$)`
  const marks = `[\\s:*_\`"'\\[(@<>{}~|“”‘’-]`
  const gap = `${marks}+((${alternation(lists.fillers)})${marks}+)*`
  // A generic agent (an AI, an LLM, a language model) counts only in the position of an attribution and only where the
  // phrase ends there: at the end of the line, before a punctuation mark or after words that describe a tool, so
  // "reviewed by the AI team" and a product sentence about AI-generated plans are not attributions.
  const generic = alternation(lists.genericAgents)
  const descriptors = alternation(lists.genericDescriptors)
  // A past participle: a word ending in -ed, or an irregular one, with an optional prefix (co-, auto-).
  const participle = `([a-z]+-)*([a-z]+ed|(re|over|hand|ghost|mis|under|out)?(${alternation(lists.irregularParticiples)}))`
  // The alternatives that end a phrase naming an agent. Each one starts by itself, so a run of blanks is read once:
  // a mark, a spaced dash or opening parenthesis, a dash, the end of the line, or an and that goes on with an
  // authorship verb, an adverb and a verb, or another tool.
  const andMarks = `[*_\`"'\\[(@<>{}~|“”‘’]*`
  // Each repeat starts with a word, so no two mark classes are ever adjacent and a run of marks is read once.
  const andWords = `(((${alternation(lists.andAdverbs)})|(${alternation(lists.adverbs)}))[ \\t]+${andMarks}){0,2}`
  // Marks of emphasis, a quote, a bracket or a handle may stand before the verb or the tool; they never include blanks,
  // so they do not overlap the blanks that precede them.
  const andNext = `[ \\t]+(and|&)[ \\t]+${andMarks}${andWords}((${alternation(lists.andVerbs)})([ \\t]|[*_\`"'\\])}>~”’]|\\r?$)|(${tools})${after})`
  const stop = `[ \\t]*[.,;:!?)\\]*_\`"”’]+|[ \\t]*\\r?$|[ \\t]+[-–—|(]|[ \\t]*[–—]|${andNext}`
  const genericEnd = `([ \\t]+(${descriptors}))*(${stop})`
  const pt = alternation(lists.ptAgents)
  const ptVerbs = `(${alternation(lists.ptVerbs)})([ \\t]+(${alternation(lists.ptAdverbs)}))?`
  const ptConnectors = alternation(lists.ptConnectors)
  // The end of a phrase that names an agent and a noun: a mark, the end of the line, or an and.
  const phraseEnd = `(${stop})`
  // One end for every phrase that names an agent: the phrase must end there, in English and in Portuguese.
  const ptEnd = `([ \\t]*[.,;:!?)\\]*_\`"”’]+|[ \\t]*\\r?$|[ \\t]+[-–—|(]|[ \\t]*[–—]|[ \\t]+(e|&)[ \\t]+${andMarks}(((${alternation(lists.ptAndAdverbs)})[ \\t]+)${andMarks}){0,1}((${alternation(lists.ptVerbs)})([ \\t]|[*_\`"'\\])}>~”’]|\\r?$)|(${tools})${after}))`
  const adverb = `((${alternation(lists.adverbs)})[ \\t]+)?`
  const credit = `${adverb}${participle}([ \\t]+and[ \\t]+${participle})?([ \\t]+(${alternation(lists.adverbs)}))?[ \\t]+(with|by|using|via|through)([ \\t]+the[ \\t]+help[ \\t]+of)?`
  // The gap that stays on one line, so a participle at the end of a line never joins the next line.
  const marksL = marks.replace('\\s', ' \\t')
  const gapL = `${marksL}+((${alternation(lists.fillers)})${marksL}+)*`
  const subject = alternation(lists.subjectVerbs)
  const nouns = alternation(lists.nounsBy)
  // The start of a line, with the marks a list item, a quote, a heading or an emphasis puts before the text.
  const lineStart = `^[ \\t>*_#\`(\\[-]*(\\d+[.)][ \\t]*)?`
  // A trailer value that is only words that name an agent (autonomous coding agent, assistant, bot, model), with an
  // optional address: a value with any other word is a name.
  // One word list, each word once, so a word is matched one way and a long run of them is read in linear time.
  const trailerWords = alternation([
    ...new Set([...lists.trailerAdjectives, ...lists.trailerAgentNouns]),
  ])
  const trailerValue = `((${trailerWords})[ \\t]+)*(${alternation(lists.trailerAgentNouns)})`
  const common = [
    // A trailer of any `-by` kind, in a list or a quote or bold, whose value names a tool, or is only `AI` or `LLM`.
    `^[ \\t>*_\`-]*(\\d+[.)][ \\t]*)?[*_\`]*[a-z][a-z-]*-by[*_\`]*[ \\t]*:(([^\\n]*[^a-z0-9])?(${tools})${after}|[ \\t*_\`]*((an?|the)[ \\t]+)?(${generic})([ \\t]+(${descriptors}))*[ \\t]*(<[^>\\n]*>)?[ \\t]*\\r?$|[ \\t*_\`]*${trailerValue}([ \\t]*<[^>\\n]*>)?[ \\t]*\\r?$)`,
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
    // A credit verb (a past participle) and a connector, then a tool or a generic agent, in a position that is an
    // attribution: a line that starts with it, or a sentence whose subject is the change itself.
    `${lineStart}${credit}${gapL}(${generic})${genericEnd}`,
    `${lineStart}((this|the|these)[ \\t]+)?((${alternation(lists.changeNouns)})[ \\t]+((is|was|were|are)[ \\t]+)?)?${adverb}${participle}([ \\t]+(${alternation(lists.adverbs)}))?[ \\t]+with${gapL}(${generic})[ \\t]+(${alternation(lists.assistanceNouns)})${phraseEnd}`,
    `${lineStart}((this|the|these)[ \\t]+)?((${alternation(lists.changeNouns)})[ \\t]+((is|was|were|are)[ \\t]+)?)?${adverb}${participle}([ \\t]+(${alternation(lists.adverbs)}))?[ \\t]+with([ \\t]+the)?[ \\t]+(${alternation(lists.assistanceNouns)})[ \\t]+(of|from)${gapL}(${generic})${genericEnd}`,
    `${lineStart}((this|the|these)\\s+)?(${alternation(lists.changeNouns)})\\s+((is|was|were|are)\\s+)?${credit}${gapL}(${generic})${genericEnd}`,
    `${lineStart}(thanks\\s+to|courtesy\\s+of|with\\s+(the\\s+)?help\\s+(of|from))${gap}(${generic})${genericEnd}`,
    `\\b(this|the|these)\\s+(${alternation(lists.changeNouns)})\\s+(is|was|were|are)\\s+((${generic})[- ](generated|assisted|authored|written)${phraseEnd}|${credit}${gapL}(${generic})${genericEnd})`,
    // The robot-emoji line, and a tag that stands alone or sits in brackets, in English and in Portuguese.
    `🤖([^\\n]*[^a-z0-9])?(${generic})${genericEnd}`,
    `^[ \\t>*_-]*[\\[(]?((${generic})[- ](generated|assisted|authored|written)|(${ptVerbs})\\s+(${ptConnectors})${gap}(${pt}))[\\])]?[ \\t.]*\\r?$`,
    `[\\[(]${credit}${gapL}(${generic})${genericEnd}`,
    `[\\[(]((${generic})[- ](generated|assisted|authored|written)|(${ptVerbs})\\s+(${ptConnectors})${gap}(${pt}))[\\])]`,
    `${lineStart}(${ptVerbs})\\s+(${ptConnectors})${gap}(${pt})${ptEnd}`,
    `${lineStart}(${alternation(lists.ptChangeNouns)})\\s+(${ptVerbs})\\s+(${ptConnectors})${gap}(${pt})${ptEnd}`,
    `\\b(${alternation(lists.ptDeterminers)})\\s+(${alternation(lists.ptChangeNouns)})\\s+(foi|é|e|foram)\\s+(${ptVerbs})\\s+(${ptConnectors})${gap}(${pt})${ptEnd}`,
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
    `${lineStart}${lineStart2}${gap}(${tools})${after}`,
    // A credit verb before a tool is read only in the strict profile: the narrow one lets a vendor be cited.
    `${lineStart}${credit}${gapL}${creditTool}`,
    `${lineStart}(${ptVerbs})[ \\t]+(${ptConnectors})${gapL}${creditTool}`,
    `${lineStart}((this|the|these)\\s+)?(${alternation(lists.changeNouns)})\\s+((is|was|were|are)\\s+)?${credit}${gapL}${creditTool}`,
    `\\b(this|the|these)\\s+(${alternation(lists.changeNouns)})\\s+(is|was|were|are)\\s+${credit}${gapL}${creditTool}`,
    `${before}(${tools})[ -](agent|assistant)\\b`,
    `(^|[^@\\w])(${alternation(lists.bareWordsStrict)})\\b`,
    // A name that only begins with the tool's (a person called Claudette) is not the tool; the dot keeps a file name out.
    `\\bclaude([^.a-z]|$)`,
  ]
  const narrowCredit = `${adverb}([a-z]+-)*(${alternation(lists.narrowCreditVerbs)})([ \\t]+(${alternation(lists.adverbs)}))?[ \\t]+(with|by|using|via|through)([ \\t]+the[ \\t]+help[ \\t]+of)?`
  const near = alternation(lists.narrowNear)
  const nearWords = alternation(lists.narrowNearWords)
  const narrow = [
    ...common,
    // A verb phrase counts only at the start of a line: a sentence that cites a vendor's documents or says what its
    // models generate is not an attribution.
    `${lineStart}${phrase}`,
    // A credit verb and a tool where the tool ends the phrase (the end of the line, a full stop, a dash or an opening
    // parenthesis, with no noun after it) is an attribution even where a vendor may be cited: `Built with <tool>.`
    // A comma or a noun after the tool is a sentence about the vendor, so `Made by <vendor>, priced per token` passes.
    // Words that name the tool's product (ai, a product word, a version or a number) may follow it, and a comma that
    // goes on with another verb ends the phrase too; `Made by <vendor>, priced per token` and a noun after the tool
    // (`<tool> bindings`) are sentences about the vendor.
    `${lineStart}${narrowCredit}${gapL}(${tools})([ \\t]+(ai|${alternation(lists.toolWords)}|${alternation(lists.productWords)}|[a-z]?[0-9][0-9.]*))*[*_\`\\])}>"'”’]*(${toolEnd}|,[ \\t]+(and|&)[ \\t])`,
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
