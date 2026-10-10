// How the visitor moves through the film, in the words the UI uses for it: a phone or tablet taps, a
// mouse or trackpad clicks (core/gestures.js; swipes, the wheel and the keys work as well).
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches
export const VERB = TOUCH ? 'tap' : 'click'
