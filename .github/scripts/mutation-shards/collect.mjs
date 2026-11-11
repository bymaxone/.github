// Finds each shard's incremental file among the downloaded shard artifacts. Layer: CI tooling for
// mutation-full.yml.
//
//   node collect.mjs --plan plan.json --dir mutation-shards
//
// Prints one path per line, in shard order. A shard is uploaded under `mutation-shard-N`, and under
// `mutation-shard-N-retry` when that first upload failed, so exactly one of the two may exist per
// shard. None is an error that names what was expected; both is an error too, so a shard can never
// be merged twice.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, readJson } from './lib.mjs';

export function collect(shardCount, dir) {
  const present = existsSync(dir) ? readdirSync(dir) : [];
  const paths = [];
  const problems = [];
  for (let i = 1; i <= shardCount; i += 1) {
    const names = [`mutation-shard-${i}`, `mutation-shard-${i}-retry`];
    const found = names.filter((n) => present.includes(n) && existsSync(join(dir, n, `stryker-shard-${i}.json`)));
    if (found.length === 0) {
      problems.push(`shard ${i}: no report; expected artifact ${names[0]} or ${names[1]}, found none with stryker-shard-${i}.json`);
    } else if (found.length > 1) {
      problems.push(`shard ${i}: both ${found.join(' and ')} are present; refusing to merge a shard twice`);
    } else {
      paths.push(join(dir, found[0], `stryker-shard-${i}.json`));
    }
  }
  return { paths, problems };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const count = readJson(args.plan).shards.length;
  const { paths, problems } = collect(count, args.dir);
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error title=Mutation shards::${p}`);
    process.exit(1);
  }
  console.log(paths.join('\n'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
