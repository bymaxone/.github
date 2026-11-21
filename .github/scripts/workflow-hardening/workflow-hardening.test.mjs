// Guards the hardening rules every workflow in this repository must keep. Layer: CI tooling.
//
// Each workflow is parsed by Ruby's Psych, as the other workflow guards do, so these tests need
// `ruby`. A rule is asserted over every file, so a workflow added later is covered without edits here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../../workflows/', import.meta.url);
const RUBY = "require 'yaml'; require 'json'; puts JSON.generate(YAML.safe_load($stdin.read, aliases: true))";
const workflows = readdirSync(dir)
  .filter((f) => f.endsWith('.yml'))
  .map((file) => {
    const text = readFileSync(new URL(file, dir), 'utf8');
    const doc = JSON.parse(execFileSync('ruby', ['-e', RUBY], { input: text, encoding: 'utf8' }));
    return { file, text, doc, on: doc.on ?? doc.true };
  });

const writes = (p) => p === 'write-all' || Object.values(p ?? {}).some((v) => v === 'write');

test('no workflow grants a write scope at the top of the file', () => {
  // A top-level write is the default of every job that declares nothing of its own.
  const hits = workflows.filter((w) => writes(w.doc.permissions)).map((w) => w.file);
  assert.deepEqual(hits, []);
});

test('every workflow declares a top-level permissions block', () => {
  const hits = workflows.filter((w) => w.doc.permissions === undefined).map((w) => w.file);
  assert.deepEqual(hits, []);
});

test('every job that runs steps has a timeout', () => {
  // A job without one runs for six hours when a step hangs.
  const hits = [];
  for (const w of workflows) {
    for (const [name, job] of Object.entries(w.doc.jobs ?? {})) {
      if (job.steps && job.uses === undefined && job['timeout-minutes'] === undefined) hits.push(`${w.file}:${name}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('no workflow runs on pull_request_target', () => {
  // That event runs with the base repository's secrets, so it must never sit beside a PR checkout.
  const hits = workflows.filter((w) => w.on && typeof w.on === 'object' && 'pull_request_target' in w.on).map((w) => w.file);
  assert.deepEqual(hits, []);
});

test('no run script interpolates github.event.* or the head ref directly', () => {
  const hits = [];
  for (const w of workflows) {
    for (const [name, job] of Object.entries(w.doc.jobs ?? {})) {
      for (const step of job.steps ?? []) {
        const found = (step.run ?? '').match(/\$\{\{[^}]*(github\.event\.|github\.head_ref)[^}]*\}\}/g);
        if (found) hits.push(`${w.file}:${name}:${found.join(',')}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

// Every `uses:` of a workflow, read from the parsed document so a flow-style step
// (`steps: [{uses: ...}]`) is seen as well as a block-style one.
function usesOf(doc) {
  return Object.values(doc.jobs ?? {}).flatMap((job) => [job.uses, ...(job.steps ?? []).map((s) => s.uses)]).filter(Boolean);
}

// The third-party references that are not a full commit, or whose every line in the file does not
// carry a version comment. A reference used twice is judged on each of its lines.
function unpinned(doc, text) {
  const lines = text.split('\n').filter((l) => !l.trim().startsWith('#'));
  return [...new Set(usesOf(doc))]
    .filter((u) => !u.startsWith('./') && !u.startsWith('bymaxone/'))
    .filter((u) => {
      if (!/@[0-9a-f]{40}$/.test(u)) return true;
      const at = lines.filter((l) => l.includes(u));
      return at.length === 0 || !at.every((l) => /#\s*v?\d/.test(l.slice(l.indexOf(u) + u.length)));
    });
}

test('every third-party action is pinned to a full commit with a version comment', () => {
  const hits = workflows.flatMap((w) => unpinned(w.doc, w.text).map((u) => `${w.file}:${u}`));
  assert.deepEqual(hits, []);
});

test('the pin scan sees a flow-style step, a job-level reference and a second use without a comment', () => {
  // A line-by-line scan for a line that starts with `uses:` skips both of these.
  const text = [
    'jobs:',
    '  a:',
    '    steps: [{uses: actions/checkout@v5}]',
    '  b:',
    '    uses: owner/repo/.github/workflows/x.yml@main',
    '  c:',
    '    steps:',
    '      - uses: actions/cache@0123456789012345678901234567890123456789',
    '      - uses: actions/setup@0123456789012345678901234567890123456789 # v4.1.0',
    '  d:',
    '    steps:',
    '      - uses: actions/twice@abcdefabcdefabcdefabcdefabcdefabcdefabcd # v2.0.0',
    '      - uses: actions/twice@abcdefabcdefabcdefabcdefabcdefabcdefabcd',
  ].join('\n');
  const doc = JSON.parse(execFileSync('ruby', ['-e', RUBY], { input: text, encoding: 'utf8' }));
  assert.deepEqual(unpinned(doc, text), [
    'actions/checkout@v5',
    'owner/repo/.github/workflows/x.yml@main',
    'actions/cache@0123456789012345678901234567890123456789',
    // The second use of the same reference has no comment, and the first one's must not cover it.
    'actions/twice@abcdefabcdefabcdefabcdefabcdefabcdefabcd',
  ]);
});
