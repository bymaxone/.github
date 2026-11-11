// Shared helpers for the sharded mutation run. Layer: CI tooling, loaded only by the sibling
// scripts in this directory; nothing here imports from the caller's code except through the
// two resolvers below, which read the caller's installed dependencies.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Parses `--name value` pairs; a name given more than once collects its values. */
export function parseArgs(argv, multi = []) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
    const name = arg.slice(2);
    if (multi.includes(name)) {
      args[name] = argv.slice(i + 1).filter((v) => !v.startsWith('--'));
      i += args[name].length;
    } else {
      args[name] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

export const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * The caller's Stryker configuration as a plain object. JSON is parsed; a JS/MJS/CJS config is
 * imported and its default export (or module.exports) is used. A config that is a function, or
 * that holds one, cannot be written back out as JSON and is refused here rather than mangled.
 */
export async function loadStrykerConfig(path) {
  const abs = resolve(path);
  if (extname(abs) === '.json') return readJson(abs);
  const mod = await import(pathToFileURL(abs).href);
  const config = mod.default ?? mod;
  const plain = JSON.parse(JSON.stringify(config));
  if (JSON.stringify(plain) === undefined || typeof config === 'function') {
    throw new Error(`${path} does not export a plain object, so it cannot be sharded.`);
  }
  return plain;
}

/**
 * Resolves a package the way Stryker itself would see it: from the caller's workspace first, then
 * from beside `@stryker-mutator/core`, where pnpm keeps Stryker's own dependencies.
 */
export function resolveFromCaller(request, cwd = process.cwd()) {
  const fromWorkspace = createRequire(resolve(cwd, 'package.json'));
  try {
    return fromWorkspace.resolve(request);
  } catch {
    const core = fromWorkspace.resolve('@stryker-mutator/core');
    return createRequire(core).resolve(request, { paths: [dirname(core)] });
  }
}

/** Statuses whose mutants cost a test run. CompileError and Ignored are decided without one. */
export const TESTED = new Set(['Killed', 'Survived', 'Timeout', 'RuntimeError', 'NoCoverage']);

/** Fields of a Stryker config that a shard config overrides. The merged report restores them. */
export const SHARD_OVERRIDES = [
  'mutate',
  'incremental',
  'force',
  'incrementalFile',
  'reporters',
  'jsonReporter',
  'thresholds',
  'concurrency',
];
