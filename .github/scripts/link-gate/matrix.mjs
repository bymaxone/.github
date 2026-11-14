// The cases the link check must decide, and the patch that makes a third party's trouble a note.
import { probe } from './probe.mjs';

const U = (p) => `https://a.example/${p}`;
/** url -> { stub answer, expected verdict }: `ok` (nothing), `note` (a note naming the url, no failure), `fail`. */
export const CASES = {
  [U('ok')]: [{ HEAD: 200, GET: 200 }, 'ok'],
  [U('503')]: [{ HEAD: 503, GET: 503 }, 'note'],
  [U('500')]: [{ HEAD: 500, GET: 500 }, 'note'],
  [U('502')]: [{ HEAD: 502, GET: 502 }, 'note'],
  [U('504')]: [{ HEAD: 504, GET: 504 }, 'note'],
  [U('429-after-retry')]: [{ HEAD: 429, GET: 429 }, 'note'],
  [U('429-then-ok')]: [{ HEAD: 429, GET: 200 }, 'ok'],
  [U('405-then-ok')]: [{ HEAD: 405, GET: 200 }, 'ok'],
  [U('head-5xx-get-ok')]: [{ HEAD: 503, GET: 200 }, 'note'],
  [U('404')]: [{ HEAD: 404, GET: 404 }, 'fail'],
  [U('410')]: [{ HEAD: 410, GET: 410 }, 'fail'],
  [U('403')]: [{ HEAD: 403, GET: 403 }, 'fail'],
  [U('401')]: [{ HEAD: 401, GET: 401 }, 'fail'],
  [U('transport')]: [{ throws: 'fetch failed' }, 'note'],
  'http://a.example/plain-http': [{ HEAD: 200, GET: 200 }, 'fail'],
  'https://10.0.0.1/private': [{ HEAD: 200, GET: 200 }, 'fail'],
  '#nowhere': [{}, 'fail'],
  'https://www.npmjs.com/package/some-unpublished-pkg': [{ HEAD: 404, GET: 404 }, 'note'],
};

/** What the run decided for `url`: `fail`, `note` or `ok`. */
const verdict = (result, url) => (result.failures.some((f) => f.includes(url)) ? 'fail' : result.notes.some((n) => n.includes(url)) ? 'note' : 'ok');

/** Runs every case against `script`; returns the cases whose verdict is not the expected one. */
export function mismatches(script, options) {
  const result = probe(script, Object.fromEntries(Object.entries(CASES).map(([u, [a]]) => [u, a])), options);
  if (result.unrecognised || result.error) return { problem: result.unrecognised ? 'unrecognised' : result.error };
  const bad = Object.entries(CASES)
    .map(([u, [, want]]) => [u, want, verdict(result, u)])
    .filter(([, want, got]) => want !== got)
    .map(([u, want, got]) => `${u.replace('https://a.example/', '')}: wanted ${want}, got ${got}`);
  return { bad, notes: result.notes };
}

const ANCHOR = 'return `${url} → HTTP ${res.status}`';
export const PATCH = [
  '// A host that answers 5xx, or 429 again after the GET above, is in trouble of its own, and a link',
  '// check cannot tell that from a dead link. Reported like a transport error, never fatal: this gate',
  "// also guards `prepublishOnly`, and someone else's outage must not block a release. 404, 410 and the",
  '// other client errors still fail.',
  'if (res.status >= 500 || res.status === 429) {',
  "  console.log(`  note: ${url} answered HTTP ${res.status}, the host's trouble and not proof that the link is dead`)",
  '  return null',
  '}',
];
/** `script` with the patch inserted before the failing return, at that line's indentation; null if the anchor is not unique. */
export function patched(script) {
  if (script.split(ANCHOR).length !== 2) return null;
  const at = script.indexOf(ANCHOR);
  const lineStart = script.lastIndexOf('\n', at) + 1;
  const indent = script.slice(lineStart, at);
  return script.slice(0, lineStart) + PATCH.map((l) => indent + l).join('\n') + '\n' + script.slice(lineStart);
}
