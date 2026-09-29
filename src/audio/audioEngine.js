import gsap from 'gsap'
import { AUDIO, DIVE, SPLASH, ALIGN } from '../config.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'
import { globalUniforms } from '../core/uniforms.js'

// Web Audio for every visual event. Continuous layers follow the same values the visuals read
// (uTimeScale, rig), so sound and picture can never drift apart; one-shots fire when the timeline
// crosses their moment, in either direction, so rewinding sounds too.
//
// Until licensed files exist (AUDIO.files in config), every sound is synthesized from noise and sine
// waves: placeholders, not the final mix. A file slot, once filled, replaces its synth.

let ctx = null
let master = null
let layers = null
let building = false
let lastTime = 0
const buffers = {}

// Must be called synchronously inside a user gesture (the "enter" click), or browsers keep it suspended.
export function unlockAudio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  // Older iOS Safari needs a sound started inside the gesture: play one silent sample.
  const src = ctx.createBufferSource()
  src.buffer = ctx.createBuffer(1, 1, 22050)
  src.connect(ctx.destination)
  src.start(0)
  // Synthesizing the rain loop takes tens of milliseconds on a phone: do it after the click returns.
  // Only the silent sample above has to happen inside the gesture.
  if (!layers && !building) {
    building = true
    setTimeout(build, 0)
  }
  return ctx
}

export const getAudioContext = () => ctx

// ---- Building blocks -----------------------------------------------------------------------------

function noiseBuffer(seconds, color = 'white') {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else d[i] = w
  }
  return buf
}

// Rain = broadband hiss plus thousands of tiny impacts. Baked into one loop so it costs one source.
function rainBuffer(seconds) {
  const buf = noiseBuffer(seconds)
  const d = buf.getChannelData(0)
  const sr = ctx.sampleRate
  for (let i = 0; i < d.length; i++) d[i] *= 0.35
  for (let k = 0; k < seconds * 900; k++) {
    const at = Math.floor(Math.random() * d.length)
    const amp = 0.2 + Math.random() * 0.8
    const decay = sr * (0.002 + Math.random() * 0.006)
    for (let j = 0; j < decay * 4 && at + j < d.length; j++) d[at + j] += (Math.random() * 2 - 1) * amp * Math.exp(-j / decay)
  }
  return buf
}

async function loadFile(url) {
  if (!url) return null
  if (!buffers[url]) {
    buffers[url] = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((a) => ctx.decodeAudioData(a))
      .catch((err) => {
        console.warn('[audio] file unavailable, using synth:', url, err.message)
        return null
      })
  }
  return buffers[url]
}

function loop(buffer, destination) {
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  src.connect(destination)
  src.start()
  return src
}

const setSmooth = (param, value, seconds = 0.08) => param.setTargetAtTime(value, ctx.currentTime, seconds)

// ---- Layers --------------------------------------------------------------------------------------

function build() {
  master = ctx.createGain()
  master.gain.value = AUDIO.master
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp).connect(ctx.destination)

  // Rain bed → (freeze) the same bed pitched down and low-passed into a hum. One source, two moods.
  const rainFilter = ctx.createBiquadFilter()
  rainFilter.type = 'lowpass'
  rainFilter.frequency.value = 12000
  const rainGain = ctx.createGain()
  rainGain.gain.value = 0
  rainFilter.connect(rainGain).connect(master)
  const rain = loop(rainBuffer(6), rainFilter)

  // City ambience inside the dive drop. Placeholder: a low murmur of brown noise.
  const cityFilter = ctx.createBiquadFilter()
  cityFilter.type = 'lowpass'
  cityFilter.frequency.value = 500
  const cityGain = ctx.createGain()
  cityGain.gain.value = 0
  cityFilter.connect(cityGain).connect(master)
  let city = loop(noiseBuffer(8, 'brown'), cityFilter)

  // The ending's city: its rain rises under the one falling drop (only when it is raining there now).
  // A second source on the rain bed's buffer, band-limited so it reads as nearer and heavier.
  const fallFilter = ctx.createBiquadFilter()
  fallFilter.type = 'lowpass'
  fallFilter.frequency.value = 3500
  const fallGain = ctx.createGain()
  fallGain.gain.value = 0
  fallFilter.connect(fallGain).connect(master)
  loop(rain.buffer, fallFilter)

  layers = { rain, rainFilter, rainGain, city, cityFilter, cityGain, fallFilter, fallGain }

  // Licensed files, when configured, replace the synthesized loops.
  loadFile(AUDIO.files.rain).then((b) => {
    if (!b) return
    rain.stop()
    layers.rain = loop(b, rainFilter)
  })
  const diveCity = state.diveCity // fixed before "enter" can be clicked
  loadFile(AUDIO.files.ambience?.[diveCity]).then((b) => {
    if (!b) return
    city.stop()
    city = layers.city = loop(b, cityFilter)
    cityFilter.frequency.value = 20000
  })

  const rainCity = state.rainCity?.kind === 'now' ? state.rainCity.city : null
  loadFile(rainCity && AUDIO.files.ambience?.[rainCity]).then((b) => {
    if (!b) return
    loop(b, fallFilter)
    fallFilter.frequency.value = 20000
  })

  gsap.ticker.add(update)
  document.addEventListener('visibilitychange', () => (document.hidden ? ctx.suspend() : ctx.resume()))
}

