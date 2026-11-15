// Plans the shards of a cold mutation run: expands the caller's `mutate` globs into the file set,
// then splits it into N balanced, disjoint slices. Layer: CI tooling for mutation-full.yml.
//
//   node plan.mjs --config <stryker config> --shards N --out <dir> [--weights <report.json>]
//
// Writes <dir>/plan.json and prints the shard indices as JSON on the `matrix` output.
//
// The split is deterministic: the same files and weights give the same slices, so a rerun of one
// failed shard sees the slice it had. Weight is the time the previous merged report measured for
// the mutants of the file; when it has no durations, the test executions those mutants cost
// (`testsCompleted`), then the number of mutants that cost a test run; and bytes of source where
// there is no report. A file the report has no weight for takes the median.
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TESTED, loadStrykerConfig, parseArgs, readJson, resolveFromCaller } from './lib.mjs';

async function loadMinimatch() {
  const mod = await import(pathToFileURL(resolveFromCaller('minimatch')).href);
  return mod.minimatch ?? mod.default ?? mod;
}

/**
 * Expands `mutate` the way Stryker reads it: positive globs add, `!` globs remove, in order.
 *
 * Stryker resolves both the pattern and each file name to an absolute path before matching, and
 * matches without `dot`, so a hidden file is never selected by a wildcard. Matching the raw pattern
 * against the repository-relative name instead would drop every `./`-prefixed pattern (selecting
 * nothing) and ignore a negated one (so excluded files would come back).
 */
export function expandMutate(patterns, trackedFiles, minimatch, root = process.cwd()) {
  const absolute = (name) => resolve(root, name).split(sep).join('/');
  const set = new Set();
  for (const pattern of patterns) {
    if (/:\d+(-\d+)?(:\d+)?$/.test(pattern)) {
      throw new Error(
        `The mutate pattern '${pattern}' selects a line range, which cannot be split across shards.`,
      );
    }
    const negated = pattern.startsWith('!');
    const glob = absolute(negated ? pattern.slice(1) : pattern);
    for (const file of trackedFiles) {
      if (!minimatch(absolute(file), glob, { dot: false })) continue;
      if (negated) set.delete(file);
      else set.add(file);
    }
  }
  return [...set].sort();
}

// The statuses whose `duration` is a cost the runner paid: the mutant ran tests. A Timeout is one
// of them, and its duration is capped at the timeout. NoCoverage, CompileError and Ignored never ran
// a test, so a duration they carry is not counted.
const RAN_TESTS = new Set(['Killed', 'Survived', 'Timeout', 'RuntimeError']);

/**
 * What each file of a Stryker report cost, as `{ source, weights }`.
 *
 * `duration`: the sum, in milliseconds, of the durations of the mutants that ran tests. That is
 * measured time, which predicted the wall time of the shards of a real run (400 to 9000 s per
 * shard) with an error of about 700 s, where the count of mutants was off by about 1500 s. A reused
 * (incremental) mutant keeps the duration of the run that measured it, or has none: the durations
 * that are present are used, and a file with none is left out, so the planner gives it the median.
 *
 * `tests`: when no mutant of the whole report has a duration (Stryker 9 writes none) but mutants carry
 * `testsCompleted`, the sum of `testsCompleted` over the mutants that ran tests: how many test
 * executions the file's mutants cost, which is closer to what the runner pays than the number of
 * mutants, because one mutant of a file everything covers runs far more tests than one of a file
 * only its own spec covers. Still a proxy: a test execution does not always cost the same. The edges,
 * as for durations: the values present are used, so a report where only some mutants carry
 * `testsCompleted` (a reused mutant may not) weighs a file by those; a file whose sum is zero or that
 * has none (every mutant NoCoverage or CompileError, or none carrying the number) is left out, and so
 * is a file the report lacks, so the planner gives both the median of the weights it has instead of
 * packing a cluster of them into one shard as if they were free.
 *
 * `count`: when neither is in the report, the number of mutants that cost a test run, as before.
 */
export function weightsFromReport(report) {
  const files = Object.entries(report.files ?? {});
  const timed = new Map();
  const executed = new Map();
  for (const [file, data] of files) {
    const ran = data.mutants.filter((m) => RAN_TESTS.has(m.status));
    const durations = ran.filter((m) => Number.isFinite(m.duration));
    if (durations.length > 0) timed.set(file, durations.reduce((sum, m) => sum + m.duration, 0));
    const tests = ran.filter((m) => Number.isFinite(m.testsCompleted)).reduce((sum, m) => sum + m.testsCompleted, 0);
    if (tests > 0) executed.set(file, tests);
  }
  if (timed.size > 0) return { source: 'duration', weights: timed };
  if (executed.size > 0) return { source: 'tests', weights: executed };
  const counted = new Map();
  for (const [file, data] of files) counted.set(file, data.mutants.filter((m) => TESTED.has(m.status)).length);
  return { source: 'count', weights: counted };
}

