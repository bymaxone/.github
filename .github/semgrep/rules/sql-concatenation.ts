declare const db: any;
declare const id: string;

// ruleid: bymax.js.sql-text-built-by-interpolation
db.query('SELECT * FROM users WHERE id = ' + id);
// ruleid: bymax.js.sql-text-built-by-interpolation
db.query(`SELECT * FROM users WHERE id = ${id}`);
// ruleid: bymax.js.sql-text-built-by-interpolation
db.execute('DELETE FROM t WHERE k = ' + id, []);
// ruleid: bymax.js.sql-text-built-by-interpolation
db.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${id}`);

// ok: bymax.js.sql-text-built-by-interpolation
db.query('SELECT * FROM users WHERE id = $1', [id]);
// ok: bymax.js.sql-text-built-by-interpolation
db.query(`SELECT * FROM users`);
// ok: bymax.js.sql-text-built-by-interpolation
db.query('SELECT * FROM ' + 'users');
// ok: bymax.js.sql-text-built-by-interpolation
db.$queryRawUnsafe('SELECT 1');
