// The rule behind the family check of the npm release template. Layer: CI tooling.
//
// An adopter copies `.github/workflow-templates/npm-release.yml` into its own `release.yml`. The
// template starts every job that holds the release with an audit-mode `step-security/harden-runner`
// pinned to a commit (DEC-164). A copy cannot be updated from here, so the rule is checked on the
// copies: which jobs must carry the step, that it is the FIRST step, that it is pinned to the commit
// the template carries, that it audits, and that it is not made conditional.
//
// Every job whose effective permissions hold the token must also carry the template's forward-only step,
// the one whose script refuses a release that does not move forward: the same step as a parsed object
// (name, env, run, no other key), with no `if` or `continue-on-error`, ahead of the first step that
// downloads the build's artifact. A copy that keeps the name and changes what the step does differs, and
// the template's own test of that script (forward-only.test.mjs) is then a test of every copy.
//
// The workflow is read by a real YAML parser (Ruby's Psych, which the GitHub-hosted Ubuntu images
// ship), not by line rules: quoted keys, flow style, comments, anchors and aliases are then the
// parser's problem, and the rule is plain checks on the resulting object. A comment is not part of
// the parsed object, so the version comment next to the pin is not checked; the pin itself is.
import { execFileSync } from 'node:child_process';

export const ACTION = 'step-security/harden-runner';

const NAMED_RELEASE_JOBS = new Set(['build', 'publish']);

// The file arrives on stdin, never on the command line, so nothing in it can reach a shell.
// `date` is required explicitly: after `require 'yaml'` Ruby 3.2 (the Ubuntu 24.04 image) has no `Date`, and naming
// it in `permitted_classes` raised NameError, which read as every file being unparseable.
const RUBY = "require 'yaml'; require 'json'; require 'date'; puts JSON.generate(YAML.safe_load($stdin.read, permitted_classes: [Date, Time], aliases: true))";

/**
 * The parsed workflow as `{ workflow }`, or `{ error }` with the first line Ruby printed when the text is
 * not YAML Psych accepts or Ruby failed: a Ruby problem must not read as a problem of the adopter's file.
 */
export function parseWorkflowResult(text) {
  try {
    const out = execFileSync('ruby', ['-e', RUBY], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 1 << 26 });
    const parsed = JSON.parse(out);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return { workflow: parsed };
    return { error: 'the file is not a mapping' };
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    return { error: (stderr.split('\n').find((line) => line.trim() !== '') ?? String(error?.message ?? error)).slice(0, 160) };
  }
}

/** The parsed workflow, or `null` when it could not be parsed (see `parseWorkflowResult`). */
export const parseWorkflow = (text) => parseWorkflowResult(text).workflow ?? null;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Whether a `permissions` value holds the OIDC token: `write-all`, or a map with `id-token: write`. */
function grantsIdToken(permissions) {
  if (permissions === 'write-all') return true;
  return isObject(permissions) && permissions['id-token'] === 'write';
}

/**
 * Whether a job holds the release: its own `permissions`, or the workflow's when it declares none (a job
 * that sets `permissions` replaces the workflow's, it does not add to it).
 */
function holdsIdToken(workflow, job) {
  return grantsIdToken(isObject(job) && 'permissions' in job ? job.permissions : workflow.permissions);
}

/** The jobs the rule applies to: those named `build` or `publish`, and any that holds `id-token: write`. */
export function releaseJobs(workflow) {
  const jobs = isObject(workflow?.jobs) ? workflow.jobs : {};
  return Object.entries(jobs)
    .filter(([id, job]) => NAMED_RELEASE_JOBS.has(id) || holdsIdToken(workflow, job))
    .map(([id, job]) => ({ id, job }));
}

const stepUses = (step) => (isObject(step) && typeof step.uses === 'string' ? step.uses : '');

export const FORWARD_STEP = 'Require a release that moves forward';

/** The template's forward-only step, as the parsed object, or null when its publish job has none. */
export function forwardStep(workflow) {
  const steps = isObject(workflow?.jobs?.publish) && Array.isArray(workflow.jobs.publish.steps) ? workflow.jobs.publish.steps : [];
  return steps.find((s) => isObject(s) && s.name === FORWARD_STEP && typeof s.run === 'string') ?? null;
}

const isDownload = (step) => stepUses(step).startsWith('actions/download-artifact@');

