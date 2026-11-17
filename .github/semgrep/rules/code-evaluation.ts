declare const input: string;
declare const fn: () => void;

// ruleid: bymax.js.code-evaluation-non-literal
eval(input);
// ruleid: bymax.js.code-evaluation-non-literal
new Function(input);
// ruleid: bymax.js.code-evaluation-non-literal
new Function('a', input);
// ruleid: bymax.js.code-evaluation-non-literal
setTimeout('run(' + input + ')', 10);
// ruleid: bymax.js.code-evaluation-non-literal
setInterval(`run(${input})`, 10);
// ruleid: bymax.js.code-evaluation-non-literal
setTimeout('run()', 10);

// ok: bymax.js.code-evaluation-non-literal
eval('1 + 1');
// ok: bymax.js.code-evaluation-non-literal
new Function('a', 'b', 'return a + b');
// ok: bymax.js.code-evaluation-non-literal
setTimeout(fn, 10);
// ok: bymax.js.code-evaluation-non-literal
setInterval(() => fn(), 10);
// ok: bymax.js.code-evaluation-non-literal
JSON.parse(input);
