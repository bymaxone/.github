// Tests for the AI-attribution patterns: the case table against both profiles, and the two organisation
// rulesets against the patterns file, so the three copies of one pattern cannot drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

test('the caller template the family check compares equals the starter workflow, byte for byte', () => {
  const starter = readFileSync(new URL('../../workflow-templates/no-ai-attribution.yml', import.meta.url), 'utf8');
  const copy = readFileSync(new URL('../../script-templates/no-ai-attribution-caller/no-ai-attribution.yml', import.meta.url), 'utf8');
  assert.equal(copy, starter);
});

test('the caller template names the reusable workflow at @v1 and carries the four pull_request types', () => {
  const copy = readFileSync(new URL('../../script-templates/no-ai-attribution-caller/no-ai-attribution.yml', import.meta.url), 'utf8');
  assert.match(copy, /uses: bymaxone\/\.github\/\.github\/workflows\/no-ai-attribution\.yml@v1/);
  assert.match(copy, /types: \[opened, edited, synchronize, reopened\]/);
  assert.match(copy, /pull-requests: read/);
});
