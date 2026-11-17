import cpTs = require('child_process');
import cpNodeTs = require('node:child_process');
import otherTs = require('some-other-module');

declare const name: string;
declare const line: string;
declare const db: { exec(sql: string): void };

// ruleid: bymax.js.child-process-shell-non-literal
cpTs.exec(name);
// ruleid: bymax.js.child-process-shell-non-literal
cpNodeTs.execSync(name, { stdio: 'inherit' });

// ok: bymax.js.child-process-shell-non-literal
cpTs.exec('ls -la');
// ok: bymax.js.child-process-shell-non-literal
otherTs.exec(name);
// ok: bymax.js.child-process-shell-non-literal
db.exec(line);
