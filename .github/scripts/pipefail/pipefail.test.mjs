// Guards the pipelines of the workflows that search a producer's output under `pipefail`.
// Layer: CI tooling. The workflows are parsed by Ruby's Psych, as the other guards do, and the steps
// are run with `bash` against a real git repository, so these tests need `ruby`, `bash` and `git`.
//
// Why: `producer | grep -q pattern` under `set -o pipefail` fails when grep exits at its first match
// while the producer is still writing more than a pipe holds (64 KiB on Linux). The producer dies of
// SIGPIPE (status 141), the pipeline reports it, and a branch that tests the pipeline reads a match as
// a miss. The mutation job of three workflows skipped itself on exactly the largest merges that way.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';

const RUBY = "require 'yaml'; require 'json'; puts JSON.generate(YAML.safe_load($stdin.read, aliases: true))";
const GITHUB = new URL('../../', import.meta.url).pathname;
const load = (path) =>
  JSON.parse(execFileSync('ruby', ['-e', RUBY], { input: readFileSync(join(GITHUB, path), 'utf8'), encoding: 'utf8' }));

const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
const scratch = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim();

/**
 * A repository whose second commit changes `src/a.ts` and thousands of long-named files after it, so
 * `git diff --name-only` lists a match first and then far more than a pipe holds.
 */
let built;
/** Built once: every case only reads it. */
function bigDiffRepo() {
  built ??= buildBigDiffRepo();
  return built;
}

function buildBigDiffRepo() {
  const dir = scratch('pipefail-');
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  const before = git(dir, 'rev-parse', 'HEAD');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'x\n');
  const names = [];
  for (let i = 0; i < 6000; i += 1) names.push(`tests/${'n'.repeat(220)}-${String(i).padStart(5, '0')}.txt`);
  mkdirSync(join(dir, 'tests'));
  for (const name of names) writeFileSync(join(dir, name), 'x\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'second');
  return { dir, before, sha: git(dir, 'rev-parse', 'HEAD') };
}

/** Runs a step's script in `cwd`; returns the exit status, the step output file and the log. */
function runStep(script, cwd, env) {
  const out = join(scratch('pipefail-out-'), 'out');
  writeFileSync(out, '');
  const r = spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...env } });
  return { status: r.status, output: readFileSync(out, 'utf8').trim(), log: r.stdout + r.stderr };
}

const DETECTORS = [
  ['node-lib-ci.yml', 'Detect source changes'],
  ['node-ci.yml', 'Detect application-source changes'],
  ['rust-ci.yml', 'Detect source changes'],
];
const detector = ([file, name]) => {
  const steps = Object.values(load(`workflows/${file}`).jobs).flatMap((job) => job.steps ?? []);
  const found = steps.filter((s) => s.name === name);
  assert.equal(found.length, 1, `${file}: one step named ${name}`);
  return found[0].run;
};

test('the fixture is far over the pipe buffer and the old pipeline skips on it', () => {
  const { dir, before, sha } = bigDiffRepo();
  const size = execFileSync('git', ['diff', '--name-only', before, sha], { cwd: dir, maxBuffer: 1 << 28 }).length;
  assert.ok(size > 1_000_000, `the diff names ${size} bytes`);
  // The control: the pipeline the workflows used to hold, so the cases below are not vacuous.
  const old = `set -euo pipefail\nif git diff --name-only "${before}" "${sha}" | grep -qE -- "^(src/)"; then echo RUN; else echo SKIP; fi`;
  const r = spawnSync('bash', ['-c', old], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'SKIP');
});

