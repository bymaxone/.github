let cp: any;
let other: any;
cp = require('child_process');
other = require('some-other-module');

declare const name: string;
declare const line: string;
declare const text: string;
declare const query: string;
declare const re: RegExp;
declare const db: { exec(sql: string): void };

// ruleid: bymax.js.child-process-shell-non-literal
cp.exec(name);
// ruleid: bymax.js.child-process-shell-non-literal
cp.execSync(name);

// ok: bymax.js.child-process-shell-non-literal
cp.exec('ls -la');
// ok: bymax.js.child-process-shell-non-literal
/a(b)/.exec(line);
// ok: bymax.js.child-process-shell-non-literal
re.exec(text);
// ok: bymax.js.child-process-shell-non-literal
db.exec(query);
// ok: bymax.js.child-process-shell-non-literal
other.exec(name);
