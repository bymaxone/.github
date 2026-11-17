// Guards the semgrep job of security.yml. Layer: CI tooling.
//
// The job hands the caller's tree to a third-party image, so its shape is the safety property: no
// secret, read-only scope, a read-only mount, an image pinned by digest, and caller-supplied rule
// names validated before they reach the command line. The workflow is parsed by Ruby's Psych, as the
// release-family checks do, so these tests need `ruby`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const path = new URL('../../workflows/security.yml', import.meta.url);
const text = readFileSync(path, 'utf8');
const RUBY = "require 'yaml'; require 'json'; puts JSON.generate(YAML.safe_load($stdin.read, aliases: true))";
const doc = JSON.parse(execFileSync('ruby', ['-e', RUBY], { input: text, encoding: 'utf8' }));
// Psych reads the bare key `on` as the boolean true.
const inputs = (doc.on ?? doc.true).workflow_call.inputs;
const job = doc.jobs.semgrep;
const steps = job?.steps ?? [];
const run = (name) => steps.find((s) => s.name === name)?.run ?? '';
const scan = run('Semgrep scan');

test('the job exists and is skipped when the input is off', () => {
  assert.ok(job, 'jobs.semgrep exists');
  assert.equal(job.if, "inputs.semgrep != 'off'");
  assert.equal(inputs.semgrep.default, 'off');
  assert.equal(inputs['semgrep-config'].default, '');
});

test('the job holds contents: read and nothing else', () => {
  assert.deepEqual(job.permissions, { contents: 'read' });
});

test('the first step is harden-runner in audit mode', () => {
  assert.match(steps[0].uses, /^step-security\/harden-runner@[0-9a-f]{40}$/);
  assert.equal(steps[0].with['egress-policy'], 'audit');
});

test('the image carries a digest and the workspace is mounted read-only', () => {
  const image = steps.find((s) => s.name === 'Semgrep scan').env.SEMGREP_IMAGE;
  assert.match(image, /^semgrep\/semgrep:[\w.-]+@sha256:[0-9a-f]{64}$/);
  assert.match(scan, /docker run --rm --volume "\$\{GITHUB_WORKSPACE\}:\/src:ro"/);
  assert.match(scan, /--volume "\$\{SEMGREP_RULES\}:\/rules:ro"/);
  assert.match(scan, /--metrics=off/);
  assert.match(scan, /--config \/rules/);
  assert.doesNotMatch(scan, /--baseline-commit/);
});

test('the checkout keeps no credential', () => {
  const checkout = steps.find((s) => String(s.uses).startsWith('actions/checkout@'));
  assert.equal(checkout.with['persist-credentials'], false);
});

