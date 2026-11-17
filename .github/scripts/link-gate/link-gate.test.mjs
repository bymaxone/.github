// Tests of the link-gate probe: that it still catches the defect on a frozen copy of a library's link check,
// that it cannot be satisfied by a dead branch, and that the code it runs from other repositories runs with
// nothing: no token, no real network, a timeout, and (on Linux) no network namespace and another identity.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkFamily, readScript, report } from './check-family.mjs';
import { CASES, mismatches, patched } from './matrix.mjs';
import { isolation, linkBlock, probe } from './probe.mjs';

const fixture = readFileSync(new URL('./fixtures/link-check.txt', import.meta.url), 'utf8');
const SIX = ['503', '500', '502', '504', '429-after-retry', 'head-5xx-get-ok'];
const names = (bad) => bad.map((b) => b.split(':')[0]);

test('the frozen link check fails exactly the six cases where a third party\'s trouble must be a note', () => {
  const { bad } = mismatches(fixture);
  assert.deepEqual(names(bad).sort(), [...SIX].sort());
  assert.ok(bad.every((b) => b.endsWith('wanted note, got fail')), 'each one is a failure where a note is wanted');
});

test('with the patch the frozen link check decides all cases as wanted, and 404, 410, 403, 401, http, private and anchor still fail', () => {
  const p = patched(fixture);
  assert.ok(p, 'the anchor is unique in the frozen copy');
  const { bad, notes } = mismatches(p);
  assert.deepEqual(bad, []);
  assert.ok(notes.some((n) => n.includes('/503') && n.includes('HTTP 503')), 'the note names the url and the status');
  assert.ok(notes.some((n) => n.includes('/429-after-retry') && n.includes('HTTP 429')));
  assert.equal(Object.values(CASES).filter(([, want]) => want === 'fail').length, 7);
});

test('a patch whose condition is dead is not accepted: the probe reports the cases again', () => {
  const dead = patched(fixture).replace('res.status >= 500 || res.status === 429', 'res.status >= 600');
  assert.deepEqual(names(mismatches(dead).bad).sort(), [...SIX].sort());
  const noRetryClass = patched(fixture).replace('res.status >= 500 || res.status === 429', 'res.status >= 500');
  assert.deepEqual(names(mismatches(noRetryClass).bad), ['429-after-retry']);
});

test('a link check that stops failing a dead link is not accepted either', () => {
  const lax = patched(fixture).replace('return `${url} → HTTP ${res.status}`', 'return null');
  const failing = names(mismatches(lax).bad);
  for (const dead of ['404', '410', '403', '401']) assert.ok(failing.includes(dead), dead);
});

test('a text with no link check is unrecognised, not ok', () => {
  assert.deepEqual(mismatches('console.log("nothing to see")'), { problem: 'unrecognised' });
  assert.deepEqual(mismatches('/** Slug a Markdown heading */ function slug() {}'), { problem: 'unrecognised' });
  assert.equal(linkBlock('async function checkLinks() {\n}\n'), null, 'no slug helper, so not the link check');
});

// A link check that is hostile: it reports what it can see instead of checking links. The probe cuts a link
// check at the first closing brace in column 0, so a body written here keeps its own braces indented.
const hostile = (body) => `/** Slug a Markdown heading */\nfunction slug(h) { return h }\nasync function checkLinks() {\n${body}\n}\n`;

test('the child sees no token and no environment at all', () => {
  process.env.GH_TOKEN = 'secret-gh-token-123';
  process.env.GITHUB_TOKEN = 'secret-github-token-456';
  try {
    // macOS adds __CF_USER_TEXT_ENCODING to every process; it is the system's, not the caller's.
    const r = probe(hostile("fail('env', JSON.stringify(Object.keys(process.env).filter((k) => k !== '__CF_USER_TEXT_ENCODING').sort()) + JSON.stringify([process.env.GH_TOKEN, process.env.GITHUB_TOKEN]))"), { 'https://a.example/x': { GET: 200 } });
    assert.deepEqual(r.failures, ['env: [][null,null]']);
  } finally {
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  }
});

