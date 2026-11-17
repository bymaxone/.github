import { exec, execSync, spawn, execFile } from 'node:child_process';
import * as cp from 'node:child_process';
import cpDefault from 'child_process';
import * as cpPlain from 'child_process';
const cpRequired = require('child_process');
const cpNodeRequired = require('node:child_process');
const { exec, execSync } = require('node:child_process');

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

declare const line: string;
declare const text: string;
declare const query: string;
declare const re: RegExp;
declare const db: { exec(sql: string): void };

// ok: bymax.js.child-process-shell-non-literal
/a(b)/.exec(line);
// ok: bymax.js.child-process-shell-non-literal
re.exec(text);
// ok: bymax.js.child-process-shell-non-literal
db.exec(query);

// ruleid: bymax.js.child-process-shell-non-literal
cpDefault.exec(name);
// ruleid: bymax.js.child-process-shell-non-literal
cpPlain.execSync(name);
// ruleid: bymax.js.child-process-shell-non-literal
cpRequired.exec(name);
// ruleid: bymax.js.child-process-shell-non-literal
cpNodeRequired.execSync(name);

import other from 'some-other-module';
// ok: bymax.js.child-process-shell-non-literal
other.exec(name);
