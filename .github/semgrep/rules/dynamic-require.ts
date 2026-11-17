declare const name: string;
declare const require: (id: string) => unknown;

// ruleid: bymax.js.dynamic-module-load-non-literal
require(name);
// ruleid: bymax.js.dynamic-module-load-non-literal
require('./plugins/' + name);
// ruleid: bymax.js.dynamic-module-load-non-literal
import(name);
// ruleid: bymax.js.dynamic-module-load-non-literal
import(`./plugins/${name}`);

// ok: bymax.js.dynamic-module-load-non-literal
require('node:path');
// ok: bymax.js.dynamic-module-load-non-literal
import('./lazy.js');
const allowed: Record<string, () => unknown> = {};
// ok: bymax.js.dynamic-module-load-non-literal
allowed[name]?.();
