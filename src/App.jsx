import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Experience from './scenes/Experience.jsx'
import Loader from './ui/Loader.jsx'
import CityType from './ui/CityType.jsx'
import DropLabels from './ui/DropLabels.jsx'
import WordSketch from './ui/WordSketch.jsx'
import EndType from './ui/EndType.jsx'
import BackToTop from './ui/BackToTop.jsx'
import StillPage from './ui/StillPage.jsx'
import ScrollHint from './ui/ScrollHint.jsx'
import ProgressRail from './ui/ProgressRail.jsx'
import Captions from './ui/Captions.jsx'
import SoundToggle from './ui/SoundToggle.jsx'
import { initScroll } from './core/scroll.js'
import { startFocusPull } from './core/focus.js'
import { state } from './core/state.js'
import { unlockAudio } from './audio/audioEngine.js'
import { detectTier, quality } from './core/quality.js'
import { startPerfGuard } from './core/perfGuard.js'
import { loadManifest } from './content/manifest.js'
import { selectClips } from './content/clipSelector.js'
import { chooseDiveCity } from './content/diveChoice.js'
import { chooseRainCity } from './content/rainChoice.js'
import { fetchWeather, unknownWeather } from './content/weather.js'
import { usesFootage } from './content/contentSource.js'
import { onSkyReady } from './sky/skyManager.js'
import { onBackdropReady } from './content/backdrop.js'
import { now } from './core/clock.js'
import { CAMERA_FOV, CITIES, CONTENT, DEFAULT_DIVE_CITY, SPLASH, TIMELINE_END, TIMELINE_START, VH_PER_UNIT } from './config.js'

const NO_CLIPS = { version: 1, clips: [] }

// Dynamic import behind the DEV flag, so production builds don't include the overlay.
const DevOverlay = import.meta.env.DEV ? lazy(() => import('./dev/DevOverlay.jsx')) : null
// ?bench (production too): scripted run that measures frame times per beat and tier on a real device.
// Its own chunk, so normal visits never download it.
const Bench = new URLSearchParams(location.search).has('bench') ? lazy(() => import('./bench/Bench.jsx')) : null

