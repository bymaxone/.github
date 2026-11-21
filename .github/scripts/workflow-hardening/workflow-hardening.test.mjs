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

test('every third-party action is pinned to a full commit with a version comment', () => {
  const hits = [];
  for (const w of workflows) {
    w.text.split('\n').forEach((line, i) => {
      const m = line.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/);
      if (!m || m[1].startsWith('./') || m[1].startsWith('bymaxone/')) return;
      if (!/@[0-9a-f]{40}$/.test(m[1]) || !/#\s*v?\d/.test(m[2])) hits.push(`${w.file}:${i + 1}:${m[1]}`);
    });
  }
  assert.deepEqual(hits, []);
});
