// Guards the one block of mutation-full.yml that exists twice. Layer: CI tooling.
//
// The step that decides whether anything can have moved the score lives in the single job and,
// copied, in the plan job: a reusable workflow cannot share a step between two jobs without
// moving it into a composite action, and that move changes the single job every caller runs
// today. A copy that drifts is a plan job that skips (or runs) a week the single job would not,
// so the two texts must be identical. When they are, this passes; when someone edits one, this is
// the red check that says to edit the other.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../workflows/mutation-full.yml', import.meta.url), 'utf8');

/** Every step whose name starts with `name`, as text, up to the next step of the same job. */
function stepsNamed(name) {
  const lines = workflow.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== `      - name: ${name}`) continue;
    let end = i + 1;
    while (end < lines.length && !/^ {6}- /.test(lines[end]) && !/^ {2}\S/.test(lines[end])) end += 1;
    found.push(lines.slice(i, end).join('\n').trimEnd());
  }
  return found;
}

test('the decide step is identical in the single job and the plan job', () => {
  const copies = stepsNamed('Decide whether anything can have moved the score');
  assert.equal(copies.length, 2, 'one copy per job that decides');
  assert.ok(copies[0].includes('git diff --quiet'), 'the extraction found the whole step');
  assert.equal(copies[1], copies[0]);
});

// A push the self-test reacts to must also be a change the reusable's decide step counts as able to
// move the score. Otherwise the plan skips, no report is uploaded, and the self-test's compare job
// fails on an edit to the self-test itself.
test('every path that triggers the self-test is covered by the score-paths it passes', () => {
  const selftest = readFileSync(new URL('../../workflows/mutation-full-selftest.yml', import.meta.url), 'utf8');
  const pushBlock = selftest.slice(selftest.indexOf('  push:'), selftest.indexOf('permissions:'));
  const triggers = [...pushBlock.matchAll(/^ {6}- (\S+)$/gm)].map((m) => m[1].replace(/\/\*\*$/, ''));
  const scoreBlock = selftest.slice(selftest.indexOf('score-paths: >-'), selftest.indexOf('\n\n', selftest.indexOf('score-paths: >-')));
  const scorePaths = scoreBlock.split('\n').slice(1).join(' ').split(/\s+/).filter(Boolean).map((p) => p.replace(/\/$/, ''));
  assert.ok(triggers.length > 0 && scorePaths.length > 0, 'both lists were found');
  const uncovered = triggers.filter((t) => !scorePaths.some((s) => t === s || t.startsWith(`${s}/`)));
  assert.deepEqual(uncovered, []);
});

// A finished shard must keep its numbers and must not be failed by writing them. The summary is
// its own best-effort step, before the first upload, and it keeps score.mjs from also appending to
// the summary (which would print the line twice).
test('the shard summary is a best-effort step before the upload and writes the score once', () => {
  const [summary] = stepsNamed("Write this shard's score and counts to the summary");
  assert.ok(summary, 'the summary step exists');
  assert.match(summary, /continue-on-error: true/);
  assert.match(summary, /env -u GITHUB_STEP_SUMMARY node "\$tools\/score\.mjs"/);
  assert.ok(workflow.indexOf(summary) < workflow.indexOf("      - name: Upload this shard's report\n"));
});

// A mutant killed by an `it.each` row under its unformatted title is recorded in a single run's
// file by that title, which Stryker cannot match to a test, so the single run's file reuses fewer
// results than the merged one. The self-test accepts exactly that difference and nothing else.
test('the self-test expects the merged file to reuse the single run\'s results plus the unmatched ones, exactly', () => {
  const selftest = readFileSync(new URL('../../workflows/mutation-full-selftest.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(selftest, /^\s*diff control\.reuse sharded\.reuse$/m);
  assert.doesNotMatch(selftest, / -ge /);
  assert.match(selftest, /compare\.mjs --unmatched control\/stryker-incremental\.json/);
  assert.match(selftest, /test "\$\(reused sharded\.reuse\)" -eq "\$\(\( \$\(reused control\.reuse\) \+ extra \)\)"/);
});