for (const site of DETECTORS) {
  const [file] = site;

  test(`${file} runs mutation on a diff far over the pipe buffer with a match listed first`, () => {
    const { dir, before, sha } = bigDiffRepo();
    const r = runStep(detector(site), dir, { EVENT_NAME: 'push', BEFORE: before, SHA: sha, SOURCE_GLOBS: '^(src/)' });
    assert.equal(r.status, 0, r.log);
    assert.equal(r.output, 'run=true');
  });

  test(`${file} skips when no listed path matches, on the same large diff`, () => {
    const { dir, before, sha } = bigDiffRepo();
    const r = runStep(detector(site), dir, { EVENT_NAME: 'push', BEFORE: before, SHA: sha, SOURCE_GLOBS: '^(lib/)' });
    assert.equal(r.status, 0, r.log);
    assert.equal(r.output, 'run=false');
  });

  test(`${file} fails the step when git cannot produce the diff, and writes no verdict`, () => {
    const { dir, before } = bigDiffRepo();
    const missing = 'f'.repeat(40);
    const r = runStep(detector(site), dir, { EVENT_NAME: 'push', BEFORE: before, SHA: missing, SOURCE_GLOBS: '^(src/)' });
    assert.notEqual(r.status, 0, r.log);
    assert.equal(r.output, '');
  });

  test(`${file} keeps its other branches: a manual dispatch runs, a root commit is diffed whole`, () => {
    const { dir, sha } = bigDiffRepo();
    const dispatch = runStep(detector(site), dir, { EVENT_NAME: 'workflow_dispatch', BEFORE: '', SHA: sha, SOURCE_GLOBS: '^(src/)' });
    assert.equal(dispatch.output, 'run=true');
    const root = git(dir, 'rev-list', '--max-parents=0', 'HEAD');
    const first = runStep(detector(site), dir, { EVENT_NAME: 'push', BEFORE: '0'.repeat(40), SHA: root, SOURCE_GLOBS: '^(README)' });
    assert.equal(first.status, 0, first.log);
    assert.equal(first.output, 'run=true');
  });
}

/** The nested-AGENTS.md check of agents-sync.yml, cut out of its step and run over `docs`. */
function templateCheck(docs) {
  const steps = Object.values(load('workflows/agents-sync.yml').jobs).flatMap((job) => job.steps ?? []);
  const script = steps.map((s) => s.run ?? '').find((run) => run.includes('while IFS= read -r nested; do'));
  assert.ok(script, 'the step with the nested-document loop');
  const lines = script.split('\n');
  const from = lines.findIndex((l) => l.startsWith('while IFS= read -r nested; do'));
  const to = lines.findIndex((l, i) => i > from && l === 'EOF');
  assert.ok(from >= 0 && to > from, 'the loop and its here-document are found');
  const loop = lines.slice(from, to + 1).join('\n');
  const dir = scratch('pipefail-docs-');
  const paths = docs.map(([name, text]) => {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return path;
  });
  const harness = `set -euo pipefail\nclean() { printf '%s' "$1"; }\nstatus=0\nnested_docs='${paths.join('\n')}'\n${loop}\necho "status=$status"`;
  return spawnSync('bash', ['-c', harness], { encoding: 'utf8' });
}

test('agents-sync names a template on a nested AGENTS.md far over the pipe buffer, marker on line 1', () => {
  const big = `{{ project }}\n${'a line of ordinary prose that fills the file\n'.repeat(15000)}`;
  assert.ok(big.length > 600_000);
  const r = templateCheck([['pkg/AGENTS.md', big]]);
  assert.match(r.stdout, /status=1/, r.stdout + r.stderr);
  assert.match(r.stdout, /is a template/);
});

test('agents-sync leaves a large nested AGENTS.md alone when its only marker is in a fence or in backticks', () => {
  const body = `\`\`\`\n{{ project }}\n\`\`\`\nSay \`{{ name }}\` in prose.\n${'ordinary prose\n'.repeat(60000)}`;
  const r = templateCheck([['pkg/AGENTS.md', body]]);
  assert.match(r.stdout, /status=0/, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /is a template/);
});

test('agents-sync reads each of several documents on its own', () => {
  const r = templateCheck([
    ['a/AGENTS.md', 'plain\n'],
    ['b/AGENTS.md', 'has {{ a marker }}\n'],
  ]);
  assert.match(r.stdout, /status=1/);
  assert.equal((r.stdout.match(/is a template/g) ?? []).length, 1);
});

