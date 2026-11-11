// Plans the shards of a cold mutation run: expands the caller's `mutate` globs into the file set,
// then splits it into N balanced, disjoint slices. Layer: CI tooling for mutation-full.yml.
//
//   node plan.mjs --config <stryker config> --shards N --out <dir> [--weights <report.json>]
//
// Writes <dir>/plan.json and prints the shard indices as JSON on the `matrix` output.
//
// The split is deterministic: the same files and weights give the same slices, so a rerun of one
// failed shard sees the slice it had. Weight is the number of mutants that cost a test run in the
// previous merged report (CompileError and Ignored are free), and bytes of source where there is
// no report. A file the report does not know takes the median known weight.
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TESTED, loadStrykerConfig, parseArgs, readJson, resolveFromCaller } from './lib.mjs';

async function loadMinimatch() {
  const mod = await import(pathToFileURL(resolveFromCaller('minimatch')).href);
  return mod.minimatch ?? mod.default ?? mod;
}

/** Expands `mutate` the way Stryker reads it: positive globs add, `!` globs remove, in order. */
export function expandMutate(patterns, trackedFiles, minimatch) {
  const set = new Set();
  for (const pattern of patterns) {
    if (/:\d+(-\d+)?(:\d+)?$/.test(pattern)) {
      throw new Error(
        `The mutate pattern '${pattern}' selects a line range, which cannot be split across shards.`,
      );
    }
    const negated = pattern.startsWith('!');
    const glob = negated ? pattern.slice(1) : pattern;
    for (const file of trackedFiles) {
      if (!minimatch(file, glob, { dot: true })) continue;
      if (negated) set.delete(file);
      else set.add(file);
    }
  }
  return [...set].sort();
}

/** Mutants per file that cost a test run, from a Stryker report. */
export function weightsFromReport(report) {
  const weights = new Map();
  for (const [file, data] of Object.entries(report.files ?? {})) {
    weights.set(file, data.mutants.filter((m) => TESTED.has(m.status)).length);
  }
  return weights;
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
  if (args.weights) weights = weightsFromReport(readJson(args.weights));
  const known = weights ? [...weights.values()].filter((w) => w > 0).sort((a, b) => a - b) : [];
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const size = (f) => statSync(f).size;
  const weightOf = (f) => (weights ? (weights.has(f) ? weights.get(f) : median) : size(f));

  const slices = partition(files, weightOf, shards);
  assertPlan(files, slices);

  if (weights) {
    const absent = [...weights.keys()].filter((f) => !files.includes(f));
    // The dangerous direction: a file the last run mutated that this plan would not.
    for (const f of absent) console.log(`::warning title=Mutation shards::${f} was mutated by the previous run but is not in this plan.`);
  }

  const total = slices.reduce((n, s) => n + s.weight, 0);
  const plan = { source: weights ? 'report' : 'size', total, files: files.length, shards: slices };
  mkdirSync(args.out, { recursive: true });
  writeFileSync(join(args.out, 'plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
  for (const s of slices) console.log(`shard ${s.index}: ${s.files.length} files, weight ${s.weight}`);
  console.log(`weight source: ${plan.source}; ${files.length} files, total weight ${total}`);
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