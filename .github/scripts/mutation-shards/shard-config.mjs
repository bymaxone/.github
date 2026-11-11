// Writes the Stryker config one shard runs with. Layer: CI tooling for mutation-full.yml.
//
//   node shard-config.mjs --config <caller config> --plan plan.json --index N --out <file>
//                         [--concurrency C]
//
// Stryker's CLI takes no nested option (`--thresholds.break` is rejected), so every per-shard
// override goes through a generated config instead. What a shard changes, and why:
//   mutate          its own slice
//   incremental +   a cold run that still writes its incremental file, which is what gets merged
//   force
//   incrementalFile one file per shard, so shards never share state
//   jsonReporter    one report per shard
//   reporters       json plus clear-text: no html, which nothing downstream reads
//   thresholds      `break` removed: a slice scores only itself, and the caller's break is
//                   enforced once, on the merged score
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadStrykerConfig, parseArgs, readJson } from './lib.mjs';

export function buildShardConfig(base, slice, index, concurrency) {
  const config = { ...base };
  config.mutate = slice.files;
  config.incremental = true;
  config.force = true;
  config.incrementalFile = `reports/stryker-shard-${index}.json`;
  config.jsonReporter = { ...(base.jsonReporter ?? {}), fileName: `reports/mutation/shard-${index}.json` };
  config.reporters = ['json', 'clear-text'];
  if (base.thresholds) {
    const { break: _break, ...rest } = base.thresholds;
    config.thresholds = rest;
  }
  if (concurrency > 0) config.concurrency = concurrency;
  return config;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const index = Number(args.index);
  const plan = readJson(args.plan);
  const slice = plan.shards.find((s) => s.index === index);
  if (!slice) throw new Error(`The plan has no shard ${args.index}.`);
  const concurrency = Number(args.concurrency ?? 0);
  if (!Number.isInteger(concurrency) || concurrency < 0) {
    throw new Error(`concurrency must be a non-negative integer, got '${args.concurrency}'.`);
  }
  const config = buildShardConfig(await loadStrykerConfig(args.config), slice, index, concurrency);
  writeFileSync(args.out, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Wrote ${args.out}: shard ${index}, ${slice.files.length} files.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Mutation shards::${error.message}`);
    process.exit(1);
  });
}
