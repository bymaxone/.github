// Guards the one block of mutation-full.yml that exists twice. Layer: CI tooling.
//
// The step that decides whether anything can have moved the score lives in the single job and,
// copied, in the plan job: a reusable workflow cannot share a step between two jobs without
// moving it into a composite action, and that move changes the single job every caller runs
// today. A copy that drifts is a plan job that skips (or runs) a week the single job would not,
// so the two texts must be identical. When they are, this passes; when someone edits one, this is
// the red check that says to edit the other.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
  assert.match(selftest, /compare\.mjs --unmatched "\$RUNNER_TEMP\/control\/stryker-incremental\.json"/);
  assert.match(selftest, /test "\$\(reused "\$sreuse"\)" -eq "\$\(\( \$\(reused "\$creuse"\) \+ extra \)\)"/);
});

// The tooling and the downloaded artifacts must not sit inside the consumer's workspace. The
// aggregate runs the consumer's own unit suite there (the inventory) and every shard runs its dry
// run there, so any file the workflow adds is a file a test that walks the tree can count. Measured
// on nest-auth: an `actions/checkout` sparse-checkout is cone mode, which also brings every file at
// the root of this repository, and the consumer's AGENTS.md-size spec read ours on top of its own.
test('no step puts a file of ours inside the consumer workspace', () => {
  assert.doesNotMatch(workflow, /path: \.mutation-shards/, 'the tooling is fetched outside the workspace');
  assert.doesNotMatch(workflow, /sparse-checkout:/, 'cone mode would bring the root files too');
  assert.doesNotMatch(workflow, /repository: \$\{\{ job\.workflow_repository \}\}/, 'no checkout of this repository into a consumer job');
  const downloads = [...workflow.matchAll(/uses: actions\/download-artifact@[^\n]*\n {8}with:\n(?: {10}[^\n]*\n)*? {10}path: ([^\n]+)/g)].map((m) => m[1]);
  assert.ok(downloads.length === 3, 'every download step was found');
  assert.deepEqual(downloads.filter((p) => !p.startsWith('${{ runner.temp }}/')), []);
  assert.doesNotMatch(workflow, /--dir mutation-weights|--out mutation-plan\b|--plan mutation-plan\//, 'scripts read and write under the runner temp directory');
});

test('the tooling fetch is the same, and fails closed, in the plan, shard and aggregate jobs', () => {
  // The plan job's copy also carries the `if:` that skips it with the rest of that job.
  const copies = stepsNamed("Fetch the shard tooling from this workflow's own commit").map((c) => c.replace("        if: steps.changed.outputs.run == 'true'\n", ''));
  assert.equal(copies.length, 3, 'one copy per job that runs the tooling');
  assert.equal(copies[1], copies[0]);
  assert.equal(copies[2], copies[0]);
  const [fetch] = copies;
  assert.match(fetch, /repos\/\$WORKFLOW_REPOSITORY\/tarball\/\$WORKFLOW_SHA/, 'the exact commit, never a branch');
  assert.match(fetch, /--strip-components=1/);
  assert.match(fetch, /%\{http_code\}/);
  assert.match(fetch, /\[ "\$status" = 200 \]/, 'a non-200 answer stops the job');
  assert.match(fetch, /-n "\$GH_TOKEN"/, 'an empty token stops the job');
  assert.match(fetch, /for script in plan shard-config collect merge score; do/, 'every script the jobs run is required to exist after the extraction');
  assert.match(workflow, /Tooling commit: \$\{\{ job\.workflow_sha \}\}/, 'a run still says which code scored it');
});

test('reports/ stays in the workspace and says why', () => {
  assert.match(workflow, /`reports\/` stays at the\s+#\s+workspace path/);
});

// The fixture runs Jest with `enableFindRelatedTests`: a spec that imports none of the mutated
// files is left out of Stryker's dry run, so it never runs in a shard's workspace, and the
// inventory then finds a unit test the mutation run did not record. The workspace spec must
// therefore import every source file the fixture mutates.
test('the fixture workspace spec is related to every mutated source file', () => {
  const spec = readFileSync(new URL('../../../fixture/test/workspace.spec.js', import.meta.url), 'utf8');
  const sources = readdirSync(new URL('../../../fixture/src/', import.meta.url)).filter((f) => f.endsWith('.js'));
  assert.ok(sources.length >= 2, 'the sources were found');
  const unrelated = sources.filter((f) => !spec.includes(`require('../src/${f.replace(/\.js$/, '')}')`));
  assert.deepEqual(unrelated, []);
});

// The compare job runs Stryker in its workspace, and that run's dry run includes the fixture's
// workspace spec, which fails on any entry the repository does not have. What the job downloads and
// writes therefore lives under the runner temp directory, apart from `reports/`.
test('the self-test compare job keeps what it downloads and writes out of the workspace', () => {
  const selftest = readFileSync(new URL('../../workflows/mutation-full-selftest.yml', import.meta.url), 'utf8');
  const compare = selftest.slice(selftest.indexOf('  compare:'));
  const downloads = [...compare.matchAll(/path: (.+)/g)].map((m) => m[1]);
  assert.equal(downloads.length, 3, 'the three artifacts');
  assert.deepEqual(downloads.filter((p) => !p.startsWith('${{ runner.temp }}/')), []);
  assert.doesNotMatch(compare, /(?<![\w/"])reuse-\$2\.log|tee (?:control|sharded)\.reuse|\.\/plan\//, 'no log or result file lands in the workspace');
});

// The weights come from the newest completed run that left a report, not from the last green run:
// the first sharded runs of a library are red while it is still being fixed, and they are the only
// ones that have a report. Found on a real consumer, whose plan fell back to file sizes twice.
test('the plan fetches its weights through weights-run, not from the last successful run', () => {
  const [fetch] = stepsNamed("Fetch the last run's report, to weight the split");
  assert.ok(fetch, 'the step exists');
  assert.match(fetch, /node "\$MUTATION_TOOLS\/weights-run\.mjs"/);
  assert.doesNotMatch(fetch, /--status success/);
  assert.doesNotMatch(fetch, /gh run list/, 'the selection is the script\'s, which is tested');
});

/** The text of one job of the workflow, from its id line to the next job. */
function jobText(id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, `job ${id} exists`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const DEFAULT_BRANCH_ONLY = "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)";

// A dispatch on another ref used to skip every job: no score, no failure, which reads as fine. The
// guard job fails it instead, and the jobs that did the work keep their ids and check names.
test('a run on another ref fails in a guard job rather than skipping silently', () => {
  const guard = jobText('guard');
  assert.match(guard, /if: github\.ref != format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/);
  assert.match(guard, /::error title=mutation-full::/);
  assert.match(guard, /\n\s+exit 1\n/);
  assert.match(guard, /permissions: \{\}/);
  assert.ok(!/uses:/.test(guard), 'it runs no action and no repository code');
  // The value comes in through env and is cleaned before it reaches a workflow command.
  assert.match(guard, /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(guard, /tr -d '\\000-\\037\\177'/);
  assert.ok(!guard.includes('${{ github.ref'), 'the ref is not interpolated into the script');
});

test('every job that does the work still runs on the default branch only, so none can run beside the guard', () => {
  for (const id of ['full', 'plan', 'shard', 'aggregate']) {
    assert.ok(jobText(id).includes(DEFAULT_BRANCH_ONLY), `${id} is limited to the default branch`);
  }
});

test('the jobs and their check names are the ones callers already require', () => {
  const names = [...workflow.matchAll(/^ {2}([a-z][\w-]*):\n {4}name: (.+)$/gm)].map((m) => `${m[1]}=${m[2]}`);
  assert.deepEqual(names, [
    'guard=Default branch only',
    'full=Full mutation run',
    'plan=Plan mutation shards',
    'shard=Mutation shard',
    'aggregate=Aggregate mutation shards',
  ]);
});
