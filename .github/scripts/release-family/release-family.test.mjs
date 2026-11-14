// Tests the rule of the release-template family check against fixtures cut from the template itself,
// so the template and the check cannot disagree, and against the shapes an adopter copy can drift into.
// The workflow is parsed by Ruby's Psych (see check-release.mjs), so these tests need `ruby`, which the
// GitHub-hosted Ubuntu images ship.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkRelease, parseWorkflow, pinnedSha, releaseJobs } from './check-release.mjs';
import { checkFamily, readList, report } from './check-family.mjs';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const template = read('.github/workflow-templates/npm-release.yml');
const SHA = pinnedSha(parseWorkflow(template));
const STEP = /^ {6}- name: Harden runner\n(?: {8}[^\n]*\n)+\n?/m;

/** `checkRelease` on text, with the template's own pin. */
const check = (text, sha = SHA) => checkRelease(parseWorkflow(text), sha);

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

// Small hand-written workflows for the shapes the template does not have.
const GOOD_STEP = `      - name: Harden runner\n        uses: step-security/harden-runner@${SHA} # v2.22.4\n        with:\n          egress-policy: audit\n`;
const OTHER_STEP = '      - name: Checkout\n        run: echo hi\n';
const ID_TOKEN = '    permissions:\n      id-token: write\n';
const job = (id, steps, extra = '') => `  ${id}:\n    runs-on: ubuntu-latest\n${extra}    steps:\n${steps}`;
const wf = (...jobs) => `name: x\njobs:\n${jobs.join('\n')}`;
const BAD_PUBLISH = (key = 'publish') => job(key, OTHER_STEP, ID_TOKEN);

test('the template itself satisfies the rule it publishes, and its jobs are the ones the rule selects', () => {
  assert.match(SHA, /^[0-9a-f]{40}$/);
  assert.deepEqual(check(template), []);
  assert.deepEqual(releaseJobs(parseWorkflow(template)).map((j) => j.id), ['build', 'publish']);
});

test('a job without the step is reported as missing', () => {
  const text = editJob(template, 'publish', (j) => j.replace(STEP, ''));
  assert.deepEqual(check(text), [{ job: 'publish', code: 'missing' }]);
});

// nest-queue's release.yml had it second in `build`, after "Require a version tag".
test('the step after another step is reported as not first', () => {
  const text = editJob(template, 'build', (j) => {
    const step = STEP.exec(j)[0];
    const without = j.replace(STEP, '');
    const at = without.indexOf('      - name: Checkout\n');
    return without.slice(0, at) + step + without.slice(at);
  });
  assert.deepEqual(check(text), [{ job: 'build', code: 'not-first' }]);
});

test('a publish job renamed but still holding id-token: write is caught through the id-token clause', () => {
  const renamed = template.replace('\n  publish:\n', '\n  release:\n');
  assert.deepEqual(check(renamed), [], 'renamed with the step in place: fine');
  const stripped = editJob(renamed, 'release', (j) => j.replace(STEP, ''));
  assert.deepEqual(check(stripped), [{ job: 'release', code: 'missing' }]);
});

test('a job that is neither build, publish nor holding id-token is not a release job', () => {
  const extra = `${template.trimEnd()}\n\n  lint:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Lint\n        run: echo lint\n`;
  assert.deepEqual(check(extra), []);
  assert.deepEqual(releaseJobs(parseWorkflow(extra)).map((j) => j.id), ['build', 'publish']);
});

test('a tag instead of a commit, a stale commit and a wrong policy each have their own code', () => {
  const tag = template.replace(new RegExp(`@${SHA} # v2\\.22\\.4`, 'g'), '@v2.22.4');
  assert.deepEqual(check(tag).map((p) => p.code), ['not-pinned', 'not-pinned']);
  assert.deepEqual(check(template, 'f'.repeat(40)).map((p) => p.code), ['stale-sha', 'stale-sha']);
  const block = template.replace(/egress-policy: audit/g, 'egress-policy: block');
  assert.deepEqual(check(block).map((p) => p.code), ['wrong-policy', 'wrong-policy']);
});

