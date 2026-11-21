// Guards the hardening rules every workflow in this repository must keep. Layer: CI tooling.
//
// Each workflow is parsed by Ruby's Psych, as the other workflow guards do, so these tests need
// `ruby`. A rule is asserted over every file, so a workflow added later is covered without edits here.
// Action pinning is not repeated here: the repo-guards workflow already checks every reference from
// the parsed document and its version comment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../../workflows/', import.meta.url);
const RUBY = "require 'yaml'; require 'json'; puts JSON.generate(YAML.safe_load($stdin.read, aliases: true))";
const parse = (text) => JSON.parse(execFileSync('ruby', ['-e', RUBY], { input: text, encoding: 'utf8' }));

// The event names a workflow runs on. `on` is a string, a list, or a map, and Psych reads the bare
// key `on` as the boolean true.
function eventsOf(doc) {
  const on = doc.on ?? doc.true;
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return on && typeof on === 'object' ? Object.keys(on) : [];
}

// The `${{` expressions in run scripts whose text from there to the END of the script names the
// github context. The context carries the event payload and the head ref, which an attacker
// chooses. Where an expression ends is not parsed (a `}}` can sit inside a string literal), and no
// spelling of the context is matched: any mention of `github`, in any case, after a `${{` is a hit.
// That over-matches on purpose; the one carve-out is a shell variable named `$GITHUB_*`.
//
// Policy: a run script takes context values only through `env:`, and reads them as "$VAR".
function interpolations(doc) {
  const found = [];
  for (const [name, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      const run = step.run ?? '';
      for (let at = run.indexOf('${{'); at >= 0; at = run.indexOf('${{', at + 3)) {
        // `$GITHUB_STEP_SUMMARY` and its kin are shell variables the runner sets, not the context.
        // Only the whole token goes, case-sensitively, and nothing around it.
        const tail = run.slice(at).replace(/\$GITHUB_[A-Z0-9_]+|\$\{GITHUB_[A-Z0-9_]+\}/g, '');
        if (/github/i.test(tail)) found.push(`${name}:${tail.split('\n')[0]}`);
      }
    }
  }
  return found;
}

const workflows = readdirSync(dir)
  .filter((f) => f.endsWith('.yml'))
  .map((file) => {
    const text = readFileSync(new URL(file, dir), 'utf8');
    return { file, text, doc: parse(text) };
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
  const hits = workflows.filter((w) => eventsOf(w.doc).includes('pull_request_target')).map((w) => w.file);
  assert.deepEqual(hits, []);
});

test('the event list is read from a string, a list and a map alike', () => {
  const on = (block) => eventsOf(parse(`${block}\njobs: {}\n`));
  assert.deepEqual(on('on: pull_request_target'), ['pull_request_target']);
  assert.deepEqual(on('on: [push, pull_request_target]'), ['push', 'pull_request_target']);
  assert.deepEqual(on('on:\n  pull_request_target:\n  push:'), ['pull_request_target', 'push']);
  assert.deepEqual(on('on:\n  workflow_call:'), ['workflow_call']);
});

test('no run script interpolates the github context', () => {
  const hits = workflows.flatMap((w) => interpolations(w.doc).map((h) => `${w.file}:${h}`));
  assert.deepEqual(hits, []);
});

test('the run-script scan sees every spelling of the github context and a }} inside a string', () => {
  const doc = (run) => ({ jobs: { j: { steps: [{ run }] } } });
  for (const run of [
    'echo ${{ github.event.pull_request.title }}',
    "echo ${{ github.event['pull_request'] }}",
    "echo ${{ github['event'].pull_request.title }}",
    'echo ${{ toJSON(github.event) }}',
    'echo ${{ toJSON(github) }}',
    'echo ${{ github.EVENT.pull_request.title }}',
    "echo ${{ format('{0}', github.event.x) }}",
    "echo ${{ '}}' && github.event.pull_request.title }}",
    "echo ${{ format('}}{0}', github.event.x) }}",
    "echo ${{ 'a}}b' }} ${{ github.head_ref }}",
    'echo ${{ github.event.x }}; echo $GITHUB_ENV',
    "echo ${{ '$GITHUB_X' && github.event.x }}",
    'echo ${{ inputs.x }} $github.event',
    'echo ${{ github.head_ref }}',
  ]) assert.ok(interpolations(doc(run)).length > 0, run);
  // These read other contexts, and a plain "$VAR" is the way a script reads the event.
  for (const run of [
    'echo ${{ inputs.command }}',
    'echo ${{ steps.a.outputs.b }}',
    'echo "$TITLE"',
    'echo "${{ job.workflow_sha }}" | tee -a "$GITHUB_STEP_SUMMARY"',
    'echo ${{ inputs.x }} >> "${GITHUB_OUTPUT}"',
  ])
    assert.deepEqual(interpolations(doc(run)), [], run);
});

test('a github value mapped through env passes', () => {
  // The expression sits in `env:`, which is the sanctioned route, and the script reads "$SHA".
  const doc = { jobs: { j: { steps: [{ env: { SHA: '${{ github.sha }}' }, run: 'echo "$SHA"' }] } } };
  assert.deepEqual(interpolations(doc), []);
});
