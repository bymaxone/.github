// Tests for the shape of no-ai-attribution.yml: what it may read, what it may be granted, and that no text of a
// pull request is ever written into a script body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const text = readFileSync(fileURLToPath(new URL('../../workflows/no-ai-attribution.yml', import.meta.url)), 'utf8');
const lines = text.split('\n');

/** The lines of every `run: |` block of the workflow, with the line number. */
function runBlocks() {
  const blocks = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)run: \|\s*$/.exec(lines[i]);
    if (match === null) continue;
    const indent = match[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j += 1) body.push([j + 1, lines[j]]);
    blocks.push(body);
  }
  return blocks;
}

test('no expression is written into a script body: every value reaches a script through the environment', () => {
  const blocks = runBlocks();
  assert.equal(blocks.length, 3);
  for (const block of blocks) {
    for (const [number, line] of block) assert.doesNotMatch(line, /\$\{\{/, `line ${number}`);
  }
});

test('the workflow asks for read access only and runs on a pull request only', () => {
  assert.match(text, /^permissions:\n  contents: read\n/m);
  assert.match(text, /^    permissions:\n      contents: read\n      pull-requests: read\n/m);
  assert.doesNotMatch(text, /(contents|pull-requests|issues|actions|checks|statuses): write/);
  assert.match(text, /if: github\.event_name == 'pull_request'/);
  assert.doesNotMatch(text, /pull_request_target/);
});

test('the patterns and the script are read at this workflow\'s own commit and nothing is checked out', () => {
  assert.match(text, /job\.workflow_sha/);
  assert.match(text, /\^\[0-9a-f\]\{40\}\$/);
  assert.doesNotMatch(text, /uses:\s/);
  assert.match(text, /tarball\/\$WORKFLOW_SHA/);
});

test('the title and the body are read from the environment into a JSON file by jq arguments', () => {
  assert.match(text, /PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/);
  assert.match(text, /PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/);
  assert.match(text, /--arg title "\$PR_TITLE" --arg body "\$PR_BODY"/);
});

/** The `run` block of the step named `name`, as a script text. */
function stepScript(name) {
  const start = lines.findIndex((line) => line.includes(`- name: ${name}`));
  assert.notEqual(start, -1, name);
  const blocks = runBlocks();
  const at = lines.findIndex((line, i) => i > start && /^\s*run: \|\s*$/.test(line));
  const block = blocks.find((b) => b[0][0] === at + 2);
  assert.ok(block, `the run block of ${name}`);
  const indent = block[0][1].search(/\S/);
  return block.map(([, line]) => line.slice(indent)).join('\n');
}

/**
 * Runs the collect step with a stand-in `gh` that serves `pages` (each a list of commits as the API shapes them)
 * and applies the step's own `--jq` expression to each page with `jq`, as `gh --paginate --jq` does. Returns the
 * exit status, the output and the items file the step wrote.
 */
function collect({ pages, count, title = 'feat: x', body = 'a body' }) {
  const dir = mkdtempSync(join(tmpdir(), 'collect-'));
  mkdirSync(join(dir, 'bin'));
  pages.forEach((page, index) => writeFileSync(join(dir, `page-${index}.json`), JSON.stringify(page)));
  writeFileSync(
    join(dir, 'bin', 'gh'),
    `#!/bin/sh\nwhile [ "$#" -gt 0 ]; do [ "$1" = --jq ] && expr="$2"; shift; done\nfor page in "${dir}"/page-*.json; do jq -c "$expr" "$page"; done\n`,
    { mode: 0o755 },
  );
  writeFileSync(join(dir, 'env'), '');
  const result = spawnSync('bash', ['-c', stepScript('Collect the title, the body and the commit messages')], {
    encoding: 'utf8',
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      GITHUB_ENV: join(dir, 'env'),
      GH_TOKEN: 'x',
      REPOSITORY: 'o/r',
      PR_NUMBER: '1',
      PR_TITLE: title,
      PR_BODY: body,
      PR_COMMITS: String(count),
    },
  });
  const itemsPath = join(dir, 'ai-attribution-items.json');
  const items = existsSync(itemsPath) ? JSON.parse(readFileSync(itemsPath, 'utf8')) : null;
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, items };
}

/** A commit as the pull-request commits endpoint shapes it. */
const commit = (sha, message, parents = 1) => ({
  sha: sha.padEnd(40, '0'),
  commit: { message },
  parents: Array.from({ length: parents }, (_, i) => ({ sha: String(i).padEnd(40, '0') })),
});

