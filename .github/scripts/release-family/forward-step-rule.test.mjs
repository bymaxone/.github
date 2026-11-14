// The family check's rule for the forward-only step. Every job whose effective permissions hold the OIDC
// token must carry the template's step, as the same parsed object (name, env, run and nothing else), live
// (no `if`, no `continue-on-error`), ahead of the first step that downloads the build's artifact: the
// publish job has no checkout and no install, so nothing it publishes exists before that download.
// Workflows are built from the template as parsed objects, so the template and the rule cannot disagree.
// Needs `ruby` (the template is read by Psych).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkRelease, FORWARD_STEP, forwardRule, parseWorkflow, pinnedSha } from './check-release.mjs';

const template = readFileSync(new URL('../../../.github/workflow-templates/npm-release.yml', import.meta.url), 'utf8');
const TEMPLATE = parseWorkflow(template);
const SHA = pinnedSha(TEMPLATE);
const FORWARD = forwardRule(TEMPLATE).step;
const RULE = forwardRule(TEMPLATE);

/** A copy of the template as an adopter would hold it: the package name filled in, then edited by `fn`. */
function copy(fn = () => {}) {
  const workflow = structuredClone(TEMPLATE);
  workflow.jobs.publish.env.PACKAGE_NAME = '@bymax-one/example';
  fn(workflow);
  return workflow;
}
const codes = (workflow) => checkRelease(workflow, SHA, RULE).map((p) => `${p.job}:${p.code}`);
const stepsOf = (workflow, job = 'publish') => workflow.jobs[job].steps;
const indexOfForward = (steps) => steps.findIndex((s) => s.name === FORWARD_STEP);
const isDownload = (s) => typeof s.uses === 'string' && s.uses.startsWith('actions/download-artifact@');
/** Moves the forward step to `to`, a function of the steps without it. */
const moveForward = (workflow, to) => {
  const steps = stepsOf(workflow);
  const [step] = steps.splice(indexOfForward(steps), 1);
  steps.splice(to(steps), 0, step);
};
const editForward = (fn) => copy((w) => fn(stepsOf(w)[indexOfForward(stepsOf(w))]));

test('the template yields its forward-only step as an object, and a filled copy satisfies the rule', () => {
  assert.equal(FORWARD.name, FORWARD_STEP);
  assert.match(FORWARD.run, /vMAJOR\.MINOR\.PATCH/);
  assert.deepEqual(codes(copy()), []);
});

test('without the forward argument the rule stays what it was, so the placeholder name is not read', () => {
  assert.deepEqual(checkRelease(TEMPLATE, SHA), []);
  assert.deepEqual(codes(TEMPLATE), ['publish:no-package-name'], 'the placeholder is not a package');
});

test('a copy without the step fails', () => {
  assert.deepEqual(codes(copy((w) => stepsOf(w).splice(indexOfForward(stepsOf(w)), 1))), ['publish:no-forward-step']);
});

test('a step that is not the template step as an object fails: a hollowed run under the right name, an edited line, a renamed step', () => {
  assert.deepEqual(codes(editForward((s) => { s.run = ''; })), ['publish:forward-step-differs'], 'emptied run');
  assert.deepEqual(codes(editForward((s) => { s.run = 'true'; })), ['publish:forward-step-differs'], 'run replaced');
  assert.deepEqual(codes(editForward((s) => { s.run = s.run.replace('"ahead"', '"behind"'); })), ['publish:forward-step-differs'], 'status compared with another word');
  assert.deepEqual(codes(editForward((s) => { s.run = s.run.replace('exit 1', 'exit 0'); })), ['publish:forward-step-differs'], 'a failure that exits 0');
  assert.deepEqual(codes(editForward((s) => { s.run = s.run.replace('# ', '#  '); })), ['publish:forward-step-differs'], 'the script is compared as written, comments included');
  assert.deepEqual(codes(editForward((s) => { s.shell = 'python'; })), ['publish:forward-step-differs'], 'a key the template does not have');
  assert.deepEqual(codes(editForward((s) => { s['working-directory'] = '/tmp'; })), ['publish:forward-step-differs']);
  assert.deepEqual(codes(editForward((s) => { s.name = 'Forward only'; })), ['publish:no-forward-step'], 'the name is part of the step');
});

test('the step must be live: an if or a continue-on-error fails, even when the script is the template script', () => {
  assert.deepEqual(codes(editForward((s) => { s.if = false; })), ['publish:forward-step-conditional'], 'if: false');
  assert.deepEqual(codes(editForward((s) => { s.if = "github.ref_name != 'v0.0.0'"; })), ['publish:forward-step-conditional']);
  assert.deepEqual(codes(editForward((s) => { s['continue-on-error'] = true; })), ['publish:forward-step-conditional'], 'continue-on-error: true');
});

