declare function spawn(command: string, ...rest: unknown[]): void;
declare function execFile(command: string, args: string[]): void;

declare const name: string;
declare const line: string;
declare const re: RegExp;

// ruleid: bymax.js.child-process-shell-non-literal
spawn(name, [], { shell: true });

// ok: bymax.js.child-process-shell-non-literal
spawn(name, ['--flag']);
// ok: bymax.js.child-process-shell-non-literal
spawn(name, ['--flag'], { shell: false });
// ok: bymax.js.child-process-shell-non-literal
spawn('ls', [], { shell: true });
// ok: bymax.js.child-process-shell-non-literal
execFile(name, ['--flag']);
// ok: bymax.js.child-process-shell-non-literal
/a(b)/.exec(line);
// ok: bymax.js.child-process-shell-non-literal
re.exec(line);
