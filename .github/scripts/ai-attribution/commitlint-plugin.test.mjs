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
  const [valid, message] = check('narrow', 'feat: x\n\nreviewed by Claude\n+\nCodex');
  assert.equal(valid, false);
  assert.doesNotMatch(message, /[\n\r]/);
  assert.match(message, /Claude \+ Codex/);
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
