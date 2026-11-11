// Scores a merged report with Stryker's own metrics library and enforces the caller's break
// threshold. Layer: CI tooling for mutation-full.yml.
//
//   node score.mjs --report <merged.json> --config <caller config> [--break N]
//
// `--break` wins over the config's `thresholds.break`. With neither, the score is reported and
// nothing is enforced, which is what Stryker does too. The comparison is Stryker's: below the
// break fails, equal passes.
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadStrykerConfig, parseArgs, readJson, resolveFromCaller } from './lib.mjs';

export async function scoreOf(report) {
  const metrics = await import(pathToFileURL(resolveFromCaller('mutation-testing-metrics')).href);
  return metrics.calculateMutationTestMetrics(report).systemUnderTestMetrics.metrics;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = readJson(args.report);
  const config = await loadStrykerConfig(args.config);
  const fromInput = args.break === undefined || args.break === '' ? undefined : Number(args.break);
  if (fromInput !== undefined && Number.isNaN(fromInput)) throw new Error(`break must be a number, got '${args.break}'.`);
  const threshold = fromInput ?? config.thresholds?.break;

  const m = await scoreOf(report);
  const score = m.mutationScore;
  const line = `Mutation score ${score.toFixed(2)} (killed ${m.killed}, timeout ${m.timeout}, survived ${m.survived}, no coverage ${m.noCoverage}, runtime errors ${m.runtimeErrors}, compile errors ${m.compileErrors}, ignored ${m.ignored}; ${m.totalMutants} mutants)`;
  console.log(line);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`);
  if (threshold === undefined || threshold === null) return;
  if (score < threshold) {
    console.error(`::error title=Mutation score::The merged score ${score.toFixed(2)} is under the break threshold ${threshold}.`);
    process.exit(1);
  }
  console.log(`The merged score is at or above the break threshold ${threshold}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Mutation score::${error.message}`);
    process.exit(1);
  });
}
