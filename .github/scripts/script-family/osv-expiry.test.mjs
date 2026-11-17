// Tests for osv-expiry.mjs: the ignores a toml holds, which end soon, and that the run only ever warns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clean, dateOf, expiring, ignores, line, main, scan, unreadable } from './osv-expiry.mjs';

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

test('an ignore is ended from the moment its date is reached, a date-only one after midnight UTC of its day', () => {
  const [item] = expiring(toml(['X', '2026-11-17']), NOW, 21);
  assert.equal(item.ended, true);
  assert.match(line({ repo: 'o/r' }, item), /ended on 2026-11-17/);
  const [later] = expiring(toml(['X', '2026-11-18']), NOW, 21);
  assert.equal(later.ended, false);
});

test('single quotes, an offset, fractional seconds and CRLF are read, and an unreadable date is counted', () => {
  const text = "[[IgnoredVulns]]\r\nid = 'A'\r\nignoreUntil = '2026-12-01'\r\n[[IgnoredVulns]]\nid = \"B\"\nignoreUntil = 2026-12-01T10:00:00-03:00\n[[IgnoredVulns]]\nid = \"C\"\nignoreUntil = 2026-12-01T00:00:00.5Z\n[[IgnoredVulns]]\nid = \"D\"\nignoreUntil = soon\n";
  assert.deepEqual(ignores(text).map(({ id }) => id), ['A', 'B', 'C']);
  assert.equal(unreadable(text), 1);
  const results = scan(['o/r'], NOW, 21, () => text);
  assert.match(results[0].note, /1 ignore\(s\) with an ignoreUntil that cannot be read/);
});

test('text from another repository file cannot add a workflow command or a line', () => {
  const evil = 'X\r::error title=pwn::injected%0A';
  assert.equal(/[\r\n%]/.test(clean(evil)), false);
  assert.equal(clean(evil).includes('::'), false);
  const text = `[[IgnoredVulns]]\nid = "${evil}"\nignoreUntil = 2020-01-01\n`;
  const lines = [];
  const original = console.log;
  console.log = (value) => lines.push(String(value));
  try {
    main(['--list', '/dev/null', '--days', '21'], {}, NOW, () => text);
  } finally {
    console.log = original;
  }
  for (const out of lines) assert.equal(/[\r]|::error/.test(out), false, out);
});

test('a date that does not exist is unreadable, a time after a space is kept, and markdown cannot reach the summary', () => {
  const text = '[[IgnoredVulns]]\nid = "A"\nignoreUntil = 2026-02-30\n[[IgnoredVulns]]\nid = "B"\nignoreUntil = 2026-12-01 10:00:00\n';
  assert.deepEqual(ignores(text).map(({ id }) => id), ['B']);
  assert.equal(unreadable(text), 1);
  assert.equal(ignores(text)[0].until.toISOString(), '2026-12-01T10:00:00.000Z');
  assert.equal(/[\[\]()<>`]/.test(clean('[click](https://evil.example) <b>`x`')), false);
});

test('every form of a TOML date and date-time is read once, as the case list says', () => {
  const read = (text) => dateOf(text)?.toISOString() ?? null;
  const cases = [
    ['2026-12-01', '2026-12-01T00:00:00.000Z'],
    ['2026-12-01T10:00:00Z', '2026-12-01T10:00:00.000Z'],
    ['2026-12-01t10:00:00z', '2026-12-01T10:00:00.000Z'],
    ['2026-12-01 10:00:00', '2026-12-01T10:00:00.000Z'],
    ['2026-12-01T10:00:00', '2026-12-01T10:00:00.000Z'],
    ['2026-12-01T10:00:00.5Z', '2026-12-01T10:00:00.500Z'],
    ['2026-12-01T10:00:00-03:00', '2026-12-01T13:00:00.000Z'],
    ['2026-12-01 10:00:00+02:00', '2026-12-01T08:00:00.000Z'],
    ['2028-02-29', '2028-02-29T00:00:00.000Z'],
    ['2027-02-29', null],
    ['2026-02-30', null],
    ['2026-13-01', null],
    ['2026-12-32', null],
    ['2026-12-01T25:00:00Z', null],
    ['soon', null],
    ['', null],
  ];
  for (const [text, expected] of cases) assert.equal(read(text), expected, text);
  const block = (value) => `[[IgnoredVulns]]\nid = "A"\nignoreUntil = ${value}\n`;
  for (const [written, expected] of [
    ['2026-12-01', '2026-12-01'],
    ['"2026-12-01"', '2026-12-01'],
    ["'2026-12-01'", '2026-12-01'],
    ['2026-12-01 # note', '2026-12-01'],
    ['"2026-12-01" # note', '2026-12-01'],
    ['2026-12-01 10:00:00 # note', '2026-12-01'],
    ['"2026-12-01T10:00:00Z"   # note', '2026-12-01'],
  ]) {
    const found = ignores(block(written));
    assert.equal(found.length, 1, written);
    assert.equal(found[0].until.toISOString().slice(0, 10), expected, written);
  }
  assert.equal(unreadable(block('2026-02-30')), 1);
  assert.equal(unreadable(block('"soon"')), 1);
});

test('a table header with a comment, a multi-line string and a comment line never change what is read', () => {
  const cases = [
    ['[[IgnoredVulns]] # triaged\nid = "A"\nignoreUntil = 2027-01-01\n', ['A']],
    ['[[IgnoredVulns]]\nid = "A"\nreason = """\n[CVE-1] not reachable\n"""\nignoreUntil = 2027-01-01\n', ['A']],
    ['[[IgnoredVulns]]\nid = "A"\nreason = """\nignoreUntil = 2099-01-01\n"""\nignoreUntil = 2027-01-01\n', ['A']],
    ["[[IgnoredVulns]]\nid = \"A\"\nreason = \'\'\'\nid = \"B\"\n\'\'\'\nignoreUntil = 2027-01-01\n", ['A']],
    ['[[IgnoredVulns]]\nid = "A"\nreason = """\n[[IgnoredVulns]]\n"""\nignoreUntil = 2027-01-01\n', ['A']],
    ['# [[IgnoredVulns]]\n[[IgnoredVulns]]\nid = "A"\n# ignoreUntil = 2020-01-01\nignoreUntil = 2027-01-01\n', ['A']],
  ];
  for (const [text, ids] of cases) {
    const found = ignores(text);
    assert.deepEqual(found.map(({ id }) => id), ids, text);
    assert.equal(found[0].until.toISOString().slice(0, 10), '2027-01-01', text);
  }
});
