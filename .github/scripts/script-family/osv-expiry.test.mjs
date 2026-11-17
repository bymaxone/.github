// Tests for osv_expiry.py, run through the interpreter the workflow uses (`python3 -I`): every form of an
// `ignoreUntil` the reviews found, the window, the ended wording, text that cannot reach a workflow command, a file
// that is not TOML, and the workflow step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./osv_expiry.py', import.meta.url));
const WORKFLOW = fileURLToPath(new URL('../../workflows/script-family-check.yml', import.meta.url));
const NOW = '2026-11-17T12:00:00Z';
const dir = mkdtempSync(join(tmpdir(), 'osv-expiry-'));

/** The interpreter, isolated as the workflow runs it. */
const python = (...args) => spawnSync('python3', ['-I', SCRIPT, ...args], { encoding: 'utf8' });

/** The result of one TOML text: `[[repo, [[id, until, left, ended]], note]]`. */
const read = (toml, days = 60) => {
  const file = join(dir, `case-${Math.random().toString(16).slice(2)}.toml`);
  writeFileSync(file, toml);
  const run = python('--file', file, '--now', NOW, '--days', String(days));
  assert.equal(run.status, 0, run.stderr);
  const [[, items, note]] = JSON.parse(run.stdout);
  return { items, note };
};
const block = (id, until) => `[[IgnoredVulns]]\nid = "${id}"\n${until === null ? '' : `ignoreUntil = ${until}\n`}reason = "x"\n`;
const ids = (toml, days) => read(toml, days).items.map(([id]) => id);

test('a date or a date-time is read in every form TOML writes, and an impossible day is not a date', () => {
  for (const [written, expected] of [
    ['2026-12-01', '2026-12-01T00:00:00+00:00'],
    ['2026-12-01T10:00:00Z', '2026-12-01T10:00:00+00:00'],
    ['2026-12-01 10:00:00', '2026-12-01T10:00:00+00:00'],
    ['2026-12-01T10:00:00', '2026-12-01T10:00:00+00:00'],
    ['2026-12-01T10:00:00.5Z', '2026-12-01T10:00:00.500000+00:00'],
    ['2026-12-01T10:00:00-03:00', '2026-12-01T13:00:00+00:00'],
    ['2026-12-01 10:00:00+02:00', '2026-12-01T08:00:00+00:00'],
    ['"2026-12-01"', '2026-12-01T00:00:00+00:00'],
    ["'2026-12-01'", '2026-12-01T00:00:00+00:00'],
    ['"2026-12-01T10:00:00Z"', '2026-12-01T10:00:00+00:00'],
    ['2026-12-01 # note', '2026-12-01T00:00:00+00:00'],
    ['"2026-12-01" # note', '2026-12-01T00:00:00+00:00'],
    ['2026-12-01 10:00:00 # note', '2026-12-01T10:00:00+00:00'],
    ['2028-02-29', '2028-02-29T00:00:00+00:00'],
  ]) {
    const { items } = read(block('A', written), 2000);
    assert.equal(items.length, 1, written);
    assert.equal(items[0][1], expected, written);
  }
  // A day that does not exist is not TOML, so the file is not read and says so; the text is never printed.
  const { items, note } = read(block('A', '2026-02-30'));
  assert.deepEqual(items, []);
  assert.match(note, /not valid TOML, not read/);
  assert.equal(note.includes('2026-02-30'), false);
  assert.match(read(block('A', '"soon"')).note, /1 ignore\(s\) with an ignoreUntil that is not a date/);
});

test('the layout of a file never changes what is read: comments, multi-line strings, several tables, CRLF', () => {
  for (const toml of [
    '[[IgnoredVulns]] # triaged\nid = "A"\nignoreUntil = 2026-12-01\n',
    '[[IgnoredVulns]]\nid = "A"\nreason = """\n[CVE-1] not reachable\n"""\nignoreUntil = 2026-12-01\n',
    '[[IgnoredVulns]]\nid = "A"\nreason = """\nignoreUntil = 2099-01-01\n"""\nignoreUntil = 2026-12-01\n',
    "[[IgnoredVulns]]\nid = \"A\"\nreason = '''\nid = \"B\"\n'''\nignoreUntil = 2026-12-01\n",
    '[[IgnoredVulns]]\nid = "A"\nreason = """\n[[IgnoredVulns]]\n"""\nignoreUntil = 2026-12-01\n',
    '# [[IgnoredVulns]]\n[[IgnoredVulns]]\nid = "A"\n# ignoreUntil = 2020-01-01\nignoreUntil = 2026-12-01\n',
    '[[IgnoredVulns]]\r\nid = "A"\r\nignoreUntil = 2026-12-01\r\n',
    "[[IgnoredVulns]]\nignoreUntil = 2026-12-01\nid = 'A'\n",
    '[[PackageOverrides]]\nname = "x"\nignoreUntil = 2020-01-01\n[[IgnoredVulns]]\nid = "A"\nignoreUntil = 2026-12-01\n',
    '[[IgnoredVulns]]\nid = "A"\nignoreUntil = 2026-12-01\n[[IgnoredVulns]]\nid = "B"\n',
  ]) {
    assert.deepEqual(ids(toml), ['A'], toml);
  }
});

