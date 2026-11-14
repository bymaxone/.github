// Reads every adopter's release.yml at the commit its default branch points to and applies the rule of
// check-release.mjs. Layer: CI tooling for release-family-check.yml.
//
//   node check-family.mjs --list <file> --template <file> [--summary <file>]
//
// The adopters are public repositories, so `gh api` with the job's own token is enough. Each file is
// read through the contents API with `ref=<commit sha>`, resolved from the default branch first, so a
// green report names exactly what it read. Exit code 1 when any adopter breaks the rule.
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../mutation-shards/lib.mjs';
import { checkRelease, forwardStep, parseWorkflow, parseWorkflowResult, pinnedSha } from './check-release.mjs';

const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const RELEASE_PATH = '.github/workflows/release.yml';

/** Repositories from the list file: one `owner/name` per line, `#` comments and blank lines ignored. */
export function readList(text) {
  const repos = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (!REPO.test(line)) throw new Error('A line of the adopter list is not owner/name.');
    repos.push(line);
  }
  return repos;
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** `{ sha, text }` for a repository, or `{ error }`; `fetch` is injectable for tests. */
export function readRelease(repo, fetch = gh) {
  let sha;
  try {
    const branch = fetch(['api', `repos/${repo}`, '--jq', '.default_branch']).trim();
    sha = fetch(['api', `repos/${repo}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha']).trim();
  } catch {
    return { error: 'unreadable' };
  }
  if (!SHA.test(sha)) return { error: 'unreadable' };
  try {
    const text = fetch(['api', `repos/${repo}/contents/${RELEASE_PATH}?ref=${sha}`, '-H', 'Accept: application/vnd.github.raw+json']);
    return { sha, text };
  } catch {
    return { sha, error: 'no-release-file' };
  }
}

/** One result per repository: `{ repo, sha, problems }`. */
export function checkFamily(repos, expectedSha, fetch = gh, forward = null) {
  return repos.map((repo) => {
    const got = readRelease(repo, fetch);
    if (got.error) return { repo, sha: got.sha ?? '-', problems: [{ job: '-', code: got.error }] };
    const parsed = parseWorkflowResult(got.text);
    // What Ruby printed comes from the adopter's file: one line, control characters removed.
    if (parsed.error !== undefined) return { repo, sha: got.sha, problems: [{ job: '-', code: 'unparseable', detail: parsed.error.replace(/[\u0000-\u001f\u007f]/g, '') }] };
    return { repo, sha: got.sha, problems: checkRelease(parsed.workflow, expectedSha, forward) };
  });
}

export function report(results, expectedSha) {
  const lines = [`Template harden-runner pin: ${expectedSha}`, ''];
  for (const { repo, sha, problems } of results) {
    const state = problems.length === 0 ? 'ok' : problems.map((p) => `${p.job}:${p.code}${p.detail ? ` (${p.detail})` : ''}`).join(', ');
    lines.push(`- ${repo} @ ${sha}: ${state}`);
  }
  return lines.join('\n');
}

export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  // The workflows are read by Ruby's YAML parser; without it every repository would read as unparseable.
  try {
    execFileSync('ruby', ['-v'], { stdio: 'ignore' });
  } catch {
    throw new Error('ruby is required to read the workflows and was not found.');
  }
  const expected = pinnedSha(parseWorkflow(readFileSync(args.template, 'utf8')));
  if (!expected) throw new Error('The template carries no pinned harden-runner step.');
  const forward = forwardStep(parseWorkflow(readFileSync(args.template, 'utf8')));
  if (!forward) throw new Error('The template carries no forward-only step in its publish job.');
  const results = checkFamily(readList(readFileSync(args.list, 'utf8')), expected, gh, forward);
  const text = report(results, expected);
  console.log(text);
  const out = args.summary ?? env.GITHUB_STEP_SUMMARY;
  if (out) appendFileSync(out, `### Release template family\n\n${text}\n`);
  const bad = results.filter((r) => r.problems.length > 0);
  if (bad.length > 0) {
    console.log(`::error title=release-family::${bad.length} adopter(s) break the release template rule: ${bad.map((r) => r.repo).join(', ')}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
