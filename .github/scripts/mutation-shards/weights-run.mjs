// Finds the report that weights the next split. Layer: CI tooling for mutation-full.yml.
//
//   node weights-run.mjs --workflow <file> --branch <name> --out <dir> [--limit 10]
//
// Looks at the newest completed runs of the workflow on the default branch, whatever their
// conclusion, takes the newest that left a `mutation-full` artifact and downloads it into <dir>.
// A run that failed after the merge (the inventory, the break threshold) still left a complete
// report, and its timings are as good as a green run's; a run that failed before it left none and
// is skipped. Best effort and never fatal: with no report the plan falls back to file size, so this
// exits 0 whatever `gh` answers.
import { appendFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './lib.mjs';

export const ARTIFACT = 'mutation-full';

/**
 * The newest run, among the first `limit` of `runs` (newest first), for which `hasReport` is true.
 * `hasReport` is asked at most once per run and only until one answers yes.
 */
export function chooseRun(runs, hasReport, limit = 10) {
  for (const run of runs.slice(0, limit)) {
    if (hasReport(run)) return run;
  }
  return null;
}

const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// Every call names the repository: `gh` otherwise infers it from the directory it runs in.
function listRuns(repository, workflow, branch, limit) {
  const out = gh([
    'run', 'list', '--repo', repository, '--workflow', workflow, '--branch', branch, '--status', 'completed',
    '--limit', String(limit), '--json', 'databaseId,conclusion',
  ]);
  return JSON.parse(out).map((r) => ({ id: r.databaseId, conclusion: r.conclusion || 'unknown' }));
}

function hasArtifact(repository, run) {
  const out = gh([
    'api', `repos/${repository}/actions/runs/${run.id}/artifacts`,
    '--jq', `[.artifacts[] | select(.name == "${ARTIFACT}" and (.expired | not))] | length`,
  ]);
  return Number(out.trim()) > 0;
}

/** Prints what it did and returns the run that supplied the report, or null. */
export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  const limit = Number(args.limit ?? 10);
  const say = (line) => {
    console.log(line);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`);
  };
  let run = null;
  try {
    const runs = listRuns(env.GITHUB_REPOSITORY, args.workflow, args.branch, limit);
    run = chooseRun(runs, (candidate) => {
      try {
        return hasArtifact(env.GITHUB_REPOSITORY, candidate);
      } catch {
        return false;
      }
    }, limit);
    if (run) {
      gh(['run', 'download', String(run.id), '--repo', env.GITHUB_REPOSITORY, '--name', ARTIFACT, '--dir', args.out]);
      if (!existsSync(join(args.out, 'mutation.json'))) run = null;
    }
  } catch {
    run = null;
  }
  if (run) say(`Weighting the split by run ${run.id} (conclusion: ${run.conclusion}).`);
  else say(`None of the last ${limit} completed runs left a mutation report; the split will use file sizes.`);
  return run;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
