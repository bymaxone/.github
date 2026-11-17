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

// The algorithm name is not case-sensitive in Node, and sha-1 is an accepted spelling.
// ruleid: bymax.js.weak-hash-md5-sha1
createHash('MD5');
// ruleid: bymax.js.weak-hash-md5-sha1
crypto.createHash('SHA1');
// ruleid: bymax.js.weak-hash-md5-sha1
createHash("sha-1");
// ruleid: bymax.js.weak-hash-md5-sha1
crypto.createHash('RSA-SHA1');

// ok: bymax.js.weak-hash-md5-sha1
createHash('SHA256');
// ok: bymax.js.weak-hash-md5-sha1
createHash('sha-512');
