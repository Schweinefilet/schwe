import { Suspense } from 'react'
import FrameDriver from '../core/FrameDriver.jsx'
import CameraRig from './CameraRig.jsx'
import Rain from './Rain.jsx'
import HeroDrops from './HeroDrops.jsx'
import AlignmentWord from './AlignmentWord.jsx'
import Puddle from './Puddle.jsx'
import Effects from './Effects.jsx'

export default function Experience() {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <FrameDriver />
      <CameraRig />
      <Rain />
      <HeroDrops />
      <Suspense fallback={null}>
        <AlignmentWord />
      </Suspense>
      <Puddle />
      <Effects />
    </>
  )
}
