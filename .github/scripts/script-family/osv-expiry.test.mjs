// Tests for osv-expiry.mjs: the ignores a toml holds, which end soon, and that the run only ever warns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expiring, ignores, line, main, scan } from './osv-expiry.mjs';

const NOW = new Date('2026-11-17T12:00:00Z');
const toml = (...blocks) => blocks.map(([id, until]) => `[[IgnoredVulns]]\nid = "${id}"\n${until ? `ignoreUntil = ${until}\n` : ''}reason = "x"\n`).join('\n');

test('the ignores of a toml are read with their dates, and a block without a date or with a bad one is left out', () => {
  const text = toml(['A', '2027-01-27T00:00:00Z'], ['B', null], ['C', '"2026-12-01"'], ['D', '2026-13-45']);
  assert.deepEqual(ignores(text).map(({ id }) => id), ['A', 'C']);
  assert.deepEqual(ignores(''), []);
  assert.deepEqual(ignores('# only a comment\n[[PackageOverrides]]\nname = "x"\n'), []);
});

test('an ignore is due within the window, on its boundary and after it ended, and not before', () => {
  const text = toml(['IN-3', '2026-11-20T12:00:00Z'], ['EDGE', '2026-12-08T12:00:00Z'], ['LATE', '2026-12-09T12:00:00Z'], ['GONE', '2026-11-10T00:00:00Z']);
  const due = expiring(text, NOW, 21).map(({ id, left }) => [id, left]);
  assert.deepEqual(due, [['GONE', -7], ['IN-3', 3], ['EDGE', 21]]);
});

test('the line says the day, the days left, and that an ended ignore is reported again', () => {
  const [item] = expiring(toml(['X', '2026-11-18T12:00:00Z']), NOW, 21);
  assert.match(line({ repo: 'o/r' }, item), /o\/r: the ignore of X ends on 2026-11-18 \(1 day\)/);
  const [gone] = expiring(toml(['Y', '2026-11-01T00:00:00Z']), NOW, 21);
  assert.match(line({ repo: 'o/r' }, gone), /ended on 2026-11-01; the audit reports it again/);
});

test('a repository without the file or with an unreadable one is a note, and the run never fails', () => {
  const answers = { 'repos/o/a/contents/osv-scanner.toml': toml(['SOON', '2026-11-30T00:00:00Z']) };
  const fetch = (args) => {
    const path = args[1];
    if (path in answers) return answers[path];
    throw new Error('404');
  };
  const results = scan(['o/a', 'o/b'], NOW, 21, fetch);
  assert.equal(results[0].due.length, 1);
  assert.match(results[1].note, /none or unreadable/);
  const dir = mkdtempSync(join(tmpdir(), 'osv-expiry-'));
  writeFileSync(join(dir, 'list.txt'), 'o/a demo\no/a other\n');
  const summary = join(dir, 'summary.md');
  const code = main(['--list', join(dir, 'list.txt'), '--summary', summary], {}, NOW, fetch);
  assert.equal(code, 0);
  assert.match(readFileSync(summary, 'utf8'), /the ignore of SOON ends on 2026-11-30/);
});

test('a window that is not a whole number of days is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'osv-expiry-'));
  writeFileSync(join(dir, 'list.txt'), 'o/a demo\n');
  assert.throws(() => main(['--list', join(dir, 'list.txt'), '--days', 'soon'], {}, NOW, () => ''), /whole number/);
});

test('the weekly workflow runs the check as a step that warns and does not fail the job', () => {
  const workflow = readFileSync(new URL('../../workflows/script-family-check.yml', import.meta.url), 'utf8');
  const step = /- name: Warn before an advisory ignore ends\n([\s\S]*?)(?=\n\s*# A reminder|\n\s*- name:|$)/.exec(workflow)?.[1] ?? '';
  assert.match(step, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(step, /osv-expiry\.mjs --list \.github\/script-adopters\.txt --days 21/);
  assert.doesNotMatch(step, /continue-on-error|exit 1/);
});
