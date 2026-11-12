// Tests for the sharded mutation scripts. Layer: CI tooling. Run with `node --test` from the
// repository root; it uses only Node's built-ins, so no install is needed.
import assert from 'node:assert/strict';
import { matchesGlob } from 'node:path';
import test from 'node:test';
import { assertPlan, expandMutate, partition, weightsFromReport } from './plan.mjs';
import { buildShardConfig } from './shard-config.mjs';
import { mergeReports } from './merge.mjs';
import { diff, index } from './compare.mjs';
import { collect } from './collect.mjs';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const glob = (file, pattern) => matchesGlob(file, pattern);

const mutant = (id, status, line, extra = {}) => ({
  id,
  mutatorName: 'Mut',
  replacement: 'x',
  status,
  location: { start: { line, column: 1 }, end: { line, column: 5 } },
  ...extra,
});

test('expandMutate applies positive and negated globs in order', () => {
  const files = ['src/a.ts', 'src/a.spec.ts', 'src/b/c.ts', 'src/b/index.ts', 'docs/x.ts'];
  const set = expandMutate(['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/index.ts'], files, glob);
  assert.deepEqual(set, ['src/a.ts', 'src/b/c.ts']);
});

// Stryker resolves pattern and file to absolute paths before matching, and matches without `dot`.
test('expandMutate reads a ./-prefixed pattern and a ./-prefixed negation as Stryker does', () => {
  const files = ['src/a.ts', 'src/a.spec.ts', 'src/.hidden.ts'];
  assert.deepEqual(expandMutate(['./src/**/*.ts'], files, glob), ['src/a.spec.ts', 'src/a.ts']);
  assert.deepEqual(expandMutate(['src/**/*.ts', '!./src/**/*.spec.ts'], files, glob), ['src/a.ts']);
});

test('expandMutate refuses a line-range pattern it cannot split', () => {
  assert.throws(() => expandMutate(['src/a.ts:1-10'], ['src/a.ts'], glob), /line range/);
});

test('weightsFromReport counts only mutants that cost a test run', () => {
  const report = {
    files: {
      'a.ts': {
        mutants: [mutant('0', 'Killed', 1), mutant('1', 'CompileError', 2), mutant('2', 'Ignored', 3), mutant('3', 'Timeout', 4)],
      },
    },
  };
  assert.equal(weightsFromReport(report).get('a.ts'), 2);
});

test('partition gives every file to exactly one shard, balanced, and the same answer twice', () => {
  const weights = { a: 50, b: 30, c: 30, d: 20, e: 10, f: 10 };
  const files = Object.keys(weights);
  const first = partition(files, (f) => weights[f], 2);
  const second = partition([...files].reverse(), (f) => weights[f], 2);
  assert.deepEqual(first, second);
  assertPlan(files, first);
  assert.equal(first[0].weight + first[1].weight, 150);
  assert.ok(Math.abs(first[0].weight - first[1].weight) <= 10);
});

test('assertPlan rejects a duplicate, a gap and an empty shard', () => {
  const dup = [{ index: 1, files: ['a', 'b'] }, { index: 2, files: ['b'] }];
  assert.throws(() => assertPlan(['a', 'b'], dup), /shards 1 and 2/);
  const gap = [{ index: 1, files: ['a'] }, { index: 2, files: ['c'] }];
  assert.throws(() => assertPlan(['a', 'b', 'c'], gap), /missing b/);
  const empty = [{ index: 1, files: ['a'] }, { index: 2, files: [] }];
  assert.throws(() => assertPlan(['a'], empty), /fewer files than shards/);
});

test('buildShardConfig removes only the break threshold and keeps the rest of the caller config', () => {
  const base = {
    testRunner: 'jest',
    mutate: ['src/**/*.ts'],
    thresholds: { high: 90, low: 80, break: 100 },
    concurrency: 4,
    reporters: ['progress', 'html'],
  };
  const config = buildShardConfig(base, { files: ['src/a.ts'] }, 2, 2);
  assert.deepEqual(config.mutate, ['src/a.ts']);
  assert.deepEqual(config.thresholds, { high: 90, low: 80 });
  assert.equal(config.concurrency, 2);
  assert.equal(config.testRunner, 'jest');
  assert.equal(config.incrementalFile, 'reports/stryker-shard-2.json');
  assert.equal(config.jsonReporter.fileName, 'reports/mutation/shard-2.json');
  assert.deepEqual(config.reporters, ['json', 'clear-text']);
  assert.equal(config.force, true);
  assert.deepEqual(base.thresholds, { high: 90, low: 80, break: 100 }, 'the caller config is not mutated');
  assert.equal(buildShardConfig(base, { files: [] }, 1, 0).concurrency, 4, '0 keeps the caller value');
});

