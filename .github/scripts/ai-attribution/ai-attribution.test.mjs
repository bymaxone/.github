// Tests for the AI-attribution patterns: the case table against both profiles, and the two organisation
// rulesets against the patterns file, so the three copies of one pattern cannot drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from '../../ai-attribution/build-patterns.mjs';

const DIR = fileURLToPath(new URL('../../ai-attribution/', import.meta.url));
const read = (path) => JSON.parse(readFileSync(DIR + path, 'utf8'));
const patterns = read('patterns.json');

/**
 * The JavaScript form of a ruleset pattern: the leading `(?im)` becomes the `im` flags. The patterns use no
 * lookaround and no back-reference, so RE2 and a JavaScript engine read them alike.
 */
function compile(pattern) {
  assert.ok(pattern.startsWith('(?im)'), 'a pattern starts with (?im)');
  assert.doesNotMatch(pattern, /\(\?[<=!]|\\[1-9]/, 'a pattern uses nothing RE2 lacks');
  return new RegExp(pattern.slice('(?im)'.length), 'im');
}

const strict = compile(patterns.strict);
const narrow = compile(patterns.narrow);

test('every case of the table is rejected or passed as stated, by the strict and by the narrow profile', () => {
  assert.ok(patterns.cases.length >= 17);
  for (const { name, message, strictRejects, narrowRejects } of patterns.cases) {
    assert.equal(strict.test(message), strictRejects, `strict: ${name}`);
    assert.equal(narrow.test(message), narrowRejects, `narrow: ${name}`);
  }
});

test('the table holds the cases that decide the profiles: a file name, a bot trailer, a model id, a real trailer', () => {
  const byName = new Map(patterns.cases.map((c) => [c.name, c]));
  for (const name of ['CLAUDE.md file', 'dependabot trailer', 'claude-opus pricing', 'real trailer (claude)', 'real trailer (codex)']) {
    assert.ok(byName.has(name), name);
  }
  assert.equal(byName.get('CLAUDE.md file').strictRejects, false);
  assert.equal(byName.get('dependabot trailer').strictRejects, false);
  assert.equal(byName.get('claude-opus pricing').narrowRejects, false);
  assert.equal(byName.get('real trailer (claude)').narrowRejects, true);
});

test('the narrow profile is a subset of what the strict profile rejects, except for the review phrasings it adds', () => {
  const onlyNarrow = patterns.cases.filter((c) => c.narrowRejects && !c.strictRejects);
  assert.deepEqual(onlyNarrow, []);
});

const lists = read('lists.json');
const cap = (word) => word.charAt(0).toUpperCase() + word.slice(1);

test('every copy of the patterns equals what the lists build: the file, the two rulesets and the plugin', () => {
  const built = build(lists);
  assert.equal(patterns.strict, built.strict);
  assert.equal(patterns.narrow, built.narrow);
  assert.equal(read('rulesets/forbid-ai-attribution.json').rules[0].parameters.pattern, built.strict);
  assert.equal(read('rulesets/forbid-ai-attribution-narrow.json').rules[0].parameters.pattern, built.narrow);
});

test('the lists keep every tool and every verb the owner named, so removing one is a failure and not a quiet loss', () => {
  for (const tool of ['claude', 'anthropic', 'codex', 'openai', 'chatgpt', 'gpt', 'copilot', 'gemini', 'cursor', 'windsurf', 'devin', 'aider']) {
    assert.ok(lists.tools.includes(tool), tool);
  }
  for (const verb of ['generated', 'authored', 'co-authored', 'reviewed', 'assisted']) assert.ok(lists.verbs.includes(verb), verb);
  for (const verb of ['written', 'created', 'made']) assert.ok(lists.strictVerbs.includes(verb), verb);
});

test('every attribution phrasing names every tool: the verbs, the trailers and the other forms are refused by both profiles', () => {
  const misses = [];
  const refused = (profile, message, label) => {
    if (!(profile === 'strict' ? strict : narrow).test(message)) misses.push(`${profile}: ${label}`);
  };
  for (const tool of lists.tools) {
    const T = cap(tool);
    for (const verb of lists.verbs) {
      for (const connector of ['with', 'by']) {
        const message = `fix: x\n\n${cap(verb)} ${connector} ${T}`;
        for (const profile of ['strict', 'narrow']) refused(profile, message, message);
      }
    }
    for (const verb of lists.strictVerbs) refused('strict', `docs: ${verb} by ${T}`, `${verb} by ${T}`);
    for (const key of ['Co-authored-by', 'Signed-off-by', 'Authored-by', 'Reviewed-by', 'Assisted-by', 'Generated-by', 'Tested-by', 'Acked-by']) {
      for (const message of [`feat: x\n\n${key}: ${T} <a@b.c>`, `feat: x\n\n> ${key} : ${T}`]) {
        for (const profile of ['strict', 'narrow']) refused(profile, message, message);
      }
    }
    for (const message of [
      `feat: x with the help of ${T}`,
      `feat: x with help from ${T}`,
      `feat: x, thanks to ${T}`,
      `feat: x, courtesy of ${T}`,
      `feat: x\n\n\u{1F916} Generated ${T}`,
      `feat: x\n\nsee ${tool}[bot] notes`,
    ]) {
      for (const profile of ['strict', 'narrow']) refused(profile, message, message);
    }
  }
  for (const message of ['AI-generated', '(AI-assisted)', 'feat: x\n\n> Generated with AI.', '- ai assisted']) {
    for (const profile of ['strict', 'narrow']) refused(profile, message, message);
  }
  assert.deepEqual(misses, []);
});

test('the narrow profile still lets a vendor and a model through when nothing is attributed to it', () => {
  for (const message of [
    'feat(prices): add claude-opus pricing',
    'feat(prices): prices for models made by Anthropic and written by OpenAI',
    'chore(deps): bump openai from 4.0.0 to 5.0.0',
    'docs: the sdk of Anthropic keeps a price table',
  ]) {
    assert.equal(narrow.test(message), false, message);
  }
});

test('a tool name that is an ordinary word, and a sentence about AI, pass outside an attribution phrasing', () => {
  for (const message of [
    'docs: spec for AI-guided training with AI-generated plans',
    'feat: plans generated by AI for each athlete',
    'fix: the Cursor position after a paste',
    'docs: Gemini is a constellation',
    'feat: copilot seat of the pilot',
    'fix: the checked box state',
  ]) {
    assert.equal(strict.test(message), false, message);
  }
});

const RULESETS = [
  ['rulesets/forbid-ai-attribution.json', 'strict', (c) => ({ include: ['~ALL'], exclude: patterns.narrowRepos }) ],
  ['rulesets/forbid-ai-attribution-narrow.json', 'narrow', () => ({ include: patterns.narrowRepos, exclude: [] }) ],
];

for (const [file, profile, repos] of RULESETS) {
  test(`${file} carries the ${profile} pattern and the repositories of the patterns file`, () => {
    const ruleset = read(file);
    assert.equal(ruleset.target, 'branch');
    assert.deepEqual(ruleset.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
    const { include, exclude } = repos();
    assert.deepEqual(ruleset.conditions.repository_name.include, include);
    assert.deepEqual(ruleset.conditions.repository_name.exclude, exclude);
    assert.equal(ruleset.rules.length, 1);
    const [rule] = ruleset.rules;
    assert.equal(rule.type, 'commit_message_pattern');
    assert.equal(rule.parameters.negate, true);
    assert.equal(rule.parameters.operator, 'regex');
    assert.equal(rule.parameters.pattern, patterns[profile]);
    assert.ok(['evaluate', 'active'].includes(ruleset.enforcement));
  });
}
