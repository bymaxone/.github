declare const line: string;
declare const text: string;
declare const re: RegExp;

// ok: bymax.js.child-process-shell-non-literal
/a(b)/.exec(line);
// ok: bymax.js.child-process-shell-non-literal
re.exec(text);
// ok: bymax.js.child-process-shell-non-literal
new RegExp(text).exec(line);

// The anchor the rule test harness needs to pair this file with the rule: a real finding, so that
// the ok cases above are judged against a rule that does match something in this file.
declare const anchor: string;
// ruleid: bymax.js.child-process-shell-non-literal
require('child_process').exec(anchor);
