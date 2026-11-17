#!/usr/bin/env node
// Scans the comments and review replies of the organisation's repositories for an AI attribution.
//
// Reads a JSON list of `{ repo, url, author, authorType, body }` on standard input and the patterns file of this
// repository, and prints one warning per comment that matches the profile of its repository, with its link. A comment
// written by a bot is not read. A hit is a warning and never a failure: the scan reminds, the pull-request job and
// the rulesets are the gates.
//
// Usage: node scan-comments.mjs --patterns <file> [--summary] < comments.json
//   --summary  also print a markdown table of the hits, for a job summary
// Exit status: 0 always when the input was read, 2 when the input or an option could not be read.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { findAttribution, profileFor } from './find-attribution.mjs';

/**
 * One line of text with every control character and the pipe removed, so it cannot start a workflow command, end a
 * line or break a markdown table cell.
 *
 * @param {string} text The text to show.
 * @returns {string} At most 120 characters on one line.
 */
function oneLine(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/[\u0000-\u001f\u007f|]+/g, ' ').slice(0, 120);
}

/**
 * The comments that name an AI tool as their author or reviewer.
 *
 * @param {{ repo: string, url: string, author: string, authorType: string, body: string }[]} comments The comments.
 * @param {{ strict: string, narrow: string, narrowRepos: string[] }} patterns The patterns file.
 * @returns {{ repo: string, url: string, author: string, found: string }[]} One entry per matching comment.
 */
export function scanComments(comments, patterns) {
  return comments.flatMap((comment) => {
    if (comment.authorType === 'Bot') return [];
    const profile = profileFor(patterns, comment.repo, 'auto');
    const [hit] = findAttribution([{ where: comment.url, text: comment.body }], patterns, profile);
    return hit === undefined ? [] : [{ repo: comment.repo, url: comment.url, author: comment.author, found: hit.found }];
  });
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
    const comments = JSON.parse(readFileSync(0, 'utf8'));
    const valid = (c) => ['repo', 'url', 'author', 'authorType', 'body'].every((key) => typeof c?.[key] === 'string');
    if (!Array.isArray(comments) || !comments.every(valid)) {
      throw new Error('standard input must be a list of { repo, url, author, authorType, body }');
    }
    const hits = scanComments(comments, patterns);
    for (const hit of hits) {
      console.log(`::warning title=no-ai-attribution::${oneLine(hit.repo)}: a comment by ${oneLine(hit.author)} names an AI tool, see ${oneLine(hit.url)}`);
    }
    if (hits.length === 0) {
      console.log(`No AI attribution in ${comments.length} comment(s).`);
    } else {
      console.log(`${hits.length} comment(s) name an AI tool in ${comments.length} read.`);
    }
    if (argv.includes('--summary')) {
      console.log(`\n### AI attribution in comments\n\n${hits.length} comment(s) name an AI tool, of ${comments.length} read.`);
      if (hits.length > 0) {
        console.log('\n| Repository | Author | Link |\n| --- | --- | --- |');
        for (const hit of hits) console.log(`| ${oneLine(hit.repo)} | ${oneLine(hit.author)} | ${oneLine(hit.url)} |`);
      }
    }
    return 0;
  } catch (error) {
    console.error(`no-ai-attribution: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main());
