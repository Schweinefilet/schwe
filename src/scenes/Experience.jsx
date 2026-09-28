import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
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
import Effects from './Effects.jsx'

export default function Experience({ clips }) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <FrameDriver />
      <TierDpr />
      <CameraRig />
      <Sky />
      <Rain />
      <HeroDrops clips={clips} />
      <AlignmentWord />
      <Puddle />
      <Splash />
      <Effects />
    </>
  )
}

// Pixel ratio follows the tier's cap, including a live tier drop.
function TierDpr() {
  const tier = useTier()
  const setDpr = useThree((s) => s.setDpr)
  useEffect(() => setDpr(Math.min(window.devicePixelRatio, quality.dpr)), [tier, setDpr])
  return null
}