// Two shards that number their tests and mutants from 0, run the same spec, and cover it
// differently: the ids collide, and only the names tell the tests apart.
function shardReports() {
  const spec = (tests) => ({ tests });
  const t = (id, name, line) => ({ id, name, location: { start: { line, column: 1 } } });
  const one = {
    schemaVersion: '1.0',
    config: { mutate: ['a.ts'], concurrency: 2, testRunner: 'jest' },
    files: { 'a.ts': { language: 'typescript', source: 'a', mutants: [mutant('0', 'Killed', 1, { coveredBy: ['0', '1'], killedBy: ['1'] })] } },
    testFiles: { 'x.spec.ts': spec([t('0', 'first', 1), t('1', 'second', 2)]) },
  };
  const two = {
    schemaVersion: '1.0',
    config: { mutate: ['b.ts'], concurrency: 2, testRunner: 'jest' },
    files: { 'b.ts': { language: 'typescript', source: 'b', mutants: [mutant('0', 'Killed', 1, { coveredBy: ['0'], killedBy: ['0'] })] } },
    // Same spec, but this shard listed its tests in another order, and only ran two of three.
    testFiles: { 'x.spec.ts': spec([t('0', 'second', 2), t('1', 'third', 3)]), 'y.spec.ts': spec([t('2', 'only-y', 1)]) },
  };
  const plan = { shards: [{ index: 1, files: ['a.ts'] }, { index: 2, files: ['b.ts'] }] };
  return { one, two, plan };
}

test('mergeReports renumbers so that colliding ids still point at the same tests', () => {
  const { one, two, plan } = shardReports();
  const base = { mutate: ['a.ts', 'b.ts'], concurrency: 4, thresholds: { break: 100 } };
  const merged = mergeReports([one, two], plan, base);
  const names = new Map();
  for (const [spec, data] of Object.entries(merged.testFiles)) for (const t of data.tests) names.set(t.id, `${spec}::${t.name}`);
  const ids = [...names.keys()];
  assert.equal(new Set(ids).size, ids.length, 'test ids are unique');
  assert.equal(names.size, 4, 'second is one test, however many shards ran it');
  const [a, b] = [merged.files['a.ts'].mutants[0], merged.files['b.ts'].mutants[0]];
  assert.notEqual(a.id, b.id);
  assert.deepEqual(a.killedBy.map((i) => names.get(i)), ['x.spec.ts::second']);
  assert.deepEqual(b.killedBy.map((i) => names.get(i)), ['x.spec.ts::second']);
  assert.deepEqual(a.coveredBy.map((i) => names.get(i)).sort(), ['x.spec.ts::first', 'x.spec.ts::second']);
});

test('mergeReports puts the caller options back and drops the per-shard ones', () => {
  const { one, two, plan } = shardReports();
  one.config.incrementalFile = 'reports/stryker-shard-1.json';
  const merged = mergeReports([one, two], plan, { mutate: ['a.ts', 'b.ts'], concurrency: 4, thresholds: { break: 100 } });
  assert.deepEqual(merged.config.mutate, ['a.ts', 'b.ts']);
  assert.equal(merged.config.concurrency, 4);
  assert.ok(!('incrementalFile' in merged.config));
  assert.deepEqual(merged.thresholds, { break: 100 });
});

test('mergeReports refuses a file outside the shard slice, a file twice, and a dangling test id', () => {
  const { one, two, plan } = shardReports();
  const stray = structuredClone(two);
  stray.files['a.ts'] = structuredClone(one.files['a.ts']);
  assert.throws(() => mergeReports([one, stray], plan, {}), /not in its slice/);
  const both = { shards: [{ index: 1, files: ['a.ts'] }, { index: 2, files: ['a.ts', 'b.ts'] }] };
  const twice = structuredClone(two);
  twice.files['a.ts'] = structuredClone(one.files['a.ts']);
  assert.throws(() => mergeReports([one, twice], both, {}), /reported by shards 1 and 2/);
  const dangling = structuredClone(one);
  dangling.files['a.ts'].mutants[0].killedBy = ['99'];
  assert.throws(() => mergeReports([dangling, two], plan, {}), /refers to test 99/);
});

