// Tests for check-family.mjs: the list, the manifest, and the byte comparison against injected `gh` answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { checkFamily, main, readList, readTemplate, report } from './check-family.mjs';

const SHA = 'a'.repeat(40);
const TEMPLATES = new Map([['demo', [{ target: 'scripts/demo.mjs', text: 'one\n' }, { target: 'src/demo.spec.ts', text: 'two\n' }]]]);

/** A `gh` stand-in: `files` maps a target path to its text; a path absent from it fails as a 404 does. */
const fake = (files, { branch = 'main', sha = SHA } = {}) => (args) => {
  const path = args[1];
  if (path === 'repos/o/r') return `${branch}\n`;
  if (path.startsWith('repos/o/r/commits/')) return `${sha}\n`;
  const m = /^repos\/o\/r\/contents\/(.+)\?ref=([0-9a-f]+)$/.exec(path);
  if (m && m[2] === sha && m[1] in files) return files[m[1]];
  throw new Error('404');
};
const entry = [{ repo: 'o/r', template: 'demo' }];
const EXEMPT = 'scripts/mutation-inventory.exempt.json';
const exempting = (...files) => JSON.stringify(files.map((file) => ({ file, reason: 'Judges no mutant.' })));

test('the list ignores comments and blank lines and rejects a malformed line', () => {
  assert.deepEqual(readList('# note\n\no/r demo # trailing\n'), [{ repo: 'o/r', template: 'demo' }]);
  for (const bad of ['o/r', 'o/r demo extra', 'not-a-repo demo', 'o/r ../x', 'o/r Demo']) {
    assert.throws(() => readList(bad), /owner\/name template/);
  }
});

test('a copy equal to the template in every file is ok and names the commit it read', () => {
  const [r] = checkFamily(entry, TEMPLATES, fake({ 'scripts/demo.mjs': 'one\n', 'src/demo.spec.ts': 'two\n', [EXEMPT]: exempting('src/demo.spec.ts') }));
  assert.deepEqual(r.problems, []);
  assert.equal(r.sha, SHA);
  assert.match(report([r]), /o\/r \(demo\) @ a{40}: ok/);
});

test('one byte of difference, including a trailing newline, is a problem for that file only', () => {
  const [r] = checkFamily(entry, TEMPLATES, fake({ 'scripts/demo.mjs': 'one', 'src/demo.spec.ts': 'two\n', [EXEMPT]: exempting('src/demo.spec.ts') }));
  assert.deepEqual(r.problems, ['scripts/demo.mjs: differs from the template']);
});

test('a missing file, an unreadable repository and an unknown template are each a problem', () => {
  assert.deepEqual(checkFamily(entry, TEMPLATES, fake({ 'scripts/demo.mjs': 'one\n' }))[0].problems, ['src/demo.spec.ts: missing']);
  assert.deepEqual(checkFamily(entry, TEMPLATES, () => { throw new Error('boom'); })[0].problems, ['unreadable']);
  assert.deepEqual(checkFamily(entry, TEMPLATES, fake({}, { sha: 'not-a-sha' }))[0].problems, ['unreadable']);
  assert.deepEqual(checkFamily([{ repo: 'o/r', template: 'nope' }], TEMPLATES, fake({}))[0].problems, ['nope: no such template or unreadable manifest']);
});

test('every template of the repository has a manifest whose files exist, and every listed adopter names one', () => {
  const root = new URL('../../script-templates/', import.meta.url).pathname;
  const names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(names.length > 0);
  for (const name of names) {
    const files = readTemplate(root, name);
    assert.equal(new Set(files.map((f) => f.target)).size, files.length, `${name}: a target is listed twice`);
  }
  const list = readList(readFileSync(new URL('../../script-adopters.txt', import.meta.url), 'utf8'));
  for (const { template } of list) assert.ok(existsSync(join(root, template, 'template.json')), `${template}: not a template`);
});

