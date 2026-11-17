import { spawn } from 'cross-spawn';
import * as other from 'another-module';

declare const cmd: string;
declare const arg: string;

function execFile(command: string, args: string[], options: object): void {}

// ok: bymax.js.child-process-spawn-shell-command
spawn(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-argument
spawn('echo', [arg], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
other.spawn(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
other.default.spawn(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-command
execFile(cmd, [], { shell: true });
// ok: bymax.js.child-process-spawn-shell-argument
execFile('echo', [arg], { shell: true });

// The anchor the rule test harness needs to pair this file with the rule: a real finding, so that
// the ok cases above are judged against a rule that does match something in this file.
// ruleid: bymax.js.child-process-spawn-shell-command
require('child_process').spawn(cmd, [], { shell: true });
// ruleid: bymax.js.child-process-spawn-shell-argument
require('child_process').spawn('echo', [arg], { shell: true });
