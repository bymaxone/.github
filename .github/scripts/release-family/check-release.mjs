// The rule behind the family check of the npm release template. Layer: CI tooling.
//
// An adopter copies `.github/workflow-templates/npm-release.yml` into its own `release.yml`. The
// template starts every job that holds the release with an audit-mode `step-security/harden-runner`
// pinned to a commit (DEC-164). A copy cannot be updated from here, so the rule is checked on the
// copies: which jobs must carry the step, that it is the FIRST step, that it is pinned to the commit
// the template carries, and that it audits.
//
// Pure functions on text, node built-ins only, so the rule is tested against fixtures before it
// reads any repository.

export const ACTION = 'step-security/harden-runner';

/** The jobs that must start with the step: `build`, `publish`, and any job that holds `id-token: write`. */
const NAMED_RELEASE_JOBS = new Set(['build', 'publish']);

/** The `jobs:` section as `{ id, lines }` blocks, split by the two-space job keys. */
export function jobBlocks(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (start === -1) return [];
  const jobs = [];
  let current = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // the next top-level key ends the section
    const key = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
    if (key) {
      current = { id: key[1], lines: [] };
      jobs.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return jobs;
}

/** The step blocks of a job: each starts at a six-space `- ` and runs to the next one. */
export function stepBlocks(job) {
  const at = job.lines.findIndex((l) => /^ {4}steps:\s*(#.*)?$/.test(l));
  if (at === -1) return [];
  const steps = [];
  let current = null;
  for (const line of job.lines.slice(at + 1)) {
    if (/^ {0,5}\S/.test(line) && !/^ {6}-/.test(line)) break; // left the steps list
    if (/^ {6}- /.test(line)) {
      current = [line];
      steps.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return steps.map((s) => s.join('\n'));
}

const holdsIdToken = (job) => job.lines.some((l) => /^\s+id-token:\s*write\b/.test(l));

/** The jobs the rule applies to. */
export function releaseJobs(text) {
  return jobBlocks(text).filter((job) => NAMED_RELEASE_JOBS.has(job.id) || holdsIdToken(job));
}

/** The commit the template pins `harden-runner` to: the first such `uses:` in the text, or null. */
export function pinnedSha(text) {
  const m = new RegExp(`uses: ${ACTION}@([0-9a-f]{40}) # v\\d+\\.\\d+\\.\\d+`).exec(text);
  return m ? m[1] : null;
}

/**
 * What is wrong with one `release.yml`, as `{ job, code }` entries; empty when it satisfies the rule.
 * Codes: `no-release-jobs`, `no-steps`, `missing` (no harden-runner step in the job), `not-first` (the
 * step is there but another step precedes it), `not-pinned` (not a 40-hex commit with a version comment),
 * `stale-sha` (a commit other than the template's), `wrong-policy` (not `egress-policy: audit`).
 */
export function checkRelease(text, expectedSha) {
  const problems = [];
  const jobs = releaseJobs(text);
  if (!jobs.some(holdsIdToken)) return [{ job: '-', code: 'no-release-jobs' }];
  for (const job of jobs) {
    const steps = stepBlocks(job);
    if (steps.length === 0) {
      problems.push({ job: job.id, code: 'no-steps' });
      continue;
    }
    const first = steps[0];
    const uses = new RegExp(`^ {8}uses: ${ACTION}@(\\S+)(?: # (\\S+))?\\s*$`, 'm').exec(first);
    if (!uses) {
      const elsewhere = steps.slice(1).some((s) => new RegExp(`uses: ${ACTION}@`).test(s));
      problems.push({ job: job.id, code: elsewhere ? 'not-first' : 'missing' });
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(uses[1]) || !/^v\d+\.\d+\.\d+$/.test(uses[2] ?? '')) {
      problems.push({ job: job.id, code: 'not-pinned' });
    } else if (uses[1] !== expectedSha) {
      problems.push({ job: job.id, code: 'stale-sha' });
    }
    if (!/^ {10}egress-policy: audit\s*$/m.test(first)) {
      problems.push({ job: job.id, code: 'wrong-policy' });
    }
  }
  return problems;
}
