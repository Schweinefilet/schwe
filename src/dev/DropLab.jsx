import { useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { CITIES, DEFAULT_DIVE_CITY, DRIFT, HERO, SKY } from '../config.js'
import FrameDriver from '../core/FrameDriver.jsx'
import { globalUniforms } from '../core/uniforms.js'
import { quality } from '../core/quality.js'
import { rig } from '../core/rig.js'
import { loadManifest, clipUrls } from '../content/manifest.js'
import { createClipVideo, createVideoTexture, destroyClipVideo } from '../content/video.js'
import { fetchWeather } from '../content/weather.js'
import { localTimeString } from '../content/clipSelector.js'
import { skyInputs } from '../sky/inputs.js'
import { CitySky, createSkyGlobals } from '../sky/citySky.js'
import { HILLAIRE_RGB } from '../sky/spectrum.js'
import { createGpuTimer } from './gpuTimer.js'
import { isBackdropReady } from '../content/backdrop.js'
import Sky from '../scenes/Sky.jsx'
import Rain from '../scenes/Rain.jsx'
import HeroDrop from '../scenes/HeroDrop.jsx'
import Effects from '../scenes/Effects.jsx'

// Dev only: /?lab=drop. One hero drop in frozen rain, orbit with mouse or touch, so the drop can be
// judged close up without scrolling. Press S to save the current frame as still.jpg (the still
// page's image: put it in public/).
//
// Content: the city's computed sky (provisional, see SKY in config.js), or footage with ?clip=.
//   ?city=tokyo           the city (default: the default dive city)
//   ?at=2026-09-29T14:30Z  the moment (default: now, following the clock)
//   ?clip=tokyo_night_clear  show that clip instead of a sky
//   ?wl=hillaire          Hillaire's original wavelengths (680/550/440 nm), for before/after comparison
//   ?set=small            the skyline's smaller copy (SKY.skyline.sets: full, half, small; default full)
// Sliders preview extremes: cloud cover, rain, local time of day, wind. Views: orbit, drift (the drop at
// true size, posed exactly as at a drift key), dive (the dive's eye; the dive slider eases the optics).
// window.__lab drives it from scripts (scripts/sky-stills.mjs).

const params = new URLSearchParams(location.search)
const CLIP = params.get('clip')
const COEFFICIENTS = params.get('wl') === 'hillaire' ? HILLAIRE_RGB : SKY.atmosphere
const CITY = CITIES.find((c) => c.id === params.get('city')) ?? CITIES.find((c) => c.id === DEFAULT_DIVE_CITY)
const AT = parseAt(params.get('at'))
const SET = params.get('set') ?? 'full'

const R = HERO.radius
const around = (DRIFT.around[0] * Math.PI) / 180
const lookK = (DRIFT.lookToward * (3 + DRIFT.lead)) / DRIFT.lead - 1
// Camera poses with the drop at the origin (config.js builds the drift keys from the same numbers).
const VIEWS = {
  orbit: { pos: [0, 0, 6 * R], target: [0, 0, 0] },
  drift: {
    pos: [-DRIFT.pass * Math.cos(around), -DRIFT.pass * Math.sin(around), DRIFT.lead],
    target: [DRIFT.pass * Math.cos(around) * lookK, DRIFT.pass * Math.sin(around) * lookK, -3],
  },
  dive: { pos: [0, 0, 1.28 * R], target: [0, 0, 0] },
}

// Read by the panel twice a second, written by the frame loop: never React state in the frame path.
const stats = { refreshMs: null, frameMs: null, tablesMs: null, sky: null, stars: null }

export default function DropLab() {
  const [view, setView] = useState('orbit')
  const [dive, setDive] = useState(0)
  const [showPanel, setShowPanel] = useState(true) // h toggles it, for clean screenshots
  useEffect(() => void (rig.dive = dive), [dive])

  useEffect(() => {
    globalUniforms.uTimeScale.value = 0
    const onKey = (e) => {
      if (e.key === 'h' || e.key === 'H') return setShowPanel((v) => !v)
      if (e.key !== 's' && e.key !== 'S') return
      const a = document.createElement('a')
      a.download = 'still.jpg'
      a.href = document.querySelector('canvas').toDataURL('image/jpeg', 0.9)
      a.click()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <Canvas
        frameloop="never"
        dpr={[1, 2]}
        gl={{ antialias: false, preserveDrawingBuffer: true }}
        camera={{ fov: 50, near: 0.002, far: 200, position: VIEWS.orbit.pos }}
        style={{ position: 'fixed', inset: 0, touchAction: 'none' }}
      >
        <FrameDriver />
        <Sky />
        <Rain />
        {CLIP ? <ClipDrop /> : <SkyContent />}
        <OrbitControls makeDefault enableDamping minDistance={1.2 * R} maxDistance={8} />
        <ViewPose view={view} />
        <Effects />
      </Canvas>
      {!CLIP && <SkyPanel hidden={!showPanel} view={view} setView={setView} dive={dive} setDive={setDive} />}
    </>
  )
}

function ViewPose({ view }) {
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  useEffect(() => {
    if (!controls) return
    camera.position.fromArray(VIEWS[view].pos)
    controls.target.fromArray(VIEWS[view].target)
    controls.update()
  }, [view, controls, camera])
  return null
}

function ClipDrop() {
  const [slot, setSlot] = useState(null)
  useEffect(() => {
    let video = null
    let tex = null
    loadManifest().then((manifest) => {
      const entry = manifest.clips.find((c) => c.id === CLIP) ?? manifest.clips[0]
      if (!entry) return
      video = createClipVideo(clipUrls(entry))
      tex = createVideoTexture(video)
      video.play().catch(() => {})
      setSlot({ live: 1, texture: tex })
    })
    return () => {
      if (video) destroyClipVideo(video)
      tex?.dispose()
    }
  }, [])
  return <HeroDrop position={[0, 0, 0]} slot={slot} />
}

// The sky's inputs live in the panel (React state, outside the frame path); SkyContent receives them
// through `labInputs` and hands them to the CitySky, which re-renders its texture only when needed.
let labInputs = null
let applyInputs = () => {}

function SkyContent() {
  const gl = useThree((s) => s.gl)
  const [sky, setSky] = useState(null)
  const timer = useMemo(() => createGpuTimer(gl), [gl])

  useEffect(() => {
    let alive = true
    let city = null
    stats.gl = gl // dev: the renderer, for its per-frame draw counts (window.__lab.info)
    const globals = createSkyGlobals(gl, { coefficients: COEFFICIENTS })
    const q = timer?.begin()
    globals.atmosphere.init() // the per-visit tables, timed
    timer?.end(q, (ms) => (stats.tablesMs = ms))
    globals.ready.then(() => {
      if (!alive) return
      stats.stars = globals.stars
      city = new CitySky(globals, SKY.skyView[quality.name], CITY.id, { detail: SET })
      stats.sky = city
      if (labInputs) city.set(labInputs)
      applyInputs = (inputs) => city.set(inputs)
      setSky(city)
    })
    return () => {
      alive = false
      applyInputs = () => {}
      city?.dispose()
      globals.dispose()
    }
  }, [gl, timer])

  // Order each frame: poll timers, refresh the sky texture if due (timed on its own), then time the
  // whole frame from here to after the effects pass (priority 1) has drawn it.
  useFrame(() => {
    timer?.poll()
    if (!sky?.dirty) return
    const q = timer?.begin()
    sky.render(gl)
    timer?.end(q, (ms) => (stats.refreshMs = ms))
  }, -3)
  const frame = useMemo(() => ({ q: null }), [])
  useFrame(() => (frame.q = timer?.begin() ?? null), -2)
  useFrame(() => timer?.end(frame.q, (ms) => (stats.frameMs = stats.frameMs == null ? ms : stats.frameMs * 0.9 + ms * 0.1)), 2)

  return sky ? <HeroDrop position={[0, 0, 0]} sky={sky.content} dive dispersion={quality.name === 'high'} /> : null
}

function SkyPanel({ hidden, view, setView, dive, setDive }) {
  const [weather, setWeather] = useState(undefined) // undefined: loading
  const [override, setOverride] = useState({ cloud: null, rain: null, hour: null, fog: null, wind: null, windFrom: null })
  const [now, setNow] = useState(() => new Date())
  const [, tick] = useState(0)

  useEffect(() => {
    fetchWeather([CITY]).then((w) => setWeather(w[CITY.id]))
    const clock = setInterval(() => setNow(new Date()), 60000)
    const panel = setInterval(() => tick((n) => n + 1), 500)
    return () => {
      clearInterval(clock)
      clearInterval(panel)
    }
  }, [])

  const base = AT ?? now
  const date = override.hour == null ? base : atLocalHour(base, CITY.tz, override.hour)
  const inputs = useMemo(
    () => (weather === undefined ? null : skyInputs({ city: CITY, date, weather, override, sky: SKY })),
    [weather, date.getTime(), override]
  )
  useEffect(() => {
    labInputs = inputs
    if (inputs) applyInputs(inputs)
  }, [inputs])

  useEffect(() => {
    window.__lab = {
      set: ({ view: v, dive: d, ...o }) => {
        if (v) setView(v)
        if (d != null) setDive(d)
        if (Object.keys(o).length) setOverride((prev) => ({ ...prev, ...o }))
      },
      ready: () => isBackdropReady() && weather !== undefined && !!stats.sky && stats.sky.renders > 0 && !stats.sky.dirty && stats.sky.skylineSettled,
      inputs: () => inputs,
      sky: () => stats.sky, // dev: the CitySky, to read its texture back
      // dev: one frame's draw calls and triangles, summed over every render it makes (the sky, the scene,
      // the effects' passes), and the GPU memory three.js tracks.
      frameInfo: () =>
        new Promise((done) => {
          const info = stats.gl.info
          info.autoReset = false
          info.reset()
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              done({ ...info.render, ...info.memory })
              info.autoReset = true
            })
          )
        }),
    }
  })

  const live = weather && (weather.cloudCover != null || weather.mmPerHour != null)
  const source = (key) => (override[key] != null ? 'slider' : live ? 'live' : 'no data')
  const set = (key) => (e) => setOverride((o) => ({ ...o, [key]: Number(e.target.value) }))
  const hour = override.hour ?? localHour(base, CITY.tz)
  const ms = (v) => (v == null ? 'n/a' : `${v.toFixed(2)} ms`)
  const deg = (v) => `${v.toFixed(1)}°`

  return (
    <div style={hidden ? { ...panelStyle, display: 'none' } : panelStyle}>
      <div>
        {CITY.name} {localTimeString(CITY, date)} · {date.toISOString().slice(0, 16)}Z
        {inputs && (
          <>
            {' '}· sun {deg(inputs.sun.alt)} · moon {deg(inputs.moon.alt)} {Math.round(inputs.moon.fraction * 100)}% lit · faces {inputs.facing.toward}
            <br />
            cloud {Math.round(inputs.cloud * 100)}% ({source('cloud')}) · rain {inputs.rain.toFixed(1)} mm/h ({source('rain')})
            {inputs.fog ? ' · fog' : ''} · wind {inputs.wind.ms.toFixed(1)} m/s{inputs.wind.towardDeg == null ? '' : ` to ${Math.round(inputs.wind.towardDeg)}°`} ({source('wind')})
            {' '}· pre-exposure meter {inputs.metered.toPrecision(3)} cd/m²
          </>
        )}
        {weather === undefined && ' · weather loading'}
        <br />
        sky {ms(stats.refreshMs)} × {stats.sky?.renders ?? 0} · tables {ms(stats.tablesMs)} · frame {ms(stats.frameMs)} (GPU) · stars{' '}
        {stats.stars ? `${stats.stars.count} (${stats.stars.merged} merged)` : 'none'} · {quality.name}
      </div>
      <Slider label="cloud" min={0} max={1} step={0.01} value={override.cloud ?? inputs?.cloud ?? 0} onChange={set('cloud')} />
      <Slider label="rain" min={0} max={30} step={0.1} value={override.rain ?? inputs?.rain ?? 0} onChange={set('rain')} />
      <Slider label="time" min={0} max={24} step={0.05} value={hour} onChange={set('hour')} />
      <Slider label="wind" min={0} max={15} step={0.1} value={override.wind ?? inputs?.wind.ms ?? 0} onChange={set('wind')} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setOverride({ cloud: null, rain: null, hour: null, fog: null, wind: null, windFrom: null })}>live</button>
        {Object.keys(VIEWS).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{ fontWeight: v === view ? 700 : 400 }}>
            {v}
          </button>
        ))}
        <Slider label="dive" min={0} max={1} step={0.01} value={dive} onChange={(e) => setDive(Number(e.target.value))} />
      </div>
    </div>
  )
}

function Slider({ label, ...props }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ width: 36 }}>{label}</span>
      <input type="range" style={{ flex: 1, minWidth: 120 }} {...props} />
    </label>
  )
}

const panelStyle = {
  position: 'fixed',
  left: 16,
  right: 16,
  bottom: 16,
  maxWidth: 640,
  padding: 10,
  font: '12px/1.5 ui-monospace, monospace',
  color: '#fff',
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'grid',
  gap: 6,
  zIndex: 10,
}

function parseAt(value) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    console.warn('[lab] ignoring ?at, not a date:', value)
    return null
  }
  return d
}

function localHour(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value])
  )
  return Number(parts.hour) + Number(parts.minute) / 60
}

// The same day at another local hour (a DST change that day shifts it by the hour).
const atLocalHour = (base, tz, hour) => new Date(base.getTime() + (hour - localHour(base, tz)) * 3600000)
