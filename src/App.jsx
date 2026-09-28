import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import Experience from './scenes/Experience.jsx'
import Loader from './ui/Loader.jsx'
import CityType from './ui/CityType.jsx'
import { initScroll } from './core/scroll.js'
import { state } from './core/state.js'
import { unlockAudio } from './audio/audioEngine.js'
import { detectTier, quality } from './core/quality.js'
import { loadManifest } from './content/manifest.js'
import { selectClips } from './content/clipSelector.js'
import { CAMERA_FOV, CITIES, HERO_DROPS, TIMELINE_END, VH_PER_UNIT } from './config.js'

// Dynamic import behind the DEV flag, so production builds don't include the overlay.
const DevOverlay = import.meta.env.DEV ? lazy(() => import('./dev/DevOverlay.jsx')) : null

const RESELECT_MS = 10 * 60 * 1000
const DIVE_CITY = HERO_DROPS.find((d) => d.dive).city
// Dev: ?at=2026-09-28T03:00Z pretends it is that moment, to check clip choice without changing the clock.
const AT = import.meta.env.DEV ? new URLSearchParams(location.search).get('at') : null

// Scroll distance = track height − one viewport, so add 100vh to map exactly TIMELINE_END units.
const TRACK_HEIGHT = `${TIMELINE_END * VH_PER_UNIT + 100}vh`

export default function App() {
  const scroll = useRef(null)
  const [clips, setClips] = useState(null)
  const [device, setDevice] = useState(null) // { tier, webgl } once GPU detection finishes

  useEffect(() => {
    detectTier().then(setDevice)
  }, [])

  useEffect(() => {
    scroll.current = initScroll()
    return () => scroll.current.destroy()
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
          if (import.meta.env.DEV) console.table(selection.map(({ urls, ...row }) => row))
        })
    select()
    const timer = setInterval(select, RESELECT_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
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
          <Experience clips={clips} />
        </Canvas>
      )}
      <div id="scroll-track" style={{ height: TRACK_HEIGHT }} />
      <CityType clips={clips} cityId={DIVE_CITY} />
      <div id="fade" />
      <Loader onEnter={handleEnter} />
      {DevOverlay && (
        <Suspense fallback={null}>
          <DevOverlay />
        </Suspense>
      )}
    </>
  )
}
