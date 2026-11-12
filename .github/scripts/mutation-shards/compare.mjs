// Compares two mutation reports mutant by mutant. Layer: CI tooling, the proof that a sharded run
// gives what a single run gives.
//
//   node compare.mjs <single.json> <sharded.json>
//   node compare.mjs --unmatched <report.json>
//
// A mutant is identified by (file, location, mutator, replacement), never by id: ids are
// per-run numbering. Exits 1 on any status difference, any mutant present in one run only, or
// any score difference. A Killed/Timeout flip is listed apart: both mean "detected", and a
// timeout depends on how loaded the machine was, so it is reported and does not fail.
import { pathToFileURL } from 'node:url';
import { readJson } from './lib.mjs';
import { scoreOf } from './score.mjs';

const keyOf = (file, m) =>
  `${file}\u0000${m.location.start.line}:${m.location.start.column}-${m.location.end.line}:${m.location.end.column}\u0000${m.mutatorName}\u0000${m.replacement ?? ''}`;

export function index(report) {
  const map = new Map();
  for (const [file, data] of Object.entries(report.files)) {
    for (const m of data.mutants) map.set(keyOf(file, m), m.status);
  }
  return map;
}

// The mutants a report ties to a test by an id that no `testFiles` entry lists: a mutant killed
// by an `it.each` row under its unformatted title is recorded that way. Stryker cannot match
// such an id to a test, so an incremental run re-runs the mutant instead of reusing its result.
export function unmatchedTestRefs(report) {
  const listed = new Set();
  for (const spec of Object.values(report.testFiles ?? {})) for (const t of spec.tests ?? []) listed.add(t.id);
  const keys = [];
  for (const [file, data] of Object.entries(report.files)) {
    for (const m of data.mutants) {
      const refs = [m.coveredBy, m.killedBy, m.testsCompleted].flatMap((ids) => (Array.isArray(ids) ? ids : []));
      if (refs.some((id) => !listed.has(id))) keys.push(keyOf(file, m));
    }
  }
  return keys;
}

export function diff(a, b) {
  const onlyA = [];
  const onlyB = [];
  const changed = [];
  const flips = [];
  for (const [key, status] of a) {
    if (!b.has(key)) onlyA.push(key);
    else if (b.get(key) !== status) {
      const pair = [status, b.get(key)].sort().join('/');
      (pair === 'Killed/Timeout' ? flips : changed).push({ key, a: status, b: b.get(key) });
    }
  }
  for (const key of b.keys()) if (!a.has(key)) onlyB.push(key);
  return { onlyA, onlyB, changed, flips };
}

async function main() {
  if (process.argv[2] === '--unmatched') {
    console.log(unmatchedTestRefs(readJson(process.argv[3])).length);
    return;
  }
  const [pathA, pathB] = process.argv.slice(2);
  const reportA = readJson(pathA);
  const reportB = readJson(pathB);
  const a = index(reportA);
  const b = index(reportB);
  const d = diff(a, b);
  const [sa, sb] = await Promise.all([scoreOf(reportA), scoreOf(reportB)]);
  console.log(`mutants: ${a.size} vs ${b.size}; score: ${sa.mutationScore.toFixed(4)} vs ${sb.mutationScore.toFixed(4)}`);
  console.log(`only in first: ${d.onlyA.length}; only in second: ${d.onlyB.length}; status differs: ${d.changed.length}; Killed/Timeout flips: ${d.flips.length}`);
  for (const c of d.changed.slice(0, 20)) console.log(`  ${c.a} -> ${c.b}  ${c.key.replaceAll('\u0000', ' | ')}`);
  for (const k of d.onlyA.slice(0, 20)) console.log(`  only first: ${k.replaceAll('\u0000', ' | ')}`);
  for (const k of d.onlyB.slice(0, 20)) console.log(`  only second: ${k.replaceAll('\u0000', ' | ')}`);
  const scoreDiffers = sa.mutationScore !== sb.mutationScore && d.flips.length === 0;
  if (d.onlyA.length || d.onlyB.length || d.changed.length || scoreDiffers) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
