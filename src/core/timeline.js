import gsap from 'gsap'
import { BEATS, DIVE, PUDDLE_RAIN, SPLASH, TIMELINE_END } from '../config.js'
import { rig } from './rig.js'
import { setTimeTarget } from './uniforms.js'
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
      // Falling at the top, frozen from the freeze, and falling again slowly once the drop meets the water.
      const again = SPLASH.rainAgain
      if (t < tl.labels.freeze) setTimeTarget(1)
      else if (t < again.at) setTimeTarget(0)
      else setTimeTarget(again.timeScale, again.seconds, 'sine.inOut')
    },
  })

  BEATS.forEach((b) => tl.addLabel(b.name, b.at))
  tl.addLabel('end', TIMELINE_END)

  // The camera reads the timeline's time directly (CameraRig + core/cameraPath.js); nothing to tween.

  // Beat 5: the dive drop's optics turn from ball lens into a plain window and back.
  tl.to(rig, { dive: 1, duration: DIVE.inEnd - DIVE.inStart, ease: 'power1.inOut' }, DIVE.inStart)
  tl.to(rig, { cityType: 1, duration: 0.25 }, DIVE.typeIn)
  tl.to(rig, { cityType: 0, duration: 0.25 }, DIVE.typeOut)
  tl.to(rig, { dive: 0, duration: DIVE.outEnd - DIVE.outStart, ease: 'power1.inOut' }, DIVE.outStart)

  // Beat 6 has nothing to animate: the word's drops are ordinary frozen rain from the first frame, and
  // the word exists only where the camera passes the eye.

  // Beat 7: time resumes for one drop. The camera turns to it and follows it down; at the water the
  // baked splash takes over, rings spread, the water settles, and the last frame holds with the answer.
  tl.to(rig, { follow: 1, duration: 0.7, ease: 'sine.inOut' }, SPLASH.fallAt - 0.1)
  tl.to(rig, { fall: 1, duration: SPLASH.impactAt - SPLASH.fallAt, ease: 'sine.in' }, SPLASH.fallAt)
  tl.to(rig, { splash: 1, duration: SPLASH.splashEnd - SPLASH.impactAt }, SPLASH.impactAt)
  tl.to(rig, { ring: 1, duration: SPLASH.ringEnd - SPLASH.ringStart }, SPLASH.ringStart)
  tl.to(rig, { endType: 1, duration: 0.3 }, SPLASH.answerAt)
  // Then the rain comes down on the puddle, a few drops at first, a downpour by PUDDLE_RAIN.full.
  tl.to(rig, { rain: 1, duration: PUDDLE_RAIN.full - PUDDLE_RAIN.from, ease: 'sine.in' }, PUDDLE_RAIN.from)
  // Its water settled, the camera's gaze leaves the hero's point for the rain across the puddle.
  tl.to(rig, { lookFree: 1, duration: TIMELINE_END - SPLASH.splashEnd, ease: 'sine.inOut' }, SPLASH.splashEnd - 0.4)
  // The hero's settled swell (its held last frame) gives way to the rain.
  tl.to(rig, { heroGone: 1, duration: 1.0, ease: 'sine.inOut' }, SPLASH.splashEnd - 0.2)

  // Pin total duration so scroll maps 1:1 to units even if the last tween ends early.
  tl.set({}, {}, TIMELINE_END)
  return tl
}
