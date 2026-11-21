// Guards container-scan.yml. Layer: CI tooling.
//
// The workflow hands a caller's Dockerfile to a build and to two third-party images, so its shape is
// the safety property: pinned images, read-only mounts, no socket, no push, no secret, inputs that
// reach the shell only through the environment, and gates that cannot report a scan that never ran
// as clean. The workflow is parsed by Ruby's Psych, as the other workflow guards do, so these tests
// need `ruby` and `jq`. The shell steps are executed here against a fake `docker`.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const path = new URL('../../workflows/container-scan.yml', import.meta.url);
const text = readFileSync(path, 'utf8');
const RUBY = "require 'yaml'; require 'json'; puts JSON.generate(YAML.safe_load($stdin.read, aliases: true))";
const doc = JSON.parse(execFileSync('ruby', ['-e', RUBY], { input: text, encoding: 'utf8' }));
const on = doc.on ?? doc.true;
const inputs = on.workflow_call.inputs;
const jobs = doc.jobs;
const stepsOf = (job) => jobs[job]?.steps ?? [];
const step = (job, name) => stepsOf(job).find((s) => s.name === name);
const script = (job, name) => step(job, name)?.run ?? '';

test('the workflow is callable and has exactly the two jobs', () => {
  assert.deepEqual(Object.keys(jobs), ['hadolint', 'image']);
  assert.ok(on.workflow_call);
});

test('the inputs and their defaults', () => {
  assert.deepEqual(Object.keys(inputs).sort(), [
    'context',
    'dockerfile',
    'hadolint-failure-threshold',
    'hadolint-ignore',
    'sbom-artifact-name',
    'trivyignore',
  ]);
  assert.equal(inputs.dockerfile.default, 'Dockerfile');
  assert.equal(inputs.context.default, '.');
  assert.equal(inputs.trivyignore.default, '');
  assert.equal(inputs['hadolint-ignore'].default, '');
  assert.equal(inputs['hadolint-failure-threshold'].default, 'warning');
  assert.equal(inputs['sbom-artifact-name'].default, 'container-sbom');
  for (const input of Object.values(inputs)) assert.equal(input.type, 'string');
  // Nothing is required, so a caller adds the line and nothing else.
  for (const input of Object.values(inputs)) assert.ok(input.required !== true);
});

test('the file reads contents only, and every job has a timeout', () => {
  assert.deepEqual(doc.permissions, { contents: 'read' });
  for (const [name, job] of Object.entries(jobs)) {
    assert.ok(job.permissions === undefined || JSON.stringify(job.permissions) === '{"contents":"read"}', name);
    assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] <= 30, name);
  }
});

test('each job starts with harden-runner in audit mode and keeps no credential', () => {
  for (const name of Object.keys(jobs)) {
    const steps = stepsOf(name);
    assert.match(steps[0].uses, /^step-security\/harden-runner@[0-9a-f]{40}$/, name);
    assert.equal(steps[0].with['egress-policy'], 'audit', name);
    const checkout = steps.find((s) => String(s.uses).startsWith('actions/checkout@'));
    assert.equal(checkout.with['persist-credentials'], false, name);
  }
});

test('no job references a secret, a socket, a push or a privileged container', () => {
  const all = JSON.stringify(doc);
  assert.doesNotMatch(all, /secrets\./);
  assert.doesNotMatch(all, /docker\.sock/);
  assert.doesNotMatch(all, /docker push|--push|--privileged|--network[ =]host/);
});