/** Deep equality of two parsed YAML values (objects, arrays, strings, numbers, booleans, null). */
const sameValue = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

/**
 * What is wrong with the forward-only step of one job that holds the token, as codes. The step is found
 * by its name and then must be the template's step as a parsed object, key for key.
 *   `no-forward-step`          no step of that name;
 *   `forward-step-conditional` it carries `if` or `continue-on-error`, so it may not run or may fail unnoticed;
 *   `forward-step-differs`     it is not the template's step (run, env or any other key);
 *   `no-download-step`         the job never downloads the build's artifact, so it is not the template's shape;
 *   `forward-step-late`        it comes after the first step that does;
 *   `no-package-name`          `PACKAGE_NAME` is absent, empty or the template's placeholder in the job's env.
 * Placement is anchored on the download rather than on the publish command: the publish job has no checkout
 * and no install, so nothing it publishes exists before the download, whatever the command is spelled like.
 */
function checkForwardStep(job, forward) {
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const at = steps.findIndex((s) => isObject(s) && s.name === FORWARD_STEP);
  if (at === -1) return ['no-forward-step'];
  const step = steps[at];
  const codes = [];
  if ('if' in step || 'continue-on-error' in step) codes.push('forward-step-conditional');
  else if (!sameValue(step, forward)) codes.push('forward-step-differs');
  const downloadAt = steps.findIndex(isDownload);
  if (downloadAt === -1) codes.push('no-download-step');
  else if (at > downloadAt) codes.push('forward-step-late');
  const name = isObject(job.env) ? job.env.PACKAGE_NAME : undefined;
  if (typeof name !== 'string' || name === '' || name.includes('CHANGE-ME')) codes.push('no-package-name');
  return codes;
}

const isHardenRunner = (step) => stepUses(step).startsWith(`${ACTION}@`);

/** The commit the template pins `harden-runner` to: the first such step of its first job, or null. */
export function pinnedSha(workflow) {
  const jobs = isObject(workflow?.jobs) ? Object.values(workflow.jobs) : [];
  for (const job of jobs) {
    const first = Array.isArray(job?.steps) ? job.steps[0] : undefined;
    if (isHardenRunner(first)) {
      const sha = stepUses(first).slice(ACTION.length + 1);
      return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
    }
  }
  return null;
}

/**
 * What is wrong with one release workflow, as `{ job, code }` entries; empty when it satisfies the rule.
 * Codes: `unparseable` (not YAML Psych accepts), `no-release-jobs` (no job holds `id-token: write`),
 * `no-steps`, `missing` (no harden-runner step in the job), `not-first` (the step is there but another
 * precedes it), `not-pinned` (not a 40-hex commit), `stale-sha` (a commit other than the template's),
 * `wrong-policy` (not `egress-policy: audit`), `conditional` (the step carries an `if` or
 * `continue-on-error`, so it may not run or may fail unnoticed).
 */
export function checkRelease(workflow, expectedSha, forward = null) {
  if (!isObject(workflow)) return [{ job: '-', code: 'unparseable' }];
  const problems = [];
  const jobs = isObject(workflow.jobs) ? workflow.jobs : {};
  for (const { id, job } of releaseJobs(workflow)) {
    const steps = isObject(job) && Array.isArray(job.steps) ? job.steps : [];
    if (steps.length === 0) {
      problems.push({ job: id, code: 'no-steps' });
      continue;
    }
    if (forward && holdsIdToken(workflow, job)) for (const code of checkForwardStep(job, forward)) problems.push({ job: id, code });
    const first = steps[0];
    if (!isHardenRunner(first)) {
      problems.push({ job: id, code: steps.slice(1).some(isHardenRunner) ? 'not-first' : 'missing' });
      continue;
    }
    const sha = stepUses(first).slice(ACTION.length + 1);
    if (!/^[0-9a-f]{40}$/.test(sha)) problems.push({ job: id, code: 'not-pinned' });
    else if (sha !== expectedSha) problems.push({ job: id, code: 'stale-sha' });
    if (!isObject(first.with) || first.with['egress-policy'] !== 'audit') problems.push({ job: id, code: 'wrong-policy' });
    if ('if' in first || 'continue-on-error' in first) problems.push({ job: id, code: 'conditional' });
  }
  if (!Object.entries(jobs).some(([, job]) => holdsIdToken(workflow, job))) problems.push({ job: '-', code: 'no-release-jobs' });
  return problems;
}
