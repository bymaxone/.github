// Tests for the shape of no-ai-attribution.yml: what it may read, what it may be granted, and that no text of a
// pull request is ever written into a script body.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
