declare const name: string;

export async function destructuredAwaitImport(): Promise<void> {
  const { exec, execSync } = await import('child_process');
  // ruleid: bymax.js.child-process-shell-non-literal
  exec(name);
  // ruleid: bymax.js.child-process-shell-non-literal
  execSync(name);
}

export async function otherModule(): Promise<void> {
  const { exec } = await import('some-other-module');
  // ok: bymax.js.child-process-shell-non-literal
  exec(name);
}
