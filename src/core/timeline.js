import gsap from 'gsap'
import { ALIGN, BEATS, CAMERA_KEYS, DIVE, TIMELINE_END } from '../config.js'
import { rig } from './rig.js'
import { setFrozen } from './uniforms.js'
import { state } from './state.js'

function beatAt(time) {
  let name = BEATS[0].name
  for (const b of BEATS) if (time >= b.at) name = b.name
  return name
}

export function buildMasterTimeline() {
  const tl = gsap.timeline({
    paused: true,
    defaults: { ease: 'none' },
    onUpdate() {
      const t = tl.time()
      state.progress = tl.progress()
      state.time = t
      state.beat = beatAt(t)
      setFrozen(t >= tl.labels.freeze)
    },
  })

  BEATS.forEach((b) => tl.addLabel(b.name, b.at))
  tl.addLabel('end', TIMELINE_END)

  // Camera: advance along the spline one key per segment.
  for (let i = 1; i < CAMERA_KEYS.length; i++) {
    const prev = CAMERA_KEYS[i - 1]
    tl.to(rig, { pathT: i, duration: CAMERA_KEYS[i].at - prev.at, ease: CAMERA_KEYS[i].ease ?? 'none' }, prev.at)
  }

  // Beat 5: the dive drop's optics turn from ball lens into a plain window and back.
  tl.to(rig, { dive: 1, duration: DIVE.inEnd - DIVE.inStart, ease: 'power1.inOut' }, DIVE.inStart)
  tl.to(rig, { cityType: 1, duration: 0.25 }, DIVE.typeIn)
  tl.to(rig, { cityType: 0, duration: 0.25 }, DIVE.typeOut)
  tl.to(rig, { dive: 0, duration: DIVE.outEnd - DIVE.outStart, ease: 'power1.inOut' }, DIVE.outStart)

  // Beat 6: the rain field recedes as the camera settles on the eye, and the word glints as it locks.
  tl.to(rig, { rainFade: 0.45, duration: ALIGN.arrive - 12 }, 12)
  tl.to(rig, { alignGlow: 1.9, duration: 0.12, ease: 'power2.out' }, ALIGN.arrive - 0.06)
  tl.to(rig, { alignGlow: 1.25, duration: 0.6, ease: 'power2.inOut' }, ALIGN.arrive + 0.06)

  // Beat 7: one drop falls, ripple spreads, fade to black.
  tl.to(rig, { dropY: 0, duration: 1.6, ease: 'power2.in' }, 'splash+=0.6')
  tl.to(rig, { ring: 1, duration: 1.8 }, 'splash+=2.2')
  tl.to('#fade', { opacity: 1, duration: 1 }, TIMELINE_END - 1)

  // Pin total duration so scroll maps 1:1 to units even if the last tween ends early.
  tl.set({}, {}, TIMELINE_END)
  return tl
}
