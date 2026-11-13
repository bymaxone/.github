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
