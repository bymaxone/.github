import crypto, { createHash } from 'node:crypto';

// ruleid: bymax.js.weak-hash-md5-sha1
createHash('md5');
// ruleid: bymax.js.weak-hash-md5-sha1
crypto.createHash('sha1').update('x');

// ok: bymax.js.weak-hash-md5-sha1
createHash('sha256');
// ok: bymax.js.weak-hash-md5-sha1
crypto.createHash('sha512');
// ok: bymax.js.weak-hash-md5-sha1
crypto.createHash('sha3-256');
