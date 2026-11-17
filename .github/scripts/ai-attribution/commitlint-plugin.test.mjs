// Tests for the commitlint plugin template: the rule against the case table of the patterns file, the profile
// choice, and that the strings embedded in the plugin equal the patterns file, so the copies cannot drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const PLUGIN = fileURLToPath(new URL('../../script-templates/commitlint-no-ai-attribution/commitlint-no-ai-attribution.cjs', import.meta.url));
const patterns = JSON.parse(readFileSync(fileURLToPath(new URL('../../ai-attribution/patterns.json', import.meta.url)), 'utf8'));
const plugin = require(PLUGIN);

/** The result of the rule of `profile` for one message. */
const check = (profile, message) => plugin.build(profile).rules['no-ai-attribution']({ raw: message });

test('the strings embedded in the plugin equal the patterns file', () => {
  assert.equal(plugin.patterns.strict, patterns.strict);
  assert.equal(plugin.patterns.narrow, patterns.narrow);
});

test('every case of the table is accepted or refused as stated, by each profile', () => {
  for (const { name, message, strictRejects, narrowRejects } of patterns.cases) {
    assert.equal(check('strict', message)[0], !strictRejects, `strict: ${name}`);
    assert.equal(check('narrow', message)[0], !narrowRejects, `narrow: ${name}`);
  }
});

test('a refusal carries a message that names what matched and says to reword', () => {
  const [valid, message] = check('strict', 'feat: x\n\nGenerated with Claude Code');
  assert.equal(valid, false);
  assert.match(message, /Generated with Claude/);
  assert.match(message, /reword/i);
});

test('what matched is shown on one line, even when the match spans a line break', () => {
  const [valid, message] = check('narrow', 'feat: x\n\nClaude\n+\nCodex');
  assert.equal(valid, false);
  assert.doesNotMatch(message, /[\n\r]/);
  assert.match(message, /Claude \+ Codex/);
});

test('commitlint own view of the message is read when it gives one, and the raw text is not', () => {
  const rule = plugin.rules['no-ai-attribution'];
  const raw = 'fix: x\n\n# note: codex is not the author\n# modified: docs/claude-guide.md\n';
  assert.equal(rule({ raw, header: 'fix: x', body: null, footer: null })[0], true);
  assert.equal(rule({ raw, header: 'fix: x', body: 'a body', footer: 'Co-Authored-By: Claude <a@b.c>' })[0], false);
  assert.equal(rule({ raw: 'x', header: 'feat: Generated with Claude Code' })[0], false);
});

test('without a parsed view the raw text is read whole up to the exact scissors line', () => {
  const scissors = '# ------------------------ >8 ------------------------';
  const verbose = `fix: x\n\n${scissors}\ndiff --git a/a b/a\n+use claude here\n`;
  assert.equal(check('strict', verbose)[0], true);
  assert.equal(check('strict', 'fix: x\n\n# note: codex is not the author\n')[0], false);
  assert.equal(check('strict', 'fix: x\n\n# Reviewed by Claude\n')[0], false);
  assert.equal(check('strict', 'fix: x\n\n# --- >8 ---\nCo-Authored-By: Claude <a@b.c>\n')[0], false);
  assert.equal(check('strict', `fix: x\n\n${scissors}\nCo-Authored-By: Claude <a@b.c>\n`)[0], true);
});

test('the rule has an always form only: a never form is refused instead of read as always', () => {
  const rule = plugin.rules['no-ai-attribution'];
  assert.equal(rule({ raw: 'feat: fine' }, 'always')[0], true);
  assert.throws(() => rule({ raw: 'feat: fine' }, 'never'), /always/);
});

test('a line or paragraph separator inside what matched does not split the shown text either', () => {
  const [valid, message] = check('strict', 'feat: x\n\n\u{1F916}\u2028Generated with Claude');
  assert.equal(valid, false);
  assert.doesNotMatch(message, /[\n\r\u2028\u2029\u0085]/);
});

test('the default export is the strict profile and a message with nothing to read is accepted', () => {
  assert.equal(plugin.rules['no-ai-attribution']({ raw: "feat(prices): add claude-opus pricing" })[0], false);
  assert.equal(plugin.rules['no-ai-attribution']({ raw: '' })[0], true);
  assert.equal(plugin.rules['no-ai-attribution']({})[0], true);
});

test('a profile that is neither strict nor narrow is refused when the plugin is built', () => {
  assert.throws(() => plugin.build('loose'), /strict or narrow/);
});

test('the plugin is a plugin object: rules only, usable as commitlint plugins entry', () => {
  assert.deepEqual(Object.keys(plugin.rules), ['no-ai-attribution']);
  assert.equal(typeof plugin.build, 'function');
});
