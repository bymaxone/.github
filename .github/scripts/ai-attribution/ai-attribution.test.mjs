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
    'cursoragent',
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
    'suggested',
    'proposed',
  ],
  nounsBy: ['review', 'approval', 'authorship', 'co-authorship', 'assistance', 'sign-off'],
  toolSpellings: [
    'chat gpt',
    'chat-gpt',
    'open ai',
    'open-ai',
    'github copilot',
    'github-copilot',
    'google gemini',
    'microsoft copilot',
    'openai codex',
    'claude code',
  ],
  fillers: [
    'the',
    'a',
    'an',
    'our',
    'my',
    'new',
    'latest',
    'github',
    'google',
    'microsoft',
    'meta',
    'amazon',
    'open',
    'our own',
    'ai',
    'um',
    'uma',
    'o',
    'os',
    'as',
    'generic',
    'autonomous',
    'helpful',
    'automated',
  ],
  lineStartVerbs: ['written'],
  genericAgents: [
    'ai',
    'llm',
    'language model',
    'large language model',
    'artificial intelligence',
    'a.i.',
    'genai',
    'generative ai',
    'chatbot',
    'chat bot',
    'coding agent',
    'language-model',
    'llms',
    'ais',
    'language models',
    'large language models',
    'artificial intelligences',
    'autonomous agent',
    'autonomous coding agent',
    'coding assistant',
    'ai coding assistant',
  ],
  genericDescriptors: [
    'coding',
    'code',
    'pair',
    'programming',
    'assistant',
    'agent',
    'tool',
    'bot',
    'model',
    'programmer',
    'system',
    'helper',
    'tools',
    'agents',
    'assistants',
    'bots',
    'models',
  ],
  ptAgents: [
    'ia',
    'intelig\u00eancia artificial',
    'inteligencia artificial',
    'llm',
    'i.a.',
    'ias',
    'agente de ia',
    'agentes de ia',
    'agente de intelig\u00eancia artificial',
  ],
  ptVerbs: [
    'gerado',
    'gerada',
    'escrito',
    'escrita',
    'criado',
    'criada',
    'revisado',
    'revisada',
    'assistido',
    'assistida',
    'feito',
    'feita',
    'desenvolvido',
    'desenvolvida',
    'redigido',
    'redigida',
    'elaborado',
    'elaborada',
    'implementado',
    'implementada',
    'produzido',
    'produzida',
    'programado',
    'programada',
  ],
  ptConnectors: [
    'por',
    'com',
    'pela',
    'pelo',
    'usando',
    'via',
    'utilizando',
    'com ajuda de',
    'com a ajuda de',
    'com assist\u00eancia de',
    'com a assist\u00eancia de',
    'com assistencia de',
    'com aux\u00edlio de',
    'com o aux\u00edlio de',
    'com suporte de',
    'com o suporte de',
  ],
  changeNouns: [
    'pr',
    'pull request',
    'commit',
    'change',
    'changes',
    'patch',
    'diff',
    'code',
    'fix',
    'implementation',
    'message',
    'text',
    'documentation',
    'content',
    'summary',
    'docs',
    'tests',
  ],
  ptChangeNouns: [
    'pr',
    'commit',
    'c\u00f3digo',
    'codigo',
    'mudan\u00e7a',
    'mudanca',
    'altera\u00e7\u00e3o',
    'alteracao',
    'corre\u00e7\u00e3o',
    'correcao',
    'texto',
    'descri\u00e7\u00e3o',
    'descricao',
    'patch',
    'diff',
  ],
  ptDeterminers: ['este', 'esta', 'o', 'a', 'os', 'as', 'esse', 'essa'],
  irregularParticiples: [
    'made',
    'built',
    'done',
    'written',
    'drawn',
    'run',
    'brought',
    'begun',
    'given',
    'shown',
    'taken',
    'sent',
    'spent',
    'led',
    'fed',
    'set',
    'put',
    'cut',
    'let',
    'kept',
    'left',
  ],
  adverbs: [
    'automatically',
    'entirely',
    'partially',
    'fully',
    'mostly',
    'largely',
    'partly',
    'manually',
    'originally',
    'initially',
  ],
  assistanceNouns: ['assistance', 'help', 'support', 'guidance'],
  ptAdverbs: ['automaticamente', 'totalmente', 'parcialmente', 'inteiramente', 'em parte'],
  andVerbs: [
    'adjusted',
    'approved',
    'assisted',
    'audited',
    'authored',
    'checked',
    'cleaned',
    'co-authored',
    'corrected',
    'created',
    'drafted',
    'edited',
    'finalized',
    'finished',
    'fixed',
    'generated',
    'improved',
    'modified',
    'polished',
    'produced',
    'proofread',
    'proposed',
    'refined',
    'reviewed',
    'revised',
    'rewritten',
    'rewrote',
    'suggested',
    'tested',
    'tuned',
    'updated',
    'validated',
    'verified',
    'written',
  ],
  andAdverbs: [
    'then',
    'also',
    'later',
    'lightly',
    'heavily',
    'manually',
    'finally',
    'afterwards',
    'subsequently',
  ],
  ptAndAdverbs: ['depois', 'tamb\u00e9m', 'tambem', 'manualmente'],
  narrowCreditVerbs: [
    'generated',
    'authored',
    'co-authored',
    'written',
    'built',
    'made',
    'crafted',
    'created',
    'produced',
    'drafted',
    'assisted',
    'raised',
    'caught',
    'found',
    'flagged',
    'suggested',
    'proposed',
    'reviewed',
    'approved',
    'verified',
    'checked',
    'designed',
    'developed',
    'implemented',
    'coded',
    'refactored',
    'fixed',
    'rewritten',
    'reported',
  ],
  toolWords: ['code', 'cli', 'agent', 'assistant', 'bot'],
  trailerAgentNouns: [
    'agent',
    'assistant',
    'bot',
    'model',
    'llm',
    'ai',
    'chatbot',
    'copilot agent',
  ],
  trailerAdjectives: [
    'generic',
    'autonomous',
    'coding',
    'helpful',
    'automated',
    'virtual',
    'ai',
    'code',
    'software',
    'language',
    'large',
    'an',
    'a',
    'the',
  ],
  ambiguousTools: [
    'cursor',
    'gemini',
    'bard',
    'aider',
    'windsurf',
    'mistral',
    'grok',
    'devin',
    'perplexity',
    'kiro',
    'codex',
    'codeium',
    'tabnine',
    'deepseek',
    'gpt',
  ],
  productWords: [
    'ide',
    'editor',
    'pro',
    'flash',
    'ultra',
    'composer',
    'cascade',
    'chat',
    'mini',
    'turbo',
    'plus',
    'studio',
    'desktop',
    'app',
    'extension',
    'plugin',
    'max',
    'tab',
    'nano',
    'lite',
    'preview',
    'advanced',
    'free',
  ],
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
  const narrowOnly = []
  for (const verb of lists.productionVerbs) {
    for (const connector of ['with', 'by', 'using', 'via', 'through'])
      both.push(`fix: x\n\n${cap(verb)} ${connector} ${T}`)
  }
  for (const verb of lists.judgementVerbs) both.push(`fix: x\n\n${cap(verb)} by ${T}`)
  for (const verb of lists.strictByVerbs) strictOnly.push(`docs: ${verb} by ${T}`)
  for (const verb of lists.lineStartVerbs) {
    both.push(`fix: x\n\n${cap(verb)} by ${T}`, `fix: x\n\n${cap(verb)} with ${T}`)
  }
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
  )
  strictOnly.push(`feat: x\n\n${T} Agent`, `feat: x\n\n${tool}-assistant`)
  for (const verb of ['suggested', 'proposed']) both.push(`feat: x\n\n${T} ${verb} this change`)
  both.push(
    `Reviewed by GitHub ${T}`,
    `Reviewed by @${tool}`,
    `Reviewed by: ${T}`,
    `Reviewed by the ${T}`,
  )
  return { both, strictOnly, narrowOnly }
}

