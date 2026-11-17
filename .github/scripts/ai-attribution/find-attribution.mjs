#!/usr/bin/env node
// Finds an AI attribution in the text of a pull request: its title, its body and the messages of its commits.
//
// Reads a JSON list of `{ where, text }` on standard input and the patterns file of this repository, chooses the
// strict or the narrow profile, and exits 1 when any item matches. The profile is read from the repository name
// unless one is requested, so a repository is moved to the narrow profile in the patterns file and nowhere else.
//
// Usage: node find-attribution.mjs --patterns <file> [--repo <owner/name>] [--profile auto|strict|narrow] < items.json
// Exit status: 0 nothing found, 1 something found, 2 the input or an option could not be read.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The JavaScript form of a pattern in the patterns file: the leading `(?im)` becomes the `im` flags.
 *
 * @param {string} pattern A pattern as the organisation rulesets carry it.
 * @returns {RegExp} The same pattern as a regular expression.
 */
function compile(pattern) {
  if (!pattern.startsWith('(?im)')) throw new Error('a pattern must start with (?im)');
  return new RegExp(pattern.slice('(?im)'.length), 'im');
}

/**
 * The profile that applies to a repository.
 *
 * @param {{ narrowRepos: string[] }} patterns The patterns file.
 * @param {string} repo The repository as `owner/name`, or an empty string.
 * @param {string} requested `strict`, `narrow`, `auto` or an empty string (both of the last two mean automatic).
 * @returns {'strict' | 'narrow'} The profile.
 */
export function profileFor(patterns, repo, requested) {
  if (requested === 'strict' || requested === 'narrow') return requested;
  if (requested !== '' && requested !== 'auto') throw new Error(`the profile must be strict, narrow or auto, not ${requested}`);
  const [owner, name] = repo.split('/');
  return owner === 'bymaxone' && patterns.narrowRepos.includes(name) ? 'narrow' : 'strict';
}

/**
 * The items whose text matches the profile's pattern.
 *
 * @param {{ where: string, text: string }[]} items The text to read and where each piece came from.
 * @param {{ strict: string, narrow: string }} patterns The patterns file.
 * @param {'strict' | 'narrow'} profile The profile to apply.
 * @returns {{ where: string, found: string }[]} One entry per matching item, with the text that matched.
 */
export function findAttribution(items, patterns, profile) {
  const pattern = compile(patterns[profile]);
  return items.flatMap(({ where, text }) => {
    const match = pattern.exec(text);
    return match === null ? [] : [{ where, found: match[0] }];
  });
}

/**
 * One line of output text with every control character removed, so it cannot start a workflow command or end a line.
 *
 * @param {string} text The text to show.
 * @returns {string} At most 80 characters on one line.
 */
function oneLine(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, 80);
}

/**
 * Reads `--name value` from the arguments.
 *
 * @param {string[]} argv The arguments.
 * @param {string} name The option name.
 * @returns {string | undefined} The value, or undefined when the option is absent.
 */
function option(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

/** Runs the command and returns the exit status. */
function main() {
  try {
    const argv = process.argv.slice(2);
    const file = option(argv, '--patterns');
    if (file === undefined) throw new Error('--patterns is required');
    const patterns = JSON.parse(readFileSync(file, 'utf8'));
    const profile = profileFor(patterns, option(argv, '--repo') ?? '', option(argv, '--profile') ?? 'auto');
    const items = JSON.parse(readFileSync(0, 'utf8'));
    if (!Array.isArray(items) || items.some((item) => typeof item?.where !== 'string' || typeof item?.text !== 'string')) {
      throw new Error('standard input must be a list of { where, text }');
    }
    const found = findAttribution(items, patterns, profile);
    for (const { where, found: text } of found) {
      console.log(`::error title=no-ai-attribution::${oneLine(where)} names an AI tool as its author or its reviewer.`);
      console.log(`  | ${oneLine(text)}`);
    }
    if (found.length > 0) {
      console.log(`${found.length} place(s) name an AI tool (profile ${profile}). Reword them; no commit, title, body or comment does this.`);
      return 1;
    }
    console.log(`No AI attribution in ${items.length} place(s) (profile ${profile}).`);
    return 0;
  } catch (error) {
    console.error(`no-ai-attribution: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