test('the rule does not depend on any comment, not even the version comment (a parsed file has none)', () => {
  const bare = template.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n').replace(new RegExp(` # v2\\.22\\.4`, 'g'), '');
  assert.deepEqual(check(bare), []);
  const words = template.replace(new RegExp(` # v2\\.22\\.4`, 'g'), ' # the audit step, version two, patch four');
  assert.deepEqual(check(words), []);
});

// The shapes below made the first, line-based parser skip a job or select the wrong one.
test('a comment at column 0 between two jobs does not hide the job after it', () => {
  assert.deepEqual(check(wf(job('build', GOOD_STEP), '# a note about the next job', BAD_PUBLISH())), [{ job: 'publish', code: 'missing' }]);
});

test('quoted job keys, in double or single quotes, are jobs like any other', () => {
  assert.deepEqual(check(wf(job('build', GOOD_STEP), BAD_PUBLISH('"publish"'))), [{ job: 'publish', code: 'missing' }]);
  assert.deepEqual(check(wf(job('build', GOOD_STEP), BAD_PUBLISH("'publish'"))), [{ job: 'publish', code: 'missing' }]);
});

test('permissions in flow style, with quoted keys or values, or write-all, hold the release', () => {
  for (const extra of [
    '    permissions: { id-token: write, contents: write }\n',
    '    permissions:\n      "id-token": write\n',
    "    permissions:\n      'id-token': 'write'\n",
    '    permissions: write-all\n',
  ]) {
    assert.deepEqual(check(wf(job('deploy', OTHER_STEP, extra))), [{ job: 'deploy', code: 'missing' }], extra);
  }
});

test('id-token: none or read, and the same words inside a step, do not make a release job', () => {
  const none = wf(job('publish', GOOD_STEP, ID_TOKEN), job('docs', OTHER_STEP, '    permissions:\n      id-token: none\n      contents: write\n'));
  assert.deepEqual(check(none), []);
  const echoed = wf(job('publish', GOOD_STEP, ID_TOKEN), job('lint', `      - run: 'echo "id-token: write"'\n`));
  assert.deepEqual(check(echoed), []);
  assert.deepEqual(releaseJobs(parseWorkflow(echoed)).map((j) => j.id), ['publish']);
});

// The adversarial shapes that a hand parser could not follow and a real parse gets for free.
test('permissions reached through a YAML alias are read', () => {
  const text = `name: x\njobs:\n  build:\n    runs-on: ubuntu-latest\n    permissions: &p\n      id-token: write\n    steps:\n${GOOD_STEP}  release:\n    runs-on: ubuntu-latest\n    permissions: *p\n    steps:\n${OTHER_STEP}`;
  assert.deepEqual(check(text), [{ job: 'release', code: 'missing' }]);
});

test('a job without permissions inherits the workflow level, and one that sets its own replaces it', () => {
  const inherits = `name: x\npermissions:\n  id-token: write\njobs:\n${job('deploy', OTHER_STEP)}`;
  assert.deepEqual(check(inherits), [{ job: 'deploy', code: 'missing' }]);
  const replaced = `name: x\npermissions:\n  id-token: write\njobs:\n${job('deploy', OTHER_STEP, '    permissions:\n      contents: read\n')}`;
  assert.deepEqual(check(replaced), [{ job: '-', code: 'no-release-jobs' }]);
});

test('a quoted uses value, or a first step written on the dash line, is the same step', () => {
  const quoted = GOOD_STEP.replace(`uses: step-security/harden-runner@${SHA}`, `uses: "step-security/harden-runner@${SHA}"`);
  const dash = `      - uses: step-security/harden-runner@${SHA}\n        with:\n          egress-policy: audit\n`;
  for (const step of [quoted, dash]) assert.deepEqual(check(wf(job('publish', step, ID_TOKEN))), []);
  const flush = `    - name: Harden runner\n      uses: step-security/harden-runner@${SHA}\n      with:\n        egress-policy: audit\n`;
  assert.deepEqual(check(`name: x\njobs:\n  publish:\n    permissions:\n      id-token: write\n    steps:\n${flush}`), []);
});

