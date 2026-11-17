import { exec } from 'child_process';
import * as cp from 'node:child_process';

// ok: bymax.js.child-process-shell-non-literal
exec('ls -la');
// ok: bymax.js.child-process-shell-non-literal
cp.execSync('git status');

// The anchor the rule test harness needs to pair this file with the rule: a real finding, so that
// the ok cases above are judged against a rule that does match something in this file.
declare const anchor: string;
// ruleid: bymax.js.child-process-shell-non-literal
require('child_process').exec(anchor);