test('every attribution phrasing names every tool: each family of phrasings is refused by the profiles that carry it', () => {
  const misses = []
  for (const tool of lists.tools) {
    const { both, strictOnly, narrowOnly } = family(tool)
    for (const message of both) {
      if (!strict.test(message)) misses.push(`strict: ${message}`)
      if (!narrow.test(message)) misses.push(`narrow: ${message}`)
    }
    for (const message of strictOnly) if (!strict.test(message)) misses.push(`strict: ${message}`)
    for (const message of narrowOnly) if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  for (const message of [
    'AI-generated',
    '(AI-assisted)',
    'feat: x\n\n> Generated with AI.',
    '- ai assisted',
    'AI-generated\r\n',
    'feat: x\n\nCo-authored-by: AI',
    'feat: x\n\nAssisted-by: LLM <a@b.c>',
    'feat: x\n\nCo-authored-by: cursoragent <a@b.c>',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
})

test('a tool spelled with a space or a hyphen, a vendor or an adjective before it, and markup around it, are refused', () => {
  const misses = []
  const names = [...lists.tools, ...lists.toolSpellings].map(cap)
  for (const T of names) {
    for (const verb of lists.productionVerbs) {
      for (const connector of ['with', 'by']) {
        for (const message of [
          `${cap(verb)} ${connector} ${T}`,
          `${cap(verb)} ${connector} **${T}**`,
          `${cap(verb)} ${connector} \`${T}\``,
          `${cap(verb)} ${connector} "${T}"`,
          `${cap(verb)} ${connector} _${T}_`,
          `${cap(verb)} ${connector} __${T}__`,
          `${cap(verb)} ${connector} ~~${T}~~`,
          `${cap(verb)} ${connector} “${T}”`,
          `${cap(verb)} ${connector} {${T}}`,
        ]) {
          if (!strict.test(message)) misses.push(`strict: ${message}`)
          if (!narrow.test(message)) misses.push(`narrow: ${message}`)
        }
      }
    }
    for (const verb of lists.judgementVerbs) {
      for (const message of [
        `${cap(verb)} by ${T}`,
        `${cap(verb)} by: ${T}`,
        `${cap(verb)} by the new ${T}`,
        `${cap(verb)} by our ${T}`,
        `${cap(verb)} by Google ${T}`,
        `${cap(verb)} by Microsoft ${T}`,
      ]) {
        if (!strict.test(message)) misses.push(`strict: ${message}`)
        if (!narrow.test(message)) misses.push(`narrow: ${message}`)
      }
    }
  }
  for (const message of [
    'Generated with Chat GPT',
    'Reviewed by Open AI',
    'Generated by Chat-GPT',
    'Reviewed by Google Gemini',
    'Generated with Microsoft Copilot',
    'Generated with the new Claude Code CLI',
    'Reviewed by our Claude',
    'Generated by **Copilot**',
    'Generated with _Cursor_',
    'Reviewed by _Copilot_',
    'Co-authored-by: _Cursor_ <a@b.c>',
    'Generated with __Claude__',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
})

test('a tool named right after the colon of a trailer or right after the robot emoji, with no separator, is refused', () => {
  const misses = []
  for (const tool of [...lists.tools, ...lists.toolSpellings]) {
    const T = cap(tool)
    for (const key of [
      'Co-authored-by',
      'Signed-off-by',
      'Reviewed-by',
      'Assisted-by',
      'Generated-by',
      'Authored-by',
    ]) {
      for (const message of [
        `feat: x\n\n${key}:${T}`,
        `feat: x\n\n${key}:${T} <a@b.c>`,
        `feat: x\n\n${key}:_${T}_`,
        `feat: x\n\n${key}:\t${T}`,
      ]) {
        if (!strict.test(message)) misses.push(`strict: ${message}`)
        if (!narrow.test(message)) misses.push(`narrow: ${message}`)
      }
    }
    for (const message of [
      `feat: x\n\n\u{1F916}${T}`,
      `feat: x\n\n\u{1F916}_${T}_`,
      `feat: x\n\n\u{1F916} ${T}`,
    ]) {
      if (!strict.test(message)) misses.push(`strict: ${message}`)
      if (!narrow.test(message)) misses.push(`narrow: ${message}`)
    }
  }
  assert.deepEqual(misses, [])
})

test('a tool name inside a longer word is not the tool, after a trailer or a verb', () => {
  for (const message of [
    'feat: x\n\nCo-authored-by: Cursors <a@b.c>',
    'Reviewed by Copilots',
    'Generated by gptq',
    'Generated with Geminis',
    'feat: x\n\nReviewed-by: Mistrals',
  ]) {
    assert.equal(strict.test(message), false, message)
    assert.equal(narrow.test(message), false, message)
  }
})

test('a credit verb, any past participle or an irregular one, then a connector, then a tool: refused at the start of a line', () => {
  const misses = []
  const participles = [
    'made',
    'built',
    'crafted',
    'done',
    'written',
    'drawn',
    'run',
    'brought',
    'powered',
    'fixed',
    'tested',
    'drafted',

    'kept',
    'given',
    'shown',
  ]
  for (const tool of [...lists.tools, ...lists.toolSpellings]) {
    const T = cap(tool)
    for (const participle of participles) {
      for (const connector of ['with', 'by', 'using', 'via', 'through', 'with the help of']) {
        for (const message of [
          `${cap(participle)} ${connector} ${T}`,
          `fix: x\n\n${cap(participle)} ${connector} **${T}**`,
          `- ${cap(participle)} ${connector} _${T}_`,
          `## ${cap(participle)} ${connector} ${T}`,
          `Co-${participle} ${connector} ${T}`,
        ]) {
          if (!strict.test(message)) misses.push(`strict: ${message}`)
        }
      }
    }
    for (const message of [
      `This PR was written by ${T}`,
      `the commit was generated with ${T}`,
      `these changes were drafted using ${T}`,
      `Code generated with ${T}`,
      `Tests written by ${T}`,
      `Docs written with the help of ${T}`,
    ]) {
      if (!strict.test(message)) misses.push(`strict: ${message}`)
    }
  }
  assert.deepEqual(misses, [])
})

test('a generic agent (an AI, an LLM, a language model) is refused in the position of an attribution, in both profiles', () => {
  const misses = []
  const agents = [
    'AI',
    'an AI',
    'the AI',
    'AI assistant',
    'an AI assistant',
    'an AI coding agent',
    'AI agent',
    'LLM',
    'an LLM',
    'a language model',
    'a large language model',
    'artificial intelligence',
  ]
  for (const agent of agents) {
    for (const message of [
      `Generated with ${agent}`,
      `Written by ${agent}.`,
      `Created using ${agent}`,
      `Assisted by ${agent}`,
      `Reviewed by ${agent}`,
      `Code generated with ${agent}`,
      `Written with the help of ${agent}`,
      `This PR is generated by ${agent}.`,
      `The commit was written with ${agent}`,
      `feat: x\n\nCo-Authored-By: ${agent} <ai@example.com>`,
      `feat: x\n\nReviewed-by: ${agent}`,
    ]) {
      if (!strict.test(message)) misses.push(`strict: ${message}`)
      if (!narrow.test(message)) misses.push(`narrow: ${message}`)
    }
  }
  for (const message of [
    'This PR is AI-generated.',
    '(AI-generated)',
    '[AI-generated]',
    'AI-generated',
    'feat: x (AI-assisted)',
    '\u{1F916} Generated with AI',
    'Gerado por IA',
    'gerado por IA',
    'Gerada por IA.',
    '[gerado por IA]',
    '(escrito por inteligência artificial)',
    'Este PR foi gerado por IA',
    'O código foi escrito por IA',
    'Criado com IA',
    'Revisado por IA',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
})

test('the review round: no verb check on the word before a connector, no vendor wording in narrow, more attribution forms', () => {
  for (const message of [
    'Chat with an LLM.',
    'Code with AI.',
    'Open with Cursor',
    'Connect with Gemini',
    'Guide by AI',
    'Migrated from Cursor',
    'Imported from Copilot',
    'Switched from Cursor',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
  }
  for (const message of [
    'Tested with Gemini 2.5 Flash on 200 prompts',
    'Made by Anthropic, priced per token',
    'Migrated from Gemini 1.5 to 2.5',
    'Replaced by Gemini 2.5 Flash',
    'Billed by OpenAI per 1M tokens',
    'Limited by OpenAI rate limits',
    'Cached by Gemini 2.5 Flash on the edge',
  ]) {
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
  const misses = []
  for (const message of [
    'Co-authored with AI',
    'Co-authored by an AI',
    'Auto-generated by AI',
    'Machine-generated by an LLM',
    '## Generated by AI',
    '### Generated with an LLM',
    '(LLM-generated)',
    '[LLM generated]',
    'LLM-assisted',
    '(language-model-written)',
    'fix: stuff (generated by AI)',
    'fix: stuff (written by an LLM)',
    'Written by AI tools',
    'Written by AI agents',
    'Generated by AI and reviewed by a human',
    'Generated by A.I.',
    'Generated by GenAI',
    'Generated by generative AI',
    'Assisted by a coding agent',
    'Generated by a chatbot',
    'Código gerado por IA',
    'Commit gerado por IA',
    'Descrição gerada por IA',
    'Esse commit foi escrito por IA',
    'Gerado por LLM',
    'Gerado via IA',
    'Gerado utilizando IA',
    'Escrito com ajuda de IA',
    'Desenvolvido com IA',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
})

test('the second review round: closed compounds, an and continuation, plurals, Portuguese verbs, one line only', () => {
  const misses = []
  for (const message of [
    'Rewritten by AI',
    'Handwritten by AI',
    'Rebuilt by AI',
    'Generated and reviewed by AI',
    'Written and tested by an LLM',
    'Generated by LLMs',
    'Generated by language models',
    'Generated by large language models',
    'Generated by AIs',
    'Redigido por IA',
    'Elaborado por IA',
    'Este patch foi gerado por IA',
    'Gerado por agentes de IA',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  for (const message of ['Gerado pelo Copilot', 'Criado com Cursor', 'Rewritten with Claude']) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
  }
  assert.deepEqual(misses, [])
  for (const message of ['Resolved\nby AI', 'Merged\nwith the\nAI', 'Updated\n\nBy AI']) {
    assert.equal(strict.test(message), false, `strict: ${JSON.stringify(message)}`)
    assert.equal(narrow.test(message), false, `narrow: ${JSON.stringify(message)}`)
  }
})

test('the third review round: an adverb, and a credit that says with AI assistance', () => {
  const misses = []
  for (const message of [
    'Automatically generated by AI',
    'Entirely written by AI',
    'Partially generated by an LLM',
    'Generated automatically by AI',
    'Gerado automaticamente por IA',
    'Written with AI assistance',
    'Developed with AI assistance',
    'This PR was written with AI assistance',
    'Written with the assistance of AI',
    'Written with LLM help',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
  for (const message of [
    'docs: help with AI assistance in the sidebar',
    'feat: fully configured with AI support in settings',
    'feat: the settings page, with AI help text',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
})

test('the fourth review round: an assistance credit ends where the phrase ends, takes an adverb, and has Portuguese forms', () => {
  for (const message of [
    'Implemented with AI support for streaming',
    'Refactored with AI guidance docs',
    'Generated with AI help command output',
    'Tested with AI support enabled',
    'Generated with AI assistance for each athlete',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
  const misses = []
  for (const message of [
    'This PR was largely written with AI assistance',
    'The commit was mostly generated with AI help',
    'Written with AI assistance.',
    'Written with AI assistance and reviewed by a human',
    'Este PR foi escrito com assistência de IA',
    'Este commit foi gerado com auxílio de IA',
    'Escrito com suporte de IA',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
})

test('every branch that names a generic agent ends the phrase there: a continuation is not an attribution', () => {
  const agents = ['AI', 'an AI', 'the AI', 'LLM', 'an LLM', 'AI assistant', 'a language model']
  const forms = [
    (a) => `Generated by ${a}`,
    (a) => `Written with ${a}`,
    (a) => `Co-authored with ${a}`,
    (a) => `Automatically generated by ${a}`,
    (a) => `This PR was written by ${a}`,
    (a) => `Code generated with ${a}`,
    (a) => `Thanks to ${a}`,
    (a) => `With the help of ${a}`,
    (a) => `(generated by ${a})`,
    (a) => `\u{1F916} ${a}`,
    (a) => `Written with ${a} assistance`,
  ]
  const continuations = [' for each athlete', ' to rank the results', ' support enabled']
  const ends = ['', '.', ' and reviewed by a human']
  const wrong = []
  for (const agent of agents) {
    for (const form of forms) {
      const base = form(agent)
      for (const end of ends) {
        const message = `fix: x\n\n${base}${end}`
        if (
          /assistant|assistance/.test(message) &&
          !/AI assistance/.test(message) &&
          /assistance/.test(message)
        )
          continue
        if (!strict.test(message)) wrong.push(`strict should refuse: ${message}`)
      }
      for (const cont of continuations) {
        if (/\u{1F916}/u.test(base) && false) continue
        const message = `fix: x\n\n${base}${cont}`
        if (/assistance/.test(base) || /\)$/.test(base)) continue
        if (strict.test(message)) wrong.push(`strict should pass: ${message}`)
        if (narrow.test(message)) wrong.push(`narrow should pass: ${message}`)
      }
    }
  }
  const pt = ['Gerado por IA', 'Escrito por IA', 'Criado com IA']
  for (const base of pt) {
    for (const cont of [' para cada atleta', ' para ranquear os resultados']) {
      const message = `fix: x\n\n${base}${cont}`
      assert.equal(strict.test(message), false, `strict: ${message}`)
      assert.equal(narrow.test(message), false, `narrow: ${message}`)
    }
    assert.equal(strict.test(`fix: x\n\n${base}.`), true, base)
  }
  assert.deepEqual(wrong, [])
})

test('one end for every phrase that names an agent: a dash, a slash or a parenthesis ends it, a predicate does not', () => {
  const misses = []
  for (const message of [
    'Gerado por IA - revisado por humano',
    'Escrito com IA - revisado',
    'Gerado por IA (revisado)',
    'Este PR foi gerado por IA (ver abaixo)',
    'Gerado por IA e revisado',
    'Written with AI assistance - reviewed',
    'Written with AI assistance (see below)',
    'Generated by AI - reviewed by a human',
    'Generated by AI \u2014 reviewed',
    'Written with AI and reviewed by a human',
    'Generated and reviewed by AI',
    'This PR is AI-generated.',
    'The summary is AI-generated.',
    'This change is AI-assisted - see the notes',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
  for (const message of [
    'The content is AI-generated recommendations for each athlete',
    'This change is AI-assisted code review for pull requests',
    'The summary is AI-generated and may be inaccurate',
    'Summary generated by AI and stored per athlete',
    'Text generated by an LLM and sent to the client',
    'Code generated by an LLM and executed in a sandbox',
    'Message generated by AI and delivered by queue',
    'Gerado por IA para cada atleta',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
})

test('the sixth review round: an and before a tool or an adverb and a verb, no slash or plus, linear on a blank run', () => {
  const misses = []
  for (const message of [
    'Generated by AI and Copilot',
    'Generated by AI & Claude',
    'Generated by AI and then reviewed',
    'Generated by AI and lightly edited',
    'Written by an AI assistant and improved by me',
    'Gerado por IA e depois revisado',
    'Gerado por IA e Copilot',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
  for (const message of [
    'Built with AI / ML pipelines for athletes',
    'Evaluated with an LLM / rubric scoring',
    'Built with AI + ML pipelines',
    '(AI-generated recommendations for each athlete)',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
  // The commitlint plugin runs these patterns in V8, where a nested blank run is read once per length.
  for (const head of [
    'This PR is AI-generated',
    'Written with AI assistance',
    'Generated by AI',
    'Gerado por IA',
  ]) {
    for (const pattern of [strict, narrow]) {
      const started = Date.now()
      pattern.test(`${head}${' '.repeat(60000)}x`)
      assert.ok(Date.now() - started < 500, `${head}: a long blank run must be read in linear time`)
    }
  }
})

test('the seventh review round: marks may stand between the and and the verb or tool', () => {
  const misses = []
  for (const message of [
    'Generated by AI and **Claude**',
    'Generated by AI and _Claude_',
    'Generated by AI and @claude',
    'Generated by AI and (Claude)',
    'Generated by AI and then **reviewed**',
    'Generated by AI and `Copilot`',
    'Gerado por IA e **revisado**',
  ]) {
    if (!strict.test(message)) misses.push(`strict: ${message}`)
    if (!narrow.test(message)) misses.push(`narrow: ${message}`)
  }
  assert.deepEqual(misses, [])
  const started = Date.now()
  strict.test(`Generated by AI and${' '.repeat(60000)}x`)
  narrow.test(`Generated by AI and ${'*'.repeat(60000)}x`)
  strict.test(`Generated by AI and ${'*_ '.repeat(20000)}x`)
  narrow.test(`Gerado por IA e ${'*_'.repeat(30000)}x`)
  assert.ok(Date.now() - started < 500)
})

test('narrow: a credit verb and a tool where the tool ends the phrase is an attribution, a vendor cited is not', () => {
  for (const message of [
    'Built with GitHub Copilot',
    'Made with Gemini',
    'Crafted with Cursor',
    'Raised by Codex',
    'Built with Copilot.',
    'Made with Gemini - see notes',
    'Crafted with Cursor (reviewed)',
    '## Made with Gemini',
  ]) {
    assert.equal(narrow.test(message), true, `narrow: ${message}`)
    assert.equal(strict.test(message), true, `strict: ${message}`)
  }
  for (const message of [
    'Built with Gemini bindings',
    'Made with the OpenAI SDK',
    'Made by Anthropic, priced per token',
    'Tested with Gemini 2.5 Flash on 200 prompts',
    'Billed by OpenAI per 1M tokens',
    'Migrated from Gemini 1.5 to 2.5',
  ]) {
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
})

test('a person whose name begins with the tool is not the tool', () => {
  for (const message of [
    'Co-authored-by: Claudette Smith <claudette@example.com>',
    'Claudia reviewed the change',
    'thanks to Claudette',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
  }
  for (const message of [
    'Co-authored-by: Claude <noreply@anthropic.com>',
    'Generated with Claude',
    'claude.md is documented',
  ]) {
    if (message.startsWith('claude.md')) assert.equal(strict.test(message), false, message)
    else assert.equal(strict.test(message), true, message)
  }
})

test('the follow-up: narrow vendor sentences, closing marks and product words after a tool, and trailers naming only an agent', () => {
  for (const message of [
    'Built with Claude Code',
    'Built with OpenAI Codex',
    'Built with Cursor Agent',
    'Built with **Copilot**',
    'Built with `Cursor`',
    'Built with [Copilot]',
  ]) {
    assert.equal(narrow.test(message), true, `narrow: ${message}`)
    assert.equal(strict.test(message), true, `strict: ${message}`)
  }
  for (const message of [
    'Tested with Gemini.',
    'Compared with Gemini',
    'Replaced by Gemini',
    'Sponsored by Anthropic',
    'Acquired by OpenAI',
    'Integrated with Copilot',
    'Blocked by Cursor',
    'Made with the OpenAI SDK',
  ]) {
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
  for (const message of [
    'feat: x\n\nCo-authored-by: Coding Agent <agent@example.com>',
    'feat: x\n\nGenerated-by: an agent',
    'feat: x\n\nAssisted-by: agent',
    'feat: x\n\nCo-authored-by: an autonomous agent <agent@example.com>',
    'feat: x\n\nReviewed-by: a helpful AI assistant',
    'feat: x\n\nCo-authored-by: Autonomous Coding Agent',
    'feat: x\n\nReviewed-by: Bot',
    'This commit was authored by a generic AI agent',
    'Authored by an autonomous coding agent',
    'Claude4',
  ]) {
    assert.equal(strict.test(message), true, `strict: ${message}`)
  }
  for (const message of [
    'feat: x\n\nCo-authored-by: Ai Lin <a@b.c>',
    'feat: x\n\nCo-authored-by: dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>',
    'feat: x\n\nCo-authored-by: Agent Smith <smith@example.com>',
    'feat: x\n\nCo-authored-by: Maria Model <m@b.c>',
    'feat: x\n\nSigned-off-by: Jane Doe <j@b.c>',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
})

test('a trailer value of repeated words is read in linear time, and strict refuses what narrow refuses', () => {
  for (const pattern of [strict, narrow]) {
    for (const word of ['ai ', 'agent ', 'an autonomous coding ', 'ai agent assistant bot ']) {
      const started = Date.now()
      pattern.test(`Co-authored-by: ${word.repeat(Math.floor(60000 / word.length))}x`)
      assert.ok(
        Date.now() - started < 500,
        `${word}: a long run of words must be read in linear time`,
      )
    }
  }
  for (const message of ['Found by Cursor.', 'Caught with Copilot', 'Caught by Copilot.']) {
    assert.equal(strict.test(message), true, `strict: ${message}`)
    assert.equal(narrow.test(message), true, `narrow: ${message}`)
  }
})

test('every word of every list, repeated, is read in linear time after each kind of prefix', () => {
  // A word that can be matched two ways inside a repeated group makes a backtracking engine (the commit plugin runs
  // these patterns in V8) take exponential time; this crosses every list word with the prefixes that lead to one.
  const prefixes = [
    'Co-authored-by: ',
    'Generated by ',
    'Written with AI and ',
    'Gerado por IA e ',
    'This PR was written by ',
    'Built with ',
  ]
  const words = new Set()
  for (const list of Object.values(lists)) {
    if (Array.isArray(list)) for (const word of list) if (typeof word === 'string') words.add(word)
  }
  const slow = []
  for (const word of words) {
    for (const prefix of prefixes) {
      for (const pattern of [strict, narrow]) {
        const message = `${prefix}${`${word} `.repeat(Math.max(1, Math.floor(2000 / (word.length + 1))))}x`
        const started = Date.now()
        pattern.test(message)
        const took = Date.now() - started
        if (took > 200) slow.push(`${took} ms: ${prefix}${word} repeated`)
      }
    }
  }
  assert.deepEqual(slow, [])
})

test('a name that is also an ordinary word is the tool after a credit verb only where it ends the phrase', () => {
  for (const message of [
    'Paginated with cursor-based offsets',
    'Filtered using cursor pagination',
    'Sorted with gemini-style routing',
    'Rendered by aider-like diffs',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
  for (const message of [
    'Built with Cursor',
    'Made with Gemini',
    'Crafted with Cursor.',
    'Raised by Codex',
    'Written with Cursor Agent',
    'Built with **Cursor**',
    'Generated with Cursor - see notes',
    '## Built with Cursor',
    'This PR was written by Cursor',
    'Built with Cursor AI',
    'Made with Gemini AI',
    'Built with GPT 5',
    'Made with Gemini: notes',
    'Built with Cursor, an AI editor',
    'Built with Cursor & friends',
    'Built with **Cursor** Agent',
    'Built with [Cursor] Code',
    'Built with Cursor \u{1F916}',
    'Made with GPT-5',
    'Built with Cursor-2.0',
    'Made with Gemini-2',
    'Built with Cursor IDE',
    'Made with Gemini Pro',
    'Built with Cursor Composer',
    'Made with Gemini Flash',
    'Built with Windsurf Cascade',
    'Built with Kiro Spec',
    'Built with Mistral Large',
    'Made with DeepSeek Coder',
    'Built with Aider Architect',
    'Built with Gemini Live',
    'Built with Cursor Bugbot',
    'Built with Grok Heavy',
    'Made with Perplexity Sonar',
    'Built with Tabnine Enterprise',
    'Made with DeepSeek R1',
    'Built with Codeium Windsurf',
  ]) {
    assert.equal(strict.test(message), true, `strict: ${message}`)
  }
})

test('narrow: a product word, a number or a comma and ends the credit phrase after the tool, a vendor sentence does not', () => {
  for (const message of [
    'Built with Cursor AI',
    'Built with GPT 5',
    'Built with Cursor, and shipped',
    'Made with Gemini 2.5',
    'Built with Cursor IDE',
    'Made with Gemini Pro.',
    'Built with Cursor v0.4',
    'Raised by Codex CLI',
    '**Built with Cursor.**',
    '*Raised by Codex.*',
    'Built with Cursor.)',
    'Built with Cursor, and then reviewed',
    'Built with Cursor, and Copilot',
  ]) {
    assert.equal(narrow.test(message), true, `narrow: ${message}`)
    assert.equal(strict.test(message), true, `strict: ${message}`)
  }
  for (const message of [
    'Built with Gemini bindings',
    'Made with the OpenAI SDK',
    'Made by Anthropic, priced per token',
    'Built with Gemini 2.5 Flash on 200 prompts',
    'Built with Cursor for the editor tests',
    'Tested with Gemini 2.5 Flash on 200 prompts',
    'Built with Gemini, and bindings are generated from the SDK',
    'Built with Gemini, and the SDK is documented',
  ]) {
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
})

test('a product that has AI features, a person named like a generic agent, and a tool name used for what it also means, pass', () => {
  for (const message of [
    'fix: guard the AI provider timeout',
    'feat: add AI usage metering',
    'feat: the AI module',
    'Co-authored-by: Ai Lin <a@b.c>',
    'docs: reviewed by the AI team',
    'feat: plans generated by AI for each athlete',
    'docs: spec for AI-guided training with AI-generated plans',
    'feat: the AI-generated summary card',
    'feat: a summary generated by AI for each athlete',
    'feat: built with Gemini bindings',
    'feat: written with cursor pagination',
    'feat: paginated with cursor-based offsets',
    'feat: Gemini pricing table',
    'feat: code generated by the tokenizer',
    'feat: tests written with jest',
    'docs: text rendered by cursor',
    'feat: ele ia para a tela inicial',
  ]) {
    assert.equal(strict.test(message), false, `strict: ${message}`)
    assert.equal(narrow.test(message), false, `narrow: ${message}`)
  }
})

test('a factual mention of a pull request bot is not an attribution', () => {
  for (const message of [
    'fix: address review feedback from Copilot bot',
    'chore: the Gemini bot comments were resolved',
    'docs: how the Cursor bot is configured',
  ]) {
    assert.equal(strict.test(message), false, message)
    assert.equal(narrow.test(message), false, message)
  }
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
    'feat: the Claude Agent SDK client',
    'chore: bump claude-agent-sdk',
    'docs: OpenAI assistant api prices',
    'feat: a Gemini agent adapter',
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
    'feat: address Copilot review comments',
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

test('the caller template the family check compares equals the starter workflow, byte for byte', () => {
  const starter = readFileSync(
    new URL('../../workflow-templates/no-ai-attribution.yml', import.meta.url),
    'utf8',
  )
  const copy = readFileSync(
    new URL(
      '../../script-templates/no-ai-attribution-caller/no-ai-attribution.yml',
      import.meta.url,
    ),
    'utf8',
  )
  assert.equal(copy, starter)
})

test('the caller template names the reusable workflow at @v1 and carries the four pull_request types', () => {
  const copy = readFileSync(
    new URL(
      '../../script-templates/no-ai-attribution-caller/no-ai-attribution.yml',
      import.meta.url,
    ),
    'utf8',
  )
  assert.match(copy, /uses: bymaxone\/\.github\/\.github\/workflows\/no-ai-attribution\.yml@v1/)
  assert.match(copy, /types: \[opened, edited, synchronize, reopened\]/)
  assert.match(copy, /pull-requests: read/)
})
