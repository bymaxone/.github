declare function spawnSync(command: string, ...rest: unknown[]): void;

declare const name: string;
declare const line: string;
declare const re: RegExp;

// ruleid: bymax.js.child-process-shell-non-literal
spawnSync(name, { shell: true });

// ok: bymax.js.child-process-shell-non-literal
spawnSync(name, ['--flag']);
// ok: bymax.js.child-process-shell-non-literal
spawnSync(name, ['--flag'], { shell: false });
// ok: bymax.js.child-process-shell-non-literal
spawnSync('ls', { shell: true });
// ok: bymax.js.child-process-shell-non-literal
/a(b)/.exec(line);
// ok: bymax.js.child-process-shell-non-literal
re.exec(line);