test("an env that is not the template's fails: a VERSION from elsewhere, a missing token, a package name inside the step", () => {
  assert.deepEqual(codes(editForward((s) => { s.env.VERSION = '0.0.0'; })), ['publish:forward-step-differs']);
  assert.deepEqual(codes(editForward((s) => { delete s.env.GH_TOKEN; })), ['publish:forward-step-differs']);
  assert.deepEqual(codes(editForward((s) => { s.env.PACKAGE_NAME = '@bymax-one/example'; })), ['publish:forward-step-differs'], 'nothing per-adopter sits in the step');
});

test('the package name lives in the job env: absent or the placeholder fails, a real one passes', () => {
  assert.deepEqual(codes(copy((w) => { delete w.jobs.publish.env.PACKAGE_NAME; })), ['publish:no-package-name']);
  assert.deepEqual(codes(copy((w) => { w.jobs.publish.env.PACKAGE_NAME = ''; })), ['publish:no-package-name']);
  assert.deepEqual(codes(copy((w) => { w.jobs.publish.env.PACKAGE_NAME = '@bymax-one/CHANGE-ME'; })), ['publish:no-package-name']);
});

test('the step stands ahead of the first step that downloads the artifact, and anywhere later is late', () => {
  const download = (steps) => steps.findIndex(isDownload);
  assert.deepEqual(codes(copy()), [], 'the template order');
  assert.deepEqual(codes(copy((w) => moveForward(w, (s) => download(s) + 1))), ['publish:forward-step-late'], 'right after the download');
  assert.deepEqual(codes(copy((w) => moveForward(w, (s) => s.length - 1))), ['publish:forward-step-late'], 'second to last');
  assert.deepEqual(codes(copy((w) => moveForward(w, (s) => s.length))), ['publish:forward-step-late'], 'last');
  assert.deepEqual(codes(copy((w) => moveForward(w, () => 1))), [], 'right after the harden-runner step, which stays first, it is still ahead of the download');
});

test('every spelling of the publish command is beside the point: the anchor is the download, not the command', () => {
  for (const publish of ['npm --access public publish', 'npm \\\n  publish --access public', 'command npm publish', 'pnpm publish', './publish.sh']) {
    const workflow = copy((w) => {
      const steps = stepsOf(w);
      steps.find((s) => typeof s.run === 'string' && s.run.includes('npm publish')).run = publish;
      moveForward(w, () => steps.length);
    });
    assert.deepEqual(codes(workflow), ['publish:forward-step-late'], publish);
  }
});

test('the download step is found as a parsed step: any ref, the first of several, none at all is a failure', () => {
  assert.deepEqual(codes(copy((w) => { stepsOf(w).find(isDownload).uses = 'actions/download-artifact@v4'; })), []);
  const twice = copy((w) => {
    const steps = stepsOf(w);
    steps.splice(steps.findIndex(isDownload) + 1, 0, structuredClone(steps.find(isDownload)));
  });
  assert.deepEqual(codes(twice), [], 'two downloads, the step is ahead of both');
  moveForward(twice, (s) => s.findIndex(isDownload) + 1);
  assert.deepEqual(codes(twice), ['publish:forward-step-late'], 'between the two it is behind the first');
  assert.deepEqual(codes(copy((w) => { w.jobs.publish.steps = stepsOf(w).filter((s) => !isDownload(s)); })), ['publish:no-download-step']);
});

test('every job whose effective permissions hold the token is asked, the inherited ones included', () => {
  const second = (w, own) => {
    w.permissions = { contents: 'read', 'id-token': 'write' };
    delete w.jobs.build.permissions;
    delete w.jobs.publish.permissions;
    w.jobs.other = { 'runs-on': 'ubuntu-latest', steps: structuredClone(stepsOf(w)) };
    if (own) w.jobs.other.permissions = own;
  };
  // A workflow-level grant reaches every job without its own block: build, publish and the second job.
  const inherited = copy((w) => {
    second(w);
    w.jobs.other.steps.splice(indexOfForward(w.jobs.other.steps), 1);
    w.jobs.other.env = { PACKAGE_NAME: '@bymax-one/example' };
  });
  assert.ok(codes(inherited).includes('other:no-forward-step'), 'the second job inherits the token and lacks the step');
  assert.ok(codes(inherited).includes('build:no-forward-step'), 'so does a build job with no permissions of its own');
  // A job with its own block replaces the workflow's, so one that does not list id-token is not asked.
  const replaced = copy((w) => {
    second(w, { contents: 'read' });
    w.jobs.other.steps.splice(indexOfForward(w.jobs.other.steps), 1);
  });
  assert.ok(!codes(replaced).some((c) => c.startsWith('other:')), 'a job whose own permissions omit the token is not asked');
  // Two jobs that hold the token, one with the step.
  const two = copy((w) => {
    second(w, { 'id-token': 'write' });
    w.jobs.other.env = { PACKAGE_NAME: '@bymax-one/example' };
  });
  assert.deepEqual(codes(two).filter((c) => c.startsWith('other:')), [], 'the second job carries the step and passes');
  two.jobs.other.steps.find((s) => s.name === FORWARD_STEP).run = '';
  assert.deepEqual(codes(two).filter((c) => c.startsWith('other:')), ['other:forward-step-differs']);
});

