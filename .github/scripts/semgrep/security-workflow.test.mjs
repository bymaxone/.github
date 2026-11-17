// Guards the semgrep job of security.yml. Layer: CI tooling.
//
// The job hands the caller's tree to a third-party image, so its shape is the safety property: no
// secret, read-only scope, a read-only mount, an image pinned by digest, and caller-supplied rule
// names validated before they reach the command line. The workflow is parsed by Ruby's Psych, as the
// release-family checks do, so these tests need `ruby`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// The step runs as `bash -e {0}`, the Actions default when a step names no shell, so a non-zero exit of the
// scan must not stop it before the verdict is read. The step body is executed under `bash -e` with a docker
// that exits with a chosen status, once per status and mode.
const CLEAN_REPORT = JSON.stringify({ errors: [], paths: { skipped: [] } });
function runScan(exitCode, mode, report = CLEAN_REPORT) {
  const dir = mkdtempSync(join(tmpdir(), 'semgrep-scan-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'tmp'));
  mkdirSync(join(dir, 'ws'));
  mkdirSync(join(dir, 'rules'));
  // The stub finds the directory mounted at /out and leaves the report there, as the image does.
  writeFileSync(join(dir, 'bin', 'docker'), `#!/bin/sh\nout=""\nfor a in "$@"; do case "$a" in *:/out) out="\${a%:/out}";; esac; done\n[ -z "$out" ] || [ -z "$STUB_REPORT" ] || printf '%s' "$STUB_REPORT" > "$out/semgrep.json"\necho "scan output"\necho "scan error" >&2\nexit ${exitCode}\n`);
  chmodSync(join(dir, 'bin', 'docker'), 0o755);
  writeFileSync(join(dir, 'tmp', 'semgrep-config.txt'), '');
  const result = spawnSync('bash', ['-e', '-c', scan], {
    env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      RUNNER_TEMP: join(dir, 'tmp'),
      GITHUB_WORKSPACE: join(dir, 'ws'),
      SEMGREP_RULES: join(dir, 'rules'),
      SEMGREP_IMAGE: 'semgrep/semgrep:test',
      SEMGREP_MODE: mode,
      GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      STUB_REPORT: report,
    },
    encoding: 'utf8',
  });
  const summary = existsSync(join(dir, 'summary')) ? readFileSync(join(dir, 'summary'), 'utf8') : '';
  rmSync(dir, { recursive: true, force: true });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, summary };
}

test('under bash -e a clean scan passes, findings are a warning or an error, an unavailable scan is its own annotation', () => {
  const clean = runScan(0, 'enforce');
  assert.equal(clean.status, 0, clean.out);
  assert.match(clean.summary, /no findings/);

  const warnFindings = runScan(1, 'warn');
  assert.equal(warnFindings.status, 0, warnFindings.out);
  assert.match(warnFindings.out, /::warning title=semgrep::/);

  const enforceFindings = runScan(1, 'enforce');
  assert.equal(enforceFindings.status, 1, enforceFindings.out);
  assert.match(enforceFindings.out, /::error title=semgrep::Semgrep reported findings/);

  const warnDown = runScan(7, 'warn');
  assert.equal(warnDown.status, 0, warnDown.out);
  assert.match(warnDown.out, /::warning title=semgrep unavailable::/);
  assert.match(warnDown.summary, /NOT SCANNED/);

  const enforceDown = runScan(7, 'enforce');
  assert.equal(enforceDown.status, 1, enforceDown.out);
  assert.match(enforceDown.out, /::error title=semgrep unavailable::/);
  assert.match(enforceDown.summary, /NOT SCANNED/);
});

