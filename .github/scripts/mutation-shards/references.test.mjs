// Guards how callers are told to reference the reusable workflows. Layer: CI tooling docs.
//
// Every reusable is referenced by the `@v1` alias except `agents-sync.yml`, which is handed the
// sync App's private key and is therefore pinned to a release commit. The README example, the
// Dependabot template that moves that pin and the AGENTS.md rule must keep saying the same thing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

test('the README caller example pins agents-sync to a commit, with the release in a comment', () => {
  const readme = read('README.md');
  const pinned = /uses: bymaxone\/\.github\/\.github\/workflows\/agents-sync\.yml@([0-9a-f]{40}) # (v\d+\.\d+\.\d+)\n/.exec(readme);
  assert.ok(pinned, 'the example uses a 40-hex commit and names the tag');
  assert.doesNotMatch(readme, /agents-sync\.yml@v1\b/, 'no example references agents-sync by the alias');
});

test('the Dependabot template moves that pin in its own group and never takes a new major', () => {
  const template = read('.github/workflow-templates/dependabot.yml');
  assert.match(template, /bymax-agents-sync:\n\s+patterns:\n\s+- 'bymaxone\/\.github\/\.github\/workflows\/agents-sync\.yml'/);
  assert.match(template, /dependency-name: 'bymaxone\/\.github\*'\n\s+update-types: \['version-update:semver-major'\]/);
});

test('AGENTS.md states the exception where it states the rule', () => {
  const agents = read('AGENTS.md');
  const rule = agents.indexOf('**Use the alias, not a commit SHA:**');
  const exception = agents.indexOf('**One exception: `agents-sync.yml`, pinned to a commit.**');
  assert.ok(rule >= 0 && exception > rule, 'the exception follows the rule');
});

// The release template keeps the privileged job small: nothing from the package runs while the OIDC
// token exists, and what is published is the file the gates saw.
const template = () => read('.github/workflow-templates/npm-release.yml');
const jobs = () => {
  const text = template();
  const build = text.indexOf('\n  build:');
  const publish = text.indexOf('\n  publish:');
  assert.ok(build > 0 && publish > build, 'a build job, then a publish job');
  return { build: text.slice(build, publish), publish: text.slice(publish) };
};

test('the npm release template builds without a credential and packs once', () => {
  const { build } = jobs();
  assert.match(build, /permissions:\n {6}contents: read\n/);
  assert.doesNotMatch(build, /id-token|contents: write/);
  assert.match(build, /npm pack --pack-destination/);
  assert.match(build, /export PACKAGE_TARBALL="\$RUNNER_TEMP\/gate\/\$TARBALL"/, 'the gates are given a copy of the tarball');
  assert.match(build, /cp "\$RUNNER_TEMP\/package\/\$TARBALL" "\$RUNNER_TEMP\/gate\/\$TARBALL"/);
  assert.ok(build.indexOf('SHA256SUMS') < build.indexOf('chmod -R a-w "$out"'), 'the pack directory is read-only once hashed');
  assert.ok(build.indexOf('Extract the release notes') < build.indexOf('chmod -R a-w'), 'the notes are written before the directory is locked');
  const notes = build.slice(build.indexOf('Extract the release notes'), build.indexOf('Pack once'));
  assert.match(notes, /mkdir -p "\$RUNNER_TEMP\/package"\n[^\n]*\n[^\n]*release-notes\.md/, 'the directory exists before the notes are written into it');
  assert.match(build, /SHA256SUMS/);
  assert.match(build, /sha256=\$sha256/, 'the digest is a job output');
});

// A library's published-surface gate reads the tags (`git fetch --tags`, `git tag --list`) and fails on
// a shallow clone. Each adopter used to have to notice that and add the depth itself.
test('the npm release template checks out the full history and still leaves no credential', () => {
  const { build } = jobs();
  const checkout = build.slice(build.indexOf('- name: Checkout'), build.indexOf('- name: Setup pnpm'));
  assert.match(checkout, /fetch-depth: 0\n/);
  assert.match(checkout, /persist-credentials: false\n/);
});

test('the npm release template publishes exactly the file the build packed, and nothing else runs there', () => {
  const { publish } = jobs();
  assert.match(publish, /id-token: write/);
  assert.match(publish, /environment:\n {6}name: npm-publish/);
  assert.doesNotMatch(publish, /actions\/checkout|pnpm install|npm ci|npm install|pnpm run|pnpm /, 'no checkout, no install, no package script');
  assert.match(publish, /sha256sum --check --strict/);
  assert.match(publish, /compare\/\$DEFAULT_BRANCH\.\.\.\$GITHUB_SHA/);
  assert.match(publish, /identical\|behind\) ;;/, 'only the tip or an ancestor of the default branch');
  assert.equal(publish.match(/npm publish/g).length, 1);
  assert.match(publish, /npm publish "\$RUNNER_TEMP\/package\/\$TARBALL" --provenance --access public/);
  assert.match(publish, /gh release view "\$GITHUB_REF_NAME"/, 'the release is created only when it is missing');
});

test('no message of the npm release template prints a value from outside the job', () => {
  const echoes = template().split('\n').filter((l) => /::(error|warning|notice)/.test(l) && !l.trim().startsWith('#'));
  assert.ok(echoes.length >= 4, 'the messages were found');
  assert.deepEqual(echoes.filter((l) => l.includes('$')), []);
});