const RESELECT_MS = 10 * 60 * 1000
// How long "enter" waits for the weather before the site opens without it (content/weather.js).
const WEATHER_WAIT_MS = 4000
const delay = (ms) => new Promise((resolve) => setTimeout(() => resolve(null), ms))
// Dev: ?dive=new-york forces the dive city instead of letting the world choose.
const FORCE_DIVE = import.meta.env.DEV ? new URLSearchParams(location.search).get('dive') : null
// Dev: ?rain=mumbai forces the ending to that city, ?rain=london@40 to "rain reaches London in 40 min",
// ?rain=none to the dry ending, ?rain=unknown to the ending without a weather reading.
const FORCE_RAIN = import.meta.env.DEV ? new URLSearchParams(location.search).get('rain') : null
// Dev: ?weather=tokyo:1:6,mumbai:0.3:0 sets cities' weather (cloud cover 0..1 : rain mm/h) as if read
// live, for stills and previews: the sky, the type and the rain choice all see it.
const FORCE_WEATHER = import.meta.env.DEV ? new URLSearchParams(location.search).get('weather') : null
// Dev: ?still forces the still page.
const FORCE_STILL = import.meta.env.DEV && new URLSearchParams(location.search).has('still')
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Scroll distance = track height − one viewport, so add 100vh to map exactly the timeline's units.
const TRACK_HEIGHT = `${(TIMELINE_END - TIMELINE_START) * VH_PER_UNIT + 100}vh`

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
  // With the sky as the source there are no clips: the rows carry light and weather only.
  // At load "enter" waits at most WEATHER_WAIT_MS for the weather; without it the rows say the weather
  // is unknown (the type shows times only), and the answer, when it comes, still reaches the labels and,
  // while the fall is ahead, the ending.
  useEffect(() => {
    let cancelled = false
    const manifest = usesFootage(CONTENT.source) ? loadManifest() : Promise.resolve(NO_CLIPS)
    const source = CONTENT.source
    const apply = (selection) => {
      if (cancelled) return
      if (FORCE_WEATHER) selection = forcedWeather(FORCE_WEATHER, selection)
      // A failed refresh keeps the weather already read rather than blanking it.
      const read = (rows) => rows?.some((r) => r.weatherKnown !== false)
      if (state.diveCity && !read(selection) && read(state.clips)) return
      state.clips = selection
      setClips(selection)
      // Chosen once per visit: the 10-minute reselect refreshes clips but never moves the dive.
      // The ending's rain city is chosen first so the dive can avoid it.
      if (!state.diveCity) {
        state.rainCity = FORCE_RAIN ? forcedRain(FORCE_RAIN, selection) : chooseRainCity(selection, { source })
        state.diveCity = FORCE_DIVE ?? chooseDiveCity(selection, DEFAULT_DIVE_CITY, { exclude: state.rainCity.city, source })
        setRainCity(state.rainCity)
        setDiveCity(state.diveCity)
      } else if (state.rainCity?.kind === 'unknown' && state.time < SPLASH.fallPinFrom) {
        // The weather came after "enter". The fall is still ahead, so the ending can answer after all
        // (with its city, even if that is the dive's: the truth over two different cities).
        state.rainCity = chooseRainCity(selection, { source })
        setRainCity(state.rainCity)
      }
      if (import.meta.env.DEV) console.table(selection.map(({ urls, ...row }) => row))
    }
    const select = async (wait) => {
      const m = await manifest
      const pending = fetchWeather(CITIES)
      const wx = wait ? await Promise.race([pending, delay(WEATHER_WAIT_MS)]) : await pending
      apply(await selectClips(m, CITIES, now(), wx ?? unknownWeather(CITIES)))
      if (!wx) apply(await selectClips(m, CITIES, now(), await pending))
    }
    select(true).catch((err) => {
      // Never leave the loader without "enter": fall back to the default dive city, and say nothing
      // about the weather.
      console.warn('[clips] selection failed:', err)
      if (cancelled || state.diveCity) return
      state.rainCity = { kind: 'unknown' }
      state.diveCity = DEFAULT_DIVE_CITY
      setRainCity(state.rainCity)
      setDiveCity(state.diveCity)
    })
    const timer = setInterval(() => select(false).catch((err) => console.warn('[clips] refresh failed:', err)), RESELECT_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // prefers-reduced-motion and no-WebGL visitors get the still page: a frame of the frozen rain and
  // the cities as they are right now. No scroll animation.
  if (still) return <StillPage clips={clips} rainCity={rainCity} />
  return <Site clips={clips} device={device} diveCity={diveCity} rainCity={rainCity} />
}

// "enter" waits for the backdrop to be on the GPU and, with the sky as the source, for every drawn
// city's sky to be prepared (tables, catalogue, noise, each city's texture, shaders compiled), at most
// SKY_WAIT_MS so it never hangs; anything left after that keeps preparing one piece per frame.
const SKY_WAIT_MS = 6000

function useScenePrepared() {
  const [prepared, setPrepared] = useState(false)
  useEffect(() => {
    if (prepared) return
    const waits = usesFootage(CONTENT.source) ? [onBackdropReady] : [onBackdropReady, onSkyReady]
    let left = waits.length
    const stops = waits.map((on) => on(() => --left === 0 && setPrepared(true)))
    const cap = setTimeout(() => setPrepared(true), SKY_WAIT_MS)
    return () => {
      stops.forEach((stop) => stop())
      clearTimeout(cap)
    }
  }, [prepared])
  return prepared
}

function Site({ clips, device, diveCity, rainCity }) {
  const scroll = useRef(null)
  const scenePrepared = useScenePrepared()

  useEffect(() => {
    scroll.current = initScroll({ onTop: startFocusPull })
    return () => scroll.current.destroy()
  }, [])

  const handleEnter = useCallback(() => {
    unlockAudio()
    state.unlocked = true
    scroll.current.enter()
    startFocusPull()
  }, [])

  // Back at the top the first shot plays again (initScroll's onTop).
  const handleTop = useCallback(() => scroll.current.toTop(), [])

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
      <DropLabels clips={clips} />
      <WordSketch />
      <CityType clips={clips} cityId={diveCity ?? DEFAULT_DIVE_CITY} />
      {/* The answer and the final screen share one column, so the answer never overlaps the way back. */}
      <div className="ending-ui">
        <EndType clips={clips} rainCity={rainCity} />
        <BackToTop onTop={handleTop} clips={clips} rainCity={rainCity} />
      </div>
      <Captions />
      <ScrollHint />
      <ProgressRail />
      <div id="fade" />
      <SoundToggle />
      <Loader onEnter={handleEnter} ready={diveCity !== null && scenePrepared} />
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

// Dev only: applies ?weather= to the selection rows. Labels follow the usual rain-rate classes
// (light < 2.5 mm/h, moderate to 7.6, heavy above).
function forcedWeather(param, selection) {
  const forced = Object.fromEntries(param.split(',').map((s) => s.split(':')).map(([city, cloud, rain]) => [city, { cloud: Number(cloud), rain: Number(rain ?? 0) }]))
  const label = ({ cloud, rain }) =>
    rain > 0 ? (rain >= 7.6 ? 'heavy rain' : rain >= 2.5 ? 'rain' : 'light rain') : cloud >= 0.9 ? 'overcast' : cloud > 0.2 ? 'partly cloudy' : 'clear'
  return selection.map((row) => {
    const w = forced[row.city]
    if (!w) return row
    return { ...row, cloudCover: w.cloud, mmPerHour: w.rain, weather: w.rain > 0 ? 'rain' : 'clear', weatherLabel: label(w), weatherKnown: true, code: null }
  })
}

// Dev only: builds a rain choice from ?rain=, using the selection's real data where it has it.
function forcedRain(param, selection) {
  if (param === 'none' || param === 'unknown') return { kind: param }
  const [city, minutes] = param.split('@')
  if (minutes != null) return { kind: 'soon', city, minutes: Number(minutes) }
  const row = selection.find((r) => r.city === city)
  const raining = row?.weather === 'rain'
  return { kind: 'now', city, mmPerHour: raining ? row.mmPerHour : null, label: raining ? row.weatherLabel : 'rain' }
}
