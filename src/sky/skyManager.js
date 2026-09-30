import { CITIES, SKY } from '../config.js'
import { quality } from '../core/quality.js'
import { now } from '../core/clock.js'
import { state } from '../core/state.js'
import { CitySky, createSkyGlobals } from './citySky.js'
import { skyInputs } from './inputs.js'

// The sky as the site's content source (CONTENT.source 'sky'). One CitySky per city whose drop is
// drawn: the visible drift drops, the dive drop and the falling drop's city. It is fed from the same
// weather rows as the rest of the site (state.clips), kept current as the sun and moon move, and
// does at most one piece of GPU work per frame (a setup step or one city's texture), so no frame
// spikes. Nothing here is React state: drops read uniforms by reference, and React hears only once,
// when everything is prepared (onSkyReady), which holds the loader's "enter".

const INPUTS_EVERY_MS = 15000 // the sun moves under 0.07° in that time; textures re-render every 0.25°
const EASE_TIME = 0.5 // seconds (time constant): a new weather reading is 98% in after 2 s, never a cut
const CITY = Object.fromEntries(CITIES.map((c) => [c.id, c]))

const skies = new Map() // city id → { sky, users, target, shown }
let globals = null
let steps = [] // per-visit setup still to do, one per frame
let loaded = false // star catalogue and cloud noise are in
let rows = undefined // the weather rows the inputs were last computed from
let lastInputs = -Infinity
let ready = false
const listeners = new Set()

// Idempotent. Builds the shared sky once; the atmosphere tables are queued, one per frame.
export function startSky(renderer) {
  if (globals) return
  globals = createSkyGlobals(renderer)
  steps = globals.atmosphere.initSteps()
  globals.ready.then(() => {
    loaded = true
    lastInputs = -Infinity // stars can now be lit
    const { uSkyStars, uSkyCloudNoise } = globals.uniforms
    for (const t of [uSkyStars.value, uSkyCloudNoise.value]) if (t) steps.push(() => renderer.initTexture(t))
  })
}

// The content a HeroDrop draws for a city (its shader code and uniforms). Creates the city's sky if
// needed; acquireSky/releaseSky mark whether its drop is drawn, which is what keeps it refreshed.
export function skyContent(cityId) {
  let entry = skies.get(cityId)
  if (!entry) {
    entry = { sky: new CitySky(globals, SKY.skyView[quality.name] ?? SKY.skyView.high, cityId), users: 0, target: null, shown: null }
    skies.set(cityId, entry)
    lastInputs = -Infinity
  }
  return entry.sky.content
}

export function acquireSky(cityId) {
  skyContent(cityId)
  skies.get(cityId).users++
}

export function releaseSky(cityId) {
  const entry = skies.get(cityId)
  if (entry) entry.users = Math.max(0, entry.users - 1)
}

// Every frame, before anything draws (Experience's SkyFrame, priority -3).
export function updateSky(renderer, dt) {
  if (!globals) return
  const step = steps.shift()
  if (step) return step()
  if (state.clips !== rows || performance.now() - lastInputs > INPUTS_EVERY_MS) readInputs()
  ease(dt)
  for (const entry of skies.values()) {
    if (entry.users > 0 && entry.sky.dirty) {
      entry.sky.render(renderer)
      break
    }
  }
  checkReady()
}

function readInputs() {
  rows = state.clips
  lastInputs = performance.now()
  const date = now()
  for (const [id, entry] of skies) {
    const row = rows?.find((r) => r.city === id) ?? null
    const weather = row && { cloudCover: row.cloudCover, mmPerHour: row.mmPerHour, code: row.code, windMs: row.windMs, windFromDeg: row.windFromDeg }
    const inputs = skyInputs({ city: CITY[id], date, weather, sky: SKY })
    entry.sky.set(inputs)
    entry.target = { ...inputs.clouds, haze: inputs.haze, rain: inputs.rain, wind: inputs.wind.ms }
    // The first real reading is shown as it is (nothing is on screen yet); later ones ease in.
    if (!entry.shown || (!entry.hadRows && rows)) entry.shown = { ...entry.target }
    entry.hadRows = !!rows
    entry.sky.setWeather(entry.shown, entry.shown.haze, entry.shown.rain, entry.shown.wind)
  }
}

function ease(dt) {
  const k = 1 - Math.exp(-Math.min(dt, 0.1) / EASE_TIME)
  for (const entry of skies.values()) {
    const { shown, target } = entry
    if (!shown || !target) continue
    let moved = false
    for (const key of ['cover', 'tau', 'baseKm', 'haze', 'rain', 'wind']) {
      const d = target[key] - shown[key]
      if (Math.abs(d) < 1e-4) continue
      shown[key] += d * k
      moved = true
    }
    if (moved) entry.sky.setWeather(shown, shown.haze, shown.rain, shown.wind)
  }
}

function checkReady() {
  if (ready || !loaded || steps.length || rows == null || !skies.size) return
  for (const entry of skies.values()) if (entry.users > 0 && (entry.sky.dirty || !entry.sky.renders)) return
  ready = true
  listeners.forEach((fn) => fn())
}

export const isSkyReady = () => ready

export function onSkyReady(fn) {
  if (ready) fn()
  else listeners.add(fn)
  return () => listeners.delete(fn)
}

// Dev: every drawn sky rendered for its current inputs and its weather eased in.
export function skySettled() {
  if (!ready) return false
  for (const { users, sky, shown, target } of skies.values()) {
    if (!users) continue
    if (sky.dirty) return false
    if (shown && target && ['cover', 'tau', 'baseKm', 'haze'].some((k) => Math.abs(shown[k] - target[k]) > 1e-3)) return false
  }
  return true
}

export const skyStats = () => ({ cities: [...skies].filter(([, e]) => e.users > 0).map(([id]) => id), renders: [...skies.values()].reduce((n, e) => n + e.sky.renders, 0) })
