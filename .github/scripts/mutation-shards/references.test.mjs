// Guards how callers are told to reference the reusable workflows. Layer: CI tooling docs.
//
// Every reusable is referenced by the `@v1` alias except `agents-sync.yml`, which is handed the
// sync App's private key and is therefore pinned to a release commit. The README example, the
// Dependabot template that moves that pin and the AGENTS.md rule must keep saying the same thing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.match(build, /PACKAGE_TARBALL: /, 'the gates are given the tarball');
  assert.match(build, /SHA256SUMS/);
  assert.match(build, /sha256=\$sha256/, 'the digest is a job output');
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