test('the collect step builds the list from the title, the body and each commit, over every page', () => {
  const result = collect({ pages: [[commit('aaaaaaa', 'feat: one')], [commit('bbbbbbb', 'fix: two')], []], count: 2 });
  assert.equal(result.status, 0, result.out);
  assert.deepEqual(result.items.map((i) => i.where), ['title', 'body', 'commit aaaaaaa', 'commit bbbbbbb']);
  assert.equal(result.items[3].text, 'fix: two');
});

test('a pull request with more commits than the list holds fails the step instead of reading part of it', () => {
  const result = collect({ pages: [[commit('aaaaaaa', 'feat: one')]], count: 300 });
  assert.notEqual(result.status, 0);
  assert.match(result.out, /300 commits.*1/s);
});

test('a commit count that is missing or not a number fails the step', () => {
  for (const count of ['', 'many', '-1']) {
    const result = collect({ pages: [[commit('aaaaaaa', 'feat: one')]], count });
    assert.notEqual(result.status, 0, `count "${count}"`);
  }
});

/** The text the step puts in the list for each of `messages`, the ones in `merges` being merge commits. */
function texts(messages, merges = []) {
  const result = collect({
    pages: [messages.map((message, i) => commit(`c${i}`, message, merges.includes(i) ? 2 : 1))],
    count: messages.length,
  });
  assert.equal(result.status, 0, result.out);
  return result.items.slice(2).map((item) => item.text);
}

test('the first line of a merge written by git or by the web merge button names refs only, so it is not read', () => {
  const generated = [
    "Merge branch 'main' into claude/feature",
    "Merge branch 'claude/x' of github.com:o/r into main",
    "Merge remote-tracking branch 'origin/main' into feature",
    "Merge branches 'a' and 'claude-b'",
    "Merge tag 'v1.2.3' into release",
    'Merge pull request #12 from o/claude-md-update',
    "Merge branches 'a', 'claude-b' and 'c'",
    "Merge tag 'v1' of https://github.com/o/r into main",
    "Merge branch 'x' of git@github.com:o/r into claude/y",
    "Merge commit 'abc1234'",
    "Merge branch 'x' of https://github.com/o/r into claude/y",
    "Merge branch 'main' into claude/feature\r",
  ];
  assert.deepEqual(texts(generated, generated.map((_, i) => i)), generated.map(() => ''));
});

test('everything else in a merge commit is read: a hand-written first line, a line below the generated one', () => {
  const handWritten = [
    "Merge branch 'main' into feature: Co-Authored-By: Claude <a@b.c>",
    "Merge branch 'main' into x y",
    'Merge: the reviewer said so',
    'Merge pull request #12 from o/branch and a note',
    "Reviewed by the reviewer. Merge branch 'main' into x",
    "Merge branch 'Co-Authored-By: Claude <n@x.com>'",
    'Merge pull request #1 from noreply@anthropic.com',
    "Merge branch 'a' into x\tGenerated with Claude",
    "Merge branch 'a' of noreply@anthropic.com",
    "Merge branch 'a' into noreply@anthropic.com",
    "Merge tag 'v1' into noreply@anthropic.com",
    "Merge commit 'abc' into noreply@anthropic.com",
    "Merge branch 'a' into x, Co-authored-by: Claude",
  ];
  assert.deepEqual(texts(handWritten, handWritten.map((_, i) => i)), handWritten);
  const below = ["Merge branch 'main' into feature\n\nCo-Authored-By: Someone <a@b.c>"];
  assert.equal(texts(below, [0])[0], '\nCo-Authored-By: Someone <a@b.c>');
});

test('a commit that is not a merge is read whole, whatever its first line looks like', () => {
  const same = ["Merge branch 'main' into claude/feature", 'Revert "feat: x"\n\nThis reverts commit abc.', 'fixup! feat: one', 'squash! fix: two'];
  assert.deepEqual(texts(same), same);
});

test('an octopus merge and a merge with a blank first line are read by the same rule', () => {
  assert.deepEqual(texts([`Merge branches 'a', 'b' and 'c'\n\nnote`], [0]), ['\nnote']);
  assert.deepEqual(texts([`Merge octopus of a, b and c\n\nnote`], [0]), [`Merge octopus of a, b and c\n\nnote`]);
  assert.deepEqual(texts(['\n\nbody only'], [0]), ['\n\nbody only']);
});

test('a pull request with no commits and a body with quotes and line breaks still gives a valid list', () => {
  const result = collect({ pages: [[]], count: 0, body: 'says "hi"\nand \\ more\n' });
  assert.equal(result.status, 0, result.out);
  assert.equal(result.items[1].text, 'says "hi"\nand \\ more\n');
});
