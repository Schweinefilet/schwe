import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CONTENT } from '../config.js'
import { usesFootage } from '../content/contentSource.js'
import FrameDriver from '../core/FrameDriver.jsx'
import { quality } from '../core/quality.js'
import { useTier } from '../core/useTier.js'
import CameraRig from './CameraRig.jsx'
import Sky from './Sky.jsx'
import Rain from './Rain.jsx'
import HeroDrops from './HeroDrops.jsx'
import AlignmentWord from './AlignmentWord.jsx'
import Puddle from './Puddle.jsx'
import Splash from './Splash.jsx'
import PuddleRain from './PuddleRain.jsx'
import Effects from './Effects.jsx'
import { isSkyReady, skySettled, skyStats, startSky, updateSky } from '../sky/skyManager.js'

export default function Experience({ clips, diveCity, rainCity }) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <FrameDriver />
      {!usesFootage(CONTENT.source) && <SkyFrame />}
      <TierDpr />
      <CameraRig />
      <Sky view />
      <Rain />
      <HeroDrops clips={clips} diveCity={diveCity} />
      <AlignmentWord />
      <Puddle />
      <Splash clips={clips} rainCity={rainCity} />
      <PuddleRain />
      <Effects />
    </>
  )
}

// The city skies' per-frame work (skyManager.js): new inputs, weather easing, at most one texture.
// Runs before everything else draws.
function SkyFrame() {
  const gl = useThree((s) => s.gl)
  startSky(gl)
  useFrame((_, dt) => updateSky(gl, dt), -3)
  // Dev hooks for scripted stills and checks: whether the skies are prepared, and settled.
  if (import.meta.env.DEV) window.__schwe = Object.assign(window.__schwe ?? {}, { skySettled, skyReady: isSkyReady, skyStats })
  return null
}

// Pixel ratio follows the tier's cap, including a live tier drop.
function TierDpr() {
  const tier = useTier()
  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => setDpr(Math.min(window.devicePixelRatio, quality.dpr)), [tier, setDpr])
  return null
}
