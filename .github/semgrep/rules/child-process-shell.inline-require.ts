declare const name: string;
declare const line: string;
declare const text: string;
declare const query: string;
declare const re: RegExp;
declare const db: { exec(sql: string): void };

// ruleid: bymax.js.child-process-shell-non-literal
require('child_process').exec(name);
// ruleid: bymax.js.child-process-shell-non-literal
require('node:child_process').execSync(name, { stdio: 'inherit' });

// ok: bymax.js.child-process-shell-non-literal
require('child_process').exec('ls -la');
// ok: bymax.js.child-process-shell-non-literal
require('some-other-module').exec(name);
// ok: bymax.js.child-process-shell-non-literal
/a(b)/.exec(line);
// ok: bymax.js.child-process-shell-non-literal
re.exec(text);
// ok: bymax.js.child-process-shell-non-literal
db.exec(query);