test('an ignore is due inside the window, on its boundary and after it ended, and not before; an ended one says ended', () => {
  const toml = [block('IN-3', '2026-11-20T12:00:00Z'), block('EDGE', '2026-12-08T12:00:00Z'), block('LATE', '2026-12-09T12:00:00Z'), block('GONE', '2026-11-10'), block('TODAY', '2026-11-17')].join('\n');
  const found = read(toml, 21).items.map(([id, , left, ended]) => [id, left, ended]);
  assert.deepEqual(found, [['GONE', -7, true], ['TODAY', 0, true], ['IN-3', 3, false], ['EDGE', 21, false]]);
});

test('the run warns with the day and the days left, never fails, and says an ended ignore is reported again', () => {
  const dirOf = mkdtempSync(join(tmpdir(), 'osv-list-'));
  writeFileSync(join(dirOf, 'list.txt'), 'o/a demo\no/a other\no/b demo\n');
  writeFileSync(join(dirOf, 'o__a.toml'), block('SOON', '2026-11-30T00:00:00Z') + block('OVER', '2026-11-01'));
  const summary = join(dirOf, 'summary.md');
  const run = python('--list', join(dirOf, 'list.txt'), '--now', NOW, '--days', '21', '--from-dir', dirOf, '--summary', summary);
  assert.equal(run.status, 0);
  assert.match(run.stdout, /::warning title=osv-expiry::o\/a: the ignore of OVER ended on 2026-11-01; the audit reports it again/);
  assert.match(run.stdout, /o\/a: the ignore of SOON ends on 2026-11-30 \(13 days\)/);
  assert.match(run.stdout, /o\/b: osv-scanner.toml: none or unreadable/);
  assert.match(readFileSync(summary, 'utf8'), /the ignore of SOON/);
});

test('text from another repository file cannot add a workflow command, a line or a link', () => {
  const dirOf = mkdtempSync(join(tmpdir(), 'osv-evil-'));
  writeFileSync(join(dirOf, 'list.txt'), 'o/a demo\n');
  writeFileSync(join(dirOf, 'o__a.toml'), '[[IgnoredVulns]]\nid = "X\\r::error title=pwn::injected%0A [click](https://evil.example) <b>"\nignoreUntil = 2020-01-01\n');
  const run = python('--list', join(dirOf, 'list.txt'), '--now', NOW, '--from-dir', dirOf);
  assert.equal(run.status, 0);
  for (const out of run.stdout.split('\n')) assert.equal(/\r|^::error|[\[\]()<>%]/.test(out.replace(/^::warning title=osv-expiry::/, '')), false, out);
});

test('a list line that is not owner/name template is refused before anything is read', () => {
  const dirOf = mkdtempSync(join(tmpdir(), 'osv-bad-'));
  writeFileSync(join(dirOf, 'list.txt'), 'not-a-repo demo\n');
  assert.notEqual(python('--list', join(dirOf, 'list.txt'), '--from-dir', dirOf).status, 0);
});

test('the weekly workflow runs the script isolated, as a step that warns and does not fail the job', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  const step = /- name: Warn before an advisory ignore ends\n([\s\S]*?)(?=\n\s*# A reminder|\n\s*- name:|$)/.exec(workflow)?.[1] ?? '';
  assert.match(step, /if: \$\{\{ !cancelled\(\) \}\}/);
  assert.match(step, /python3 -I \.github\/scripts\/script-family\/osv_expiry\.py --list \.github\/script-adopters\.txt --days 21/);
  assert.doesNotMatch(step, /continue-on-error|exit 1/);
});
