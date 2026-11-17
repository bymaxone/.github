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
  return blocks(toml).filter((block) => block.until !== null).map(({ id, until }) => ({ id, until }));
}

/**
 * The value of `key = ...` in a block, as TOML writes it: a basic or a literal string, or a bare value, up to a comment
 * outside quotes. `undefined` when the key is absent.
 */
function valueOf(body, key) {
  const line = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.*)$`, 'm').exec(body)?.[1];
  if (line === undefined) return undefined;
  const quoted = /^"([^"\r\n]*)"|^'([^'\r\n]*)'/.exec(line);
  if (quoted) return quoted[1] ?? quoted[2];
  return line.replace(/[ \t]*#.*$/, '').trim();
}

/**
 * A date or date-time as TOML (and a quoted string of one) writes it, as a `Date`, or null when it is not one:
 * `YYYY-MM-DD`, then optionally `T` or a space, `HH:MM:SS`, fractional seconds, and `Z` or an offset. A local
 * date-time and a date are read as UTC. The day must exist (2028-02-29 does, 2027-02-29 does not).
 */
export function dateOf(text) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/i.exec(text ?? '');
  if (!parts) return null;
  const [, year, month, day, time = '00:00:00', fraction = '', zone = 'Z'] = parts;
  const exists = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (exists.getUTCFullYear() !== Number(year) || exists.getUTCMonth() !== Number(month) - 1 || exists.getUTCDate() !== Number(day)) return null;
  const date = new Date(`${year}-${month}-${day}T${time}${fraction}${zone.toUpperCase()}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The text with every multi-line string and every whole-line comment blanked and the newlines kept, so a line inside
 * a reason or a comment is never read as a key or as a table header.
 */
function blanked(toml) {
  const spans = toml.replace(/"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'/g, (span) => span.replace(/[^\r\n]/g, ' '));
  return spans.replace(/^[ \t]*#.*$/gm, '');
}

/** Every `[[IgnoredVulns]]` block that names an id: `{ id, until, dated }`, `until` null when there is no date or it cannot be read. */
function blocks(toml) {
  const found = [];
  for (const block of blanked(toml).split(/^[ \t]*\[\[IgnoredVulns\]\][ \t]*(?:#.*)?$/m).slice(1)) {
    const next = block.search(/^\s*\[/m);
    const body = next === -1 ? block : block.slice(0, next);
    const id = valueOf(body, 'id');
    if (!id) continue;
    const text = valueOf(body, 'ignoreUntil');
    found.push({ id, until: text === undefined ? null : dateOf(text), dated: text !== undefined });
  }
  return found;
}

/** The count of ignores whose `ignoreUntil` is present and cannot be read as a date. */
export function unreadable(toml) {
  return blocks(toml).filter((block) => block.dated && block.until === null).length;
}

/** Text from another repository's file, made safe to print in a workflow command and a summary. */
export function clean(text) {
  return String(text).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029%\[\]()<>`*_|!&\\]/g, '').replace(/::/g, ':').slice(0, 80);
}

/** The ignores that end within `days` days of `now`, or already have, soonest first, with the whole days left. */
export function expiring(toml, now, days) {
  return ignores(toml)
    .map(({ id, until }) => ({ id, until, left: Math.ceil((until.getTime() - now.getTime()) / DAY), ended: until.getTime() <= now.getTime() }))
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
    const bad = unreadable(toml);
    return { repo, due: expiring(toml, now, days), ...(bad > 0 ? { note: `${bad} ignore(s) with an ignoreUntil that cannot be read as a date` } : {}) };
  });
}

/** The line a warning prints for one ignore. */
export function line({ repo }, { id, until, left, ended }) {
  const when = until.toISOString().slice(0, 10);
  return ended
    ? `${clean(repo)}: the ignore of ${clean(id)} ended on ${when}; the audit reports it again`
    : `${clean(repo)}: the ignore of ${clean(id)} ends on ${when} (${left} day${left === 1 ? '' : 's'}); re-triage it or the audit goes red`;
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
    if (result.note) out.push(`- ${clean(result.repo)}: ${result.note}`);
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
