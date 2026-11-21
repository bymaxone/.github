// Guards two opt-in inputs: `dependency-review` of security.yml and `allow-private` of codeql.yml.
// Layer: CI tooling. The workflows are parsed by Ruby's Psych, as the other guards do, and the
// visibility step of codeql.yml is run against a fake `gh`, so these tests need `ruby` and `bash`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const RUBY = "require 'yaml'; require 'json'; puts JSON.generate(YAML.safe_load($stdin.read, aliases: true))";
const load = (name) =>
  JSON.parse(execFileSync('ruby', ['-e', RUBY], { input: readFileSync(new URL(`../../workflows/${name}`, import.meta.url), 'utf8'), encoding: 'utf8' }));
const inputsOf = (doc) => (doc.on ?? doc.true).workflow_call.inputs;

const security = load('security.yml');
const codeql = load('codeql.yml');

test('dependency-review is a boolean that defaults to on and gates only its own job', () => {
  const input = inputsOf(security)['dependency-review'];
  assert.equal(input.type, 'boolean');
  assert.equal(input.default, true);
  assert.equal(security.jobs['dependency-review'].if, "github.event_name == 'pull_request' && inputs['dependency-review']");
  // The other jobs must not read it: turning the review off cannot turn a scan off.
  for (const [name, job] of Object.entries(security.jobs)) {
    if (name !== 'dependency-review') assert.doesNotMatch(String(job.if ?? ''), /dependency-review/, name);
  }
});

test('allow-private is a boolean that defaults to off and is read only by the visibility step', () => {
  const input = inputsOf(codeql)['allow-private'];
  assert.equal(input.type, 'boolean');
  assert.equal(input.default, false);
  const step = codeql.jobs.visibility.steps.find((s) => s.id === 'check');
  assert.equal(step.env.ALLOW_PRIVATE, "${{ inputs['allow-private'] }}");
  assert.equal(codeql.jobs.analyze.if, "${{ needs.visibility.outputs.scan == 'true' }}");
});

// Runs the visibility step with `gh` answering `visibility` (or failing when it is empty).
function visibility(answer, allowPrivate) {
  const dir = mkdtempSync(join(tmpdir(), 'vis-'));
  try {
    const bin = join(dir, 'gh');
    writeFileSync(bin, answer === '' ? '#!/bin/sh\nexit 1\n' : `#!/bin/sh\necho ${answer}\n`);
    chmodSync(bin, 0o755);
    // `sleep` is shadowed so the retry loop of the failing case does not wait.
    writeFileSync(join(dir, 'sleep'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(dir, 'sleep'), 0o755);
    const out = join(dir, 'out');
    writeFileSync(out, '');
    const script = codeql.jobs.visibility.steps.find((s) => s.id === 'check').run;
    const r = spawnSync('bash', ['-c', script], {
      env: { PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: out, REPO: 'o/r', GH_TOKEN: 'x', ALLOW_PRIVATE: allowPrivate },
      encoding: 'utf8',
    });
    return { status: r.status, output: readFileSync(out, 'utf8').trim(), log: r.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a public repository is analysed whatever allow-private says', () => {
  assert.equal(visibility('public', 'false').output, 'scan=true');
  assert.equal(visibility('public', 'true').output, 'scan=true');
});

test('a private or internal repository is skipped unless allow-private is true', () => {
  for (const v of ['private', 'internal']) {
    assert.equal(visibility(v, 'false').output, 'scan=false', v);
    assert.equal(visibility(v, '').output, 'scan=false', `${v} with the input unset`);
    assert.equal(visibility(v, 'true').output, 'scan=true', v);
  }
});

test('an unknown visibility is skipped even with allow-private, and the step stays green', () => {
  const r = visibility('', 'true');
  assert.equal(r.status, 0);
  assert.equal(r.output, 'scan=false');
});

test('a value the API does not define for a repository is skipped even with allow-private', () => {
  for (const v of ['secret', 'Private', 'null', 'public-ish']) {
    const r = visibility(v, 'true');
    assert.equal(r.status, 0, v);
    assert.equal(r.output, 'scan=false', v);
    assert.match(r.log, /^::warning::/m, `${v} warns`);
    assert.doesNotMatch(r.log.split('\n').filter((l) => l.startsWith('::warning::')).join('\n'), new RegExp(v), `${v} is not echoed in the warning`);
  }
  // A known non-public value is a notice, not a warning.
  assert.doesNotMatch(visibility('private', 'false').log, /::warning::/);
  assert.doesNotMatch(visibility('private', 'true').log, /::warning::/);
});
