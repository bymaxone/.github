declare const name: string;

export async function inlineAwaitImport(): Promise<void> {
  // ruleid: bymax.js.child-process-shell-non-literal
  (await import('child_process')).exec(name);
  // ruleid: bymax.js.child-process-shell-non-literal
  (await import('node:child_process')).execSync(name);
}

export async function otherModule(): Promise<void> {
  // ok: bymax.js.child-process-shell-non-literal
  (await import('some-other-module')).exec(name);
  // ok: bymax.js.child-process-shell-non-literal
  (await import('child_process')).exec('ls -la');
}

export async function templateLiteralModuleName(): Promise<void> {
  // ruleid: bymax.js.child-process-shell-non-literal
  (await import(`child_process`)).exec(name);
}
