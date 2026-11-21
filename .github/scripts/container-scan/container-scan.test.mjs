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
    'expected-uid',
    'hadolint-failure-threshold',
    'hadolint-ignore',
    'sbom-artifact-name',
    'trivyignore',
  ]);
  assert.equal(inputs.dockerfile.default, 'Dockerfile');
  assert.equal(inputs.context.default, '.');
  assert.equal(inputs.trivyignore.default, '');
  assert.equal(inputs['expected-uid'].default, '');
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
  const trivy = step('image', 'Trivy gate').env.TRIVY_IMAGE;
  assert.match(hadolint, /^ghcr\.io\/hadolint\/hadolint:v\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.match(trivy, /^ghcr\.io\/aquasecurity\/trivy:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/);
  assert.equal(step('image', 'SBOM').env.TRIVY_IMAGE, trivy);
  assert.equal(step('image', 'Trivy report').env.TRIVY_IMAGE, trivy);
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
  assert.equal(step('image', 'Check the inputs').env.EXPECTED_UID, '${{ inputs.expected-uid }}');
  assert.equal(step('image', 'Check the image configuration').env.EXPECTED_UID, '${{ inputs.expected-uid }}');
  assert.equal(step('image', 'Check the inputs').env.SBOM_NAME, '${{ inputs.sbom-artifact-name }}');
});

test('the image is built and never pushed, then scanned from a read-only archive', () => {
  const build = script('image', 'Build the image');
  assert.match(build, /docker build /);
  assert.match(build, /--file "\$DOCKERFILE"/);
  assert.match(build, /"\$CONTEXT"/);
  assert.match(script('image', 'Save the image'), /docker save/);
  const scan = script('image', 'Trivy gate');
  assert.match(scan, /--volume "\$RUNNER_TEMP\/image\.tar:\/image\.tar:ro"/);
  assert.match(scan, /--input \/image\.tar/);
  assert.match(scan, /--severity HIGH,CRITICAL/);
  assert.match(scan, /--ignore-unfixed/);
  assert.match(scan, /--scanners vuln/);
  assert.match(scan, /--exit-code 1/);
  assert.match(scan, /--user "\$\(id -u\):\$\(id -g\)"/);
});

test('no gate reads a report: Trivy decides on its exit status', () => {
  const gate = script('image', 'Trivy gate');
  assert.doesNotMatch(gate, /jq|trivy\.json|--format json|--exit-code 0/);
  // The only step that writes the JSON report decides nothing.
  const report = script('image', 'Trivy report');
  assert.match(report, /--format json/);
  assert.match(report, /--exit-code 0/);
  for (const s of stepsOf('image')) {
    if (s.name !== 'Trivy report' && s.name !== 'Upload the SBOM') assert.doesNotMatch(JSON.stringify(s.run ?? ''), /trivy\.json/, s.name);
  }
});

test('the SBOM is CycloneDX and is uploaded whatever the scan said', () => {
  const sbom = script('image', 'SBOM');
  assert.match(sbom, /--format cyclonedx/);
  assert.match(sbom, /sbom\.cdx\.json/);
  const upload = step('image', 'Upload the SBOM');
  assert.match(upload.uses, /^actions\/upload-artifact@[0-9a-f]{40}$/);
  assert.equal(upload.with.name, '${{ inputs.sbom-artifact-name }}');
  assert.match(upload.with.path, /sbom\.cdx\.json/);
  assert.match(upload.with.path, /trivy\.json/);
  assert.match(upload.if, /!cancelled\(\)/);
});

