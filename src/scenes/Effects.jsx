import { useEffect, useState } from 'react'
import { Bloom, EffectComposer, LUT, Noise, Vignette } from '@react-three/postprocessing'
import { BlendFunction, LUTCubeLoader } from 'postprocessing'
import { GRADE } from '../config.js'
import { quality } from '../core/quality.js'
import { useTier } from '../core/useTier.js'

// The final pass, identical for every frame of the site, footage included: the master LUT (the same
// .cube used in Resolve), film grain and a light vignette. Bloom only catches the brightest values,
// which in this scene are drop highlights. Which effects run depends on the quality tier.
export default function Effects() {
  useTier() // re-render with the new effect list if the tier drops
  const has = (name) => quality.effects.includes(name)
  const [lut, setLut] = useState(null)

  useEffect(() => {
    if (!has('lut') || !GRADE.lut) return
    let cancelled = false
    new LUTCubeLoader().load(
      `${import.meta.env.BASE_URL}${GRADE.lut}`,
      (t) => !cancelled && setLut(t),
      undefined,
      () => console.warn('[grade] LUT not found, rendering ungraded:', GRADE.lut)
    )
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <EffectComposer multisampling={0}>
      {has('bloom') && <Bloom mipmapBlur luminanceThreshold={GRADE.bloomThreshold} luminanceSmoothing={0.1} intensity={GRADE.bloomIntensity} />}
      {lut && <LUT lut={lut} />}
      {has('grain') && <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={GRADE.grain} />}
      {has('vignette') && <Vignette offset={0.3} darkness={GRADE.vignette} />}
    </EffectComposer>
  )
}