// The whole table of exit statuses of the scan under bash -e: 0 is clean, 1 is findings, every other status (a
// fatal error, a registry outage, a failure of docker itself) is NOT SCANNED, in both modes.
test('every exit status of the scan has one verdict in each mode, under bash -e', () => {
  const verdicts = { 0: 'clean', 1: 'findings', 2: 'unavailable', 3: 'unavailable', 4: 'unavailable', 7: 'unavailable', 125: 'unavailable', 126: 'unavailable', 127: 'unavailable' };
  for (const [code, verdict] of Object.entries(verdicts)) {
    for (const mode of ['warn', 'enforce']) {
      const r = runScan(Number(code), mode);
      const expectStatus = verdict === 'clean' || mode === 'warn' ? 0 : 1;
      assert.equal(r.status, expectStatus, `exit ${code} in ${mode}: ${r.out}`);
      if (verdict === 'unavailable') {
        assert.match(r.out, new RegExp(`::(warning|error) title=semgrep unavailable::`), `exit ${code} in ${mode}`);
        assert.match(r.summary, /NOT SCANNED/, `exit ${code} in ${mode}`);
      } else if (verdict === 'findings') {
        assert.match(r.out, new RegExp(`::(warning|error) title=semgrep::`), `exit ${code} in ${mode}`);
        assert.doesNotMatch(r.summary, /NOT SCANNED/);
      } else {
        assert.doesNotMatch(r.out, /::(warning|error)/, `exit ${code} in ${mode}`);
      }
    }
  }
});

// What the report adds to the exit status: a rule that failed to load or parse is a RULE ERROR (red in enforce mode, never
// silent), a file the scan skipped or could not parse is PARTIAL (a warning and a summary, never red by itself), and a scan with
// no readable report did not complete.
const PARTIAL_REPORT = JSON.stringify({
  errors: [{ type: ['PartialParsing', []], level: 'warn', path: 'src/broken.ts' }],
  paths: { skipped: [{ path: 'src/big.js', reason: 'exceeded_size_limit' }, { path: 'node_modules/x.js', reason: 'excluded_by_ignore' }] },
});
const RULE_ERROR_REPORT = JSON.stringify({ errors: [{ type: 'Rule parse error', level: 'error', path: '/rules/broken.yml' }], paths: { skipped: [] } });
const BOTH_REPORT = JSON.stringify({
  errors: [{ type: 'InvalidRuleSchemaError', level: 'error' }, { type: 'Timeout', level: 'warn', path: 'src/slow.ts' }],
  paths: { skipped: [] },
});

test('a partial scan says PARTIAL with the list and a warning, and is not red by itself', () => {
  for (const mode of ['warn', 'enforce']) {
    const r = runScan(0, mode, PARTIAL_REPORT);
    assert.equal(r.status, 0, `${mode}: ${r.out}`);
    assert.match(r.out, /::warning title=semgrep partial::2 files or rules not scanned/, mode);
    assert.match(r.summary, /PARTIAL: 2 files or rules not scanned\./, mode);
    assert.match(r.summary, /src\/broken\.ts: PartialParsing/, 'the list names the file');
    assert.match(r.summary, /src\/big\.js: exceeded_size_limit/, 'the list names a skipped file');
    assert.doesNotMatch(r.summary, /excluded_by_ignore/, 'a file the ignore rules leave out is not a failure to scan');
    assert.match(r.summary, /No findings in what was scanned: 2 files or rules were not\./, 'a partial scan never reads as the whole tree');
    assert.doesNotMatch(r.summary, /Scanned the whole tree/);
  }
});

