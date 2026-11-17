// Tests that the pull-request test step cannot miss a test file: it names one glob, and every test file of this
// repository that the step is meant to run is under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const STEP_GLOB = '.github/scripts/*/*.test.mjs';

/** Every file below `dir`, as paths relative to the repository root, skipping `node_modules` and `.git`. */
function filesBelow(dir) {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    if (name === 'node_modules' || name === '.git') return [];
    const path = `${dir}/${name}`;
    return statSync(join(ROOT, path)).isDirectory() ? filesBelow(path) : [path];
  });
}

/** The `run` text of the step named `Run the tests` in the repo-guards workflow. */
function testStepCommand() {
  const lines = readFileSync(join(ROOT, '.github/workflows/repo-guards.yml'), 'utf8').split('\n');
  const at = lines.findIndex((line) => line.includes('- name: Run the tests'));
  assert.notEqual(at, -1, 'the step exists');
  const run = lines.slice(at).find((line) => /^\s*run: /.test(line));
  assert.ok(run, 'the step has a run line');
  return run.replace(/^\s*run: /, '').trim();
}

test('the pull-request test step runs one glob over every script directory, not a list of directories', () => {
  assert.equal(testStepCommand(), `node --test '${STEP_GLOB}'`);
});

test('every test file of the repository is a direct child of a script directory, so the glob reaches it', () => {
  const outside = filesBelow('.github')
    .filter((path) => path.endsWith('.test.mjs'))
    .filter((path) => !path.startsWith('.github/script-templates/'))
    .filter((path) => !/^\.github\/scripts\/[^/]+\/[^/]+\.test\.mjs$/.test(path));
  assert.deepEqual(outside, []);
});

test('the glob reaches every directory that holds a test file today', () => {
  const dirs = new Set(
    filesBelow('.github/scripts')
      .filter((path) => /^\.github\/scripts\/[^/]+\/[^/]+\.test\.mjs$/.test(path))
      .map((path) => path.split('/')[2]),
  );
  for (const dir of ['ai-attribution', 'link-gate', 'mutation-shards', 'release-family', 'script-family', 'semgrep', 'ci-coverage']) {
    assert.ok(dirs.has(dir), dir);
  }
});