// ---- One-shots -----------------------------------------------------------------------------------

function envGain(peak, attack, release, at = ctx.currentTime) {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(peak, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + release)
  return g
}

function whoosh({ from, to, seconds, peak = 0.25 }) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(seconds + 0.1)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 1.2
  bp.frequency.setValueAtTime(from, ctx.currentTime)
  bp.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + seconds)
  const g = envGain(peak, seconds * 0.6, seconds * 0.5)
  src.connect(bp).connect(g).connect(master)
  src.start()
}

function chime(freqs, peak = 0.08, release = 3) {
  for (const [i, f] of freqs.entries()) {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = f
    o.detune.value = (Math.random() - 0.5) * 6
    const g = envGain(peak / (i + 1), 0.01, release * (1 - i * 0.15))
    o.connect(g).connect(master)
    o.start()
    o.stop(ctx.currentTime + release + 0.1)
  }
}

function thud(peak = 0.5) {
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(90, ctx.currentTime)
  o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.35)
  const g = envGain(peak, 0.005, 0.5)
  o.connect(g).connect(master)
  o.start()
  o.stop(ctx.currentTime + 0.6)
  // The splash itself: a short burst of bright noise.
  const n = ctx.createBufferSource()
  n.buffer = noiseBuffer(0.6)
  const hp = ctx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 1800
  const gn = envGain(peak * 0.35, 0.004, 0.45)
  n.connect(hp).connect(gn).connect(master)
  n.start()
}

function bloop(freq, peak = 0.1) {
  const o = ctx.createOscillator()
  o.frequency.setValueAtTime(freq, ctx.currentTime)
  o.frequency.exponentialRampToValueAtTime(freq * 0.6, ctx.currentTime + 0.8)
  const g = envGain(peak, 0.02, 1.2)
  o.connect(g).connect(master)
  o.start()
  o.stop(ctx.currentTime + 1.4)
}

async function playFileOrSynth(file, synth) {
  const b = await loadFile(file)
  if (!b) return synth()
  const src = ctx.createBufferSource()
  src.buffer = b
  src.connect(master)
  src.start()
}

// Moments in timeline units. `dir` 1 fires scrolling forward, -1 backward, 0 both ways.
const CUES = [
  { at: DIVE.inStart, dir: 1, play: () => whoosh({ from: 300, to: 2400, seconds: 0.9 }) },
  { at: DIVE.outStart, dir: 1, play: () => whoosh({ from: 2400, to: 300, seconds: 0.8 }) },
  { at: DIVE.outEnd, dir: -1, play: () => whoosh({ from: 300, to: 2400, seconds: 0.9 }) },
  // The word gets a faint shimmer, not an announcement: it is meant to be found.
  { at: ALIGN.chimeAt, dir: 1, play: () => playFileOrSynth(AUDIO.files.align, () => chime([1567.98, 2093], 0.018, 2.2)) },
  { at: SPLASH.fallAt, dir: 1, play: () => whoosh({ from: 180, to: 90, seconds: 1.6, peak: 0.12 }) },
  { at: SPLASH.impactAt, dir: 0, play: () => playFileOrSynth(AUDIO.files.splash, () => thud()) },
  { at: SPLASH.ringStart, dir: 1, play: () => bloop(220) },
  { at: SPLASH.ringStart + 0.35, dir: 1, play: () => bloop(180, 0.07) },
  { at: SPLASH.ringStart + 0.75, dir: 1, play: () => bloop(150, 0.05) },
  { at: SPLASH.answerAt, dir: 1, play: () => chime([392, 587.33], 0.04, 2.5) },
]

// ---- Per frame -----------------------------------------------------------------------------------

function update() {
  if (!ctx || ctx.state !== 'running') return
  const t = state.time
  const ts = globalUniforms.uTimeScale.value

  // Rain → hum. Level also dips while inside the city (it gives way to the ambience) and fades out
  // with the ending.
  const fadeOut = 1 - Math.min(1, Math.max(0, (t - SPLASH.fadeStart) / 0.8))
  const started = state.unlocked ? 1 : 0
  const inCity = rig.dive
  setSmooth(layers.rainGain.gain, started * fadeOut * (1 - 0.85 * inCity) * (0.18 + 0.22 * ts))
  setSmooth(layers.rain.playbackRate, 0.12 + 0.88 * ts)
  setSmooth(layers.rainFilter.frequency, 180 + 11800 * ts * ts)

  // City: only while the drop fills the screen.
  setSmooth(layers.cityGain.gain, fadeOut * inCity * AUDIO.cityLevel)

  // Ending: the rain city's rain rises with the fall and gives way to the splash.
  const raining = state.rainCity?.kind === 'now' ? 1 : 0
  setSmooth(layers.fallGain.gain, raining * fadeOut * rig.fall * (1 - 0.6 * rig.splash) * AUDIO.cityLevel)

  // Cues: fire those whose moment lies between the last frame's time and this one.
  if (t !== lastTime) {
    const forward = t > lastTime
    const lo = Math.min(t, lastTime)
    const hi = Math.max(t, lastTime)
    if (hi - lo < 1.5) {
      // A big jump (e.g. a reload deep in the page) skips cues rather than firing them all at once.
      for (const c of CUES) {
        if (c.at > lo && c.at <= hi && (c.dir === 0 || (c.dir === 1) === forward)) c.play()
      }
    }
    lastTime = t
  }
}
