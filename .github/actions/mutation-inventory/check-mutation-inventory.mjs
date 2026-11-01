#!/usr/bin/env node
/**
 * Fails when the mutation run did not run every unit test.
 *
 * Layer: tooling.
 *
 * Stryker judges each mutant only with the tests its run discovered. A test the run never
 * discovered is never held to failing on a mutant: one only it would kill survives, and the test
 * itself goes unchecked. Selecting tests by their import graph is the known way to lose one: the
 * graph Jest builds covers only its `roots`, so a spec that reaches the code through a helper
 * outside them drops out. This check does not depend on how the tests were selected. It compares
 * every test the unit suite runs with the tests the mutation run recorded, and fails when one is
 * missing.
 *
 * A test is identified by its full name, the describe titles and the test title joined by spaces,
 * because that is how Stryker identifies it: the Jest runner uses the full name as the test's id,
 * the run keeps one entry per id across all files, and a mutant's tests are selected by that name
 * among the spec files related to the mutated one. Tests sharing a full name in one file are one
 * entry and run together, since they share the file's relatedness. A full name carried by two spec
 * files is also one entry, but the report cannot say whether the second file ran: it fails the
 * check, naming both files, so that one is renamed.
 *
 * Usage: `node check-mutation-inventory.mjs <stryker report> <jest --json output>
 * [exemptions]`. The Stryker report is the incremental file `stryker run` writes after a run; it
 * carries the run's test inventory in the mutation-testing-report schema. A report that cannot be
 * read, or that lists no test, fails the check rather than passing it.
 *
 * The optional exemptions file lists spec files the run may leave out, each with its reason: a spec
 * that executes no code under `src/` judges no mutant, so the related-test lookup is right to leave
 * it out. The list is held to account both ways: an exempt file that is no longer in the unit suite,
 * or that the run did record, fails the check, so the list can neither rot nor hide a real gap.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** How many missing tests the failure lists by name before it only counts the rest. */
const LISTED_LIMIT = 20;

/**
 * Reads a JSON file, or stops the check naming the file.
 *
 * @param file - The path to read.
 * @returns The parsed value.
 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read ${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Prints the reason and exits non-zero.
 *
 * @param message - What went wrong.
 */
function fail(message) {
  console.error(`check-mutation-inventory: ${message}`);
  process.exit(1);
}

/**
 * Lists the full names a mutation run recorded, the spec files the report attributes them to, and
 * each name together with its file.
 *
 * @param report - The parsed Stryker report.
 * @returns The recorded names, the files that carry at least one of them, and the file-and-name
 * pairs.
 */
function strykerInventory(report) {
  const names = new Set();
  const files = new Set();
  const pairs = new Set();
  for (const [file, entry] of Object.entries(report.testFiles ?? {})) {
    for (const test of entry.tests ?? []) {
      names.add(test.name);
      files.add(file);
      pairs.add(`${file}\0${test.name}`);
    }
  }
  return { names, files, pairs };
}

/** Assertion statuses in which Jest did not run the test, so the mutation run owes it nothing. */
const NOT_RUN = new Set(['pending', 'skipped', 'todo', 'disabled']);

/**
 * Lists the full names a Jest run executed, each with the spec files, relative to `root`, that
 * carry it, and how many of the file's tests carry it.
 *
 * @param results - The parsed `jest --json` output.
 * @param root - The directory the Stryker report's paths are relative to.
 * @returns The executed full names, each with its test count per file.
 */
function jestInventory(results, root) {
  const filesByName = new Map();
  for (const file of results.testResults ?? []) {
    const relative = path.relative(root, file.name).split(path.sep).join('/');
    for (const test of file.assertionResults ?? []) {
      if (NOT_RUN.has(test.status)) {
        continue;
      }
      const name = [...test.ancestorTitles, test.title].join(' ');
      const files = filesByName.get(name) ?? new Map();
      filesByName.set(name, files.set(relative, (files.get(relative) ?? 0) + 1));
    }
  }
  return filesByName;
}

/**
 * Prints a heading and a bounded list, then exits non-zero.
 *
 * @param heading - What the lines are.
 * @param lines - The lines, already sorted.
 */