test('fetch and DNS are the stubs: a request to a host nobody listed gets the stub\'s answer, not the network', () => {
  const r = probe(hostile("const res = await fetch('https://unlisted.invalid/x'); fail('fetch', String(res.status))"), { 'https://a.example/x': { GET: 200 } });
  assert.deepEqual(r.failures, ['fetch: 599']);
});

test('a child that does not finish is stopped, and reported as an error', () => {
  const r = probe(hostile('while (true) {}'), { 'https://a.example/x': { GET: 200 } }, { timeoutMs: 700 });
  assert.match(r.error, /timed out/);
});

test('the family walk reads the link module when a library keeps one, and reports each library by its commit', () => {
  const sha = (c) => c.repeat(40);
  const calls = [];
  const fetch = (args) => {
    calls.push(args.join(' '));
    const url = args[1];
    if (url === 'repos/o/modular') return 'main\n';
    if (url === 'repos/o/modular/commits/main') return `${sha('a')}\n`;
    if (url.startsWith('repos/o/modular/contents/scripts/published-surface-links.mjs')) return 'export async function checkLinks({ readme, root, fail }) { fail("links", "x") }\n';
    if (url === 'repos/o/plain') return 'trunk\n';
    if (url === 'repos/o/plain/commits/trunk') return `${sha('b')}\n`;
    if (url.startsWith('repos/o/plain/contents/scripts/check-published-surface.mjs')) return patched(fixture);
    if (url === 'repos/o/empty') return 'main\n';
    if (url === 'repos/o/empty/commits/main') return `${sha('c')}\n`;
    throw new Error('404');
  };
  const results = checkFamily(['o/modular', 'o/plain', 'o/empty', 'o/gone'], fetch);
  assert.equal(results[0].path, 'scripts/published-surface-links.mjs');
  assert.ok(results[0].problems.length > 0, 'a module that fails everything does not decide the cases as wanted');
  assert.deepEqual(results[1], { repo: 'o/plain', sha: sha('b'), path: 'scripts/check-published-surface.mjs', problems: [] });
  assert.deepEqual(results[2].problems, ['no-script']);
  assert.deepEqual(results[3].problems, ['unreadable']);
  assert.ok(calls.some((c) => c.includes(`ref=${sha('b')}`)), 'the file is read at the commit, not at the branch');
  assert.match(report(results), new RegExp(`o/plain @ ${sha('b')} \\(scripts/check-published-surface.mjs\\): ok`));
  assert.equal(readScript('o/gone', fetch).error, 'unreadable');
});

// Linux only. On Linux a wrapper that cannot run is a failure of the test, not a reason to skip it: the job
// relies on the isolation, and an isolation that silently stopped working must not read as green.
test('isolated, the child cannot reach the network and cannot read the environment of the caller\'s processes', { skip: process.platform === 'linux' ? false : 'the isolation is Linux-only (unshare, setpriv, sudo)' }, async () => {
  // The caller's own `process.env` is not what /proc shows, which is the environment a process started with:
  // so the canary lives in the initial environment of a process this test starts, as the job's token does.
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { env: { LINK_GATE_CANARY: 'canary-value-do-not-leak-789' }, stdio: 'ignore' });
  try {
    const body = `
const net = await import('node:net')
const reach = await new Promise((resolve) => {
  const s = net.connect({ host: '1.1.1.1', port: 443, timeout: 3000 })
  s.on('connect', () => resolve('connected'))
  s.on('timeout', () => resolve('timeout'))
  s.on('error', (e) => resolve(String(e.code)))
  })
fail('net', reach)
const fs = await import('node:fs')
let seen = 0
  for (const pid of fs.readdirSync('/proc').filter((d) => /^[0-9]+$/.test(d))) {
    try { if (fs.readFileSync('/proc/' + pid + '/environ', 'utf8').includes('canary-value-do-not-leak-789')) seen++ } catch {}
  }
fail('environ', String(seen))
fail('uid', String(process.getuid()))`;
    const r = probe(hostile(body), { 'https://a.example/x': { GET: 200 } }, { wrap: isolation(), timeoutMs: 30_000 });
    assert.ok(r.failures, `the isolated child did not run: ${r.error}`);
    const [net, environ, uid] = r.failures.map((f) => f.split(': ')[1]);
    assert.notEqual(net, 'connected', 'no network');
    assert.match(net, /ENETUNREACH|EAI_AGAIN|ENETDOWN|ECONNREFUSED|EHOSTUNREACH|timeout/);
    assert.equal(environ, '0', 'the environment of the caller\'s processes is not readable');
    assert.notEqual(uid, '0', 'not root');
  } finally {
    holder.kill('SIGKILL');
  }
});

