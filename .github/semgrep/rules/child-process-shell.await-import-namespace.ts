declare const name: string;
declare const line: string;
declare const db: { exec(sql: string): void };

export async function namespaceAwaitImport(): Promise<void> {
  const cp = await import('node:child_process');
  // ruleid: bymax.js.child-process-shell-non-literal
  cp.exec(name);
  // ruleid: bymax.js.child-process-shell-non-literal
  cp.execSync(name, { stdio: 'inherit' });
}

export async function otherModule(): Promise<void> {
  const other = await import('some-other-module');
  // ok: bymax.js.child-process-shell-non-literal
  other.exec(name);
  // ok: bymax.js.child-process-shell-non-literal
  db.exec(line);
}