function failListing(heading, lines) {
  const listed = lines.slice(0, LISTED_LIMIT).map((line) => `  ${line}`);
  const rest = lines.length - listed.length;
  fail([heading, ...listed, ...(rest > 0 ? [`  and ${rest} more`] : [])].join('\n'));
}

/**
 * Reads the exemption list and holds it to account both ways, stopping the check when an exempt
 * spec is no longer in the unit suite or ran in the mutation run.
 *
 * @param exemptionsPath - The exemptions file, or `undefined` for none.
 * @param executed - The executed full names, each with its test count per file.
 * @param recorded - The recorded names and the files the report attributes them to.
 * @returns The exempt spec files.
 */
function readExemptions(exemptionsPath, executed, recorded) {
  const entries = exemptionsPath === undefined ? [] : readJson(exemptionsPath);
  if (!Array.isArray(entries)) {
    fail(`${exemptionsPath} must be a JSON array of { "file", "reason" } entries`);
  }
  const unexplained = entries
    .filter((entry) => typeof entry?.file !== 'string' || typeof entry?.reason !== 'string' || entry.reason.trim() === '')
    .map((entry) => (typeof entry?.file === 'string' ? entry.file : JSON.stringify(entry)));
  if (unexplained.length > 0) {
    failListing(`${unexplained.length} exempt entries have no file or no reason:`, unexplained.sort());
  }
  const exempt = new Set(entries.map((entry) => entry.file));
  const executedFiles = new Set([...executed.values()].flatMap((files) => [...files.keys()]));
  for (const file of exempt) {
    if (!executedFiles.has(file)) {
      fail(`exempt spec ${file} is not in the unit suite; remove it from ${exemptionsPath}`);
    }
    if (recorded.files.has(file)) {
      fail(`exempt spec ${file} ran in the mutation run; remove it from ${exemptionsPath}`);
    }
  }
  return exempt;
}

/**
 * Runs the check.
 *
 * @param argv - The command-line arguments after the script path.
 */
function main(argv) {
  const [strykerPath, jestPath, exemptionsPath] = argv;
  if (strykerPath === undefined || jestPath === undefined) {
    fail('usage: check-mutation-inventory.mjs <stryker report> <jest --json output> [exemptions]');
  }
  const report = readJson(strykerPath);
  const recorded = strykerInventory(report);
  if (recorded.names.size === 0) {
    fail(`${strykerPath} records no test, so the mutation run proved nothing`);
  }
  const executed = jestInventory(readJson(jestPath), report.projectRoot ?? process.cwd());
  const exempt = readExemptions(exemptionsPath, executed, recorded);
  // A name is required when a spec that is not exempt carries it, once per test that carries it.
  const required = [...executed]
    .map(([name, files]) => [name, [...files].filter(([file]) => !exempt.has(file)).sort()])
    .filter(([, files]) => files.length > 0);
  const shared = required
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => `${files.map(([file]) => file).join(', ')} › ${name}`)
    .sort();
  if (shared.length > 0) {
    failListing(
      `${shared.length} full names are carried by more than one spec file, so the mutation run ` +
        'cannot tell whether each ran; rename one of each:',
      shared,
    );
  }
  const testsOf = (files) => files.reduce((total, [, tests]) => total + tests, 0);
  const total = required.reduce((sum, [, files]) => sum + testsOf(files), 0);
  // The name alone is not enough: the same full name recorded under another spec file, one only
  // Stryker's Jest config includes, would otherwise hide a unit test that never ran.
  const missing = required.filter(([name, [[file]]]) => !recorded.pairs.has(`${file}\0${name}`));
  if (missing.length > 0) {
    failListing(
      `${missing.reduce((sum, [, files]) => sum + testsOf(files), 0)} of ${total} unit tests did not run in the mutation run:`,
      missing.map(([name, [[file]]]) => `${file} › ${name}`).sort(),
    );
  }
  const exemptNote = exempt.size === 0 ? '' : `, ${exempt.size} exempt spec files left out`;
  console.log(
    `check-mutation-inventory: all ${total} unit tests ran in the mutation run${exemptNote}`,
  );
}

main(process.argv.slice(2));
