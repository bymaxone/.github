// Tests the rule of the release-template family check against fixtures cut from the template itself,
// so the template and the check cannot disagree, and the cases an adopter copy can drift into.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkRelease, jobBlocks, pinnedSha, releaseJobs, stepBlocks } from './check-release.mjs';
import { checkFamily, readList, report } from './check-family.mjs';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const template = read('.github/workflow-templates/npm-release.yml');
const SHA = pinnedSha(template);
const STEP = /^ {6}- name: Harden runner\n(?: {8}[^\n]*\n)+\n?/m;

/** The text of one job of `text`, for surgery on a single job. */
const jobText = (text, id) => {
  const start = text.indexOf(`\n  ${id}:\n`) + 1;
  const rest = text.slice(start + 1);
  const next = rest.search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return { start, end: next === -1 ? text.length : start + 1 + next + 1 };
};
const editJob = (text, id, fn) => {
  const { start, end } = jobText(text, id);
  return text.slice(0, start) + fn(text.slice(start, end)) + text.slice(end);
};

test('the template itself satisfies the rule it publishes', () => {
  assert.match(SHA, /^[0-9a-f]{40}$/);
  assert.deepEqual(checkRelease(template, SHA), []);
  assert.deepEqual(releaseJobs(template).map((j) => j.id), ['build', 'publish']);
});

