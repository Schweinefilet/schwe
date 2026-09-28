import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Experience from './scenes/Experience.jsx'
import Loader from './ui/Loader.jsx'
import CityType from './ui/CityType.jsx'
import EndType from './ui/EndType.jsx'
import StillPage from './ui/StillPage.jsx'
import { initScroll } from './core/scroll.js'
import { state } from './core/state.js'
import { unlockAudio } from './audio/audioEngine.js'
import { detectTier, quality } from './core/quality.js'
import { startPerfGuard } from './core/perfGuard.js'
import { loadManifest } from './content/manifest.js'
import { selectClips } from './content/clipSelector.js'
import { chooseDiveCity } from './content/diveChoice.js'
import { chooseRainCity } from './content/rainChoice.js'
import { CAMERA_FOV, CITIES, DEFAULT_DIVE_CITY, TIMELINE_END, VH_PER_UNIT } from './config.js'

// Dynamic import behind the DEV flag, so production builds don't include the overlay.
const DevOverlay = import.meta.env.DEV ? lazy(() => import('./dev/DevOverlay.jsx')) : null
// ?bench (production too): scripted run that measures frame times per beat and tier on a real device.
// Its own chunk, so normal visits never download it.
const Bench = new URLSearchParams(location.search).has('bench') ? lazy(() => import('./bench/Bench.jsx')) : null

const RESELECT_MS = 10 * 60 * 1000
// Dev: ?at=2026-09-28T03:00Z pretends it is that moment, to check clip choice without changing the clock.
const AT = import.meta.env.DEV ? new URLSearchParams(location.search).get('at') : null
// Dev: ?dive=new-york forces the dive city instead of letting the world choose.
const FORCE_DIVE = import.meta.env.DEV ? new URLSearchParams(location.search).get('dive') : null
// Dev: ?rain=mumbai forces the ending to that city, ?rain=london@40 to "rain reaches London in 40 min",
// ?rain=none to the dry ending.
const FORCE_RAIN = import.meta.env.DEV ? new URLSearchParams(location.search).get('rain') : null
// Dev: ?still forces the still page.
const FORCE_STILL = import.meta.env.DEV && new URLSearchParams(location.search).has('still')
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Scroll distance = track height − one viewport, so add 100vh to map exactly TIMELINE_END units.
const TRACK_HEIGHT = `${TIMELINE_END * VH_PER_UNIT + 100}vh`

export default function App() {
  const [clips, setClips] = useState(null)
  const [diveCity, setDiveCity] = useState(null)
  const [rainCity, setRainCity] = useState(null)
  const [device, setDevice] = useState(null) // { tier, webgl } once GPU detection finishes
  const still = FORCE_STILL || REDUCED_MOTION || device?.webgl === false

  useEffect(() => {
    if (FORCE_STILL || REDUCED_MOTION) return
    let stop = null
    let cancelled = false
    detectTier().then((d) => {
      if (cancelled) return
      setDevice(d)
      if (d.webgl) stop = startPerfGuard()
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  // Clip selection runs at load and every ten minutes (bible), so light and weather stay current.
  useEffect(() => {
    let cancelled = false
    const manifest = loadManifest()
    const select = () =>
      manifest
        .then((m) => selectClips(m, CITIES, AT ? new Date(AT) : new Date()))
        .then((selection) => {
          if (cancelled) return
          state.clips = selection
          setClips(selection)
          // Chosen once per visit: the 10-minute reselect refreshes clips but never moves the dive.
          // The ending's rain city is chosen first so the dive can avoid it.
          if (!state.diveCity) {
            state.rainCity = FORCE_RAIN ? forcedRain(FORCE_RAIN, selection) : chooseRainCity(selection)
            state.diveCity = FORCE_DIVE ?? chooseDiveCity(selection, DEFAULT_DIVE_CITY, { exclude: state.rainCity.city })
            setRainCity(state.rainCity)
            setDiveCity(state.diveCity)
          }
          if (import.meta.env.DEV) console.table(selection.map(({ urls, ...row }) => row))
        })
        .catch((err) => {
          // Never leave the loader without "enter": fall back to the default dive city.
          console.warn('[clips] selection failed:', err)
          if (cancelled || state.diveCity) return
          state.rainCity = { kind: 'none' }
          state.diveCity = DEFAULT_DIVE_CITY
          setRainCity(state.rainCity)
          setDiveCity(state.diveCity)
        })
    select()
    const timer = setInterval(select, RESELECT_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // prefers-reduced-motion and no-WebGL visitors get the still page: a frame of the frozen rain and
  // the cities as they are right now. No scroll animation.
  if (still) return <StillPage clips={clips} />
  return <Site clips={clips} device={device} diveCity={diveCity} rainCity={rainCity} />
}

function Site({ clips, device, diveCity, rainCity }) {
  const scroll = useRef(null)

  useEffect(() => {
    scroll.current = initScroll()
    return () => scroll.current.destroy()
  }, [])

  const handleEnter = useCallback(() => {
    unlockAudio()
    state.unlocked = true
    scroll.current.enter()
  }, [])

  return (
    <>
      {device?.webgl && (
        <Canvas
          frameloop="never"
          dpr={[1, quality.dpr]}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          camera={{ fov: CAMERA_FOV, near: 0.02, far: 200 }}
          style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
        >
          <Experience clips={clips} diveCity={diveCity ?? DEFAULT_DIVE_CITY} rainCity={rainCity} />
        </Canvas>
      )}
      <div id="scroll-track" style={{ height: TRACK_HEIGHT }} />
      <CityType clips={clips} cityId={diveCity ?? DEFAULT_DIVE_CITY} />
      <EndType clips={clips} rainCity={rainCity} />
      <div id="fade" />
      <Loader onEnter={handleEnter} ready={diveCity !== null} />
      {DevOverlay && (
        <Suspense fallback={null}>
          <DevOverlay />
        </Suspense>
      )}
      {Bench && (
        <Suspense fallback={null}>
          <Bench scroll={scroll} />
        </Suspense>
      )}
    </>
  )
}

// Dev only: builds a rain choice from ?rain=, using the selection's real data where it has it.
function forcedRain(param, selection) {
  if (param === 'none') return { kind: 'none' }
  const [city, minutes] = param.split('@')
  if (minutes != null) return { kind: 'soon', city, minutes: Number(minutes) }
  const row = selection.find((r) => r.city === city)
  const raining = row?.weather === 'rain'
  return { kind: 'now', city, mmPerHour: raining ? row.mmPerHour : null, label: raining ? row.weatherLabel : 'rain' }
}
