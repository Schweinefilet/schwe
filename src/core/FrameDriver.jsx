import { useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { setAdvance } from './loop.js'
import { stepSimTime } from './uniforms.js'

// Hands R3F's render call to the shared loop and integrates simulated time first each frame.
export default function FrameDriver() {
  const advance = useThree((s) => s.advance)

  useEffect(() => {
    setAdvance(advance)
    return () => setAdvance(null)
  }, [advance])

  // Negative priority: runs before every other useFrame and does not take over rendering.
  useFrame((_, delta) => stepSimTime(Math.min(delta, 0.1)), -1)

  return null
}
