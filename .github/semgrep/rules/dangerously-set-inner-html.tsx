declare const userInput: string;

// ruleid: bymax.js.dangerously-set-inner-html-non-literal
export const a = <div dangerouslySetInnerHTML={{ __html: userInput }} />;

// ok: bymax.js.dangerously-set-inner-html-non-literal
export const b = <div dangerouslySetInnerHTML={{ __html: '<b>static</b>' }} />;
// ok: bymax.js.dangerously-set-inner-html-non-literal
export const c = <div>{userInput}</div>;