test('only the step\'s own `with` decides the policy: a decoy under env or a quoted audit', () => {
  const decoy = `      - name: Harden runner\n        uses: step-security/harden-runner@${SHA}\n        env:\n          egress-policy: audit\n        with:\n          egress-policy: block\n`;
  assert.deepEqual(check(wf(job('publish', decoy, ID_TOKEN))), [{ job: 'publish', code: 'wrong-policy' }]);
  const noWith = `      - name: Harden runner\n        uses: step-security/harden-runner@${SHA}\n`;
  assert.deepEqual(check(wf(job('publish', noWith, ID_TOKEN))), [{ job: 'publish', code: 'wrong-policy' }]);
  const quoted = GOOD_STEP.replace('egress-policy: audit', "egress-policy: 'audit' # kept");
  assert.deepEqual(check(wf(job('publish', quoted, ID_TOKEN))), []);
});

test('a step that may not run, or may fail unnoticed, is reported', () => {
  for (const line of ['        if: false\n', "        if: ${{ false }}\n", '        continue-on-error: true\n']) {
    const step = GOOD_STEP.replace('        with:\n', `${line}        with:\n`);
    assert.deepEqual(check(wf(job('publish', step, ID_TOKEN))), [{ job: 'publish', code: 'conditional' }], line);
  }
});

test('CRLF line endings, an empty step list and a file that is not YAML are handled', () => {
  assert.deepEqual(check(template.replace(/\n/g, '\r\n')), []);
  assert.deepEqual(check(wf('  publish:\n    permissions:\n      id-token: write\n    runs-on: ubuntu-latest\n')), [{ job: 'publish', code: 'no-steps' }]);
  assert.deepEqual(check('jobs: [unclosed\n  - : :'), [{ job: '-', code: 'unparseable' }]);
  assert.deepEqual(check('- just\n- a list\n'), [{ job: '-', code: 'unparseable' }]);
});

test('named jobs are checked even when no job holds id-token, and the missing id-token is reported too', () => {
  assert.deepEqual(check(wf(job('build', OTHER_STEP))), [{ job: 'build', code: 'missing' }, { job: '-', code: 'no-release-jobs' }]);
  assert.deepEqual(check(wf(job('lint', OTHER_STEP))), [{ job: '-', code: 'no-release-jobs' }]);
});

test('a file Ruby cannot parse is reported with the first line Ruby printed, one line and without control characters', () => {
  const fetch = (args) => {
    const url = args[1];
    if (url === 'repos/o/broken') return 'main\n';
    if (url === 'repos/o/broken/commits/main') return `${'d'.repeat(40)}\n`;
    if (url.startsWith('repos/o/broken/contents/')) return 'jobs: [unclosed\n  - : :\n';
    throw new Error('404');
  };
  const [result] = checkFamily(['o/broken'], SHA, fetch);
  assert.equal(result.problems[0].code, 'unparseable');
  assert.ok(result.problems[0].detail.length > 0 && !/[\n\r]/.test(result.problems[0].detail));
  assert.match(report([result], SHA), /o\/broken @ d{40}: -:unparseable \(.+\)/);
});

// The workflow files are read by the Ruby of the runner image, and 3.2 has no `Date` after `require 'yaml'`
// (that broke the first CI run): the image is named, so a newer default does not change the parser unseen.
test('the check and the tests that run the parser both name the Ubuntu image, and the Ruby snippet requires date', () => {
  assert.match(read('.github/workflows/release-family-check.yml'), /\n {4}runs-on: ubuntu-24\.04\n/);
  const guards = read('.github/workflows/repo-guards.yml');
  const job = guards.slice(guards.indexOf('  mutation-shard-scripts:'));
  assert.match(job.slice(0, job.indexOf('\n    steps:')), /runs-on: ubuntu-24\.04/);
  assert.match(read('.github/scripts/release-family/check-release.mjs'), /require 'date'/);
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
