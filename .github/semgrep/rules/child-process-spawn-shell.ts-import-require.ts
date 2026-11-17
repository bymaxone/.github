import cpTs = require('child_process');
import otherTs = require('some-other-module');

declare const cmd: string;
declare const arg: string;
declare const args: string[];
declare const base: object;

// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.spawn(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.spawnSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.execFile(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.execFileSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.execFile(cmd, [], { shell: true }, () => {});
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.spawn(cmd, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.spawn(cmd, [], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.spawn(cmd, [], { shell: process.env.SHELL });
// ruleid: bymax.js.child-process-spawn-shell-command
cpTs.spawn('ls ' + cmd, [], { cwd: '/', shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cpTs.spawn('echo', [arg], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cpTs.execFileSync('echo', ['-n', `${arg}`], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-argument
cpTs.spawnSync('echo', args, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cpTs.spawn('echo', [arg], { ...base, shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cpTs.spawn('ls', ['-la'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cpTs.spawn('ls', { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cpTs.spawn(cmd, [arg]);
// ok: bymax.js.child-process-spawn-shell-command
cpTs.spawn(cmd, [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-command
cpTs.spawn(cmd, { stdio: 'inherit' });
// ok: bymax.js.child-process-spawn-shell-argument
cpTs.spawn('echo', [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-argument
cpTs.spawn('echo', [arg]);
// ok: bymax.js.child-process-spawn-shell-argument
cpTs.spawn('echo', ['-n', 'hi'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
otherTs.spawn(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-argument
otherTs.spawn('echo', [arg], { shell: true });
