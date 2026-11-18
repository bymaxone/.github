// Merges the shard incremental files into the one file a single run would have written.
// Layer: CI tooling for mutation-full.yml.
//
//   node merge.mjs --plan plan.json --config <caller config> --out <file> --shards <file>...
//
// Why this is not a plain union. Each shard numbers its tests and its mutants from 0, so ids
// collide across shards, and `coveredBy`/`killedBy` point at test ids. The merge therefore
// renumbers: a test is identified by (spec file, name, location) and gets one id in the merged
// file however many shards ran it; mutants are numbered in file order. The merged file keeps the
// schema Stryker reads back for incremental runs, which is what the per-push job restores.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SHARD_OVERRIDES, loadStrykerConfig, parseArgs, readJson } from './lib.mjs';

// Jest's title placeholders. `%#` and `%$` are a row number and `%%` is one percent sign; every
// other one stands for whatever text the row's value formats to.
const PRINTF = /%[sdifjoOp#$%]/;
const PRINTF_ALL = /(%[sdifjoOp#$%])/;
const PLACEHOLDER_PATTERN = { '%#': '\\d+', '%$': '\\d+', '%%': '%' };
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titlePattern = (title) =>
  new RegExp(
    `^${title
      .split(PRINTF_ALL)
      .map((part, at) => (at % 2 === 0 ? escapeRegExp(part) : (PLACEHOLDER_PATTERN[part] ?? '.*')))
      .join('')}$`,
    's',
  );
// How a rendered value may differ from the title the runner recorded: see `renderedAs`.
const RENDERED_GAP = 16
const RENDERED_MIN_END = 8
const RENDERED_MIN_TITLE = 16
const testKey = (t) => `${t.name}\u0000${t.location?.start?.line ?? ''}:${t.location?.start?.column ?? ''}`;

export function mergeReports(shardReports, plan, base) {
  // Every shard may report only files from its own slice, and no file may come from two shards.
  const owner = new Map();
  shardReports.forEach((report, i) => {
    const slice = new Set(plan.shards.find((s) => s.index === i + 1).files);
    for (const file of Object.keys(report.files ?? {})) {
      if (!slice.has(file)) throw new Error(`Shard ${i + 1} reports ${file}, which is not in its slice.`);
      if (owner.has(file)) throw new Error(`${file} is reported by shards ${owner.get(file)} and ${i + 1}.`);
      owner.set(file, i + 1);
    }
  });

  // Merged test ids: per spec file, a test's first appearance in shard order fixes its position.
  const specFiles = [...new Set(shardReports.flatMap((r) => Object.keys(r.testFiles ?? {})))].sort();
  const testFiles = {};
  const testIdMap = shardReports.map(() => new Map());
  let nextTest = 0;
  for (const spec of specFiles) {
    const byKey = new Map();
    const tests = [];
    shardReports.forEach((report, i) => {
      for (const test of report.testFiles?.[spec]?.tests ?? []) {
        const key = testKey(test);
        if (!byKey.has(key)) {
          const merged = { ...test, id: String(nextTest) };
          nextTest += 1;
          byKey.set(key, merged);
          tests.push(merged);
        }
        testIdMap[i].set(test.id, byKey.get(key).id);
      }
    });
    testFiles[spec] = { ...shardReports.find((r) => r.testFiles?.[spec])?.testFiles[spec], tests };
  }

  // Jest formats an `it.each` title per row, yet the runner may record the unformatted title,
  // placeholders and all, as the id of a test. Such an id stands for every row of that title in
  // the same shard: coverage becomes a superset of the rows, never a guess at one of them.
  // The runner may also record a title whose value it rendered its own way (a symbol as `Symbol()`
  // where Jest prints `Symbol(description)`), so no placeholder is left in it. Such an id stands for
  // every test whose name differs from it only in the span where the value was rendered: it shares a
  // long prefix and a long suffix with the title, and at most RENDERED_GAP characters of the title
  // lie between them.
  const sharedEnds = (title, name) => {
    let prefix = 0;
    while (prefix < title.length && prefix < name.length && title[prefix] === name[prefix]) prefix += 1;
    let suffix = 0;
    while (
      suffix < title.length - prefix &&
      suffix < name.length - prefix &&
      title[title.length - 1 - suffix] === name[name.length - 1 - suffix]
    ) suffix += 1;
    return { prefix, suffix };
  };
  const renderedAs = (title, name) => {
    if (title.length < RENDERED_MIN_TITLE) return false;
    const { prefix, suffix } = sharedEnds(title, name);
    return prefix >= RENDERED_MIN_END && suffix >= RENDERED_MIN_END && title.length - prefix - suffix <= RENDERED_GAP;
  };
  const rowsOf = (i, title) => {
    const matches = PRINTF.test(title) ? ((name) => titlePattern(title).test(name)) : (name) => renderedAs(title, name);
    const rows = [];
    for (const data of Object.values(shardReports[i].testFiles ?? {})) {
      for (const test of data.tests ?? []) {
        if (matches(test.name)) rows.push(testIdMap[i].get(test.id));
      }
    }
    return rows;
  };

  const remap = (i, ids) => ids?.flatMap((id) => {
    const mapped = testIdMap[i].get(id);
    if (mapped !== undefined) return [mapped];
    const rows = rowsOf(i, String(id));
    if (rows.length === 0) throw new Error(`Shard ${i + 1} refers to test ${id}, which its testFiles do not list.`);
    return rows;
  }).filter((id, at, all) => all.indexOf(id) === at);

  const files = {};
  let nextMutant = 0;
  for (const file of [...owner.keys()].sort()) {
    const i = owner.get(file) - 1;
    const source = shardReports[i].files[file];
    files[file] = {
      ...source,
      mutants: source.mutants.map((m) => {
        const merged = { ...m, id: String(nextMutant) };
        nextMutant += 1;
        if (m.coveredBy) merged.coveredBy = remap(i, m.coveredBy);
        if (m.killedBy) merged.killedBy = remap(i, m.killedBy);
        if (m.testsCompleted !== undefined && Array.isArray(m.testsCompleted)) {
          merged.testsCompleted = remap(i, m.testsCompleted);
        }
        return merged;
      }),
    };
  }

  // The run's own metadata, with the options a shard overrode put back to the caller's values.
  const first = shardReports[0];
  const config = { ...(first.config ?? {}) };
  for (const key of SHARD_OVERRIDES) {
    if (key in base) config[key] = base[key];
    else delete config[key];
  }
  const merged = { ...first, files, testFiles, config };
  if (base.thresholds) merged.thresholds = base.thresholds;
  return merged;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), ['shards']);
  const plan = readJson(args.plan);
  const inputs = args.shards ?? [];
  if (inputs.length !== plan.shards.length) {
    throw new Error(`The plan has ${plan.shards.length} shards but ${inputs.length} report files were given.`);
  }
  const base = await loadStrykerConfig(args.config);
  const merged = mergeReports(inputs.map(readJson), plan, base);
  writeFileSync(args.out, JSON.stringify(merged));
  const mutants = Object.values(merged.files).reduce((n, f) => n + f.mutants.length, 0);
  console.log(`Merged ${inputs.length} shards: ${Object.keys(merged.files).length} files, ${mutants} mutants.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Mutation shards::${error.message}`);
    process.exit(1);
  });
}