// Adopters keep or trim the step's comment (a repository's own comments rule can ask for it), so the
// rule may not read comment text: the same template without a single comment line passes, and so does
// one whose step comment is replaced by a different one.
test('the rule does not depend on the text of any comment', () => {
  const bare = template.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.deepEqual(checkRelease(bare, SHA), []);
  const reworded = template.replace(/(\n {8}# Egress is audited[^\n]*\n(?: {8}#[^\n]*\n)*)/g, '\n        # Some other wording entirely.\n');
  assert.notEqual(reworded, template);
  assert.deepEqual(checkRelease(reworded, SHA), []);
});

test('the parser sees the template as two jobs whose first step is the harden-runner', () => {
  const jobs = jobBlocks(template);
  assert.deepEqual(jobs.map((j) => j.id), ['build', 'publish']);
  for (const job of jobs) assert.match(stepBlocks(job)[0], /- name: Harden runner\n[\s\S]*uses: step-security\/harden-runner@/);
});

test('a job without the step is reported as missing', () => {
  const text = editJob(template, 'publish', (job) => job.replace(STEP, ''));
  assert.deepEqual(checkRelease(text, SHA), [{ job: 'publish', code: 'missing' }]);
});

// nest-queue's release.yml had it second in `build`, after "Require a version tag".
test('the step after another step is reported as not first', () => {
  const text = editJob(template, 'build', (job) => {
    const step = STEP.exec(job)[0];
    const without = job.replace(STEP, '');
    const at = without.indexOf('      - name: Checkout\n');
    return without.slice(0, at) + step + without.slice(at);
  });
  assert.deepEqual(checkRelease(text, SHA), [{ job: 'build', code: 'not-first' }]);
});

test('a publish job renamed but still holding id-token: write is caught through the id-token clause', () => {
  const renamed = template.replace('\n  publish:\n', '\n  release:\n').replace('needs: build', 'needs: build');
  assert.deepEqual(checkRelease(renamed, SHA), [], 'renamed with the step in place: fine');
  const stripped = editJob(renamed, 'release', (job) => job.replace(STEP, ''));
  assert.deepEqual(checkRelease(stripped, SHA), [{ job: 'release', code: 'missing' }]);
});

test('a job that is neither build, publish nor holding id-token is not a release job', () => {
  const extra = `${template.trimEnd()}\n\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Lint\n        run: echo lint\n`;
  assert.deepEqual(checkRelease(extra, SHA), []);
  assert.deepEqual(releaseJobs(extra).map((j) => j.id), ['build', 'publish']);
});

test('a tag instead of a commit, a stale commit and a wrong policy each have their own code', () => {
  const tag = template.replace(new RegExp(`@${SHA} # v2\\.22\\.4`, 'g'), '@v2.22.4');
  assert.deepEqual(checkRelease(tag, SHA).map((p) => p.code), ['not-pinned', 'not-pinned']);
  assert.deepEqual(checkRelease(template, 'f'.repeat(40)).map((p) => p.code), ['stale-sha', 'stale-sha']);
  const block = template.replace(/egress-policy: audit/g, 'egress-policy: block');
  assert.deepEqual(checkRelease(block, SHA).map((p) => p.code), ['wrong-policy', 'wrong-policy']);
});

test('a version comment is required next to the commit', () => {
  const bare = template.replace(new RegExp(`@${SHA} # v2\\.22\\.4`, 'g'), `@${SHA}`);
  assert.deepEqual(checkRelease(bare, SHA).map((p) => p.code), ['not-pinned', 'not-pinned']);
});

test('a file with no job holding id-token has no release jobs, and a release job without steps is reported', () => {
  assert.deepEqual(checkRelease('name: x\njobs:\n  build:\n    steps:\n      - run: echo\n', SHA), [{ job: '-', code: 'no-release-jobs' }]);
  const empty = 'name: x\njobs:\n  publish:\n    permissions:\n      id-token: write\n    runs-on: ubuntu-latest\n';
  assert.deepEqual(checkRelease(empty, SHA), [{ job: 'publish', code: 'no-steps' }]);
});

test('the adopter list parses, rejects anything that is not owner/name, and names real repositories only', () => {
  assert.deepEqual(readList('# c\n\nbymaxone/nest-auth # x\nbymaxone/nest-core\n'), ['bymaxone/nest-auth', 'bymaxone/nest-core']);
  assert.throws(() => readList('bymaxone/nest-auth\nnot a repo\n'));
  assert.throws(() => readList('bymaxone/x\n::error::y\n'));
  const repos = readList(read('.github/release-adopters.txt'));
  assert.ok(repos.length > 0);
  assert.equal(new Set(repos).size, repos.length, 'no repository twice');
});

test('the family walk reads each repository at the commit its default branch points to and prints that commit', () => {
  const calls = [];
  const fetch = (args) => {
    calls.push(args.join(' '));
    const url = args[1];
    if (url === 'repos/o/good') return 'main\n';
    if (url === 'repos/o/good/commits/main') return `${'a'.repeat(40)}\n`;
    if (url.startsWith('repos/o/good/contents/')) return template;
    if (url === 'repos/o/bad') return 'trunk\n';
    if (url === 'repos/o/bad/commits/trunk') return `${'b'.repeat(40)}\n`;
    if (url.startsWith('repos/o/bad/contents/')) return editJob(template, 'publish', (job) => job.replace(STEP, ''));
    if (url === 'repos/o/norelease') return 'main\n';
    if (url === 'repos/o/norelease/commits/main') return `${'c'.repeat(40)}\n`;
    throw new Error('404');
  };
  const results = checkFamily(['o/good', 'o/bad', 'o/norelease', 'o/gone'], SHA, fetch);
  assert.deepEqual(results.map((r) => [r.repo, r.problems.map((p) => `${p.job}:${p.code}`)]), [
    ['o/good', []],
    ['o/bad', ['publish:missing']],
    ['o/norelease', ['-:no-release-file']],
    ['o/gone', ['-:unreadable']],
  ]);
  assert.ok(calls.some((c) => c.includes(`contents/.github/workflows/release.yml?ref=${'a'.repeat(40)}`)), 'the file is read at the commit, not at the branch');
  const text = report(results, SHA);
  assert.match(text, new RegExp(`o/good @ ${'a'.repeat(40)}: ok`));
  assert.match(text, new RegExp(`o/bad @ ${'b'.repeat(40)}: publish:missing`));
  assert.match(text, /o\/gone @ -: -:unreadable/);
});
