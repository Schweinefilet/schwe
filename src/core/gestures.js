import { STOPS } from '../config.js'

// The visitor's input, as two intents for the film (core/film.js):
//   step(dir): on to the next stop (dir 1) or back to the one before (−1)
//   hold(dir) / release(): time runs on while held; letting go comes to rest at the next stop
// - Click or tap: step on. Pressed and held (STOPS.hold ms): hold on until it lets go.
// - Swipe (touch, pen or a mouse drag): up or left steps on, down or right steps back.
// - Wheel or trackpad: one gesture is one step, however long its momentum runs on.
// - Keys: ↓ → PageDown Space Enter step on, ↑ ← PageUp Shift+Space step back; held, they hold.
//   Home and End are jumps (film.js), as is "back to top".
// Input on the page's own controls and panels (buttons, links, the sheet, the expanded weather, the
// bench) is theirs and is left alone.
const OWN = 'button, a, input, textarea, select, label, [contenteditable], [role="dialog"], .sheet, .wx-panel, .bench-panel, [data-own-input]'
const own = (target) => target instanceof Element && !!target.closest(OWN)

const SWIPE_PX = 26 // a press that travels this far is a swipe, not a tap
// Wheel: a gesture ends after QUIET ms without input. Inside one, a fresh flick (input jumping to more
// than SPIKE × the last few events' size, while a trackpad's momentum dies away) starts a new one.
const QUIET = 220
const SPIKE = 2.2
const FIRE_PX = 28 // a gesture steps once it has moved this far
const LINE_PX = 16

export function listen({ step, hold, release, jump, enabled }) {
  // ---- Pointer: tap, hold, swipe
  let press = null // { id, x, y, timer, holding, done }
  const endPress = () => {
    if (!press) return
    clearTimeout(press.timer)
    if (press.holding) release()
    press = null
  }
  const onDown = (e) => {
    if (!enabled() || !e.isPrimary || e.button !== 0 || own(e.target)) return
    endPress()
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, holding: false, done: false }
    press.timer = setTimeout(() => {
      if (!press || press.done) return
      press.holding = true
      hold(1)
    }, STOPS.hold)
  }
  const onMove = (e) => {
    if (!press || e.pointerId !== press.id || press.done || press.holding) return
    const dx = e.clientX - press.x
    const dy = e.clientY - press.y
    if (Math.hypot(dx, dy) < SWIPE_PX) return
    press.done = true
    clearTimeout(press.timer)
    const along = Math.abs(dy) >= Math.abs(dx) ? dy : dx
    step(along < 0 ? 1 : -1)
  }
  const onUp = (e) => {
    if (!press || e.pointerId !== press.id) return
    const tap = !press.done && !press.holding
    endPress()
    if (tap && enabled()) step(1)
  }
  const onCancel = (e) => {
    if (press && e.pointerId === press.id) endPress()
  }
  // A long press on a phone would otherwise open the browser's menu for the page.
  const onMenu = (e) => {
    if (press?.holding) e.preventDefault()
  }

  // ---- Wheel and trackpad
  const wheel = { last: -Infinity, sum: 0, fired: 0, recent: [] }
  const onWheel = (e) => {
    if (own(e.target)) return
    if (e.cancelable) e.preventDefault()
    if (!enabled() || e.ctrlKey) return // ctrl: a trackpad pinch
    const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? innerHeight : 1
    const d = (Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * scale
    if (!d) return
    const size = Math.abs(d)
    const recent = wheel.recent.length ? wheel.recent.reduce((a, b) => a + b, 0) / wheel.recent.length : 0
    const fresh =
      e.timeStamp - wheel.last > QUIET ||
      (wheel.fired && Math.sign(d) !== wheel.fired && size > 8) ||
      (wheel.fired && wheel.recent.length >= 3 && size > SPIKE * recent && size > 12)
    if (fresh) Object.assign(wheel, { sum: 0, fired: 0, recent: [] })
    wheel.last = e.timeStamp
    wheel.recent.push(size)
    if (wheel.recent.length > 4) wheel.recent.shift()
    if (wheel.fired) return
    wheel.sum += d
    if (Math.abs(wheel.sum) >= FIRE_PX) {
      wheel.fired = Math.sign(wheel.sum)
      step(wheel.fired)
    }
  }

  // ---- Keys
  const FORWARD = ['ArrowDown', 'ArrowRight', 'PageDown', 'Enter', ' ']
  const BACK = ['ArrowUp', 'ArrowLeft', 'PageUp']
  let keyHeld = null // the key that holds, once it repeats
  const onKey = (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || own(e.target) || !enabled()) return
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      jump(e.key === 'Home' ? -1 : 1)
      return
    }
    const dir = BACK.includes(e.key) || (e.key === ' ' && e.shiftKey) ? -1 : FORWARD.includes(e.key) ? 1 : 0
    if (!dir) return
    e.preventDefault()
    if (!e.repeat) step(dir)
    else if (!keyHeld) {
      keyHeld = e.key
      hold(dir)
    }
  }
  const onKeyUp = (e) => {
    if (keyHeld && e.key === keyHeld) {
      keyHeld = null
      release()
    }
  }
  // Leaving the page mid-hold (another window, a tab switch) lets go.
  const onBlur = () => {
    endPress()
    if (keyHeld) {
      keyHeld = null
      release()
    }
  }

  addEventListener('pointerdown', onDown)
  addEventListener('pointermove', onMove)
  addEventListener('pointerup', onUp)
  addEventListener('pointercancel', onCancel)
  addEventListener('contextmenu', onMenu)
  addEventListener('wheel', onWheel, { passive: false })
  addEventListener('keydown', onKey)
  addEventListener('keyup', onKeyUp)
  addEventListener('blur', onBlur)
  return () => {
    endPress()
    removeEventListener('pointerdown', onDown)
    removeEventListener('pointermove', onMove)
    removeEventListener('pointerup', onUp)
    removeEventListener('pointercancel', onCancel)
    removeEventListener('contextmenu', onMenu)
    removeEventListener('wheel', onWheel)
    removeEventListener('keydown', onKey)
    removeEventListener('keyup', onKeyUp)
    removeEventListener('blur', onBlur)
  }
}
