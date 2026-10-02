// How the visitor moves through the film, in the words the UI uses for it: a phone or tablet swipes, a
// mouse or trackpad scrolls.
export const TOUCH = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches
export const VERB = TOUCH ? 'swipe' : 'scroll'