test('only the template\'s own steps may stand ahead of the step: the premise of the download anchor is checked, not assumed', () => {
  const at = (w) => indexOfForward(stepsOf(w));
  // A publish that happens before the step, with the download moved behind it: ahead of the download, yet too late.
  const publishedFirst = copy((w) => {
    const steps = stepsOf(w);
    const download = steps.splice(steps.findIndex(isDownload), 1)[0];
    steps.splice(at(w), 0, { uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', with: { 'persist-credentials': false } }, { run: 'npm publish ./x.tgz' });
    steps.splice(at(w) + 1, 0, download);
  });
  assert.deepEqual(codes(publishedFirst), ['publish:forward-step-preceded'], 'checkout and publish ahead of the step, download after it');
  assert.deepEqual(codes(copy((w) => stepsOf(w).splice(at(w), 0, { run: 'echo hi' }))), ['publish:forward-step-preceded'], 'an unknown step ahead');
  assert.deepEqual(codes(copy((w) => { const s = stepsOf(w)[at(w) - 1]; s.run = `${s.run}\ntrue`; })), ['publish:forward-step-preceded'], 'a template step ahead, edited');
  // Membership, not order: the template's steps ahead of the step may come in any order, and the harden-runner is the other rule's.
  assert.deepEqual(codes(copy((w) => { const s = stepsOf(w); [s[1], s[3]] = [s[3], s[1]]; })), [], 'two of the template steps swapped');
  // A harden-runner pinned to another commit is the pin rule's finding (stale-sha), not a stranger ahead of the step.
  const stale = codes(copy((w) => { stepsOf(w)[0].uses = `step-security/harden-runner@${'0'.repeat(40)}`; }));
  assert.deepEqual(stale.filter((c) => c.includes('preceded')), [], 'a stale harden-runner is not a preceding stranger');
  assert.deepEqual(codes(copy()), [], 'the template order');
  assert.deepEqual(codes(copy((w) => { w.jobs.publish.steps = [stepsOf(w)[at(w)], ...stepsOf(w).filter((s) => s.name !== FORWARD_STEP)]; })).filter((c) => c.includes('preceded')), [], 'nothing ahead of it at all');
});

test('a harden-runner step is exempt from the membership check only as the first step, the one the pin rule judges', () => {
  const sorted = (w) => codes(w).sort();
  const hardenAt = (sha) => ({ uses: `step-security/harden-runner@${sha}`, with: { 'egress-policy': 'audit' } });
  const forwardAt = (w) => indexOfForward(stepsOf(w));
  // Codex's trigger: a mutable-tag harden-runner as a second step runs with the token before the guard.
  assert.deepEqual(sorted(copy((w) => stepsOf(w).splice(1, 0, { uses: 'step-security/harden-runner@v2' }))), ['publish:forward-step-preceded'], 'a second harden-runner at a tag');
  assert.deepEqual(sorted(copy((w) => stepsOf(w).splice(1, 0, hardenAt('2'.repeat(40))))), ['publish:forward-step-preceded'], 'a second one at another commit');
  assert.deepEqual(sorted(copy((w) => stepsOf(w).splice(1, 0, structuredClone(stepsOf(w)[0])))), [], 'a second one identical to the template\'s is a member');
  // The first step is the pin rule's: a stale pin there is one finding, not two.
  assert.deepEqual(sorted(copy((w) => { stepsOf(w)[0].uses = `step-security/harden-runner@${'0'.repeat(40)}`; })), ['publish:stale-sha']);
  assert.deepEqual(sorted(copy((w) => { stepsOf(w)[0].uses = `step-security/harden-runner@${'0'.repeat(40)}`; stepsOf(w).splice(1, 0, hardenAt('2'.repeat(40))); })), ['publish:forward-step-preceded', 'publish:stale-sha'], 'a stale first step and a stranger behind it');
  // A first step that is not a harden-runner is judged by both rules.
  const checkoutFirst = copy((w) => stepsOf(w).unshift({ uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1' }));
  assert.deepEqual(sorted(checkoutFirst), ['publish:forward-step-preceded', 'publish:not-first'], 'checkout, harden-runner, forward, download');
  assert.ok(forwardAt(checkoutFirst) > 1);
  assert.deepEqual(sorted(copy()), [], 'the template order');
});
