import { useEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { Bloom, EffectComposer, LUT, Noise, SMAA, Vignette } from '@react-three/postprocessing'
import { BlendFunction, LUTCubeLoader } from 'postprocessing'
import { GRADE } from '../config.js'
import { quality } from '../core/quality.js'
import { useTier } from '../core/useTier.js'

// How long an effect a tier drop removes takes to fade out before its pass goes.
const LEAVE_SECONDS = 1.2

// The final pass, identical for every frame of the site, footage included: edge antialiasing (SMAA: the
// canvas has none of its own), the master LUT (the same .cube used in Resolve), film grain and a light
// vignette. Bloom only catches the brightest values,
// which in this scene are drop highlights. Which effects run depends on the quality tier; when a live
// tier drop removes one, it fades out first instead of switching off between two frames.
// Dev: ?nograin leaves the grain out, so before/after captures compare pixel for pixel.
const NO_GRAIN = import.meta.env.DEV && new URLSearchParams(location.search).has('nograin')

export default function Effects() {
  const tier = useTier()
  const [effects, setEffects] = useState(quality.effects)
  const has = (name) => effects.includes(name)
  const [lut, setLut] = useState(null)
  const bloom = useRef()
  const grain = useRef()

  useEffect(() => {
    const next = quality.effects
    const leaving = effects.filter((name) => !next.includes(name))
    if (!leaving.length) {
      setEffects(next)
      return
    }
    const tl = gsap.timeline({ onComplete: () => setEffects(next) })
    if (leaving.includes('bloom') && bloom.current) tl.to(bloom.current, { intensity: 0, duration: LEAVE_SECONDS, ease: 'sine.inOut' }, 0)
    if (leaving.includes('grain') && grain.current) tl.to(grain.current.blendMode.opacity, { value: 0, duration: LEAVE_SECONDS, ease: 'sine.inOut' }, 0)
    tl.set({}, {}, LEAVE_SECONDS) // the list changes after the fade even if neither ref exists
    return () => tl.kill()
  }, [tier])

  useEffect(() => {
    if (!quality.effects.includes('lut') || !GRADE.lut) return
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
      {has('smaa') && <SMAA />}
      {has('bloom') && <Bloom ref={bloom} mipmapBlur luminanceThreshold={GRADE.bloomThreshold} luminanceSmoothing={0.1} intensity={GRADE.bloomIntensity} />}
      {lut && <LUT lut={lut} />}
      {has('grain') && !NO_GRAIN && <Noise ref={grain} premultiply blendFunction={BlendFunction.SCREEN} opacity={GRADE.grain} />}
      {has('vignette') && <Vignette offset={0.3} darkness={GRADE.vignette} />}
    </EffectComposer>
  )
}
