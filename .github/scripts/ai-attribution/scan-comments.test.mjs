// Tests for scan-comments.mjs: which comments are read, what a hit prints, that the output carries no text of a
// comment as a workflow command, and that a hit is a warning and never a failure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanComments } from './scan-comments.mjs';
import { readFileSync } from 'node:fs';

const PATTERNS_PATH = fileURLToPath(new URL('../../ai-attribution/patterns.json', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./scan-comments.mjs', import.meta.url));
const patterns = JSON.parse(readFileSync(PATTERNS_PATH, 'utf8'));

const comment = (over = {}) => ({
  repo: 'bymaxone/nest-auth',
  url: 'https://github.com/bymaxone/nest-auth/pull/1#issuecomment-1',
  author: 'someone',
  authorType: 'User',
  body: 'looks good',
  ...over,
});

/** Runs the command with `items` on standard input. */
function run(items, ...args) {
  const input = typeof items === 'string' ? items : JSON.stringify(items);
  const result = spawnSync(process.execPath, [SCRIPT, '--patterns', PATTERNS_PATH, ...args], { input, encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test('a comment that names a tool as its author or reviewer is a hit, with its link', () => {
  const hits = scanComments([comment({ body: 'Reviewed by Claude, no findings' }), comment({ url: 'u2', body: 'fine' })], patterns);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].url, 'https://github.com/bymaxone/nest-auth/pull/1#issuecomment-1');
});

test('a comment written by a bot is not read: the bots name themselves', () => {
  assert.deepEqual(scanComments([comment({ authorType: 'Bot', author: 'review-bot[bot]', body: 'Codex review finding P2' })], patterns), []);
});

test('the profile follows the repository: a model name passes in a narrow repository and not in a strict one', () => {
  const body = 'the claude-opus price moved';
  assert.equal(scanComments([comment({ repo: 'bymaxone/nest-ai-tokens', body })], patterns).length, 0);
  assert.equal(scanComments([comment({ repo: 'bymaxone/nest-auth', body })], patterns).length, 1);
});

test('the command exits 0 with a warning per hit and a summary, and exits 0 when nothing is found', () => {
  const none = run([comment()]);
  assert.equal(none.status, 0);
  assert.match(none.out, /No AI attribution in 1 comment/);
  const hit = run([comment({ body: 'Generated with Claude Code' })]);
  assert.equal(hit.status, 0);
  assert.match(hit.out, /^::warning title=no-ai-attribution::/m);
  assert.match(hit.out, /issuecomment-1/);
});

test('the command exits 2 on input it cannot read', () => {
  assert.equal(run('not json').status, 2);
  assert.equal(run({ not: 'a list' }).status, 2);
  assert.equal(spawnSync(process.execPath, [SCRIPT], { input: '[]', encoding: 'utf8' }).status, 2);
});

test('the text of a comment never starts a workflow command in the output', () => {
  const hostile = comment({ author: 'x\n::error::injected', url: 'https://x/y\n::set-output name=a::b', body: '::error::injected\nCo-Authored-By: Claude <a@b.c>' });
  const result = run([hostile]);
  assert.equal(result.status, 0);
  for (const line of result.out.split('\n')) {
    if (line.startsWith('::')) assert.match(line, /^::warning title=no-ai-attribution::[^\r\n]*$/);
  }
  assert.doesNotMatch(result.out, /^::error::injected|^::set-output/m);
});

test('the summary lists each hit as a markdown link line and counts them', () => {
  const result = run([comment({ body: 'Co-Authored-By: Claude <a@b.c>' }), comment({ url: 'https://github.com/bymaxone/nest-auth/pull/2#r2', author: 'dev', body: 'noreply@anthropic.com' })], '--summary');
  assert.match(result.out, /2 comment\(s\) name an AI tool/);
  assert.match(result.out, /\| bymaxone\/nest-auth \| dev \| https:\/\/github\.com\/bymaxone\/nest-auth\/pull\/2#r2 \|/);
});
