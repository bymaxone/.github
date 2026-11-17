const cp = require('node:child_process');
const { spawnSync } = require('child_process');

declare const cmd: string;
declare const arg: string;

// ok: bymax.js.child-process-spawn-shell-command
cp.spawn('ls', ['-la'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-argument
cp.spawn('ls', ['-la', '/tmp'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cp.execFileSync('git', ['status'], { shell: '/bin/sh' });
// ok: bymax.js.child-process-spawn-shell-argument
spawnSync('ls', [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
spawnSync('ls', { shell: true });

// The anchor the rule test harness needs to pair this file with the rule: a real finding, so that
// the ok cases above are judged against a rule that does match something in this file.
// ruleid: bymax.js.child-process-spawn-shell-command
require('child_process').spawn(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
require('child_process').spawn('echo', [arg], { shell: true });
