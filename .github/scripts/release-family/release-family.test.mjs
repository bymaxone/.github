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
  for (const job of jobs) assert.match(stepBlocks(job)[0].text, /- name: Harden runner\n[\s\S]*uses: step-security\/harden-runner@/);
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
  assert.deepEqual(checkRelease('name: x\njobs:\n  lint:\n    steps:\n      - run: echo\n', SHA), [{ job: '-', code: 'no-release-jobs' }]);
  const empty = 'name: x\njobs:\n  publish:\n    permissions:\n      id-token: write\n    runs-on: ubuntu-latest\n';
  assert.deepEqual(checkRelease(empty, SHA), [{ job: 'publish', code: 'no-steps' }]);
});

// Shapes of a real release.yml that the first parser read wrongly: some made it skip a job (a missed
// adopter, the failure this check exists to prevent), some made a valid file fail.
const bareJob = (id, steps, extra = '') =>
  `  ${id}:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${steps}`;
const GOOD_STEP = `      - name: Harden runner\n        uses: step-security/harden-runner@${SHA} # v2.22.4\n        with:\n          egress-policy: audit\n`;
const OTHER_STEP = '      - name: Checkout\n        run: echo hi\n';
const ID_TOKEN = '    permissions:\n      id-token: write\n';
const BAD_PUBLISH = (key = 'publish') => bareJob(key, OTHER_STEP, ID_TOKEN);

test('a comment at column 0 between two jobs does not end the jobs section', () => {
  const text = `name: x\njobs:\n${bareJob('build', GOOD_STEP)}\n# a note about the next job\n${BAD_PUBLISH()}`;
  assert.deepEqual(checkRelease(text, SHA), [{ job: 'publish', code: 'missing' }]);
});

test('a quoted job key is read as its own job, not merged into the previous one', () => {
  const text = `name: x\njobs:\n${bareJob('build', GOOD_STEP)}\n${BAD_PUBLISH('"publish"')}`;
  assert.deepEqual(checkRelease(text, SHA), [{ job: 'publish', code: 'missing' }]);
  const single = `name: x\njobs:\n${bareJob('build', GOOD_STEP)}\n${BAD_PUBLISH("'publish'")}`;
  assert.deepEqual(checkRelease(single, SHA), [{ job: 'publish', code: 'missing' }]);
});

test('an id-token written in flow style still marks a job as holding the release', () => {
  const text = `name: x\njobs:\n${bareJob('deploy', OTHER_STEP, '    permissions: { id-token: write, contents: write }\n')}`;
  assert.deepEqual(checkRelease(text, SHA), [{ job: 'deploy', code: 'missing' }]);
});

test('a line at the job level that is not a job key is reported, not ignored', () => {
  const text = `name: x\njobs:\n${bareJob('build', GOOD_STEP)}\n  *anchored:\n    runs-on: ubuntu-latest\n`;
  assert.ok(checkRelease(text, SHA).some((p) => p.code === 'unparsed'));
});

test('valid spellings of the step are accepted: a policy with a comment or quotes, uses on the dash line, steps at the key indent', () => {
  const trailing = GOOD_STEP.replace('egress-policy: audit', 'egress-policy: audit # keep');
  const quoted = GOOD_STEP.replace('egress-policy: audit', "egress-policy: 'audit'");
  const dash = `      - uses: step-security/harden-runner@${SHA} # v2.22.4\n        with:\n          egress-policy: audit\n`;
  const flush = '    - name: Harden runner\n      uses: step-security/harden-runner@' + SHA + ' # v2.22.4\n      with:\n        egress-policy: audit\n';
  for (const step of [trailing, quoted, dash]) {
    assert.deepEqual(checkRelease(`name: x\njobs:\n${bareJob('publish', step, ID_TOKEN)}`, SHA), []);
  }
  assert.deepEqual(checkRelease(`name: x\njobs:\n  publish:\n    permissions:\n      id-token: write\n    steps:\n${flush}`, SHA), []);
});

test('named jobs are checked even when no job holds id-token, and the missing id-token is reported too', () => {
  const text = `name: x\njobs:\n${bareJob('build', OTHER_STEP)}`;
  assert.deepEqual(checkRelease(text, SHA), [{ job: 'build', code: 'missing' }, { job: '-', code: 'no-release-jobs' }]);
});

test('only the job\'s own permissions decide whether it holds the release: a quoted key counts, text inside a step does not', () => {
  const quoted = `name: x\njobs:\n${bareJob('deploy', OTHER_STEP, '    permissions:\n      "id-token": write\n')}`;
  assert.deepEqual(checkRelease(quoted, SHA), [{ job: 'deploy', code: 'missing' }]);
  const singleQuoted = `name: x\njobs:\n${bareJob('deploy', OTHER_STEP, "    permissions:\n      'id-token': 'write'\n")}`;
  assert.deepEqual(checkRelease(singleQuoted, SHA), [{ job: 'deploy', code: 'missing' }]);
  const echoed = `name: x\njobs:\n${bareJob('publish', GOOD_STEP, ID_TOKEN)}\n${bareJob('lint', '      - run: echo "id-token: write"\n')}`;
  assert.deepEqual(checkRelease(echoed, SHA), []);
  assert.deepEqual(releaseJobs(echoed).map((j) => j.id), ['publish']);
  const readOnly = `name: x\njobs:\n${bareJob('publish', GOOD_STEP, ID_TOKEN)}\n${bareJob('docs', OTHER_STEP, '    permissions:\n      id-token: none\n      contents: write\n')}`;
  assert.deepEqual(checkRelease(readOnly, SHA), [], 'id-token: none is not the release');
});

test('write-all permissions hold the release too', () => {
  const text = `name: x\njobs:\n${bareJob('deploy', OTHER_STEP, '    permissions: write-all\n')}`;
  assert.deepEqual(checkRelease(text, SHA), [{ job: 'deploy', code: 'missing' }]);
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
