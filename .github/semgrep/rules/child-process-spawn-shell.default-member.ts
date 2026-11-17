import * as cp from 'node:child_process';
import * as other from 'some-other-module';

declare const cmd: string;
declare const arg: string;
declare const args: string[];
declare const base: object;

// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.spawn(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.spawnSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.execFile(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.execFileSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.execFile(cmd, [], { shell: true }, () => {});
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.spawn(cmd, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.spawn(cmd, [], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.spawn(cmd, [], { shell: process.env.SHELL });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.default.spawn('ls ' + cmd, [], { cwd: '/', shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.default.spawn('echo', [arg], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.default.execFileSync('echo', ['-n', `${arg}`], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.default.spawnSync('echo', args, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.default.spawn('echo', [arg], { ...base, shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cp.default.spawn('ls', ['-la'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cp.default.spawn('ls', { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cp.default.spawn(cmd, [arg]);
// ok: bymax.js.child-process-spawn-shell-command
cp.default.spawn(cmd, [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-command
cp.default.spawn(cmd, { stdio: 'inherit' });
// ok: bymax.js.child-process-spawn-shell-argument
cp.default.spawn('echo', [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-argument
cp.default.spawn('echo', [arg]);
// ok: bymax.js.child-process-spawn-shell-argument
cp.default.spawn('echo', ['-n', 'hi'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
other.default.spawn(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-argument
other.default.spawn('echo', [arg], { shell: true });