// Jest formats an `it.each` title per row, but Stryker's jest runner may record the unformatted
// title (`%s` still in it) as the id of the test that killed a mutant. The id then names no
// listed test, and the merge must attribute it to every row of that title instead of refusing.
test('mergeReports maps an unformatted it.each title to every formatted row of it', () => {
  const { one, two, plan } = shardReports();
  const spec = (tests) => ({ tests });
  const t = (id, name, line) => ({ id, name, location: { start: { line, column: 1 } } });
  const title = 'suite refuses the header %s';
  one.testFiles['x.spec.ts'] = spec([t('0', 'suite refuses the header cookie', 5), t('1', 'suite refuses the header host', 5), t('2', 'suite refuses the header-less case', 9)]);
  one.files['a.ts'].mutants[0].killedBy = [title];
  one.files['a.ts'].mutants[0].coveredBy = ['0', '1'];
  const merged = mergeReports([one, two], plan, { mutate: ['a.ts', 'b.ts'] });
  const names = new Map();
  for (const data of Object.values(merged.testFiles)) for (const x of data.tests) names.set(x.id, x.name);
  assert.deepEqual(merged.files['a.ts'].mutants[0].killedBy.map((i) => names.get(i)).sort(), ['suite refuses the header cookie', 'suite refuses the header host']);
});

test('mergeReports still refuses an unformatted title that no listed test matches', () => {
  const { one, two, plan } = shardReports();
  one.files['a.ts'].mutants[0].killedBy = ['nothing refuses the header %s'];
  assert.throws(() => mergeReports([one, two], plan, {}), /refers to test nothing refuses the header %s/);
});

// A merged report keeps the runner's `projectRoot`, which need not be where the unit suite runs
// now. The inventory resolves Jest's absolute spec paths against the checkout it runs in.
test('the inventory reads spec paths against the checkout, not a stale report projectRoot', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'inventory-')));
  try {
    const report = { projectRoot: '/home/runner/work/lib/lib', testFiles: { 'src/a.spec.ts': { tests: [{ id: '0', name: 'a does it' }] } } };
    const jest = { testResults: [{ name: join(dir, 'src/a.spec.ts'), assertionResults: [{ ancestorTitles: ['a'], title: 'does it', status: 'passed' }] }] };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
    writeFileSync(join(dir, 'jest.json'), JSON.stringify(jest));
    const script = join(import.meta.dirname, '../../actions/mutation-inventory/check-mutation-inventory.mjs');
    const run = spawnSync(process.execPath, [script, join(dir, 'report.json'), join(dir, 'jest.json')], { cwd: dir, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /all 1 unit tests ran/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compare reports a status change and treats a Killed/Timeout flip apart', () => {
  const a = { files: { 'f.ts': { mutants: [mutant('0', 'Killed', 1), mutant('1', 'Killed', 2), mutant('2', 'Survived', 3)] } } };
  const b = { files: { 'f.ts': { mutants: [mutant('9', 'Timeout', 1), mutant('8', 'Survived', 2), mutant('7', 'Survived', 3)] } } };
  const d = diff(index(a), index(b));
  assert.equal(d.flips.length, 1);
  assert.equal(d.changed.length, 1);
  assert.equal(d.onlyA.length + d.onlyB.length, 0);
});

function artifacts(names) {
  const dir = mkdtempSync(join(tmpdir(), 'shards-'));
  for (const name of names) {
    mkdirSync(join(dir, name));
    const shard = name.match(/mutation-shard-(\d+)/)[1];
    writeFileSync(join(dir, name, `stryker-shard-${shard}.json`), '{}');
  }
  return dir;
}

test('collect takes the retry artifact when the first upload of a shard failed', () => {
  const dir = artifacts(['mutation-shard-1', 'mutation-shard-2-retry']);
  const { paths, problems } = collect(2, dir);
  rmSync(dir, { recursive: true });
  assert.deepEqual(problems, []);
  assert.deepEqual(paths.map((p) => p.split('/').slice(-2).join('/')), [
    'mutation-shard-1/stryker-shard-1.json',
    'mutation-shard-2-retry/stryker-shard-2.json',
  ]);
});

test('collect names a missing shard and refuses a shard present under both names', () => {
  const missing = artifacts(['mutation-shard-1']);
  const a = collect(2, missing);
  rmSync(missing, { recursive: true });
  assert.equal(a.problems.length, 1);
  assert.match(a.problems[0], /shard 2: .*mutation-shard-2 or mutation-shard-2-retry/);
  const both = artifacts(['mutation-shard-1', 'mutation-shard-1-retry']);
  const b = collect(1, both);
  rmSync(both, { recursive: true });
  assert.match(b.problems[0], /both mutation-shard-1 and mutation-shard-1-retry/);
});
