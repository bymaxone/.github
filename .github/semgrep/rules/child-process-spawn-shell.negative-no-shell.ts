const cp = require('node:child_process');
const { spawn, execFile } = require('child_process');

declare const cmd: string;
declare const arg: string;

// ok: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, [arg]);
// ok: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-command
cp.spawnSync(cmd, [arg], { stdio: 'inherit' });
// ok: bymax.js.child-process-spawn-shell-argument
cp.spawn('echo', [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-argument
cp.spawn('echo', [arg], { cwd: '/' });
// ok: bymax.js.child-process-spawn-shell-command
spawn(cmd, [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-command
execFile(cmd, [arg]);
// ok: bymax.js.child-process-spawn-shell-command
execFile(cmd, [arg], () => {});
// ok: bymax.js.child-process-spawn-shell-argument
execFile('echo', [arg], { shell: false }, () => {});

// The anchor the rule test harness needs to pair this file with the rule: a real finding, so that
// the ok cases above are judged against a rule that does match something in this file.
// ruleid: bymax.js.child-process-spawn-shell-command
require('child_process').spawn(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
require('child_process').spawn('echo', [arg], { shell: true });
