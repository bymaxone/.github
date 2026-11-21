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

// The `${{ }}` expressions in run scripts that name the github context at all. The context carries
// the event payload and the head ref, which an attacker chooses, and an expression can reach them
// through a dot, a bracket, a function or another letter case, so no spelling is matched: any
// expression that mentions `github` is a hit.
//
// Policy: a run script takes context values only through `env:`, and reads them as "$VAR".
function interpolations(doc) {
  const found = [];
  for (const [name, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      const run = step.run ?? '';
      for (let at = run.indexOf('${{'); at >= 0; at = run.indexOf('${{', at + 3)) {
        const end = run.indexOf('}}', at);
        const expression = run.slice(at, end < 0 ? undefined : end + 2);
        if (/github/i.test(expression)) found.push(`${name}:${expression}`);
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

test('the run-script scan sees every spelling of the github context', () => {
  const doc = (run) => ({ jobs: { j: { steps: [{ run }] } } });
  for (const run of [
    'echo ${{ github.event.pull_request.title }}',
    "echo ${{ github.event['pull_request'] }}",
    "echo ${{ github['event'].pull_request.title }}",
    'echo ${{ toJSON(github.event) }}',
    'echo ${{ toJSON(github) }}',
    'echo ${{ github.EVENT.pull_request.title }}',
    "echo ${{ format('{0}', github.event.x) }}",
    'echo ${{ github.head_ref }}',
  ]) assert.equal(interpolations(doc(run)).length, 1, run);
  // These read other contexts, and a plain "$VAR" is the way a script reads the event.
  for (const run of ['echo ${{ inputs.command }}', 'echo ${{ steps.a.outputs.b }}', 'echo "$TITLE"'])
    assert.deepEqual(interpolations(doc(run)), [], run);
});

test('a github value mapped through env passes', () => {
  // The expression sits in `env:`, which is the sanctioned route, and the script reads "$SHA".
  const doc = { jobs: { j: { steps: [{ env: { SHA: '${{ github.sha }}' }, run: 'echo "$SHA"' }] } } };
  assert.deepEqual(interpolations(doc), []);
});
