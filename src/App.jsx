import { Suspense, lazy, useCallback, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import Experience from './scenes/Experience.jsx'
import Loader from './ui/Loader.jsx'
import { initScroll } from './core/scroll.js'
import { state } from './core/state.js'
import { unlockAudio } from './audio/audioEngine.js'
import { loadManifest } from './content/manifest.js'
import { selectClips } from './content/clipSelector.js'
import { CITIES, TIMELINE_END, VH_PER_UNIT } from './config.js'

// Dynamic import behind the DEV flag, so production builds don't include the overlay.
const DevOverlay = import.meta.env.DEV ? lazy(() => import('./dev/DevOverlay.jsx')) : null

// Scroll distance = track height − one viewport, so add 100vh to map exactly TIMELINE_END units.
const TRACK_HEIGHT = `${TIMELINE_END * VH_PER_UNIT + 100}vh`

export default function App() {
  const scroll = useRef(null)

  useEffect(() => {
    scroll.current = initScroll()
    return () => scroll.current.destroy()
  }, [])

  useEffect(() => {
    let cancelled = false
    loadManifest()
      .then((manifest) => selectClips(manifest, CITIES))
      .then((selection) => {
        if (cancelled) return
        state.clips = selection
        if (import.meta.env.DEV) console.table(selection.map(({ urls, ...row }) => row))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleEnter = useCallback(() => {
    unlockAudio()
    state.unlocked = true
    scroll.current.enter()
  }, [])

  return (
    <>
      <Canvas
        frameloop="never"
        dpr={[1, 2]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        camera={{ fov: 50, near: 0.02, far: 200 }}
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none' }}
      >
        <Experience />
      </Canvas>
      <div id="scroll-track" style={{ height: TRACK_HEIGHT }} />
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
