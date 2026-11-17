import { spawn, spawnSync, execFile, execFileSync } from 'node:child_process';
import { spawn as otherSpawn } from 'some-other-module';

declare const cmd: string;
declare const arg: string;
declare const args: string[];
declare const base: object;

// ruleid: bymax.js.child-process-spawn-shell-command
spawn(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
spawnSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
execFile(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
execFileSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
execFile(cmd, [], { shell: true }, () => {});
// ruleid: bymax.js.child-process-spawn-shell-command
spawn(cmd, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
spawn(cmd, [], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-command
spawn(cmd, [], { shell: process.env.SHELL });
// ruleid: bymax.js.child-process-spawn-shell-command
spawn('ls ' + cmd, [], { cwd: '/', shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
spawn('echo', [arg], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
execFileSync('echo', ['-n', `${arg}`], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-argument
spawnSync('echo', args, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
spawn('echo', [arg], { ...base, shell: true });
// ok: bymax.js.child-process-spawn-shell-command
spawn('ls', ['-la'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
spawn('ls', { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
spawn(cmd, [arg]);
// ok: bymax.js.child-process-spawn-shell-command
spawn(cmd, [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-command
spawn(cmd, { stdio: 'inherit' });
// ok: bymax.js.child-process-spawn-shell-argument
spawn('echo', [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-argument
spawn('echo', [arg]);
// ok: bymax.js.child-process-spawn-shell-argument
spawn('echo', ['-n', 'hi'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
otherSpawn(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-argument
otherSpawn('echo', [arg], { shell: true });
