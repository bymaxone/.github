// Tests for find-attribution.mjs: the module over the case table of the patterns file, the profile choice, and the
// command's exit status and output, which carries no text of a pull request as a workflow command.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findAttribution, profileFor } from './find-attribution.mjs';

const PATTERNS_PATH = fileURLToPath(new URL('../../ai-attribution/patterns.json', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./find-attribution.mjs', import.meta.url));
const patterns = JSON.parse(readFileSync(PATTERNS_PATH, 'utf8'));

/** Runs the command with `items` on standard input. */
function run(items, ...args) {
  const input = typeof items === 'string' ? items : JSON.stringify(items);
  const result = spawnSync(process.execPath, [SCRIPT, '--patterns', PATTERNS_PATH, ...args], { input, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test('every case of the table is found or passed as stated, by each profile', () => {
  for (const { name, message, strictRejects, narrowRejects } of patterns.cases) {
    assert.equal(findAttribution([{ where: 'title', text: message }], patterns, 'strict').length > 0, strictRejects, `strict: ${name}`);
    assert.equal(findAttribution([{ where: 'title', text: message }], patterns, 'narrow').length > 0, narrowRejects, `narrow: ${name}`);
  }
});

test('an offender names where it was found, and every item is read', () => {
  const found = findAttribution(
    [
      { where: 'title', text: 'feat: fine' },
      { where: 'body', text: 'Co-Authored-By: Claude <x@y.z>' },
      { where: 'commit abc1234', text: 'fix: the Codex said so' },
    ],
    patterns,
    'strict',
  );
  assert.deepEqual(found.map((f) => f.where), ['body', 'commit abc1234']);
});

test('the profile is chosen from the repository name unless one is requested', () => {
  assert.equal(profileFor(patterns, 'bymaxone/nest-auth', 'auto'), 'strict');
  assert.equal(profileFor(patterns, 'bymaxone/nest-ai-tokens', 'auto'), 'narrow');
  assert.equal(profileFor(patterns, 'bymaxone/bymax-agent-kit', ''), 'narrow');
  assert.equal(profileFor(patterns, 'bymaxone/nest-ai-tokens', 'strict'), 'strict');
  assert.equal(profileFor(patterns, 'bymaxone/nest-auth', 'narrow'), 'narrow');
  assert.throws(() => profileFor(patterns, 'bymaxone/nest-auth', 'loose'), /profile/);
});

test('a repository whose name only contains a narrow repository name is strict', () => {
  assert.equal(profileFor(patterns, 'bymaxone/nest-ai-tokens-extras', 'auto'), 'strict');
  assert.equal(profileFor(patterns, 'other/nest-ai-tokens', 'auto'), 'strict');
});

test('the command exits 0 on clean text, 1 on an offender and 2 on input it cannot read', () => {
  assert.equal(run([{ where: 'title', text: 'feat: fine' }], '--repo', 'bymaxone/nest-auth').status, 0);
  const bad = run([{ where: 'body', text: 'Generated with Claude Code' }], '--repo', 'bymaxone/nest-auth');
  assert.equal(bad.status, 1);
  assert.match(bad.out, /body/);
  assert.equal(run('not json', '--repo', 'bymaxone/nest-auth').status, 2);
  assert.equal(run({ not: 'a list' }, '--repo', 'bymaxone/nest-auth').status, 2);
  assert.equal(run([{ where: 'title', text: 'x' }], '--repo', 'bymaxone/nest-auth', '--profile', 'loose').status, 2);
  assert.equal(run([{ where: 'title', text: 'feat(prices): add claude-opus pricing' }]).status, 1, 'no repository means strict');
  assert.equal(spawnSync(process.execPath, [SCRIPT], { input: '[]', encoding: 'utf8' }).status, 2, 'no patterns file');
});

test('a merge commit that names a branch for a tool is refused, and the message says to rename the branch', () => {
  const result = run([{ where: 'commit abc1234', text: "Merge branch 'main' into claude/x" }], '--repo', 'bymaxone/nest-auth');
  assert.equal(result.status, 1);
  assert.match(result.out, /rename the branch/);
});

test('the text of a pull request never starts a workflow command in the output', () => {
  const hostile = '::error::injected\n::set-output name=x::y\r\n%0A Co-authored-by: Claude';
  const result = run([{ where: 'body', text: hostile }], '--repo', 'bymaxone/nest-auth');
  assert.equal(result.status, 1);
  for (const line of result.out.split('\n')) {
    if (line.startsWith('::')) assert.match(line, /^::error title=no-ai-attribution::[^\r\n]*$/);
  }
  assert.doesNotMatch(result.out, /::set-output|::error::injected/);
});

test('a line break inside what matched, or inside where it was found, does not split the output', () => {
  const split = run([{ where: 'commit x\n::error::injected', text: 'Claude\n+\nCodex reviewed' }], '--repo', 'bymaxone/nest-ai-tokens');
  assert.equal(split.status, 1);
  assert.match(split.out, /^  \| Claude \+ Codex$/m);
  assert.doesNotMatch(split.out, /^::error::injected/m);
  for (const line of split.out.split('\n')) {
    if (line.startsWith('::')) assert.match(line, /^::error title=no-ai-attribution::commit x ::error::injected names an AI tool/);
  }
});

test('an empty list of items passes, and the narrow profile lets a product word through', () => {
  assert.equal(run([], '--repo', 'bymaxone/nest-auth').status, 0);
  assert.equal(run([{ where: 'title', text: 'feat(prices): add claude-opus pricing' }], '--repo', 'bymaxone/nest-ai-tokens').status, 0);
  assert.equal(run([{ where: 'title', text: 'feat(prices): add claude-opus pricing' }], '--repo', 'bymaxone/nest-auth').status, 1);
});
