// Tests for the AI-attribution patterns: the case table against both profiles, and the two organisation
// rulesets and the patterns file against what the lists build, so those copies cannot drift.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from '../../ai-attribution/build-patterns.mjs'

const DIR = fileURLToPath(new URL('../../ai-attribution/', import.meta.url))
const read = (path) => JSON.parse(readFileSync(DIR + path, 'utf8'))
const patterns = read('patterns.json')

/**
 * The JavaScript form of a ruleset pattern: the leading `(?im)` becomes the `im` flags. The patterns use no
 * lookaround and no back-reference, so RE2 and a JavaScript engine read them alike.
 */
function compile(pattern) {
  assert.ok(pattern.startsWith('(?im)'), 'a pattern starts with (?im)')
  assert.doesNotMatch(pattern, /\(\?[<=!]|\\[1-9]/, 'a pattern uses nothing RE2 lacks')
  return new RegExp(pattern.slice('(?im)'.length), 'im')
}

const strict = compile(patterns.strict)
const narrow = compile(patterns.narrow)

test('every case of the table is rejected or passed as stated, by the strict and by the narrow profile', () => {
  assert.ok(patterns.cases.length >= 17)
  for (const { name, message, strictRejects, narrowRejects } of patterns.cases) {
    assert.equal(strict.test(message), strictRejects, `strict: ${name}`)
    assert.equal(narrow.test(message), narrowRejects, `narrow: ${name}`)
  }
})

test('the table holds the cases that decide the profiles: a file name, a bot trailer, a model id, a real trailer', () => {
  const byName = new Map(patterns.cases.map((c) => [c.name, c]))
  for (const name of [
    'CLAUDE.md file',
    'dependabot trailer',
    'claude-opus pricing',
    'real trailer (claude)',
    'real trailer (codex)',
  ]) {
    assert.ok(byName.has(name), name)
  }
  assert.equal(byName.get('CLAUDE.md file').strictRejects, false)
  assert.equal(byName.get('dependabot trailer').strictRejects, false)
  assert.equal(byName.get('claude-opus pricing').narrowRejects, false)
  assert.equal(byName.get('real trailer (claude)').narrowRejects, true)
})

test('the narrow profile is a subset of what the strict profile rejects, except for the review phrasings it adds', () => {
  const onlyNarrow = patterns.cases.filter((c) => c.narrowRejects && !c.strictRejects)
  assert.deepEqual(onlyNarrow, [])
})

const lists = read('lists.json')
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1)

test('every copy of the patterns equals what the lists build: the file and the two rulesets', () => {
  const built = build(lists)
  assert.equal(patterns.strict, built.strict)
  assert.equal(patterns.narrow, built.narrow)
  assert.equal(
    read('rulesets/forbid-ai-attribution.json').rules[0].parameters.pattern,
    built.strict,
  )
  assert.equal(
    read('rulesets/forbid-ai-attribution-narrow.json').rules[0].parameters.pattern,
    built.narrow,
  )
})

/** Every entry the lists hold today: a list may grow, and a removal is a failure and not a quiet loss. */
const MINIMUM = {
  tools: [
    'claude',
    'anthropic',
    'codex',
    'openai',
    'chatgpt',
    'gpt',
    'copilot',
    'gemini',
    'cursor',
    'windsurf',
    'devin',
    'aider',
    'codeium',
    'tabnine',
    'bard',
    'grok',
    'deepseek',
    'mistral',
    'kiro',
    'perplexity',
  ],
  productionVerbs: [
    'generated',
    'authored',
    'co-authored',
    'assisted',
    'drafted',
    'created',
    'produced',
  ],
  judgementVerbs: [
    'reviewed',
    'approved',
    'audited',
    'verified',
    'checked',
    'proposed',
    'suggested',
  ],
  strictByVerbs: ['written', 'made', 'built', 'fixed', 'implemented'],
  subjectVerbs: [
    'reviewed',
    'wrote',
    'authored',
    'generated',
    'created',
    'co-authored',
    'approved',
    'drafted',
  ],
  nounsBy: ['review', 'approval', 'authorship', 'co-authorship', 'assistance', 'sign-off'],
}

test('the lists keep every entry they hold today: they may grow and never shrink', () => {
  for (const [name, entries] of Object.entries(MINIMUM)) {
    for (const entry of entries) assert.ok(lists[name].includes(entry), `${name}: ${entry}`)
  }
})

