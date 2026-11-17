declare const cmd: string;
declare const arg: string;
declare const args: string[];
declare const base: object;

export async function inlineAwaitImport(): Promise<void> {
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn(cmd, [], { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawnSync(cmd, [], { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).execFile(cmd, [], { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).execFileSync(cmd, [], { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).execFile(cmd, [], { shell: true }, () => {});
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn(cmd, { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn(cmd, [], { shell: '/bin/sh' });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn(cmd, [], { shell: process.env.SHELL });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn('ls ' + cmd, [], { cwd: '/', shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-argument
  (await import('child_process')).spawn('echo', [arg], { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-argument
  (await import('child_process')).execFileSync('echo', ['-n', `${arg}`], { shell: '/bin/sh' });
  // ruleid: bymax.js.child-process-spawn-shell-argument
  (await import('child_process')).spawnSync('echo', args, { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-argument
  (await import('child_process')).spawn('echo', [arg], { ...base, shell: true });
  // ok: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn('ls', ['-la'], { shell: true });
  // ok: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn('ls', { shell: true });
  // ok: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn(cmd, [arg]);
  // ok: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn(cmd, [arg], { shell: false });
  // ok: bymax.js.child-process-spawn-shell-command
  (await import('child_process')).spawn(cmd, { stdio: 'inherit' });
  // ok: bymax.js.child-process-spawn-shell-argument
  (await import('child_process')).spawn('echo', [arg], { shell: false });
  // ok: bymax.js.child-process-spawn-shell-argument
  (await import('child_process')).spawn('echo', [arg]);
  // ok: bymax.js.child-process-spawn-shell-argument
  (await import('child_process')).spawn('echo', ['-n', 'hi'], { shell: true });
  // ruleid: bymax.js.child-process-spawn-shell-command
  (await import(`node:child_process`)).spawn(cmd, [], { shell: true });
  // ok: bymax.js.child-process-spawn-shell-command
  (await import('some-other-module')).spawn(cmd, [], { shell: true });
}
