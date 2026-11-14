// Runs the "Require a release that moves forward" step of the npm release template as the shell
// script it is, against stubbed `gh` and `npm`, and checks what the rule must and must not allow.
// The script is read out of the template, so a copy edited in the template is the copy tested here.
// Needs `ruby` (the template is parsed by check-release.mjs) and `bash`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseWorkflow } from './check-release.mjs';

const template = readFileSync(new URL('../../../.github/workflow-templates/npm-release.yml', import.meta.url), 'utf8');
const STEP_NAME = 'Require a release that moves forward';
const step = parseWorkflow(template).jobs.publish.steps.find((s) => s.name === STEP_NAME);

// `gh api` prints the tags it is given for the ref listing, and the status it is given for a compare.
const GH = `#!/bin/bash
echo "$*" >> "$STUB_LOG"
# A failing gh prints its diagnostic, which can carry the request URL: the step must not pass it on.
fail() { echo "gh: diagnostic-from-gh $*" >&2; exit 1; }
case "$*" in
  *matching-refs*) [ "\${GH_FAIL:-}" = "list" ] && fail "$*"; printf '%s\\n' "$GH_TAGS" ;;
  *compare/*) [ "\${GH_FAIL:-}" = "compare" ] && fail "$*"; echo "$GH_STATUS" ;;
  *) exit 2 ;;
esac
`;
// `npm view <pkg>@<version> version` succeeds when the version is listed; `npm view <pkg> versions --json`
// answers a list, one bare string, a 404 or another failure.
const NPM = `#!/bin/bash
echo "npm $*" >> "$STUB_LOG"
# A scoped name starts with @, so only an @ after the first character separates a version.
case "\${2:1}" in
  *@*) case " $NPM_VERSIONS " in *" \${2##*@} "*) exit 0 ;; *) exit 1 ;; esac ;;
esac
case "$NPM_MODE" in
  e404) echo "npm error code E404" >&2; exit 1 ;;
  fail) echo "npm error code EAI_AGAIN" >&2; exit 1 ;;
  *) node -e 'const v=process.env.NPM_VERSIONS.split(" ").filter(Boolean); console.log(JSON.stringify(v.length===1?v[0]:v))' ;;
esac
`;

/** Runs the step. Returns { code, out, log }. */
function run({ tag = 'v1.5.0', version = '1.5.0', tags = 'v1.4.0\nv1.5.0', status = 'ahead', npm = '1.4.0', npmMode = '', ghFail = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forward-only-'));
  try {
    for (const [name, body] of [['gh', GH], ['npm', NPM]]) {
      writeFileSync(join(dir, name), body);
      chmodSync(join(dir, name), 0o755);
    }
    writeFileSync(join(dir, 'step.sh'), step.run);
    const r = spawnSync('bash', [join(dir, 'step.sh')], {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        STUB_LOG: join(dir, 'log'),
        RUNNER_TEMP: dir,
        GITHUB_REPOSITORY: 'bymaxone/example',
        GITHUB_REF_NAME: tag,
        GITHUB_SHA: 'c'.repeat(40),
        GH_TOKEN: 'x',
        VERSION: version,
        PACKAGE_NAME: '@bymax-one/example',
        GH_TAGS: tags,
        GH_STATUS: status,
        GH_FAIL: ghFail,
        NPM_VERSIONS: npm,
        NPM_MODE: npmMode,
      },
    });
    let log = '';
    try {
      log = readFileSync(join(dir, 'log'), 'utf8');
    } catch {
      // No stub was called.
    }
    return { code: r.status, out: r.stdout + r.stderr, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the step exists in the publish job, before the package is published', () => {
  const names = parseWorkflow(template).jobs.publish.steps.map((s) => s.name);
  assert.ok(step, 'the step is in the template');
  assert.ok(names.indexOf(STEP_NAME) < names.indexOf('Publish to npm with provenance'));
});

test('a commit ahead of the previous release, with a greater version, passes', () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.match(r.log, /compare\/v1\.4\.0\.\.\.c{40}/, 'it compared with the previous tag');
});

test('the previous release is the greatest tag below this one, not the latest by creation', () => {
  const r = run({ tag: 'v1.10.0', version: '1.10.0', tags: 'v1.9.0\nv1.10.0\nv1.2.0\nv2.0.0\nv1.10.0-rc.1', npm: '1.9.0' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.log, /compare\/v1\.9\.0\.\.\./, 'v1.9.0 sorts below v1.10.0, and prerelease tags are not releases');
});

for (const status of ['identical', 'behind', 'diverged']) {
  test(`a tagged commit that is ${status} against the previous release fails`, () => {
    const r = run({ status });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /not ahead of the previous release tag/);
  });
}

for (const tag of ['v1.5.0-rc.1', 'v1.5.0+build', 'v1.5', 'v01.5.0x', 'v1.5.0\nv9.9.9']) {
  test(`a tag that is not vMAJOR.MINOR.PATCH fails before anything is read: ${JSON.stringify(tag)}`, () => {
    const r = run({ tag });
    assert.notEqual(r.code, 0);
    assert.match(r.out, /vMAJOR\.MINOR\.PATCH/);
    assert.equal(r.log, '', 'no call went out');
  });
}

test('a first release (no previous tag, package not on npm) passes', () => {
  const r = run({ tag: 'v1.0.0', version: '1.0.0', tags: 'v1.0.0', npm: '', npmMode: 'e404' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.log, /compare\//, 'nothing to compare with');
});

test('a version equal to or below the highest on npm fails', () => {
  for (const npm of ['1.5.1', '1.5.0 1.4.0'.replace('1.5.0 ', '9.0.0 ')]) {
    const r = run({ npm });
    assert.notEqual(r.code, 0, npm);
    assert.match(r.out, /not greater than the highest version on npm/);
  }
});

test('the highest version is compared as a version, not as text, and prereleases do not count', () => {
  assert.equal(run({ tag: 'v1.10.0', version: '1.10.0', tags: 'v1.9.0', npm: '1.9.0 1.2.0 2.0.0-rc.1' }).code, 0);
  assert.notEqual(run({ tag: 'v1.9.0', version: '1.9.0', tags: 'v1.8.0', npm: '1.8.0 1.10.0' }).code, 0);
});

test('a version already on npm is the re-run case and passes', () => {
  const r = run({ npm: '1.4.0 1.5.0' });
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.log, /versions --json/, 'it stopped at the exact-version lookup');
});

test('a registry that cannot be read is a failure, not a first release', () => {
  const r = run({ npm: '1.4.0', npmMode: 'fail' });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /registry could not be read/);
});

test('a GitHub API failure is a failure that carries none of gh\'s own diagnostic', () => {
  for (const ghFail of ['list', 'compare']) {
    const r = run({ ghFail });
    assert.notEqual(r.code, 0, ghFail);
    assert.match(r.out, /::error title=release::/, ghFail);
    assert.doesNotMatch(r.out, /diagnostic-from-gh|v1\.5\.0|c{40}/, `${ghFail}: gh's text reached the log`);
  }
});

test('a single published version comes back as a bare string and is still compared', () => {
  assert.notEqual(run({ npm: '2.0.0' }).code, 0);
  assert.equal(run({ npm: '1.0.0' }).code, 0);
});

test('no message prints the tag, the version or a registry answer', () => {
  const r = run({ tag: 'v1.5.0-rc.1' });
  assert.doesNotMatch(r.out, /rc\.1/);
  const s = run({ npm: '9.9.9' });
  assert.doesNotMatch(s.out, /9\.9\.9/);
});
