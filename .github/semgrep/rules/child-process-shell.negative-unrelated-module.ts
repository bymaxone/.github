import { exec } from 'some-other-module';
import * as other from 'another-module';

declare const name: string;

// ok: bymax.js.child-process-shell-non-literal
exec(name);
// ok: bymax.js.child-process-shell-non-literal
other.exec(name);
// ok: bymax.js.child-process-shell-non-literal
other.default.exec(name);

// The anchor the rule test harness needs to pair this file with the rule: a real finding, so that
// the ok cases above are judged against a rule that does match something in this file.
declare const anchor: string;
// ruleid: bymax.js.child-process-shell-non-literal
require('child_process').exec(anchor);
