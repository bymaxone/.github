// The family check's rule for the forward-only step: a copy must carry the template's script ahead of the
// publish, unconditionally, with the template's env and a real package name. Fixtures are cut from the
// template, so the template and the rule cannot disagree. Needs `ruby` (the workflow is read by Psych).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkRelease, FORWARD_STEP, forwardStep, parseWorkflow, pinnedSha } from './check-release.mjs';

const template = readFileSync(new URL('../../../.github/workflow-templates/npm-release.yml', import.meta.url), 'utf8');
const SHA = pinnedSha(parseWorkflow(template));
const FORWARD = forwardStep(parseWorkflow(template));
const filled = template.replaceAll('@bymax-one/CHANGE-ME', '@bymax-one/example');

/** The codes the rule reports for `text`, as `job:code`. */
const codes = (text) => checkRelease(parseWorkflow(text), SHA, FORWARD).map((p) => `${p.job}:${p.code}`);

/** The forward-only step of `text`, as `{ text, start, end }` over the whole step block. */
const stepBlock = (text) => {
  const start = text.indexOf(`      - name: ${FORWARD_STEP}\n`);
  const end = text.indexOf('\n      - name: ', start + 1) + 1;
  return { start, end, block: text.slice(start, end) };
};
const edit = (text, fn) => {
  const { start, end, block } = stepBlock(text);
  return text.slice(0, start) + fn(block) + text.slice(end);
};

test('the template yields the step the rule looks for, and a filled copy satisfies the rule', () => {
  assert.ok(FORWARD, 'the template has the step in its publish job');
  assert.match(FORWARD.script, /vMAJOR\.MINOR\.PATCH/);
  assert.deepEqual(codes(filled), []);
});

test('without the forward argument the rule stays what it was, so the placeholder name is not read', () => {
  assert.deepEqual(checkRelease(parseWorkflow(template), SHA), []);
});

test('a copy without the step fails, and so does one that keeps the name and changes the script', () => {
  assert.deepEqual(codes(edit(filled, () => '')), ['publish:no-forward-step']);
  assert.deepEqual(codes(edit(filled, (b) => b.replace('!= "$VERSION" ]; }; then', '= "$VERSION" ]; }; then'))), ['publish:no-forward-step']);
  assert.deepEqual(codes(edit(filled, (b) => b.replace('"ahead"', '"behind"'))), ['publish:no-forward-step']);
  assert.deepEqual(codes(edit(filled, (b) => b.replace('exit 1', 'exit 0'))), ['publish:no-forward-step']);
});

test('a copy that renames the step but keeps the script passes: the script is the rule, not the name', () => {
  assert.deepEqual(codes(edit(filled, (b) => b.replace(FORWARD_STEP, 'Forward only'))), []);
});

test('comment lines and blank lines of the script are not compared', () => {
  const bare = edit(filled, (b) =>
    b
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n'),
  );
  assert.notEqual(bare, filled);
  assert.deepEqual(codes(bare), []);
});

test('the step after the one that publishes fails: it would run when it can no longer refuse', () => {
  const { block } = stepBlock(filled);
  const without = edit(filled, () => '');
  const at = without.indexOf('\n      - name: Create the GitHub Release');
  const late = without.slice(0, at + 1) + block + without.slice(at + 1);
  assert.deepEqual(codes(late), ['publish:forward-step-late']);
});

test('the publish step is found by its command, not by one spelling of it', () => {
  const { block } = stepBlock(filled);
  const without = edit(filled, () => '');
  const at = without.indexOf('\n      - name: Create the GitHub Release');
  const late = without.slice(0, at + 1) + block + without.slice(at + 1);
  for (const spelling of ['npm --access public publish', 'npm  publish', 'pnpm publish', 'yarn npm publish', 'npm run publish', 'npx npm@11 publish', 'NODE_OPTIONS=x npm publish', 'cd d && npm publish', 'if npm publish']) {
    const text = late.replace('npm publish "$RUNNER_TEMP', `${spelling} "$RUNNER_TEMP`);
    assert.notEqual(text, late, spelling);
    assert.deepEqual(codes(text), ['publish:forward-step-late'], spelling);
  }
});

test('words that only look like a publish do not make the step late', () => {
  // A message that says "npm ... publish" inside quotes, ahead of the forward step, is not a publish command.
  assert.deepEqual(codes(filled), []);
  const text = filled.replace('npm 11.5.1 or newer is required for trusted publishing.', 'npm 11.5.1 or newer is required to publish.');
  assert.notEqual(text, filled);
  assert.deepEqual(codes(text), []);
  const trailing = filled.replace('have=$(npm --version)', 'have=$(npm --version) # npm publish');
  assert.notEqual(trailing, filled);
  assert.deepEqual(codes(trailing), []);
});

test('an if or a continue-on-error on the step fails', () => {
  assert.deepEqual(codes(edit(filled, (b) => b.replace(`      - name: ${FORWARD_STEP}\n`, `      - name: ${FORWARD_STEP}\n        if: github.ref_name != 'v0.0.0'\n`))), ['publish:forward-step-conditional']);
  assert.deepEqual(codes(edit(filled, (b) => b.replace(`      - name: ${FORWARD_STEP}\n`, `      - name: ${FORWARD_STEP}\n        continue-on-error: true\n`))), ['publish:forward-step-conditional']);
});

test("an env that is not the template's fails: a VERSION from elsewhere defeats the version rule", () => {
  assert.deepEqual(codes(edit(filled, (b) => b.replace('${{ needs.build.outputs.version }}', '0.0.0'))), ['publish:forward-step-env']);
  assert.deepEqual(codes(edit(filled, (b) => b.replace('          GH_TOKEN: ${{ github.token }}\n', ''))), ['publish:forward-step-env']);
});

test('the package name is read from the job env or from the step env, and the placeholder or none fails', () => {
  assert.deepEqual(codes(template), ['publish:no-package-name'], 'the placeholder is not a package');
  const noJobName = filled.replace(/ {6}# The one place[^\n]*\n[^\n]*\n {6}PACKAGE_NAME: '[^']*'\n/, '');
  assert.notEqual(noJobName, filled);
  assert.deepEqual(codes(noJobName), ['publish:no-package-name']);
  const inStep = edit(noJobName, (b) => b.replace('          VERSION:', "          PACKAGE_NAME: '@bymax-one/example'\n          VERSION:"));
  assert.deepEqual(codes(inStep), []);
});
