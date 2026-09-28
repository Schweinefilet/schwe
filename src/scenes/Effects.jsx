import { EffectComposer, Noise, Vignette } from '@react-three/postprocessing'

// Final pass placeholder. The shared LUT joins grain and vignette here in the grading phase.
export default function Effects() {
  return (
    <EffectComposer multisampling={0}>
      <Noise opacity={0.04} />
      <Vignette offset={0.3} darkness={0.8} />
    </EffectComposer>
  )
}