// The canonical link-check module (script-templates/published-surface-links) is measured in module form, as the
// family check measures a library that keeps one. The isolation follows the job: LINK_GATE_ISOLATE=1 adds it.
const template = readFileSync(new URL('../../script-templates/published-surface-links/published-surface-links.mjs', import.meta.url), 'utf8');
const templateOptions = process.env.LINK_GATE_ISOLATE === '1' ? { wrap: isolation(), timeoutMs: 60_000 } : { timeoutMs: 60_000 };
const mutate = (from, to) => {
  assert.equal(template.split(from).length, 2, `the anchor is unique in the template: ${from}`);
  return template.replace(from, to);
};
/** The cases the matrix reports for `script`, as `url: wanted X, got Y` lines. */
const mismatched = (script) => {
  const r = mismatches(script, templateOptions);
  assert.ok(r.bad, `the probe ran: ${r.problem}`);
  return r.bad;
};

test('the link-check template decides all 18 cases of the matrix as wanted', () => {
  assert.equal(Object.keys(CASES).length, 18);
  const { bad, notes } = mismatches(template, templateOptions);
  assert.deepEqual(bad, []);
  assert.ok(notes.some((n) => n.includes('/503') && n.includes('HTTP 503')));
});

test('the link-check template is not accepted once a decision is removed from it', () => {
  const sixNotes = mismatched(mutate('res.status >= 500 || res.status === 429', 'false'));
  assert.deepEqual(names(sixNotes).sort(), [...SIX].sort(), 'without the 5xx and 429 note branch');
  const no429 = mismatched(mutate('res.status >= 500 || res.status === 429', 'res.status >= 500'));
  assert.deepEqual(names(no429), ['429-after-retry']);
  const http = mismatched(mutate("if (u.protocol !== 'https:') return `uses ${u.protocol.replace(':', '')}, not https`", ''));
  assert.deepEqual(http, ['http://a.example/plain-http: wanted fail, got ok']);
  // The stub resolves every name to a public address, so the literal check is the only guard an IPv4 literal meets.
  const priv = mismatched(mutate('if (/^\\d{1,3}(\\.\\d{1,3}){3}$/.test(h)) {', 'if (false) {'));
  assert.deepEqual(priv, ['https://10.0.0.1/private: wanted fail, got ok']);
});

// Which raw HTML anchors the link check reads, as one table. The reference is a frozen copy of the three readers
// the libraries carried (double quotes only): for each row the kind they give it is computed, and the template
// must give the same kind to the double-quoted spelling and to the single-quoted one, which is the only change.
// A kind is what an anchor is checked as: an external link, an anchor of the page, a relative path, or nothing.
const OLD_READERS = {
  external: /<a\s+href="(https?:\/\/[^"]+)"/g,
  internal: /<a\s+href="(#[^"]+)"/g,
  relative: /<a\s+href="(?!https?:|#|mailto:)([^"]+)"/g
};
const oldKind = (html) => {
  const kinds = Object.keys(OLD_READERS).filter((kind) => [...html.matchAll(OLD_READERS[kind])].length > 0);
  assert.ok(kinds.length <= 1, `a row falls in one kind at most: ${html}`);
  return kinds[0] ?? null;
};
// The kind the template gave an anchor, read from the one failure it reports: every row is a README with no
// heading, no file and no network, so an external link can only fail as a private literal.
const kindOfFailures = (failures) => {
  if (failures.length === 0) return null;
  if (failures.length > 1) return `several (${failures.join(' | ')})`;
  if (/matches no heading/.test(failures[0])) return 'internal';
  if (/does not exist|outside the repository/.test(failures[0])) return 'relative';
  return 'external';
};
const VALUES = [
  'https://10.0.0.1/p', 'http://10.0.0.1/p', '#nohead', '#Mixed-Case', '#', 'mailto:a@b.c', 'missing.md', ' spaced.md ',
  'sub/missing.md#frag', '../outside.md', 'HTTPS://10.0.0.1/p', '', '#\nmissing', 'a\nb.md'
];
const SHAPES = [
  (q, v) => `<a href=${q}${v}${q}>x</a>`,
  (q, v) => `<a  href=${q}${v}${q}>x</a>`,
  (q, v) => `<a\thref=${q}${v}${q}>x</a>`,
  (q, v) => `<a class="c" href=${q}${v}${q}>x</a>`,
  (q, v) => `<A HREF=${q}${v}${q}>x</A>`,
  (q, v) => `<a href = ${q}${v}${q}>x</a>`,
  (q, v) => `<a href=${v}>x</a>`,
  (q, v) => `<a\nhref=${q}${v}${q}>x</a>`
];
const TABLE = SHAPES.flatMap((shape) => VALUES.flatMap((value) => ['"', "'"].map((quote) => ({ html: shape(quote, value), quote, value }))));

