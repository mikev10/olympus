// I9: the compiler lib is ES2022 with no DOM. A browser global is not a name
// the runtime can see, so nothing in a contract can lean on one. TS2584 is
// the compiler's "add 'dom' to lib" hint; TS2304 is a plain unknown name.
// Only names Node's own types do not declare belong here: `navigator` and
// `localStorage` exist in @types/node 22 and are not evidence of DOM.
export const title = document.title; // expect-error TS2584: Cannot find name 'document'
export const win = window; // expect-error TS2304: Cannot find name 'window'
export const listener = addEventListener('load', () => undefined); // expect-error TS2304: Cannot find name 'addEventListener'
export const frame = requestAnimationFrame(() => undefined); // expect-error TS2304: Cannot find name 'requestAnimationFrame'
