// Guards how the reusable workflows and the setup action read their inputs. Layer: CI tooling.
//
// A `${{ ... }}` inside a `run:` body is pasted into the shell before the shell runs, so whatever
// the expression holds is code. An input that a caller feeds from an event (a PR title, a branch
// name) would then run on the runner with the job's token. The rule: an input reaches a `run:` body
// through `env:`, except the inputs that ARE commands, which are documented as such. This runs in
// the same `node --test` glob as the shard tests.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const files = [
  ...readdirSync(new URL('workflows/', root)).filter((f) => f.endsWith('.yml')).map((f) => `workflows/${f}`),
  'actions/setup-node-pnpm/action.yml',
  'actions/mutation-inventory/action.yml',
];

// Inputs that are commands by design; a numeric input (`type: number`) cannot carry text.
const COMMAND_INPUTS = new Set([
  'unit-command', 'e2e-api-command', 'build-command', 'full-command', 'mutation-command', 'post-install',
  'coverage-fail-under',
]);
// Expressions whose value is fixed by GitHub or by this workflow, not by an event's author. The
// whole expression must be one of these: a safe name next to an input (`inputs.x || github.sha`)
// still carries the input.
const SAFE = /^(runner\.temp|github\.workspace|github\.action_path|github\.sha|job\.workflow_sha|job\.workflow_repository|github\.run_id|matrix\.shard|steps\.[\w-]+\.outputs\.[\w-]+)$/;

/** Whether a run body may interpolate this expression. */
export function allowed(expr) {
  if (SAFE.test(expr)) return true;
  const input = /^inputs\.([\w-]+)$/.exec(expr);
  return input !== null && COMMAND_INPUTS.has(input[1]);
}

/** Every expression inside a `run:` body, as `{ file, line, expr }`. */
function expressionsInRunBodies(file) {
  const lines = readFileSync(new URL(file, root), 'utf8').split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(\s*)(- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length + (m[2] ? 2 : 0);
    const body = [[i + 1, m[3]]];
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || lines[j].length - lines[j].trimStart().length > indent)) {
      body.push([j + 1, lines[j]]);
      j += 1;
    }
    for (const [line, text] of body) {
      if (text.trim().startsWith('#')) continue;
      for (const e of text.matchAll(/\$\{\{(.*?)\}\}/g)) found.push({ file, line, expr: e[1].trim() });
    }
    i = j - 1;
  }
  return found;
}

test('no run body interpolates an input that is not a documented command', () => {
  const offenders = files
    .flatMap(expressionsInRunBodies)
    .filter(({ expr }) => !allowed(expr))
    .map(({ file, line, expr }) => `${file}:${line}: ${expr}`);
  assert.deepEqual(offenders, []);
});

// The classifier decides the test above, so it is held to the cases that a substring match got wrong.
test('an input next to a safe name is still an input', () => {
  assert.equal(allowed('github.sha'), true);
  assert.equal(allowed('steps.merge.outputs.files'), true);
  assert.equal(allowed('inputs.unit-command'), true);
  for (const expr of [
    'inputs.api-port || github.sha',
    'github.sha && inputs.msrv-version',
    'inputs.msrv-version',
    'format(\'{0}\', inputs.msrv-version, runner.temp)',
    'github.event.pull_request.title',
    'inputs.unit-command || inputs.msrv-version',
  ]) assert.equal(allowed(expr), false, expr);
});

test('the inputs that are commands say so, and the ones that are values are checked before they are used', () => {
  const read = (f) => readFileSync(new URL(f, root), 'utf8');
  for (const [file, names] of [
    ['workflows/node-ci.yml', ['unit-command', 'e2e-api-command', 'post-install']],
    ['workflows/node-lib-ci.yml', ['unit-command', 'build-command', 'post-install']],
    ['workflows/rust-ci.yml', ['mutation-command']],
    ['workflows/mutation-full.yml', ['full-command']],
    ['actions/setup-node-pnpm/action.yml', ['post-install']],
  ]) {
    const text = read(file);
    for (const name of names) {
      const at = text.indexOf(`\n      ${name}:`) >= 0 ? text.indexOf(`\n      ${name}:`) : text.indexOf(`\n  ${name}:`);
      assert.ok(at >= 0, `${file} declares ${name}`);
      assert.match(text.slice(at, at + 600), /never\s+text taken from an event/, `${file}: ${name} says it runs as a shell command`);
    }
  }
  assert.match(read('workflows/rust-ci.yml'), /MSRV_VERSION[\s\S]{0,400}\[\[ "\$MSRV_VERSION" =~ /, 'msrv-version is validated');
  assert.match(read('workflows/node-ci.yml'), /\[\[ "\$port" =~ \^\[0-9\]\{1,5\}\$ \]\]/, 'the ports are validated');
});

// A line that starts a workflow command is read by the runner, so text from outside must not be
// echoed into one: a value with a newline can start a second command. The inputs that are checked
// before use are named in the message, never printed.
const CHECKED_VALUES = ['MSRV_VERSION', 'API_PORT', 'WEB_PORT', 'SIGNATURES', 'port'];

test('a workflow-command line never prints a checked input value', () => {
  const offenders = [];
  for (const file of files) {
    readFileSync(new URL(file, root), 'utf8').split('\n').forEach((text, i) => {
      if (!/::(error|warning|notice)/.test(text) || text.trim().startsWith('#')) return;
      for (const name of CHECKED_VALUES) {
        if (new RegExp(`\\$\\{?${name}\\b`).test(text)) offenders.push(`${file}:${i + 1}: ${name}`);
      }
    });
  }
  assert.deepEqual(offenders, []);
});

test('the signatures job is opt-in, checks its mode before installing, and holds a read token', () => {
  const security = readFileSync(new URL('workflows/security.yml', root), 'utf8');
  assert.match(security, /signatures:\n(?: {8}[^\n]*\n)+? {8}default: "off"/, 'off by default');
  const job = security.slice(security.indexOf('  audit-signatures:'));
  assert.match(job, /if: inputs\.signatures != 'off'/);
  assert.match(job, /permissions:\n {6}contents: read/);
  assert.ok(job.indexOf('Check the mode') < job.indexOf('setup-node-pnpm'), 'the mode is checked before the install');
  assert.match(job, /warn\|enforce\) ;;/);
  assert.match(job, /npm audit signatures/);
});
