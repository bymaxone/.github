// Tests for the comment-scan steps of script-family-check.yml: they run after a failed comparison, they read the
// organisation's public repositories through the API, and a hit never fails the job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const text = readFileSync(join(ROOT, '.github/workflows/script-family-check.yml'), 'utf8');
const lines = text.split('\n');

/** The `run` block of the step named `name`, as script text, and the lines of the whole step. */
function step(name) {
  const start = lines.findIndex((line) => line.includes(`- name: ${name}`));
  assert.notEqual(start, -1, name);
  let end = lines.findIndex((line, i) => i > start && /^ {6}- /.test(line));
  if (end === -1) end = lines.length;
  const body = lines.slice(start, end);
  const at = body.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  assert.notEqual(at, -1, `the run block of ${name}`);
  const indent = body[at + 1].search(/\S/);
  return { script: body.slice(at + 1).map((line) => line.slice(indent)).join('\n'), body: body.join('\n') };
}

test('both steps run even when the comparison before them failed, which it does by design until every adopter lands', () => {
  assert.match(step('Collect the comments of the last week').body, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(step('Scan the comments for an AI attribution').body, /if: \$\{\{ !cancelled\(\) \}\}/);
});

test('the job holds read access only and the scan steps put no expression of the event into a script', () => {
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(text, /: write/);
  for (const name of ['Collect the comments of the last week', 'Scan the comments for an AI attribution']) {
    assert.doesNotMatch(step(name).script, /\$\{\{/, name);
  }
});

/** Runs the collect step with a stand-in `gh` that serves two repositories and their comments. */
function collect({ failRepo = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  mkdirSync(join(dir, 'bin'));
  const comments = {
    'a/issues/comments': [{ html_url: 'https://github.com/bymaxone/a/pull/1#c1', user: { login: 'dev', type: 'User' }, body: 'Generated with Claude Code' }],
    'a/pulls/comments': [{ html_url: 'https://github.com/bymaxone/a/pull/1#r1', user: { login: 'review-bot[bot]', type: 'Bot' }, body: 'Codex review finding' }],
    'b/issues/comments': [],
    'b/pulls/comments': [{ html_url: 'https://github.com/bymaxone/b/pull/2#r2', user: { login: 'dev2', type: 'User' }, body: 'looks good' }],
  };
  writeFileSync(join(dir, 'comments.json'), JSON.stringify(comments));
  writeFileSync(
    join(dir, 'bin', 'gh'),
    `#!/bin/sh
case "$*" in
  *orgs/bymaxone/repos*) printf 'bymaxone/a\\nbymaxone/b\\n' ;;
  *repos/bymaxone/${failRepo || 'none'}/*) exit 1 ;;
  *repos/bymaxone/a/issues/comments*) node -e "console.log(JSON.stringify(require('${dir}/comments.json')['a/issues/comments']))" ;;
  *repos/bymaxone/a/pulls/comments*) node -e "console.log(JSON.stringify(require('${dir}/comments.json')['a/pulls/comments']))" ;;
  *repos/bymaxone/b/issues/comments*) echo '[]' ;;
  *repos/bymaxone/b/pulls/comments*) node -e "console.log(JSON.stringify(require('${dir}/comments.json')['b/pulls/comments']))" ;;
esac
`,
    { mode: 0o755 },
  );
  chmodSync(join(dir, 'bin', 'gh'), 0o755);
  writeFileSync(join(dir, 'env'), '');
  const result = spawnSync('bash', ['-c', step('Collect the comments of the last week').script], {
    encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: dir, GITHUB_ENV: join(dir, 'env'), GH_TOKEN: 'x' },
  });
  let items = null;
  try {
    items = JSON.parse(readFileSync(join(dir, 'comments.json.out'), 'utf8'));
  } catch {
    // the step writes comments.json under RUNNER_TEMP, read below
  }
  try {
    items = JSON.parse(readFileSync(join(dir, 'comments.json'), 'utf8'));
  } catch {
    items = null;
  }
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, items };
}

test('the collect step reads the issue comments and the review replies of every public repository into one list', () => {
  const result = collect();
  assert.equal(result.status, 0, result.out);
  assert.ok(Array.isArray(result.items), 'the step writes a list');
  assert.deepEqual(result.items.map((c) => [c.repo, c.author, c.authorType]).sort(), [
    ['bymaxone/a', 'dev', 'User'],
    ['bymaxone/a', 'review-bot[bot]', 'Bot'],
    ['bymaxone/b', 'dev2', 'User'],
  ]);
  assert.equal(result.items.find((c) => c.author === 'dev').url, 'https://github.com/bymaxone/a/pull/1#c1');
});

test('a repository whose comments cannot be read is a warning, not a failure of the step', () => {
  const result = collect({ failRepo: 'b' });
  assert.equal(result.status, 0, result.out);
  assert.match(result.out, /::warning title=attribution-scan::could not read/);
});
