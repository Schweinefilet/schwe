import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import FrameDriver from '../core/FrameDriver.jsx'
import { globalUniforms } from '../core/uniforms.js'
import { loadManifest, clipUrls } from '../content/manifest.js'
import { createClipVideo, createVideoTexture, destroyClipVideo } from '../content/video.js'
import Sky from '../scenes/Sky.jsx'
import Rain from '../scenes/Rain.jsx'
import HeroDrop from '../scenes/HeroDrop.jsx'
import Effects from '../scenes/Effects.jsx'

// Dev only: /?lab=drop. One hero drop in frozen rain, orbit with mouse or touch, so the drop can be
// judged close up without scrolling. ?clip=tokyo_night_clear picks the clip (default: first found).
export default function DropLab() {
  const [slot, setSlot] = useState(null)

  useEffect(() => {
    globalUniforms.uTimeScale.value = 0
    let video = null
    let tex = null
    loadManifest().then((manifest) => {
      const want = new URLSearchParams(location.search).get('clip')
      const entry = manifest.clips.find((c) => c.id === want) ?? manifest.clips[0]
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

  return (
    <Canvas
      frameloop="never"
      dpr={[1, 2]}
      gl={{ antialias: false }}
      camera={{ fov: 50, near: 0.01, far: 200, position: [0, 0, 1.1] }}
      style={{ position: 'fixed', inset: 0, touchAction: 'none' }}
    >
      <FrameDriver />
      <Sky />
      <Rain />
      <HeroDrop position={[0, 0, 0]} slot={slot} />
      <OrbitControls target={[0, 0, 0]} enableDamping minDistance={0.22} maxDistance={8} />
      <Effects />
    </Canvas>
  )
}
