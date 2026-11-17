// Compares each adopter's copy of a script template with the template, byte for byte.
// Layer: CI tooling for script-family-check.yml.
//
//   node check-family.mjs --list <file> --templates <dir> [--summary <file>]
//
// A template is a directory holding template.json, `{ "files": [{ "source", "target" }] }`: each source is
// the canonical file, each target is where an adopter keeps its copy. The adopters are public repositories,
// so `gh api` with the job's own token is enough. Each file is read with `ref=<commit sha>`, resolved from
// the default branch first, so a green report names exactly what it read. Exit code 1 when a copy differs,
// is missing or cannot be read.
import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from '../mutation-shards/lib.mjs';

const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const NAME = /^[a-z0-9][a-z0-9-]*$/;
const SHA = /^[0-9a-f]{40}$/;
const TARGET = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

/** `{ repo, template }` per line: `owner/name template`, `#` comments and blank lines ignored. */
export function readList(text) {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [repo, template, extra] = line.split(/\s+/);
    if (!REPO.test(repo ?? '') || !NAME.test(template ?? '') || extra !== undefined) {
      throw new Error('A line of the adopter list is not `owner/name template`.');
    }
    entries.push({ repo, template });
  }
  return entries;
}

/** The files a template lists, with their canonical text; throws on a manifest that is not well formed. */
export function readTemplate(dir, name) {
  const manifest = JSON.parse(readFileSync(join(dir, name, 'template.json'), 'utf8'));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${name}: template.json lists no files.`);
  }
  return manifest.files.map(({ source, target }) => {
    if (!TARGET.test(source ?? '') || !TARGET.test(target ?? '') || source.split('/').includes('..') || target.split('/').includes('..')) {
      throw new Error(`${name}: a file entry of template.json is not a plain relative path.`);
    }
    return { target, text: readFileSync(join(dir, name, source), 'utf8') };
  });
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });

const EXEMPT_PATH = 'scripts/mutation-inventory.exempt.json';

/**
 * The template specs an adopter holds that its exempt list does not name. The cold mutation run fails a unit test that
 * judges no mutant and is not listed there, and the per-push job does not run that check, so a copy of a template spec
 * that is not listed fails only at the adopter's next release.
 */
function unlistedSpecs(repo, sha, held, fetch) {
  const specs = held.filter((target) => target.endsWith('.spec.ts'));
  if (specs.length === 0) return [];
  let listed;
  try {
    const entries = JSON.parse(fetch(['api', `repos/${repo}/contents/${EXEMPT_PATH}?ref=${sha}`, '-H', 'Accept: application/vnd.github.raw+json']));
    if (!Array.isArray(entries)) throw new Error('not a list');
    listed = new Set(entries.map((entry) => entry?.file));
  } catch {
    return [`${EXEMPT_PATH}: missing or unreadable`];
  }
  return specs.filter((target) => !listed.has(target)).map((target) => `${target}: not in ${EXEMPT_PATH}`);
}

/** One result per adopter: `{ repo, template, sha, problems }`; `fetch` is injectable for tests. */
export function checkFamily(entries, templates, fetch = gh) {
  return entries.map(({ repo, template }) => {
    const files = templates.get(template);
    if (!files) return { repo, template, sha: '-', problems: [`${template}: no such template or unreadable manifest`] };
    let sha;
    try {
      const branch = fetch(['api', `repos/${repo}`, '--jq', '.default_branch']).trim();
      sha = fetch(['api', `repos/${repo}/commits/${encodeURIComponent(branch)}`, '--jq', '.sha']).trim();
    } catch {
      return { repo, template, sha: '-', problems: ['unreadable'] };
    }
    if (!SHA.test(sha)) return { repo, template, sha: '-', problems: ['unreadable'] };
    const problems = [];
    const held = [];
    for (const { target, text } of files) {
      let got;
      try {
        got = fetch(['api', `repos/${repo}/contents/${target}?ref=${sha}`, '-H', 'Accept: application/vnd.github.raw+json']);
      } catch {
        problems.push(`${target}: missing`);
        continue;
      }
      held.push(target);
      if (got !== text) problems.push(`${target}: differs from the template`);
    }
    problems.push(...unlistedSpecs(repo, sha, held, fetch));
    return { repo, template, sha, problems };
  });
}

export function report(results) {
  return results
    .map(({ repo, template, sha, problems }) => `- ${repo} (${template}) @ ${sha}: ${problems.length === 0 ? 'ok' : problems.join(', ')}`)
    .join('\n');
}

export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  const entries = readList(readFileSync(args.list, 'utf8'));
  const templates = new Map();
  for (const { template } of entries) {
    if (templates.has(template)) continue;
    // A template that cannot be read is reported for its adopters, with the rest of the report, not thrown.
    try {
      templates.set(template, readTemplate(args.templates, template));
    } catch {
      templates.set(template, null);
    }
  }
  const results = checkFamily(entries, templates);
  const text = report(results);
  console.log(text);
  const out = args.summary ?? env.GITHUB_STEP_SUMMARY;
  if (out) appendFileSync(out, `### Script template family\n\n${text}\n`);
  const bad = results.filter((r) => r.problems.length > 0);
  if (bad.length > 0) {
    console.log(`::error title=script-family::${bad.length} adopter(s) carry a copy that differs from its template: ${bad.map((r) => r.repo).join(', ')}`);
    return 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
