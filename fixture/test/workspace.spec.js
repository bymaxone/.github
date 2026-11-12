// A consumer's own spec that walks its tree. It stands for the specs that count files at the
// root (an instruction-file size budget, a licence check): they must see exactly the repository
// they live in. The reusable workflow runs this suite in the consumer's workspace (every shard's
// dry run and the inventory in the aggregate), so any file the workflow adds there fails it.
//
// Measured on a real consumer: the tooling was checked out at `.mutation-shards/`, and the root
// files of that checkout (this repository's AGENTS.md) were counted on top of the consumer's own.
//
// Update `OWN` when this repository gains or loses a top-level entry.
const { readdirSync } = require('node:fs');
const path = require('node:path');

// Stryker runs Jest with --findRelatedTests (see stryker.config.json), and a spec that imports no
// mutated file is left out of its dry run: it would never run in a shard's workspace, and the
// inventory would find a unit test the mutation run did not record. Importing every source file
// keeps this spec in both. A test in workflow.test.mjs fails if a source file is missing here.
require('../src/math');
require('../src/text');

// Tracked top-level entries.
const OWN = new Set([
  '.github', '.gitignore', 'AGENTS.md', 'LICENSE', 'README.md', 'agents', 'fixture',
  'jest.config.js', 'jest.stryker.config.js', 'osv-scanner.toml', 'package.json',
  'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'profile', 'stryker.config.json',
]);
// What a run itself leaves at the root: dependencies, the report directory, Stryker's sandbox and
// the per-shard configs it is given. None of them is ours to forbid.
const RUN_OUTPUT = /^(\.git|node_modules|reports|\.stryker-tmp|\.stryker-shard-\d+\.json)$/;

describe('the workspace the workflow runs a consumer suite in', () => {
  it('holds nothing at its root that the repository does not', () => {
    // The root is two levels above this file, in the checkout and in Stryker's sandbox copy.
    const root = path.resolve(__dirname, '..', '..');
    const unexpected = readdirSync(root).filter((name) => !OWN.has(name) && !RUN_OUTPUT.test(name));
    expect(unexpected).toEqual([]);
  });
});
