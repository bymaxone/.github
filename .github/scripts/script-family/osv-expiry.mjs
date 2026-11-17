// Warns before an `ignoreUntil` date of an adopter's osv-scanner.toml, so a dependency audit does not go red on the
// day an ignored advisory comes back. Layer: CI tooling for script-family-check.yml.
//
//   node osv-expiry.mjs --list <file> [--days 21] [--summary <file>]
//
// The repositories are those of the adopter list, once each, and this repository. The file is read from the default
// branch with the job's own token (the repositories are public). It is a reminder and never a gate: the exit code
// is 0 whatever the files say, and a file that is missing or cannot be read is a note, not a warning.
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../mutation-shards/lib.mjs';
import { readList } from './check-family.mjs';

const DAY = 864e5;
const PATH = 'osv-scanner.toml';
const HERE = 'bymaxone/.github';

/**
 * The ignores of an osv-scanner.toml: `{ id, until }` for each `[[IgnoredVulns]]` block that has an `ignoreUntil`
 * date. A block without a date or with a date that does not parse is left out.
 */
export function ignores(toml) {
  const found = [];
  for (const block of toml.split(/^\s*\[\[IgnoredVulns\]\]\s*$/m).slice(1)) {
    const next = block.search(/^\s*\[/m);
    const body = next === -1 ? block : block.slice(0, next);
    const id = /^\s*id\s*=\s*"([^"\n]+)"/m.exec(body)?.[1];
    const date = /^\s*ignoreUntil\s*=\s*"?(\d{4}-\d{2}-\d{2}(?:[T ][0-9:]+Z?)?)"?\s*(?:#.*)?$/m.exec(body)?.[1];
    if (!id || !date) continue;
    const until = new Date(date.length === 10 ? `${date}T00:00:00Z` : date.replace(' ', 'T'));
    if (Number.isNaN(until.getTime())) continue;
    found.push({ id, until });
  }
  return found;
}

/** The ignores that end within `days` days of `now`, or already have, soonest first, with the whole days left. */
export function expiring(toml, now, days) {
  return ignores(toml)
    .map(({ id, until }) => ({ id, until, left: Math.ceil((until.getTime() - now.getTime()) / DAY) }))
    .filter(({ left }) => left <= days)
    .sort((a, b) => a.until - b.until);
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });

/** One result per repository: `{ repo, note?, due }`; `fetch` is injectable for tests. */
export function scan(repos, now, days, fetch = gh) {
  return repos.map((repo) => {
    let toml;
    try {
      toml = fetch(['api', `repos/${repo}/contents/${PATH}`, '-H', 'Accept: application/vnd.github.raw+json']);
    } catch {
      return { repo, note: `${PATH}: none or unreadable`, due: [] };
    }
    return { repo, due: expiring(toml, now, days) };
  });
}

/** The line a warning prints for one ignore. */
export function line({ repo }, { id, until, left }) {
  const when = until.toISOString().slice(0, 10);
  return left < 0
    ? `${repo}: the ignore of ${id} ended on ${when}; the audit reports it again`
    : `${repo}: the ignore of ${id} ends on ${when} (${left} day${left === 1 ? '' : 's'}); re-triage it or the audit goes red`;
}

export function main(argv, env = process.env, now = new Date(), fetch = gh) {
  const args = parseArgs(argv);
  const days = Number(args.days ?? 21);
  if (!Number.isInteger(days) || days < 0) throw new Error('--days is a whole number of days');
  const repos = [...new Set([...readList(readFileSync(args.list, 'utf8')).map((entry) => entry.repo), HERE])];
  const results = scan(repos, now, days, fetch);
  const out = [];
  for (const result of results) {
    for (const item of result.due) {
      console.log(`::warning title=osv-expiry::${line(result, item)}`);
      out.push(`- ${line(result, item)}`);
    }
    if (result.note) out.push(`- ${result.repo}: ${result.note}`);
  }
  const text = out.length === 0 ? `No ignore ends within ${days} days in ${repos.length} repositories.` : out.join('\n');
  console.log(text);
  const summary = args.summary ?? env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `### OSV ignores that end soon\n\n${text}\n`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
