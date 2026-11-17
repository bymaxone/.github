import { exec, execSync, spawn, execFile } from 'node:child_process';
import * as cp from 'node:child_process';

declare const name: string;

// ruleid: bymax.js.child-process-shell-non-literal
exec('ls ' + name);
// ruleid: bymax.js.child-process-shell-non-literal
execSync(`ls ${name}`);
// ruleid: bymax.js.child-process-shell-non-literal
cp.exec(name, () => {});
// ruleid: bymax.js.child-process-shell-non-literal
spawn(name, [], { shell: true });
// ruleid: bymax.js.child-process-shell-non-literal
cp.spawnSync(name, { shell: true });

// ok: bymax.js.child-process-shell-non-literal
exec('ls -la');
// ok: bymax.js.child-process-shell-non-literal
execSync('git status');
// ok: bymax.js.child-process-shell-non-literal
spawn(name, ['--flag']);
// ok: bymax.js.child-process-shell-non-literal
spawn(name, ['--flag'], { shell: false });
// ok: bymax.js.child-process-shell-non-literal
execFile(name, ['--flag']);