test('the job references no secret', () => {
  assert.doesNotMatch(JSON.stringify(job), /secrets\./);
  assert.doesNotMatch(JSON.stringify(job), /secrets\[/);
});

test('the registry packs are validated before use and reach the command as array elements', () => {
  const check = run('Check the inputs');
  assert.ok(check, 'the validation step exists');
  assert.ok(steps.findIndex((s) => s.name === 'Check the inputs') < steps.findIndex((s) => s.name === 'Semgrep scan'));
  assert.ok(check.includes('^p/[A-Za-z0-9._-]+$') && check.includes('^r/[A-Za-z0-9._/-]+$'));
  assert.match(scan, /config_args\+=\(--config "\$token"\)/);
  assert.match(scan, /"\$\{config_args\[@\]\}"/);
  // Inputs reach the shell through the environment, never through an expression in the script.
  for (const s of steps) assert.doesNotMatch(s.run ?? '', /\$\{\{\s*inputs\./);
});

test('the rules are read at the workflow own commit, and that commit is required', () => {
  const fetch = steps.find((s) => s.name?.startsWith('Fetch the vendored rules'));
  assert.equal(fetch.env.WORKFLOW_SHA, '${{ job.workflow_sha }}');
  assert.equal(fetch.env.WORKFLOW_REPOSITORY, '${{ job.workflow_repository }}');
  assert.match(fetch.run, /\.github\/semgrep\/rules/);
});

test('a scan that could not run is reported on its own and never as clean', () => {
  assert.match(scan, /::warning title=semgrep unavailable::/);
  assert.match(scan, /::error title=semgrep unavailable::/);
  assert.match(scan, /NOT SCANNED/);
  assert.match(scan, /::warning title=semgrep::/);
  assert.match(scan, /::error title=semgrep::/);
});

test('the commit requirement step exists before the rules fetch', () => {
  const names = steps.map((s) => s.name);
  const required = names.indexOf("Require this workflow's own commit");
  assert.ok(required >= 0);
  assert.ok(required < names.findIndex((n) => n?.startsWith('Fetch the vendored rules')));
});

// The validation step is executed, not only read: the allow-list is the control.
function validate(config, mode = 'warn') {
  const dir = mkdtempSync(join(tmpdir(), 'semgrep-check-'));
  const result = spawnSync('bash', ['-c', run('Check the inputs')], {
    env: { PATH: process.env.PATH, RUNNER_TEMP: dir, SEMGREP_MODE: mode, SEMGREP_CONFIG: config },
    encoding: 'utf8',
  });
  const file = join(dir, 'semgrep-config.txt');
  const accepted = existsSync(file) ? readFileSync(file, 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, out: result.stdout, accepted };
}

test('the template pack list is accepted as separate tokens', () => {
  const packs = 'p/typescript p/nodejs p/expressjs p/jwt p/secrets p/dockerfile p/docker-compose p/github-actions';
  const r = validate(`${packs}\n r/python.lang `);
  assert.equal(r.status, 0);
  assert.deepEqual(r.accepted.trim().split('\n'), [...packs.split(' '), 'r/python.lang']);
});

test('an empty list is accepted', () => {
  assert.equal(validate('').status, 0);
});

for (const bad of ['p/x;id', '$(id)', '--config', 'https://evil.example/r.yml', 'p/x/y','r/a/../b', '/etc/passwd', 'p/x`id`']) {
  test(`rejects ${JSON.stringify(bad)} without echoing it`, () => {
    const r = validate(bad);
    assert.equal(r.status, 1);
    assert.match(r.out, /::error title=semgrep::/);
    assert.ok(!r.out.includes(bad), 'the rejected value is not printed');
  });
}

test('a mode other than warn or enforce is rejected', () => {
  assert.equal(validate('', 'off').status, 1);
  assert.equal(validate('', 'WARN').status, 1);
});

test('the summary fence is computed from the output and a cut list is announced', () => {
  assert.match(scan, /RLENGTH > n/, 'the longest run of backticks is measured');
  assert.match(scan, /lines were cut/);
  assert.match(scan, /the first \$limit lines are in the job summary/);
  assert.doesNotMatch(scan, /echo '```'/, 'no fixed fence');
});

// The summary helper is executed against output that holds fences of its own.
function summarize(output, message = 'Findings:') {
  const dir = mkdtempSync(join(tmpdir(), 'semgrep-summary-'));
  const helper = scan.match(/limit=200[\s\S]*?\n}\n/)?.[0] ?? 'exit 99';
  writeFileSync(join(dir, 'out'), output);
  const result = spawnSync('bash', ['-c', `${helper}\nsummary "$MESSAGE" "$OUT"`], {
    env: { PATH: process.env.PATH, GITHUB_STEP_SUMMARY: join(dir, 'summary'), MESSAGE: message, OUT: join(dir, 'out') },
    encoding: 'utf8',
  });
  const summary = existsSync(join(dir, 'summary')) ? readFileSync(join(dir, 'summary'), 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, summary };
}

test('the fence is longer than every run of backticks in the output', () => {
  const r = summarize('a\n```\nb ``` c\n````\n`x`\n');
  assert.equal(r.status, 0);
  const lines = r.summary.split('\n');
  const wrapper = lines.filter((l) => l === '`````');
  assert.equal(wrapper.length, 2, 'the wrapper is five backticks, one more than the longest run of four');
  assert.equal(lines.indexOf('`````'), lines.indexOf('a') - 1);
  assert.equal(lines.lastIndexOf('`````'), lines.length - 2);
});

test('the fence is three backticks when the output has none', () => {
  const r = summarize('plain\n');
  assert.match(r.summary, /\n```\nplain\n```\n$/);
  assert.doesNotMatch(r.summary, /were cut/);
});

test('a list longer than the 200 lines shown says how many lines were cut', () => {
  const r = summarize(Array.from({ length: 230 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  assert.match(r.summary, /Only the first 200 of 230 lines are shown; 30 lines were cut\./);
  assert.ok(r.summary.includes('line 200\n') && !r.summary.includes('line 201\n'));
});

test('symlinks and other non-regular entries are removed before the non-yml files', () => {
  const fetch = steps.find((s) => s.name?.startsWith('Fetch the vendored rules')).run;
  const links = fetch.indexOf('find "$rules" ! -type f ! -type d -delete');
  const others = fetch.indexOf("find \"$rules\" -type f ! -name '*.yml' -delete");
  assert.ok(links >= 0, 'the symlink-removing find exists');
  assert.ok(others > links, 'it precedes the non-yml deletion');
  assert.ok(fetch.indexOf("-name '*.yml' -print -quit") > others, 'the non-empty check stays last');
});

test('a last line without a trailing newline is counted, so the cut count is exact', () => {
  const r = summarize(Array.from({ length: 201 }, (_, i) => `line ${i + 1}`).join('\n'));
  assert.match(r.summary, /Only the first 200 of 201 lines are shown; 1 lines were cut\./);
  assert.ok(r.summary.includes('line 200\n') && !r.summary.includes('line 201\n'));
});

// Output that came from the scanned tree is data. A lone carriage return could start a new log line on the
// runner, so none reaches the log or the summary, and the closing fence of the summary is a line of its own.
test('a carriage return in the output cannot start a workflow command in the log or the summary', () => {
  const show = scan.match(/show\(\) \{[^\n]*\}/)?.[0] ?? 'exit 99';
  const dir = mkdtempSync(join(tmpdir(), 'semgrep-show-'));
  writeFileSync(join(dir, 'out'), 'finding\r::error::injected\nnext\r\nlast');
  const shown = spawnSync('bash', ['-c', `${show}\nshow "$OUT"`], { env: { PATH: process.env.PATH, OUT: join(dir, 'out') }, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(shown.status, 0);
  assert.doesNotMatch(shown.stdout, /\r/, 'the log carries no carriage return');
  assert.ok(shown.stdout.split('\n').filter(Boolean).every((line) => line.startsWith('  | ')), shown.stdout);
  const r = summarize('finding\r::error::injected\n');
  assert.doesNotMatch(r.summary, /\r/, 'the summary carries no carriage return');
});

test('the closing fence of the summary is a line of its own when the output has no trailing newline', () => {
  const r = summarize('a\nb\nc');
  const lines = r.summary.split('\n');
  const close = lines.lastIndexOf('```');
  assert.ok(close > lines.indexOf('c'), r.summary);
  assert.equal(lines[close - 1], 'c', 'the last output line is followed by a newline, then the fence');
});
