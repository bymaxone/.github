import * as cp from 'node:child_process';

declare const name: string;
declare const line: string;
declare const text: string;
declare const query: string;
declare const re: RegExp;
declare const db: { exec(sql: string): void };

// ruleid: bymax.js.child-process-shell-non-literal
cp.default.exec(name);
// ruleid: bymax.js.child-process-shell-non-literal
cp.default.execSync(name);

// ok: bymax.js.child-process-shell-non-literal
cp.default.exec('ls -la');
// ok: bymax.js.child-process-shell-non-literal
/a(b)/.exec(line);
// ok: bymax.js.child-process-shell-non-literal
re.exec(text);
// ok: bymax.js.child-process-shell-non-literal
db.exec(query);