/** The rows on which the module at `path` disagrees with the reference, as `html: wanted X, got Y` lines. */
async function tableMismatches(path) {
  const { checkLinks } = await import(`${path}?table=${Math.random()}`);
  const root = mkdtempSync(join(tmpdir(), 'links-table-'));
  const bad = [];
  try {
    for (const row of TABLE) {
      // The reference reads double quotes only, so a single-quoted row is judged as its double-quoted twin.
      const wanted = oldKind(row.quote === "'" ? row.html.replaceAll("'", '"') : row.html);
      const failures = [];
      await checkLinks({ readme: `# T\n\n${row.html}\n`, root, fail: (...args) => failures.push(args.join(' ')) });
      const got = kindOfFailures(failures);
      if (got !== wanted) bad.push(`${row.html}: wanted ${wanted}, got ${got}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  return bad;
}
const TEMPLATE_PATH = new URL('../../script-templates/published-surface-links/published-surface-links.mjs', import.meta.url);

test('the link-check template reads raw HTML anchors as the double-quote readers did, in either quote style', async () => {
  assert.ok(TABLE.length > 100);
  assert.ok(new Set(TABLE.map((row) => oldKind(row.quote === "'" ? row.html.replaceAll("'", '"') : row.html))).size === 4, 'the table covers all four kinds');
  assert.deepEqual(await tableMismatches(TEMPLATE_PATH.pathname), []);
});

test('the table notices each decision of the href readers once it is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'links-mutants-'));
  const mutants = [
    ['no single quotes', String.raw`|'([^']+)')`, ')'],
    ['a bare # is an anchor', String.raw`/^#[\s\S]/.test(href)`, String.raw`href.startsWith('#')`],
    ['a # before a line break is no anchor', String.raw`/^#[\s\S]/.test(href)`, String.raw`/^#./.test(href)`],
    ['mailto is relative', String.raw`!/^(?:https?:|#|mailto:)/.test(href)`, String.raw`!/^(?:https?:|#)/.test(href)`],
    ['only https is external', String.raw`/^https?:\/\//.test(href)`, String.raw`/^https:\/\//.test(href)`],
    ['every other href is relative', String.raw`!/^(?:https?:|#|mailto:)/.test(href)`, 'true'],
    ['case is ignored', String.raw`/<a\s+href=(?:"([^"]+)"|'([^']+)')/g`, String.raw`/<a\s+href=(?:"([^"]+)"|'([^']+)')/gi`]
  ];
  try {
    for (const [name, from, to] of mutants) {
      const text = readFileSync(TEMPLATE_PATH, 'utf8');
      assert.equal(text.split(from).length, 2, `the anchor of the mutant is unique in the template: ${name}`);
      const file = join(dir, 'mutant.mjs');
      writeFileSync(file, text.replace(from, () => to));
      assert.notDeepEqual(await tableMismatches(file), [], `the table notices: ${name}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
