import gsap from 'gsap'
import { ALIGN, BEATS, CAMERA_KEYS, DIVE, SPLASH, TIMELINE_END } from '../config.js'
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
  tl.to(rig, { wordReveal: 1, duration: 0.6, ease: 'sine.inOut' }, 11.9) // joins while the camera is well off-axis
  tl.to(rig, { rainFade: 0.45, duration: ALIGN.arrive - 12 }, 12)
  tl.to(rig, { alignGlow: 1.9, duration: 0.12, ease: 'power2.out' }, ALIGN.arrive - 0.06)
  tl.to(rig, { alignGlow: 1.25, duration: 0.6, ease: 'power2.inOut' }, ALIGN.arrive + 0.06)

  // Beat 7: time resumes for one drop. The camera turns to it and follows it down; at the water the
  // baked splash takes over, rings spread, and everything fades to black.
  tl.to(rig, { follow: 1, duration: 0.7, ease: 'sine.inOut' }, SPLASH.fallAt - 0.1)
  tl.to(rig, { fall: 1, duration: SPLASH.impactAt - SPLASH.fallAt, ease: 'sine.in' }, SPLASH.fallAt)
  tl.to(rig, { splash: 1, duration: SPLASH.splashEnd - SPLASH.impactAt }, SPLASH.impactAt)
  tl.to(rig, { ring: 1, duration: SPLASH.ringEnd - SPLASH.ringStart }, SPLASH.ringStart)
  tl.to(rig, { endType: 1, duration: 0.3 }, SPLASH.answerAt)
  tl.to('#fade', { opacity: 1, duration: TIMELINE_END - SPLASH.fadeStart }, SPLASH.fadeStart)

  // Pin total duration so scroll maps 1:1 to units even if the last tween ends early.
  tl.set({}, {}, TIMELINE_END)
  return tl
}