/**
 * The weight the planner gives a file: the report's, the median of the report's positive weights for a
 * file the report has none for (so unknown files spread across shards instead of weighing nothing), or
 * the file's size when there is no report at all. `sizeOf` is injected so this needs no filesystem.
 */
export function weightFunction(weights, sizeOf) {
  const known = weights ? [...weights.values()].filter((w) => w > 0).sort((a, b) => a - b) : [];
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  return (file) => (weights ? (weights.has(file) ? weights.get(file) : median) : sizeOf(file));
}

const UNIT = { duration: 'ms', tests: 'test executions', count: 'mutants', size: 'bytes' };

/** The lines the plan prints: each shard's predicted weight, so a run's walls can be compared with them. */
export function planSummary(source, fileCount, slices) {
  const total = slices.reduce((n, s) => n + s.weight, 0);
  return [
    ...slices.map((s) => `shard ${s.index}: ${s.files.length} files, weight ${s.weight}`),
    `weight source: ${source} (${UNIT[source]}); ${fileCount} files, total weight ${total}`,
    ...(source === 'duration' ? [`predicted shard weights (ms): ${slices.map((s) => s.weight).join(' / ')}`] : []),
  ];
}

/** Longest-processing-time-first. Ties break on path, then on the lowest shard, for determinism. */
export function partition(files, weightOf, shards) {
  const slices = Array.from({ length: shards }, (_, index) => ({ index: index + 1, weight: 0, files: [] }));
  const order = [...files].sort((a, b) => weightOf(b) - weightOf(a) || (a < b ? -1 : 1));
  for (const file of order) {
    const target = slices.reduce((best, s) =>
      s.weight < best.weight || (s.weight === best.weight && s.files.length < best.files.length) ? s : best,
    );
    target.files.push(file);
    target.weight += weightOf(file);
  }
  for (const s of slices) s.files.sort();
  return slices;
}

/** The invariants the plan owes the run: every file in exactly one slice, none empty. */
export function assertPlan(files, slices) {
  const seen = new Map();
  for (const s of slices) {
    for (const f of s.files) {
      if (seen.has(f)) throw new Error(`${f} is in shards ${seen.get(f)} and ${s.index}.`);
      seen.set(f, s.index);
    }
  }
  const missing = files.filter((f) => !seen.has(f));
  if (missing.length > 0 || seen.size !== files.length) {
    throw new Error(`The shards do not cover the mutate set: missing ${missing.join(', ')}.`);
  }
  const empty = slices.filter((s) => s.files.length === 0).map((s) => s.index);
  if (empty.length > 0) {
    throw new Error(`Shards ${empty.join(', ')} have no file; there are fewer files than shards.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shards = Number(args.shards);
  if (!Number.isInteger(shards) || shards < 1 || shards > 20) {
    throw new Error(`shards must be an integer from 1 to 20, got '${args.shards}'.`);
  }
  const config = await loadStrykerConfig(args.config);
  const patterns = config.mutate ?? [];
  if (patterns.length === 0) throw new Error(`${args.config} has no mutate patterns to shard.`);

  const tracked = execFileSync('git', ['-c', 'core.quotePath=false', 'ls-files'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const files = expandMutate(patterns, tracked, await loadMinimatch());
  const unsafe = files.filter((f) => /[,*?[\]{}()!]/.test(f));
  if (unsafe.length > 0) {
    throw new Error(`These files hold a glob or list character and cannot be passed as a pattern: ${unsafe.join(', ')}`);
  }

  let weights = null;
  let source = 'size';
  if (args.weights) ({ source, weights } = weightsFromReport(readJson(args.weights)));
  const weightOf = weightFunction(weights, (f) => statSync(f).size);

  const slices = partition(files, weightOf, shards);
  assertPlan(files, slices);

  if (weights) {
    const absent = [...weights.keys()].filter((f) => !files.includes(f));
    // The dangerous direction: a file the last run mutated that this plan would not.
    for (const f of absent) console.log(`::warning title=Mutation shards::${f} was mutated by the previous run but is not in this plan.`);
  }

  const total = slices.reduce((n, s) => n + s.weight, 0);
  const plan = { source, total, files: files.length, shards: slices };
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  for (const line of planSummary(source, files.length, slices)) console.log(line);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(slices.map((s) => s.index))}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Mutation shards::${error.message}`);
    process.exit(1);
  });
}