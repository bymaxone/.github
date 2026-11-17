import https from 'node:https';

// ruleid: bymax.js.tls-verification-disabled
https.request({ host: 'a', rejectUnauthorized: false });
// ruleid: bymax.js.tls-verification-disabled
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// ruleid: bymax.js.tls-verification-disabled
process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

// ok: bymax.js.tls-verification-disabled
https.request({ host: 'a', rejectUnauthorized: true });
// ok: bymax.js.tls-verification-disabled
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
// ok: bymax.js.tls-verification-disabled
https.request({ host: 'a' });