test('a manifest entry that climbs out of the adopter is refused', () => {
  const root = new URL('./fixtures-bad/', import.meta.url).pathname;
  assert.throws(() => readTemplate(root, 'climbs'), /plain relative path/);
});

test('a manifest source that climbs out of the template is refused too', () => {
  const root = new URL('./fixtures-bad/', import.meta.url).pathname;
  assert.throws(() => readTemplate(root, 'climbs-source'), /plain relative path/);
});

test('an adopter naming a template that has no directory fails the run with a report, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'script-family-'));
  const list = join(dir, 'list.txt');
  const summary = join(dir, 'summary.md');
  writeFileSync(list, 'o/r missing-template\n');
  const logs = [];
  const log = console.log;
  console.log = (line) => logs.push(line);
  try {
    assert.equal(main(['--list', list, '--templates', dir, '--summary', summary], {}), 1);
  } finally {
    console.log = log;
  }
  assert.match(readFileSync(summary, 'utf8'), /missing-template: no such template or unreadable manifest/);
  assert.ok(logs.some((l) => l.startsWith('::error title=script-family::')));
});

// The cold run's inventory fails a unit test that judges no mutant and is not listed in scripts/mutation-inventory.exempt.json, and
// the per-push job does not run it, so an adopter that copies a template spec without listing it fails only at its release. The family
// check therefore reads the list too: every spec of a template that the adopter holds must be in it.
test('a template spec that the adopter holds and does not list as exempt is a problem named for that file', () => {
  const files = { 'scripts/demo.mjs': 'one\n', 'src/demo.spec.ts': 'two\n', [EXEMPT]: exempting('src/other.spec.ts') };
  const [r] = checkFamily(entry, TEMPLATES, fake(files));
  assert.deepEqual(r.problems, [`src/demo.spec.ts: not in ${EXEMPT}`]);
});

test('an adopter that lists every spec of the template as exempt is ok, and extra entries do no harm', () => {
  const files = { 'scripts/demo.mjs': 'one\n', 'src/demo.spec.ts': 'two\n', [EXEMPT]: exempting('src/other.spec.ts', 'src/demo.spec.ts') };
  assert.deepEqual(checkFamily(entry, TEMPLATES, fake(files))[0].problems, []);
});

test('a missing or unreadable exempt list is one problem, and a spec the adopter does not hold is only missing', () => {
  const base = { 'scripts/demo.mjs': 'one\n', 'src/demo.spec.ts': 'two\n' };
  assert.deepEqual(checkFamily(entry, TEMPLATES, fake(base))[0].problems, [`${EXEMPT}: missing or unreadable`]);
  assert.deepEqual(checkFamily(entry, TEMPLATES, fake({ ...base, [EXEMPT]: 'not json' }))[0].problems, [`${EXEMPT}: missing or unreadable`]);
  assert.deepEqual(checkFamily(entry, TEMPLATES, fake({ ...base, [EXEMPT]: '{"file": "x"}' }))[0].problems, [`${EXEMPT}: missing or unreadable`]);
  assert.deepEqual(checkFamily(entry, TEMPLATES, fake({ 'scripts/demo.mjs': 'one\n', [EXEMPT]: exempting() }))[0].problems, ['src/demo.spec.ts: missing']);
});

test('a template without a spec asks for no exempt list', () => {
  const noSpec = new Map([['plain', [{ target: 'scripts/plain.mjs', text: 'x\n' }]]]);
  const r = checkFamily([{ repo: 'o/r', template: 'plain' }], noSpec, fake({ 'scripts/plain.mjs': 'x\n' }));
  assert.deepEqual(r[0].problems, []);
});

test('every spec of every template is a src/ spec, which is where the exempt list names it', () => {
  const root = new URL('../../script-templates/', import.meta.url).pathname;
  for (const name of readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    for (const { target } of readTemplate(root, name)) {
      if (target.endsWith('.spec.ts')) assert.match(target, /^src\/[A-Za-z0-9._-]+\.spec\.ts$/, `${name}: ${target}`);
    }
  }
});
