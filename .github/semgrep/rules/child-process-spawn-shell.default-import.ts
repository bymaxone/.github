import cp from 'child_process';
import other from 'some-other-module';

declare const cmd: string;
declare const arg: string;
declare const args: string[];
declare const base: object;

// ruleid: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.spawnSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.execFile(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.execFileSync(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.execFile(cmd, [], { shell: true }, () => {});
// ruleid: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, [], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, [], { shell: process.env.SHELL });
// ruleid: bymax.js.child-process-spawn-shell-command
cp.spawn('ls ' + cmd, [], { cwd: '/', shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.spawn('echo', [arg], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.execFileSync('echo', ['-n', `${arg}`], { shell: '/bin/sh' });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.spawnSync('echo', args, { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
cp.spawn('echo', [arg], { ...base, shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cp.spawn('ls', ['-la'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cp.spawn('ls', { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, [arg]);
// ok: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-command
cp.spawn(cmd, { stdio: 'inherit' });
// ok: bymax.js.child-process-spawn-shell-argument
cp.spawn('echo', [arg], { shell: false });
// ok: bymax.js.child-process-spawn-shell-argument
cp.spawn('echo', [arg]);
// ok: bymax.js.child-process-spawn-shell-argument
cp.spawn('echo', ['-n', 'hi'], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
other.spawn(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-argument
other.spawn('echo', [arg], { shell: true });