test('the tool images carry a digest', () => {
  const hadolint = step('hadolint', 'Hadolint').env.HADOLINT_IMAGE;
  const trivy = step('image', 'Trivy scan').env.TRIVY_IMAGE;
  assert.match(hadolint, /^ghcr\.io\/hadolint\/hadolint:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.match(trivy, /^ghcr\.io\/aquasecurity\/trivy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.equal(step('image', 'SBOM').env.TRIVY_IMAGE, trivy);
});

test('inputs reach the shell only through the environment', () => {
  for (const name of Object.keys(jobs)) {
    for (const s of stepsOf(name)) assert.doesNotMatch(s.run ?? '', /\$\{\{\s*inputs\./, `${name}:${s.name}`);
  }
  assert.equal(step('hadolint', 'Check the inputs').env.DOCKERFILE, '${{ inputs.dockerfile }}');
  assert.equal(step('hadolint', 'Check the inputs').env.HADOLINT_IGNORE, '${{ inputs.hadolint-ignore }}');
  assert.equal(step('hadolint', 'Check the inputs').env.HADOLINT_THRESHOLD, '${{ inputs.hadolint-failure-threshold }}');
  assert.equal(step('image', 'Check the inputs').env.DOCKERFILE, '${{ inputs.dockerfile }}');
  assert.equal(step('image', 'Check the inputs').env.CONTEXT, '${{ inputs.context }}');
  assert.equal(step('image', 'Check the inputs').env.TRIVYIGNORE, '${{ inputs.trivyignore }}');
  assert.equal(step('image', 'Check the inputs').env.SBOM_NAME, '${{ inputs.sbom-artifact-name }}');
});

test('the image is built and never pushed, then scanned from a read-only archive', () => {
  const build = script('image', 'Build the image');
  assert.match(build, /docker build /);
  assert.match(build, /--file "\$DOCKERFILE"/);
  assert.match(build, /"\$CONTEXT"/);
  const save = script('image', 'Save the image');
  assert.match(save, /docker save/);
  const scan = script('image', 'Trivy scan');
  assert.match(scan, /--volume "\$\{?RUNNER_TEMP\}?\/image\.tar:\/image\.tar:ro"/);
  assert.match(scan, /--input \/image\.tar/);
  assert.match(scan, /--severity HIGH,CRITICAL/);
  assert.match(scan, /--ignore-unfixed/);
  assert.match(scan, /--scanners vuln/);
  assert.match(scan, /--format json/);
  assert.match(scan, /--user "\$\(id -u\):\$\(id -g\)"/);
});

test('the SBOM is CycloneDX and is uploaded whatever the scan said', () => {
  const sbom = script('image', 'SBOM');
  assert.match(sbom, /--format cyclonedx/);
  assert.match(sbom, /sbom\.cdx\.json/);
  const upload = step('image', 'Upload the SBOM');
  assert.match(upload.uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);
  assert.equal(upload.with.name, '${{ inputs.sbom-artifact-name }}');
  assert.match(upload.with.path, /sbom\.cdx\.json$/);
  assert.match(upload.if, /!cancelled\(\)/);
});

test('every gate runs after an earlier gate failed, and none runs on an image that did not build', () => {
  const build = step('image', 'Build the image');
  assert.equal(build.id, 'build');
  for (const name of ['Upload the SBOM', 'Check the image configuration', 'Fail on findings']) {
    const condition = step('image', name).if;
    assert.match(condition, /!cancelled\(\)/, name);
    assert.match(condition, /steps\.build\.outcome == 'success'/, name);
  }
  const order = stepsOf('image').map((s) => s.name);
  assert.ok(order.indexOf('Trivy scan') < order.indexOf('SBOM'));
  assert.ok(order.indexOf('Upload the SBOM') < order.indexOf('Check the image configuration'));
  assert.equal(order.at(-1), 'Fail on findings');
});

// ---- the shell steps, executed -------------------------------------------------------------

function workspace(files = {}, links = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'container-scan-'));
  mkdirSync(join(dir, 'ws'), { recursive: true });
  mkdirSync(join(dir, 'tmp'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const file = join(dir, 'ws', name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, body);
  }
  for (const [name, target] of Object.entries(links)) symlinkSync(target, join(dir, 'ws', name));
  return dir;
}

function runStep(job, name, env, dir, { fakeDocker = '', stdin = '' } = {}) {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'docker'), `#!/bin/bash\n${fakeDocker}\n`);
  chmodSync(join(bin, 'docker'), 0o755);
  return spawnSync('bash', ['-c', script(job, name)], {
    cwd: join(dir, 'ws'),
    env: { PATH: `${bin}:${process.env.PATH}`, RUNNER_TEMP: join(dir, 'tmp'), GITHUB_WORKSPACE: join(dir, 'ws'), ...env },
    input: stdin,
    encoding: 'utf8',
  });
}

const okEnv = { DOCKERFILE: 'Dockerfile', HADOLINT_IGNORE: '', HADOLINT_THRESHOLD: 'warning' };

test('the dockerfile input is a regular file inside the checkout', () => {
  const dir = workspace({ Dockerfile: 'FROM scratch\n', 'sub/app.Dockerfile': 'FROM scratch\n' }, { linked: '/etc/hostname' });
  try {
    for (const [value, status] of [
      ['Dockerfile', 0],
      ['sub/app.Dockerfile', 0],
      ['../Dockerfile', 1],
      ['/etc/passwd', 1],
      ['linked', 1],
      ['missing', 1],
      ['sub', 1],
      ['Docker file', 1],
      ['Dockerfile;id', 1],
      ['$(id)', 1],
    ]) {
      const r = runStep('hadolint', 'Check the inputs', { ...okEnv, DOCKERFILE: value }, dir);
      assert.equal(r.status, status, `${value}: ${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hadolint rule ids and the threshold are checked, and reach the command as array elements', () => {
  const dir = workspace({ Dockerfile: 'FROM scratch\n' });
  try {
    for (const [ignore, status] of [
      ['', 0],
      ['DL3008 SC2086', 0],
      ['DL3008\nDL3009', 0],
      ['dl3008', 1],
      ['DL3008;id', 1],
      ['DL30', 1],
      ['$(id)', 1],
    ]) {
      const r = runStep('hadolint', 'Check the inputs', { ...okEnv, HADOLINT_IGNORE: ignore }, dir);
      assert.equal(r.status, status, `${JSON.stringify(ignore)}: ${r.stdout}${r.stderr}`);
    }
    for (const [threshold, status] of [['error', 0], ['warning', 0], ['info', 0], ['style', 0], ['none', 1], ['', 1], ['warning;id', 1]]) {
      const r = runStep('hadolint', 'Check the inputs', { ...okEnv, HADOLINT_THRESHOLD: threshold }, dir);
      assert.equal(r.status, status, `${JSON.stringify(threshold)}`);
    }
    const accepted = runStep('hadolint', 'Check the inputs', { ...okEnv, HADOLINT_IGNORE: 'DL3008 SC2086' }, dir);
    assert.equal(accepted.status, 0);
    assert.equal(readFileSync(join(dir, 'tmp', 'hadolint-ignore.txt'), 'utf8'), '--ignore\nDL3008\n--ignore\nSC2086\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hadolint reads the Dockerfile from stdin, with no mount, and passes the ignores and the threshold', () => {
  const dir = workspace({ Dockerfile: 'FROM scratch\nUSER 1000\n' });
  try {
    writeFileSync(join(dir, 'tmp', 'hadolint-ignore.txt'), '--ignore\nDL3008\n');
    const log = join(dir, 'docker.log');
    const r = runStep(
      'hadolint',
      'Hadolint',
      { ...okEnv, HADOLINT_IMAGE: 'img@sha256:abc', HADOLINT_THRESHOLD: 'error' },
      dir,
      { fakeDocker: `printf '%s\\n' "$@" > "${log}"; cat > "${log}.stdin"` },
    );
    assert.equal(r.status, 0, r.stderr);
    const args = readFileSync(log, 'utf8').split('\n');
    assert.deepEqual(args.slice(0, 3), ['run', '--rm', '--interactive']);
    assert.ok(args.includes('img@sha256:abc'));
    assert.ok(args.join(' ').includes('--failure-threshold error'));
    assert.ok(args.join(' ').includes('--ignore DL3008'));
    assert.ok(!args.some((a) => a.includes('--volume')));
    assert.equal(readFileSync(`${log}.stdin`, 'utf8'), 'FROM scratch\nUSER 1000\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const imageEnv = { DOCKERFILE: 'Dockerfile', CONTEXT: '.', TRIVYIGNORE: '', SBOM_NAME: 'container-sbom' };

test('the build context, the trivy ignore file and the artifact name are checked', () => {
  const dir = workspace({ Dockerfile: 'FROM scratch\n', '.trivyignore': 'CVE-2024-0001\n', 'sub/x.txt': '' }, { linked: '/etc/hostname' });
  try {
    const check = (patch) => runStep('image', 'Check the inputs', { ...imageEnv, ...patch }, dir);
    for (const [patch, status] of [
      [{}, 0],
      [{ CONTEXT: 'sub' }, 0],
      [{ CONTEXT: './sub' }, 0],
      [{ CONTEXT: '..' }, 1],
      [{ CONTEXT: '/' }, 1],
      [{ CONTEXT: 'Dockerfile' }, 1],
      [{ CONTEXT: 'a b' }, 1],
      [{ TRIVYIGNORE: '.trivyignore' }, 0],
      [{ TRIVYIGNORE: 'nope' }, 1],
      [{ TRIVYIGNORE: 'linked' }, 1],
      [{ TRIVYIGNORE: '../x' }, 1],
      [{ TRIVYIGNORE: 'sub' }, 1],
      [{ SBOM_NAME: 'my-sbom_1.0' }, 0],
      [{ SBOM_NAME: '' }, 1],
      [{ SBOM_NAME: 'a b' }, 1],
      [{ SBOM_NAME: 'a/b' }, 1],
      [{ SBOM_NAME: '$(id)' }, 1],
    ]) {
      const r = check(patch);
      assert.equal(r.status, status, `${JSON.stringify(patch)}: ${r.stdout}${r.stderr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A fake docker that answers `image inspect` with a given config.
const inspecting = (config) => `if [ "$1 $2" = "image inspect" ]; then printf '%s' '${JSON.stringify(config)}'; exit 0; fi; exit 9`;

test('the image runs as a non-root user and declares a healthcheck', () => {
  const dir = workspace();
  const healthy = { Test: ['CMD', 'true'], Interval: 1 };
  try {
    for (const [config, status, why] of [
      [{ User: '1000', Healthcheck: healthy }, 0, 'a numeric user'],
      [{ User: 'node', Healthcheck: healthy }, 0, 'a named user'],
      [{ User: '10001:10001', Healthcheck: healthy }, 0, 'uid and gid'],
      [{ User: 'app:app', Healthcheck: healthy }, 0, 'name and group'],
      [{ Healthcheck: healthy }, 1, 'no user'],
      [{ User: '', Healthcheck: healthy }, 1, 'an empty user'],
      [{ User: '0', Healthcheck: healthy }, 1, 'user 0'],
      [{ User: '0:0', Healthcheck: healthy }, 1, 'user 0:0'],
      [{ User: '0:1000', Healthcheck: healthy }, 1, 'user 0 with a group'],
      [{ User: 'root', Healthcheck: healthy }, 1, 'user root'],
      [{ User: 'root:root', Healthcheck: healthy }, 1, 'user root:root'],
      [{ User: '1000' }, 1, 'no healthcheck'],
      [{ User: '1000', Healthcheck: null }, 1, 'a null healthcheck'],
      [{ User: '1000', Healthcheck: { Test: ['NONE'] } }, 1, 'HEALTHCHECK NONE'],
      [{ User: '1000', Healthcheck: {} }, 1, 'an empty healthcheck'],
    ]) {
      const r = runStep('image', 'Check the image configuration', { IMAGE_TAG: 'container-scan:candidate' }, dir, {
        fakeDocker: inspecting(config),
      });
      assert.equal(r.status, status, `${why}: ${r.stdout}${r.stderr}`);
    }
    const both = runStep('image', 'Check the image configuration', { IMAGE_TAG: 'x' }, dir, { fakeDocker: inspecting({ User: '0' }) });
    assert.match(both.stdout, /::error title=container-scan::.*non-root/);
    assert.match(both.stdout, /::error title=container-scan::.*HEALTHCHECK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const finding = (id, severity, fixed = '1.2.4') => ({
  VulnerabilityID: id,
  PkgName: 'openssl',
  InstalledVersion: '1.2.3',
  FixedVersion: fixed,
  Severity: severity,
});

function gate(report) {
  const dir = workspace();
  try {
    mkdirSync(join(dir, 'tmp', 'trivy-out'), { recursive: true });
    if (report !== undefined) writeFileSync(join(dir, 'tmp', 'trivy-out', 'trivy.json'), report);
    return runStep('image', 'Fail on findings', {}, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a fixable HIGH or CRITICAL finding fails the gate and an empty report passes', () => {
  const clean = gate(JSON.stringify({ Results: [{ Target: 'os', Vulnerabilities: [] }] }));
  assert.equal(clean.status, 0, clean.stdout);
  assert.equal(gate(JSON.stringify({ Results: [] })).status, 0);
  assert.equal(gate(JSON.stringify({})).status, 0);
  const failing = gate(JSON.stringify({ Results: [{ Target: 'os', Vulnerabilities: [finding('CVE-2024-1', 'HIGH'), finding('CVE-2024-2', 'CRITICAL')] }] }));
  assert.equal(failing.status, 1);
  assert.match(failing.stdout, /::error title=container-scan::HIGH CVE-2024-1 openssl 1\.2\.3 fixed in 1\.2\.4/);
  assert.match(failing.stdout, /::error title=container-scan::CRITICAL CVE-2024-2/);
});

test('a report that is missing, empty or not JSON is NOT SCANNED, never a pass', () => {
  for (const report of [undefined, '', 'not json', '{"Results":']) {
    const r = gate(report);
    assert.equal(r.status, 1, JSON.stringify(report));
    assert.match(r.stdout, /::error title=container-scan::NOT SCANNED/);
  }
});

test('a newline in a package name cannot start another workflow command', () => {
  const evil = { ...finding('CVE-2024-3', 'HIGH'), PkgName: 'a\n::error title=x::forged' };
  const r = gate(JSON.stringify({ Results: [{ Target: 'os', Vulnerabilities: [evil] }] }));
  assert.equal(r.status, 1);
  assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('::error title=x')).length, 0);
});

test('the scan step never fails on findings itself and mounts the ignore file read-only', () => {
  const dir = workspace({ '.trivyignore': 'CVE-2024-1\n' });
  try {
    const log = join(dir, 'docker.log');
    const r = runStep(
      'image',
      'Trivy scan',
      { TRIVY_IMAGE: 'trivy@sha256:abc', TRIVYIGNORE: '.trivyignore' },
      dir,
      { fakeDocker: `printf '%s\\n' "$@" > "${log}"` },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const args = readFileSync(log, 'utf8');
    assert.match(args, /--exit-code\n0/);
    assert.match(args, new RegExp(`${join(dir, 'ws', '.trivyignore').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:/ignore/.trivyignore:ro`));
    assert.match(args, /--ignorefile\n\/ignore\/\.trivyignore/);
    assert.ok(existsSync(join(dir, 'tmp', 'trivy-out')));
    const without = runStep('image', 'Trivy scan', { TRIVY_IMAGE: 'x', TRIVYIGNORE: '' }, dir, { fakeDocker: `printf '%s\\n' "$@" > "${log}"` });
    assert.equal(without.status, 0);
    assert.doesNotMatch(readFileSync(log, 'utf8'), /--ignorefile/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
