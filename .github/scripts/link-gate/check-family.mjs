// Measures the link check of every library's published-surface gate against the matrix of cases.
// Layer: CI tooling.
//
//   node check-family.mjs --list <file> [--summary <file>]
//
// For each repository in the list it resolves the default branch to a commit, reads the library's link check
// at that commit (`scripts/published-surface-links.mjs` when the library keeps it as a module, otherwise
// `scripts/check-published-surface.mjs`) and runs every case of matrix.mjs on it with `probe`. A library is
// `ok` when each case comes out as wanted; otherwise the report names the cases that did not. A script whose
// link check cannot be found is `unrecognised`, which is a failure: a layout nobody looked at proves nothing.
// With LINK_GATE_ISOLATE=1 each child also gets a network namespace and the `nobody` user (Linux, sudo).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../mutation-shards/lib.mjs';
import { readList } from '../release-family/check-family.mjs';
import { mismatches } from './matrix.mjs';
import { isolation } from './probe.mjs';

const SHA = /^[0-9a-f]{40}$/;
// The module first: the main script of a library that keeps its link check apart has no link check in it.
export const SCRIPT_PATHS = ['scripts/published-surface-links.mjs', 'scripts/check-published-surface.mjs'];

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 });

/** `{ sha, path, text }` for a repository, or `{ error }`; `fetch` is injectable for tests. */
export function readScript(repo, fetch = gh) {
  let sha;
  try {
    const branch = fetch(['api', `repos/${repo}`, '--jq', '.default_branch']).trim();
    sha = fetch(['api', `repos/${repo}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha']).trim();
  } catch {
    return { error: 'unreadable' };
  }
  if (!SHA.test(sha)) return { error: 'unreadable' };
  for (const path of SCRIPT_PATHS) {
    try {
      return { sha, path, text: fetch(['api', `repos/${repo}/contents/${path}?ref=${sha}`, '-H', 'Accept: application/vnd.github.raw+json']) };
    } catch {
      // The next candidate.
    }
  }
  return { sha, error: 'no-script' };
}

/** One result per repository: `{ repo, sha, path, problems }`, problems being strings. */
export function checkFamily(repos, fetch = gh, options = {}) {
  return repos.map((repo) => {
    const got = readScript(repo, fetch);
    if (got.error) return { repo, sha: got.sha ?? '-', path: '-', problems: [got.error] };
    const result = mismatches(got.text, options);
    if (result.problem) return { repo, sha: got.sha, path: got.path, problems: [result.problem.slice(0, 160).replace(/[\u0000-\u001f\u007f]/g, ' ')] };
    return { repo, sha: got.sha, path: got.path, problems: result.bad };
  });
}

export function report(results) {
  const lines = [];
  for (const { repo, sha, path, problems } of results) {
    lines.push(`- ${repo} @ ${sha} (${path}): ${problems.length === 0 ? 'ok' : problems.join('; ')}`);
  }
  return lines.join('\n');
}

export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  const options = env.LINK_GATE_ISOLATE === '1' ? { wrap: isolation(), timeoutMs: 60_000 } : { timeoutMs: 60_000 };
  const results = checkFamily(readList(readFileSync(args.list, 'utf8')), gh, options);
  const text = report(results);
  console.log(text);
  const out = args.summary ?? env.GITHUB_STEP_SUMMARY;
  if (out) appendFileSync(out, `### Link gate family\n\n${text}\n`);
  const bad = results.filter((r) => r.problems.length > 0);
  if (bad.length > 0) {
    console.log(`::error title=link-gate::${bad.length} librar${bad.length === 1 ? 'y' : 'ies'} decide a link differently from the matrix: ${bad.map((r) => r.repo).join(', ')}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
