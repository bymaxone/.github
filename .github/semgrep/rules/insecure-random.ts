const user: Record<string, unknown> = {};

// ruleid: bymax.js.math-random-secret
const token = Math.random().toString(36).slice(2);
// ruleid: bymax.js.math-random-secret
let sessionId = 'sess-' + Math.random();
// ruleid: bymax.js.math-random-secret
user.nonce = Math.random();
// ruleid: bymax.js.math-random-secret
export const body = { password: Math.random().toString(16) };

// ok: bymax.js.math-random-secret
const jitter = Math.random() * 100;
// ok: bymax.js.math-random-secret
const delay = 1000 + Math.random() * 250;
// ok: bymax.js.math-random-secret
const tokenValue = crypto.randomUUID();
// ok: bymax.js.math-random-secret
const width = Math.random();
