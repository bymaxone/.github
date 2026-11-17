declare const el: HTMLElement;
declare const userInput: string;

// ruleid: bymax.js.html-injection-non-literal
el.innerHTML = userInput;
// ruleid: bymax.js.html-injection-non-literal
el.innerHTML = '<b>' + userInput + '</b>';
// ruleid: bymax.js.html-injection-non-literal
el.outerHTML = `<p>${userInput}</p>`;
// ruleid: bymax.js.html-injection-non-literal
document.write(userInput);

// ok: bymax.js.html-injection-non-literal
el.innerHTML = '<b>static</b>';
// ok: bymax.js.html-injection-non-literal
el.textContent = userInput;
// ok: bymax.js.html-injection-non-literal
document.write('<p>static</p>');