test('the artifacts and the configuration check run after the gate failed, and none runs on an image that did not build', () => {
  const build = step('image', 'Build the image');
  assert.equal(build.id, 'build');
  assert.equal(step('image', 'Trivy gate').id, 'scan');
  // The gate has no condition of its own: a failure there fails the job, and the steps below still run.
  assert.equal(step('image', 'Trivy gate').if, undefined);
  for (const name of ['Trivy report', 'SBOM', 'Upload the SBOM', 'Check the image configuration']) {
    const condition = step('image', name).if;
    assert.match(condition, /!cancelled\(\)/, name);
    assert.match(condition, /steps\.build\.outcome == 'success'/, name);
  }
  const order = stepsOf('image').map((s) => s.name);
  assert.ok(order.indexOf('Trivy gate') < order.indexOf('Trivy report'));
  assert.ok(order.indexOf('Upload the SBOM') < order.indexOf('Check the image configuration'));
  assert.equal(order.at(-1), 'Check the image configuration');
  assert.ok(!order.includes('Fail on findings'));
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

const imageEnv = { DOCKERFILE: 'Dockerfile', CONTEXT: '.', TRIVYIGNORE: '', EXPECTED_UID: '', SBOM_NAME: 'container-sbom' };

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
      [{ EXPECTED_UID: '10001' }, 0],
      [{ EXPECTED_UID: '1' }, 0],
      [{ EXPECTED_UID: '4294967294' }, 0],
      [{ EXPECTED_UID: '0' }, 1],
      [{ EXPECTED_UID: '00' }, 1],
      [{ EXPECTED_UID: '010' }, 1],
      [{ EXPECTED_UID: '+1000' }, 1],
      [{ EXPECTED_UID: '-1' }, 1],
      [{ EXPECTED_UID: 'abc' }, 1],
      [{ EXPECTED_UID: '1 2' }, 1],
      [{ EXPECTED_UID: '10001;id' }, 1],
      [{ EXPECTED_UID: '12345678901' }, 1],
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

// The fake docker for the configuration step. `run` answers like `id -u` in the image: it prints
// `id` and exits with `idStatus`. `image inspect` answers the configured user or the healthcheck.
function fake({ id = '1000', idStatus = 0, user = '', healthcheck = 'null' }) {
  return `
case "$1" in
  run) printf '%s\\n' "$@" > "$RECORD"; printf '%s' '${id}'; exit ${idStatus} ;;
  image) case "$*" in
    *'.Config.User'*) printf '%s' '${user}'; exit 0 ;;
    *'json .Config.Healthcheck'*) printf '%s' '${healthcheck}'; exit 0 ;;
  esac ;;
esac
exit 9`;
}

const healthy = JSON.stringify({ Test: ['CMD', 'true'], Interval: 1 });
function configure(patch, expected = '') {
  const dir = workspace();
  try {
    const r = runStep('image', 'Check the image configuration', { IMAGE_TAG: 'container-scan:candidate', EXPECTED_UID: expected, RECORD: join(dir, 'run.log') }, dir, {
      fakeDocker: fake({ healthcheck: healthy, ...patch }),
    });
    return { ...r, record: existsSync(join(dir, 'run.log')) ? readFileSync(join(dir, 'run.log'), 'utf8') : '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the user is measured by running id in the image, with the flags that contain it', () => {
  const r = configure({ id: '1000' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const args = r.record.split('\n');
  assert.deepEqual(args.slice(0, 1), ['run']);
  for (const flag of ['--rm', '--read-only', '--network', 'none', '--cap-drop', 'ALL', 'no-new-privileges', '--entrypoint', 'id', '--pull', 'never']) {
    assert.ok(args.includes(flag), flag);
  }
  // The image's default user is what is measured, so docker is given no --user; `-u` is id's own flag.
  assert.ok(!args.includes('--user'), 'no user override');
  assert.deepEqual(args.filter(Boolean).slice(-3), ['id', 'container-scan:candidate', '-u']);
});

test('a measured uid of zero is root however the USER line was spelled', () => {
  // USER 00, +0, 0:0 and root all start the image as uid 0, and `id -u` prints that as 0.
  for (const id of ['0', '00', '000']) {
    const r = configure({ id, user: '+0' });
    assert.equal(r.status, 1, id);
    assert.match(r.stdout, /::error title=container-scan::The image runs as root/);
  }
  for (const id of ['1', '1000', '10001', '65534', '4294967294']) assert.equal(configure({ id }).status, 0, id);
});

test('an id that prints anything but a decimal integer fails closed', () => {
  for (const id of ['', '+0', '-1', 'uid=0(root)', '1000 0', '1000\n0', '0x0', '1e3', '12345678901', 'root']) {
    const r = configure({ id, user: '' });
    assert.equal(r.status, 1, JSON.stringify(id));
    assert.match(r.stdout, /could not be measured/, JSON.stringify(id));
  }
});

test('an image with no id fails closed, and expected-uid names the way out', () => {
  const none = configure({ idStatus: 127, id: '', user: '10001' });
  assert.equal(none.status, 1);
  assert.match(none.stdout, /::error title=container-scan::The user could not be measured/);
  assert.match(none.stdout, /expected-uid/);
  // With the uid named, the configured USER must be exactly that number, with or without a group.
  for (const user of ['10001', '10001:10001', '10001:0']) {
    const r = configure({ idStatus: 127, id: '', user }, '10001');
    assert.equal(r.status, 0, user + r.stdout);
    assert.match(r.stdout, /::notice title=container-scan::/);
  }
  for (const user of ['', 'node', '0', '00', '010001', '10001x', '1000', '0:10001', ' 10001', 'root:10001']) {
    assert.equal(configure({ idStatus: 127, id: '', user }, '10001').status, 1, JSON.stringify(user));
  }
});

test('expected-uid is compared to the measured uid when id works', () => {
  assert.equal(configure({ id: '10001' }, '10001').status, 0);
  const wrong = configure({ id: '1000' }, '10001');
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /expected-uid is 10001/);
  assert.equal(configure({ id: '0' }, '10001').status, 1);
});

test('the image declares a healthcheck that is not NONE', () => {
  const ok = [{ Test: ['CMD', 'true'] }, { Test: ['CMD-SHELL', 'exit 0'], Interval: 5 }];
  for (const h of ok) assert.equal(configure({ healthcheck: JSON.stringify(h) }).status, 0, JSON.stringify(h));
  for (const h of ['null', '', '{}', '[]', '"CMD"', '{"Test":[]}', '{"Test":"x"}', '{"Test":["NONE"]}', '{"Test":{}}', 'false', 'not json']) {
    const r = configure({ healthcheck: h });
    assert.equal(r.status, 1, JSON.stringify(h));
    assert.match(r.stdout, /::error title=container-scan::The image declares no HEALTHCHECK/);
  }
});

test('root and a missing healthcheck are both reported', () => {
  const r = configure({ id: '0', healthcheck: 'null' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /runs as root/);
  assert.match(r.stdout, /no HEALTHCHECK/);
});

// The gate is Trivy's own exit status: whatever Trivy does that is not a clean exit fails the step.
function gate(code, { ignore = '', planted } = {}) {
  const dir = workspace({ '.trivyignore': 'CVE-2024-1\n' });
  try {
    mkdirSync(join(dir, 'tmp', 'trivy-out'), { recursive: true });
    if (planted !== undefined) writeFileSync(join(dir, 'tmp', 'trivy-out', 'trivy.json'), planted);
    const log = join(dir, 'docker.log');
    const r = runStep('image', 'Trivy gate', { TRIVY_IMAGE: 'trivy@sha256:abc', TRIVYIGNORE: ignore }, dir, {
      fakeDocker: `printf '%s\\n' "$@" > "${log}"; exit ${code}`,
    });
    return { ...r, args: existsSync(log) ? readFileSync(log, 'utf8') : '', dir };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Trivy exiting zero passes the gate and every other exit fails it', () => {
  assert.equal(gate(0).status, 0);
  for (const code of [1, 2, 3, 125, 126, 127, 137, 255]) {
    const r = gate(code);
    assert.equal(r.status, 1, String(code));
    assert.match(r.stdout, /::error title=container-scan::Trivy failed the image/);
  }
});

test('a report in the output directory changes nothing about the gate', () => {
  // The gate never reads one: a clean-looking, an empty and a hostile file all leave the exit status alone.
  for (const planted of ['{}', '', 'not json', JSON.stringify({ SchemaVersion: 2, ArtifactType: 'container_image', Results: 'bad' })]) {
    assert.equal(gate(0, { planted }).status, 0, JSON.stringify(planted));
    assert.equal(gate(1, { planted }).status, 1, JSON.stringify(planted));
  }
});

test('the gate passes Trivy its flags and mounts the ignore file read-only', () => {
  const r = gate(0, { ignore: '.trivyignore' });
  assert.match(r.args, /--exit-code\n1\n/);
  assert.match(r.args, /--severity\nHIGH,CRITICAL/);
  assert.match(r.args, /--ignore-unfixed/);
  assert.match(r.args, /--scanners\nvuln/);
  assert.match(r.args, /\/ignore\/\.trivyignore:ro/);
  assert.match(r.args, /--ignorefile\n\/ignore\/\.trivyignore/);
  assert.doesNotMatch(gate(0).args, /--ignorefile/);
});
