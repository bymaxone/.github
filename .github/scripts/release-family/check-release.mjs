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

const COMMENT_OR_BLANK = /^\s*(#.*)?$/;
const JOB_KEY = /^ {2}(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+)):\s*(?:#.*)?$/;

/**
 * The `jobs:` section as `{ id, lines }` blocks, split by the two-space job keys (a key may be quoted),
 * and the two-space lines that are not a job key. A comment or a blank line never ends the section or
 * starts a job; only a non-comment line at column 0 ends it.
 */
export function jobSection(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (start === -1) return { jobs: [], unparsed: [] };
  const jobs = [];
  const unparsed = [];
  let current = null;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (COMMENT_OR_BLANK.test(line)) {
      if (current) current.lines.push(line);
      continue;
    }
    if (/^\S/.test(line)) break; // the next top-level key ends the section
    const key = JOB_KEY.exec(line);
    if (key) {
      current = { id: key[1] ?? key[2] ?? key[3], lines: [] };
      jobs.push(current);
    } else if (/^ {2}\S/.test(line)) {
      unparsed.push(line.trim().slice(0, 40));
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return { jobs, unparsed };
}

export const jobBlocks = (text) => jobSection(text).jobs;

/**
 * The step blocks of a job. The list starts after `steps:` at whatever indent its first `- ` has (at
 * least the key's own, YAML allows both), and each `- ` at that indent starts a step.
 */
export function stepBlocks(job) {
  const at = job.lines.findIndex((l) => /^ {4}steps:\s*(#.*)?$/.test(l));
  if (at === -1) return [];
  const rest = job.lines.slice(at + 1);
  const first = rest.find((l) => !COMMENT_OR_BLANK.test(l));
  if (first === undefined || !/^\s*- /.test(first)) return [];
  const indent = first.length - first.trimStart().length;
  if (indent < 4) return [];
  const steps = [];
  let current = null;
  for (const line of rest) {
    if (COMMENT_OR_BLANK.test(line)) {
      if (current) current.push(line);
      continue;
    }
    const lineIndent = line.length - line.trimStart().length;
    if (lineIndent < indent || (lineIndent === indent && !line.trimStart().startsWith('- '))) break;
    if (lineIndent === indent) {
      current = [line];
      steps.push(current);
    } else if (current) {
      current.push(line);
    }
  }
  return steps.map((s) => ({ text: s.join('\n'), indent }));
}

const holdsIdToken = (job) => job.lines.some((l) => /(?:^|[\s{,])id-token:\s*['"]?write\b/.test(l.replace(/#.*$/, '')));

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
 * Codes: `unparsed` (a line at the job level that is not a job key, so a job may have been skipped),
 * `no-release-jobs` (no job holds `id-token: write`), `no-steps`, `missing` (no harden-runner step in
 * the job), `not-first` (the step is there but another step precedes it), `not-pinned` (not a 40-hex
 * commit with a version comment), `stale-sha` (a commit other than the template's), `wrong-policy`
 * (not `egress-policy: audit`).
 */
export function checkRelease(text, expectedSha) {
  const problems = [];
  const { jobs: all, unparsed } = jobSection(text);
  for (const line of unparsed) problems.push({ job: line, code: 'unparsed' });
  const jobs = all.filter((job) => NAMED_RELEASE_JOBS.has(job.id) || holdsIdToken(job));
  for (const job of jobs) {
    const steps = stepBlocks(job);
    if (steps.length === 0) {
      problems.push({ job: job.id, code: 'no-steps' });
      continue;
    }
    const { text: first, indent } = steps[0];
    const uses = new RegExp(`^(?: {${indent}}- | {${indent + 2}})uses:\\s*${ACTION}@(\\S+)(?:\\s+#\\s*(\\S+))?\\s*$`, 'm').exec(first);
    if (!uses) {
      const elsewhere = steps.slice(1).some((s) => new RegExp(`uses:\\s*${ACTION}@`).test(s.text));
      problems.push({ job: job.id, code: elsewhere ? 'not-first' : 'missing' });
      continue;
    }
    if (!/^[0-9a-f]{40}$/.test(uses[1]) || !/^v\d+\.\d+\.\d+$/.test(uses[2] ?? '')) {
      problems.push({ job: job.id, code: 'not-pinned' });
    } else if (uses[1] !== expectedSha) {
      problems.push({ job: job.id, code: 'stale-sha' });
    }
    if (!/^\s+egress-policy:\s*['"]?audit['"]?\s*(?:#.*)?$/m.test(first)) {
      problems.push({ job: job.id, code: 'wrong-policy' });
    }
  }
  if (!all.some(holdsIdToken)) problems.push({ job: '-', code: 'no-release-jobs' });
  return problems;
}