/** Every message a family of phrasings builds for one tool: the ones both profiles refuse, and the strict-only ones. */
function family(tool) {
  const T = cap(tool)
  const both = []
  const strictOnly = []
  for (const verb of lists.productionVerbs) {
    for (const connector of ['with', 'by', 'using', 'via', 'through'])
      both.push(`fix: x\n\n${cap(verb)} ${connector} ${T}`)
  }
  for (const verb of lists.judgementVerbs) both.push(`fix: x\n\n${cap(verb)} by ${T}`)
  for (const verb of lists.strictByVerbs) strictOnly.push(`docs: ${verb} by ${T}`)
  for (const key of [
    'Co-authored-by',
    'Signed-off-by',
    'Authored-by',
    'Reviewed-by',
    'Assisted-by',
    'Generated-by',
    'Tested-by',
    'Acked-by',
    'Helped-by',
  ]) {
    for (const prefix of ['', '> ', '- ', '* ', '1. ', '`', '**']) {
      both.push(`feat: x\n\n${prefix}${key} : ${T} <a@b.c>`)
    }
    both.push(`feat: x\n\n**${key}**: ${T}`)
  }
  for (const verb of lists.subjectVerbs) both.push(`feat: x\n\n${T} ${verb} this`)
  for (const noun of lists.nounsBy) both.push(`feat: x\n\n${cap(noun)} by ${T}`)
  both.push(
    `feat: x with the help of ${T}`,
    `feat: x with help from ${T}`,
    `feat: x, thanks to ${T}`,
    `feat: x, courtesy of ${T}`,
    `feat: x, powered by ${T}`,
    `feat: x, pair programmed with ${T}`,
    `feat: x\n\n\u{1F916} Generated ${T}`,
    `feat: x\n\nMade with \u2764\uFE0F and ${T}`,
    `feat: x\n\nsee ${tool}[bot] notes`,
    `feat: x\n\n${T} Bot`,
    `feat: x\n\n${T}-bot`,
    `feat: x\n\n${T} Agent`,
  )
  strictOnly.push(`feat: address ${T} review comments`)
  return { both, strictOnly }
}

test('every attribution phrasing names every tool: each family of phrasings is refused by the profiles that carry it', () => {
  const misses = []
  for (const tool of lists.tools) {
    const { both, strictOnly } = family(tool)
    for (const message of both) {
      if (!strict.test(message)) misses.push(`strict: ${message}`)
      if (!narrow.test(message)) misses.push(`narrow: ${message}`)
    }
    for (const message of strictOnly) if (!strict.test(message)) misses.push(`strict: ${message}`)
  }
  for (const message of [
    'AI-generated',
    '(AI-assisted)',
    'feat: x\n\n> Generated with AI.',
    '- ai assisted',
    'AI-generated\r\n',
    'feat: x\n\nCo-authored-by: AI',
    'feat: x\n\nAssisted-by: LLM <a@b.c>',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
})

test('the narrow profile reads a verb phrase only at the start of a line: a vendor cited or described passes', () => {
  for (const message of [
    'feat(prices): add claude-opus pricing',
    'feat(prices): prices for models made by Anthropic and written by OpenAI',
    'chore(deps): bump openai from 4.0.0 to 5.0.0',
    'docs: the sdk of Anthropic keeps a price table',
    'docs: cost verified with Anthropic pricing page',
    'fix: price checked by OpenAI docs',
    'docs: the models generated by Anthropic are priced per token',
    'docs: tokens approved by Mistral for the tier',
    'Made by Anthropic, priced per token',
    'Written by OpenAI: the model card',
  ]) {
    assert.equal(narrow.test(message), false, message)
  }
})

test('a phrase that is not an attribution passes the strict profile: an ordinary word, a sentence about AI, a technical object', () => {
  for (const message of [
    'docs: spec for AI-guided training with AI-generated plans',
    'feat: plans generated by AI for each athlete',
    'fix: the Cursor position after a paste',
    'fix: the cursor jumps on resize',
    'docs: Gemini is a constellation',
    'feat: copilot seat of the pilot',
    'fix: the checked box state',
    'feat: implemented using cursor pagination',
    'fix: reviewed with Cursor position in mind',
    'feat: built with Gemini bindings',
    'chore(deps): bump openai from 4.0.0 to 5.0.0',
    'chore(deps): bump @anthropic-ai/sdk from 1.0.0 to 1.1.0',
  ]) {
    assert.equal(strict.test(message), false, message)
  }
})

const RULESETS = [
  [
    'rulesets/forbid-ai-attribution.json',
    'strict',
    (c) => ({ include: ['~ALL'], exclude: patterns.narrowRepos }),
  ],
  [
    'rulesets/forbid-ai-attribution-narrow.json',
    'narrow',
    () => ({ include: patterns.narrowRepos, exclude: [] }),
  ],
]

for (const [file, profile, repos] of RULESETS) {
  test(`${file} carries the ${profile} pattern and the repositories of the patterns file`, () => {
    const ruleset = read(file)
    assert.equal(ruleset.target, 'branch')
    assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH'])
    const { include, exclude } = repos()
    assert.deepEqual(ruleset.conditions.repository_name.include, include)
    assert.deepEqual(ruleset.conditions.repository_name.exclude, exclude)
    assert.equal(ruleset.rules.length, 1)
    const [rule] = ruleset.rules
    assert.equal(rule.type, 'commit_message_pattern')
    assert.equal(rule.parameters.negate, true)
    assert.equal(rule.parameters.operator, 'regex')
    assert.equal(rule.parameters.pattern, patterns[profile])
    assert.ok(['evaluate', 'active'].includes(ruleset.enforcement))
  })
}