test('a rule that failed to load is a RULE ERROR: a warning in warn mode, red in enforce mode, with or without findings', () => {
  const warn = runScan(0, 'warn', RULE_ERROR_REPORT);
  assert.equal(warn.status, 0, warn.out);
  assert.match(warn.out, /::warning title=semgrep rule error::1 rule\(s\) failed to load or parse/);
  assert.match(warn.summary, /RULE ERROR: 1 rule\(s\) failed to load or parse/);
  assert.match(warn.summary, /\/rules\/broken\.yml: Rule parse error/);

  const enforce = runScan(0, 'enforce', RULE_ERROR_REPORT);
  assert.equal(enforce.status, 1, enforce.out);
  assert.match(enforce.out, /::error title=semgrep rule error::1 rule\(s\) failed to load or parse/);
  assert.doesNotMatch(enforce.summary, /Scanned the whole tree/);
  assert.match(enforce.summary, /No findings from the rules that ran: 1 rule\(s\) did not run\./, 'a scan that skipped a rule never reads as clean');

  const findingsWarn = runScan(1, 'warn', RULE_ERROR_REPORT);
  assert.equal(findingsWarn.status, 0, findingsWarn.out);
  assert.match(findingsWarn.out, /semgrep rule error/);
  assert.match(findingsWarn.out, /::warning title=semgrep::/);
  const findingsEnforce = runScan(1, 'enforce', RULE_ERROR_REPORT);
  assert.equal(findingsEnforce.status, 1, findingsEnforce.out);
  assert.match(findingsEnforce.out, /semgrep rule error/);
});

test('findings with a partial scan keep the findings verdict and add the PARTIAL note', () => {
  const warn = runScan(1, 'warn', PARTIAL_REPORT);
  assert.equal(warn.status, 0, warn.out);
  assert.match(warn.out, /semgrep partial/);
  assert.match(warn.out, /::warning title=semgrep::/);
  const enforce = runScan(1, 'enforce', PARTIAL_REPORT);
  assert.equal(enforce.status, 1, enforce.out);
  assert.match(enforce.summary, /PARTIAL: 2 files/);
});

test('a rule error and a partial scan together are both reported, and only the rule error turns enforce mode red', () => {
  const r = runScan(0, 'enforce', BOTH_REPORT);
  assert.equal(r.status, 1, r.out);
  assert.match(r.summary, /RULE ERROR: 1 rule/);
  assert.match(r.summary, /PARTIAL: 1 files/);
  assert.match(r.summary, /src\/slow\.ts: Timeout/);
});

test('a finished scan with no readable report is NOT SCANNED, not clean', () => {
  for (const report of ['', 'not json', '{"errors": ']) {
    const warn = runScan(0, 'warn', report);
    assert.equal(warn.status, 0, warn.out);
    assert.match(warn.out, /::warning title=semgrep unavailable::/);
    assert.match(warn.summary, /NOT SCANNED: semgrep finished but left no readable report/);
    const enforce = runScan(1, 'enforce', report);
    assert.equal(enforce.status, 1, enforce.out);
    assert.match(enforce.out, /::error title=semgrep unavailable::/);
  }
});

// Where an error points decides what it is: no path, or a path under /rules, is a problem of the rules (fail closed, red in enforce
// mode whatever name Semgrep gives it); a path in the scanned tree is a problem of the target (PARTIAL, never red by itself).
const UNNAMED_RULE_ERROR_REPORT = JSON.stringify({ errors: [{ type: 'Pattern parse error', level: 'error', path: null }, { type: ['Unknown language', []], level: 'error' }], paths: { skipped: [] } });
const TARGET_ERROR_REPORT = JSON.stringify({ errors: [{ type: 'Syntax error', level: 'error', path: 'src/a.ts' }, { type: ['Rule parse error looking name', []], level: 'warn', path: 'src/b.ts' }], paths: { skipped: [] } });

test('an error with no path is a rule error whatever its name, and an error in the scanned tree is partial whatever its level', () => {
  const unnamed = runScan(0, 'enforce', UNNAMED_RULE_ERROR_REPORT);
  assert.equal(unnamed.status, 1, unnamed.out);
  assert.match(unnamed.summary, /RULE ERROR: 2 rule\(s\) failed to load or parse/);
  assert.match(unnamed.summary, /Pattern parse error/);
  assert.match(unnamed.summary, /No findings from the rules that ran/);
  const target = runScan(0, 'enforce', TARGET_ERROR_REPORT);
  assert.equal(target.status, 0, target.out);
  assert.match(target.summary, /PARTIAL: 2 files or rules not scanned/);
  assert.doesNotMatch(target.summary, /RULE ERROR/);
});
