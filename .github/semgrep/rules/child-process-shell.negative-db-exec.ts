declare const query: string;
declare const db: { exec(sql: string): void };
declare const client: { execSync(sql: string): void };

// ok: bymax.js.child-process-shell-non-literal
db.exec(query);
// ok: bymax.js.child-process-shell-non-literal
client.execSync(query);

// The anchor the rule test harness needs to pair this file with the rule: a real finding, so that
// the ok cases above are judged against a rule that does match something in this file.
declare const anchor: string;
// ruleid: bymax.js.child-process-shell-non-literal
require('child_process').exec(anchor);
