// Runs the link check of a library's published-surface gate against stubbed hosts and reports what it decided.
// Layer: CI tooling.
//
// The libraries each carry their own copy of the check, so nothing here can change a copy; this measures
// one. The text of the check is cut out of the script (from `function slug` to the end of `checkLinks`),
// or, for a library whose link check is its own module, the module that exports `checkLinks` is run as it is.
// Either way the verdicts are the script's own behaviour under stubs, not a re-implementation of its rules,
// so a branch that is dead in a copy shows up as a case that does not come out as wanted.
//
// The text comes from another repository and is code nobody reviewed here, so it runs in a child process
// that is given nothing: an empty environment (no token), a stubbed `fetch` and DNS, a timeout, and, where
// the caller asks for it, a network namespace and an unprivileged user (see `isolation`).
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The text of the link check: from `slug` (its helpers follow) to the closing brace of `checkLinks`. */
export function linkBlock(script) {
  const start = script.indexOf('/** Slug a Markdown heading');
  const fn = script.indexOf('async function checkLinks()');
  const end = fn === -1 ? -1 : script.indexOf('\n}\n', fn);
  if (start === -1 || fn === -1 || end === -1 || start > fn) return null;
  return script.slice(start, end + 3);
}

/**
 * The command prefix that takes the child off the network and off the caller's identity: a fresh network
 * namespace, then the `nobody` user, so it can neither connect nor read the caller's process environment.
 * `sudo` is used unless the caller is already root. Linux only; the caller decides whether to use it.
 */
export function isolation(uid = process.getuid?.()) {
  const drop = ['unshare', '--net', '--', 'setpriv', '--reuid=nobody', '--regid=nogroup', '--clear-groups', '--'];
  return uid === 0 ? drop : ['sudo', '-n', ...drop];
}

const STUB = `import dns from 'node:dns/promises'
import { syncBuiltinESMExports } from 'node:module'
dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }]
syncBuiltinESMExports()
const table = JSON.parse(process.env.STUB_LINKS)
globalThis.fetch = async (url, init) => {
  const e = table[url] ?? table[url.replace(/^https:\\/\\/registry\\.npmjs\\.org\\//, 'https://www.npmjs.com/package/')]
  if (!e) return new Response(null, { status: 599 })
  if (e.throws) throw new TypeError(e.throws)
  return new Response(null, { status: e[init?.method ?? 'GET'] ?? e.GET })
}
`;

/**
 * Runs the link check in `script` on a README made of `links` (url -> stub answer) and returns
 * `{ failures, notes }`, or `{ unrecognised: true }` when no link check can be found, or `{ error }`.
 * A stub answer is `{ HEAD, GET }` statuses, or `{ throws: 'message' }` for a transport error.
 * `wrap` is a command prefix for the child (see `isolation`); `timeoutMs` bounds it.
 */
export function probe(script, links, { wrap = [], timeoutMs = 60_000 } = {}) {
  const modular = /export async function checkLinks\(\{/.test(script);
  const block = modular ? null : linkBlock(script);
  if (!modular && !block) return { unrecognised: true };
  const dir = mkdtempSync(join(tmpdir(), 'link-gate-'));
  try {
    const readme = Object.keys(links)
      .map((u, i) => `[l${i}](${u})`)
      .join('\n\n');
    const main = modular
      ? `import { checkLinks } from './links.mjs'
const failures = []
await checkLinks({ readme: ${JSON.stringify(readme)}, root: ${JSON.stringify(dir)}, fail: (check, detail) => failures.push(check + ': ' + detail) })
console.log('@@RESULT ' + JSON.stringify(failures))
`
      : `import { existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { lookup } from 'node:dns/promises'
const ROOT = ${JSON.stringify(dir)}
const README = ${JSON.stringify(readme)}
// One library checks every document of a set; here the set is the README alone.
const DOCUMENTS = [{ path: 'README.md', text: README }]
const failures = []
const fail = (check, detail) => failures.push(check + ': ' + detail)
${block}
await checkLinks()
console.log('@@RESULT ' + JSON.stringify(failures))
`;
    writeFileSync(join(dir, 'main.mjs'), main);
    writeFileSync(join(dir, 'stub.mjs'), STUB);
    if (modular) writeFileSync(join(dir, 'links.mjs'), script);
    // The child may run as another user: it must be able to read what it is given.
    chmodSync(dir, 0o755);
    for (const f of ['main.mjs', 'stub.mjs', 'links.mjs']) {
      try {
        chmodSync(join(dir, f), 0o644);
      } catch {
        // links.mjs exists only for a module.
      }
    }
    const [command, ...prefix] = [...wrap, process.execPath];
    const r = spawnSync(command, [...prefix, '--import', join(dir, 'stub.mjs'), join(dir, 'main.mjs')], {
      encoding: 'utf8',
      // Nothing is inherited: no token, no PATH, no HOME. The only variable is the stub's table.
      env: { STUB_LINKS: JSON.stringify(links) },
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    if (r.error?.code === 'ETIMEDOUT') return { error: `timed out after ${timeoutMs} ms` };
    if (r.error) return { error: String(r.error.message).slice(0, 160) };
    const out = r.stdout.split('\n');
    const line = out.find((l) => l.startsWith('@@RESULT '));
    if (!line) return { error: (r.stderr || r.stdout).split('\n').filter(Boolean).slice(0, 4).join(' | ').slice(0, 300) };
    return { failures: JSON.parse(line.slice(9)), notes: out.filter((l) => l.trim().startsWith('note:')).map((l) => l.trim()) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