// ---- the guard: no search of a multi-line producer by an early-exiting grep ------------------------

/** Every `run` script of the workflows, the workflow templates and the composite actions, with where it is. */
function scripts() {
  const found = [];
  const collect = (path, doc) => {
    const steps = [...Object.values(doc.jobs ?? {}).flatMap((job) => job.steps ?? []), ...(doc.runs?.steps ?? [])];
    for (const step of steps) if (typeof step.run === 'string') found.push({ where: `${path}: ${step.name ?? step.id ?? 'step'}`, script: step.run });
  };
  for (const dir of ['workflows', 'workflow-templates']) {
    for (const file of readdirSync(join(GITHUB, dir)).filter((f) => /\.ya?ml$/.test(f))) collect(`${dir}/${file}`, load(`${dir}/${file}`));
  }
  for (const action of readdirSync(join(GITHUB, 'actions'))) {
    const file = join('actions', action, 'action.yml');
    collect(file, load(file));
  }
  return found;
}

/** Whether a pipeline stage is a `grep` that stops at its first match: `-q` in any option token before `--`. */
const isEarly = (stage) => {
  const [command, ...tokens] = stage.trim().split(/\s+/);
  if (command !== 'grep') return false;
  for (const token of tokens) {
    if (token === '--') return false;
    if (token === '--quiet' || /^-[A-Za-z]*q[A-Za-z]*$/.test(token)) return true;
  }
  return false;
};
// A producer that is one short line by construction: a value written by the shell, or one line of a file.
const BOUNDED = /(?:^|[\s!;&(])(?:printf|echo|(?:head|tail)\s+-(?:n\s*)?1)\s[^|]*$/;

/** The pipelines in `script` whose consumer exits at its first match and whose producer is not bounded. */
export function unsafeSearches(script) {
  const logical = script.replace(/\\\n\s*/g, ' ').replace(/\|[ \t]*\n\s*/g, '| ').split('\n');
  const bad = [];
  for (const line of logical) {
    const stages = line.split(/(?<!\|)\|(?!\|)/);
    for (let i = 1; i < stages.length; i += 1) {
      if (!isEarly(stages[i])) continue;
      if (i === 1 && BOUNDED.test(stages[0].trim())) continue;
      bad.push(line.trim());
    }
  }
  return bad;
}

test('no workflow, template or action searches a multi-line producer with an early-exiting grep', () => {
  const all = scripts();
  assert.ok(all.length > 50, `${all.length} scripts read`);
  const offenders = all.flatMap(({ where, script }) => unsafeSearches(script).map((line) => `${where}: ${line}`));
  assert.deepEqual(offenders, []);
});

test('the guard refuses the pipelines it exists for and allows the bounded ones', () => {
  const refused = [
    'if git diff --name-only "$base" "$SHA" | grep -qE -- "$GLOBS"; then',
    "awk '1' f \\\n  | sed 's/a/b/' | grep -q '{{'",
    'git ls-files | grep -q ^src/',
    'cat big.txt | grep --quiet x',
    'git log --format=%H | grep -Eq "^[0-9a-f]{40}$"',
    'git ls-files | grep -E -q ^src/',
    'git ls-files |\n  grep -q ^src/',
  ];
  for (const line of refused) assert.equal(unsafeSearches(line).length, 1, line);
  const allowed = [
    'if ! printf \'%s\' "$PR_TITLE" | grep -qE "^(a|b): .+"; then',
    'if [ -z "$X" ] || ! printf \'%s\' "$SHA" | grep -Eq \'^[0-9a-f]{40}$\'; then',
    "head -1 agents/code-review-rules.md | grep -q '^<!-- shared:begin -->'",
    'tail -1 file | grep -q x',
    'grep -qE -- "$GLOBS" <<<"$changed"',
    'git diff --name-only a b | grep -E x',
    'git ls-files | grep -E -- -q',
    'git ls-files | grep -e -q-pattern',
  ];
  for (const line of allowed) assert.deepEqual(unsafeSearches(line), [], line);
});