// `gh` infers the repository from a git directory, and the publish job has none: without GH_REPO the
// release step fails after the package is already on npm. The step is run here from a directory that
// is not a git repository, with a `gh` that behaves like the real one there.
function releaseStep() {
  const text = template();
  const start = text.indexOf('      - name: Create the GitHub Release when it is missing');
  assert.ok(start > 0, 'the release step exists');
  const step = text.slice(start);
  const env = {};
  for (const m of step.slice(0, step.indexOf('run: |')).matchAll(/^ {10}(\w+): (.+)$/gm)) {
    env[m[1]] = { '${{ github.token }}': 'token', '${{ github.repository }}': 'bymaxone/demo' }[m[2].trim()] ?? m[2].trim();
  }
  const script = step.slice(step.indexOf('run: |\n') + 'run: |\n'.length).split('\n').map((l) => l.slice(10)).join('\n');
  return { env, script };
}

function runReleaseStep({ env, script }, { releaseExists }) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'release-step-')));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  mkdirSync(join(dir, 'package'));
  writeFileSync(join(dir, 'package', 'release-notes.md'), 'notes\n');
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
if [ -z "$GH_REPO" ]; then echo "failed to run git: fatal: not a git repository" >&2; exit 1; fi
case "$1 $2" in
  "release view") exit ${releaseExists ? 0 : 1} ;;
  "release create") echo "$@" >> "${join(dir, 'calls')}"; exit 0 ;;
esac
exit 1
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const result = spawnSync('bash', ['-c', script], {
    cwd: dir,
    env: { PATH: `${bin}:${process.env.PATH}`, GITHUB_REF_NAME: 'v1.0.0', RUNNER_TEMP: dir, ...env },
    encoding: 'utf8',
  });
  let calls = '';
  try { calls = readFileSync(join(dir, 'calls'), 'utf8'); } catch { /* no release was created */ }
  return { status: result.status, calls };
}

test('the release step works outside a git directory: it creates a missing release and leaves an existing one', () => {
  const step = releaseStep();
  assert.equal(step.env.GH_REPO, 'bymaxone/demo');
  const missing = runReleaseStep(step, { releaseExists: false });
  assert.equal(missing.status, 0);
  assert.match(missing.calls, /release create v1\.0\.0 .*--notes-file .*release-notes\.md/);
  const exists = runReleaseStep(step, { releaseExists: true });
  assert.equal(exists.status, 0);
  assert.equal(exists.calls, '');
});

test('without GH_REPO the same step fails outside a git directory', () => {
  const step = releaseStep();
  delete step.env.GH_REPO;
  assert.notEqual(runReleaseStep(step, { releaseExists: false }).status, 0);
});

// agents-sync mints an installation token that can write to the caller's repository. A dispatch
// aimed at another ref has to stop before any step that reads the App key.
const agentsSync = () => read('.github/workflows/agents-sync.yml');
const guardStep = () => {
  const text = agentsSync();
  const start = text.indexOf('      - name: Refuse a run outside the default branch\n');
  assert.ok(start > 0, 'the guard step exists');
  const end = text.indexOf('\n      #', start);
  const step = text.slice(start, end);
  const script = step.slice(step.indexOf('run: |\n') + 'run: |\n'.length).split('\n').map((l) => l.slice(10)).join('\n');
  return { text, start, step, script };
};
const runGuard = (script, env) =>
  spawnSync('bash', ['-c', script], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });

test('agents-sync refuses a run outside the default branch before any step can read the App key', () => {
  const { text, start, step } = guardStep();
  const sync = text.indexOf('\n  sync:\n');
  const firstStep = text.indexOf('    steps:\n', sync) + '    steps:\n'.length;
  assert.equal(text.slice(firstStep).search(/^ {6}- name:/m) + firstStep, start, 'it is the first step of the job');
  assert.ok(start < text.indexOf('- name: Mint an installation token\n'));
  assert.doesNotMatch(step, /uses:|secrets\./, 'it runs no action and reads no secret');
  assert.doesNotMatch(step, /\$\{\{ *github\.ref *\}\}[^\n]*\n\s+run/, 'the ref reaches the script through env');
  assert.match(step, /RUN_REF: \$\{\{ github\.ref \}\}/);
  assert.match(step, /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
});

test('the agents-sync guard passes on the default branch and fails on any other ref', () => {
  const { script } = guardStep();
  assert.equal(runGuard(script, { RUN_REF: 'refs/heads/main', DEFAULT_BRANCH: 'main' }).status, 0);
  for (const ref of ['refs/heads/feature', 'refs/pull/7/merge', 'refs/tags/v1.0.0', 'refs/heads/main-old']) {
    const result = runGuard(script, { RUN_REF: ref, DEFAULT_BRANCH: 'main' });
    assert.equal(result.status, 1, ref);
    assert.match(result.stdout, /::error title=agents-sync::agents-sync runs only on the default branch \(main\)\./);
  }
});

test('the agents-sync guard prints no character that could start a workflow command', () => {
  const { script } = guardStep();
  const result = runGuard(script, { RUN_REF: 'refs/heads/x', DEFAULT_BRANCH: 'main\n::error::injected' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.split('\n').filter((l) => l.startsWith('::')).length, 1, 'one workflow command only');
});
