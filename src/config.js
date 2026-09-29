import cities from './content/cities.json'

export const CITIES = cities

// ---- Scroll ----------------------------------------------------------------
// Timeline time is measured in "units". One unit = VH_PER_UNIT of scroll distance.
export const VH_PER_UNIT = 100
export const FREEZE_SECONDS = 1.5 // real time for uTimeScale to ease 1 → 0 (and back on rewind)
export const ENTER_SCROLL_SECONDS = 2.4 // auto-scroll from the loader pose to the rain beat after "enter"

// The seven beats, in order. `at` is the label position in timeline units.
export const BEATS = [
  { name: 'loader', at: 0 },
  { name: 'rain', at: 1 },
  { name: 'freeze', at: 1.08 }, // just past rain, so the first scroll triggers the freeze
  { name: 'drift', at: 2.5 },
  { name: 'dive', at: 8 },
  { name: 'align', at: 11.5 },
  { name: 'splash', at: 13.3 }, // SPLASH_AT; the camera passes the word's eye at 13 without stopping
]
const SPLASH_AT = 13.3 // beat 7 timings below are offsets from this
export const TIMELINE_END = SPLASH_AT + 4.5

// ---- Scene layout (world units, camera travels toward -z) ----------------
// Drop count comes from the quality tier (core/quality.js).
export const RAIN = {
  boxSize: [24, 18, 30], // the field repeats every box; it is centered ahead of the camera
  boxLead: 0.3, // how far ahead of the camera the box center sits, as a fraction of its depth
  speed: [9, 14], // units per simulated second, min/max
  radius: [0.01, 0.03], // world units
  shutter: 1 / 50, // motion-blur length in seconds; streak length = speed × shutter × uTimeScale
  wind: [0.12, 0.04], // horizontal drift per unit of fall
  fogDensity: 0.045,
  lensGain: 30, // brightness of the street glow seen through a frozen bead
  reflGain: 8,
  spec: 3,
  streakColor: [0.55, 0.6, 0.66],
}

export const HERO = {
  radius: 0.03, // the largest ordinary rain bead (RAIN.radius): a city drop is a normal drop
  ior: 1.333,
  dispersion: 0.0035, // water's real red-to-blue IOR spread; high tier only
  clipFov: 60, // horizontal field of view the clip is assumed to cover, in degrees
  exposure: 1.0,
  reflGain: 4,
  glint: 2,
  envOnlyGain: 14, // the falling drop has no clip: it shows the street glow, as bright as a rain bead's
  envOnlyGlint: 6,
}
// Beat 4, a macro dolly. Hero drops are ordinary-sized, so a city only shows up close: the camera
// passes each drop DRIFT.pass from its centre, easing as it goes by, head turned slightly toward it.
// Drops sit mostly above and below the path (angles in DRIFT.around), so they stay in frame on
// portrait phones, whose horizontal view is narrow. One drop per city; lower tiers show fewer.
export const DRIFT = {
  start: 2.5, // timeline units
  end: 8,
  y: 4.45, // camera height through the drift
  zFirst: 5, // first drop; the rest follow every zStep toward -z
  zStep: 4.5,
  pass: 0.12, // distance from the camera line to each drop's centre (4 radii)
  lead: 0.4, // camera key sits this far before each drop: its city then fills ~1/7 of the frame height
  around: [60, 240, 120, 300], // offset direction per drop, degrees (0 = right, 90 = up), cycled
  ease: 0.5, // camera speed at each drop relative to its average (1 = no easing)
  lookToward: 0.3, // 0 look straight ahead, 1 look straight at the drop as it passes
}
const DRIFT_DROPS = 9 // the tenth drop is the dive drop, placed separately below
const driftDrop = (i) => {
  const a = (DRIFT.around[i % DRIFT.around.length] * Math.PI) / 180
  return [DRIFT.pass * Math.cos(a), DRIFT.y + DRIFT.pass * Math.sin(a), DRIFT.zFirst - i * DRIFT.zStep]
}
const DIVE_DROP_POS = [0.05, DRIFT.y, DRIFT.zFirst - (DRIFT_DROPS + 0.1) * DRIFT.zStep]
const HERO_POSITIONS = [...Array.from({ length: DRIFT_DROPS }, (_, i) => driftDrop(i)), DIVE_DROP_POS]
export const DIVE_DROP_INDEX = 9
export const DEFAULT_DIVE_CITY = CITIES[DIVE_DROP_INDEX].id
// The dive city is chosen per visit (content/diveChoice.js). It swaps into the dive slot with the
// city that was there; positions and the camera path never change.
export function heroDropsFor(diveCity) {
  const order = CITIES.map((c) => c.id)
  const from = order.indexOf(diveCity)
  if (from >= 0) [order[from], order[DIVE_DROP_INDEX]] = [order[DIVE_DROP_INDEX], order[from]]
  return HERO_POSITIONS.map((pos, i) => ({ pos, city: order[i % order.length], dive: i === DIVE_DROP_INDEX }))
}
const D = HERO_POSITIONS[DIVE_DROP_INDEX]

export const CAMERA_FOV = 50 // vertical, degrees

// Beat 6. From `eye` looking at `target`, the scattered drops spell `text`.
// The word's drops are ordinary frozen rain: present from the start, rain-sized, shaded and faded
// exactly like the field. Each sits somewhere along the sight line from one eye point through a point
// of a letter, spread from near to far, so only from that eye do they line up into the word. The
// camera passes through the eye (slowing, never stopping) and the parallax scatters it again.
// The word's axis is turned ALIGN.yaw off the drift line, so the drift and dive see its drops from the
// side, spread across the view like rain, instead of looking down the axis at a clump.
const ALIGN_YAW = 40 // degrees, to the left of the drift direction (-z)
const yaw = (ALIGN_YAW * Math.PI) / 180
const AXIS = { fwd: [-Math.sin(yaw), 0, -Math.cos(yaw)], right: [Math.cos(yaw), 0, -Math.sin(yaw)] }
// A point given in the word's frame (x right, y up, z back toward the viewer) relative to `origin`.
const inWordFrame = (origin, [x, y, z]) => [
  origin[0] + AXIS.right[0] * x - AXIS.fwd[0] * z,
  origin[1] + y,
  origin[2] + AXIS.right[2] * x - AXIS.fwd[2] * z,
]
// 3 units left of the drift line: the word's nearest drops stay beyond visibleWithin from the dive.
const EYE = [-3, 4.8, -41]
export const ALIGN = {
  text: 'schwe',
  eye: EYE,
  target: inWordFrame(EYE, [0, 0, -19]),
  fov: CAMERA_FOV,
  depth: [2, 9], // drops sit at a distance from the eye in this range
  // Word drops fade out beyond this distance from the camera (from, to). Far rain is sub-pixel specks,
  // so a few missing is invisible, but seen from afar the word's drops would bunch into a dense band.
  visibleWithin: [7, 9], // the dive's closest approach to the word's drops is 9.4
  depthPower: 1, // density along each sight line ∝ depth^power: 1 keeps more drops near, where they read
  widthFrac: 0.42, // word width as a share of the screen width…
  maxHeightFrac: 0.28, // …unless that would make it taller than this share of the screen height
  beadAngle: 0.0032, // target bead radius as seen from the eye (≈2.5 px at 720p); radii stay within RAIN.radius
  count: { high: 450, medium: 325, low: 225 }, // sparse: found, not announced
  fallDepth: 9.4, // distance from the eye of the one drop that falls in beat 7 (puddle is below it)
  arrive: 13, // camera passes the eye
  passSpeed: 0.45, // camera speed at the eye relative to its average: a slow pass, not a stop
}
// Beat 7. One drop of the word falls into a puddle on the ground (y = 0) directly below it.
// The splash is a Mantaflow sim baked to a vertex animation texture (blender/splash/bake_splash.py).
export const SPLASH = {
  url: 'splash/', // splash.json + PNGs, relative to the site root
  loadAfter: 3.5, // timeline time at which the splash data starts downloading (during the drift)
  fallRadius: 0.03, // world radius of the falling drop; the sim is scaled to match its drop
  fallAt: SPLASH_AT + 0.1, // time resumes for this one drop
  impactAt: SPLASH_AT + 2.5, // it reaches the water; the VAT takes over
  splashEnd: SPLASH_AT + 4.0, // last VAT frame
  ringStart: SPLASH_AT + 2.8,
  ringEnd: SPLASH_AT + 4.5,
  fadeStart: SPLASH_AT + 3.7,
  answerAt: SPLASH_AT + 3.0, // the ending's type fades in as the rings spread; it leaves with the fade
  fallPinFrom: 12.4, // the falling drop's clip starts decoding after the dive drop's pin ends (12)
  groundY: 0,
  puddleSize: 80, // the wet ground, fading into darkness with distance
}
// Water look shared by the splash and the puddle (water.glsl).
export const WATER = { reflGain: 4, deep: [0.004, 0.006, 0.009], transGain: 2 }

// Where the falling drop starts until the word is laid out (AlignmentWord replaces it with the exact
// word sample it picks, fallDepth along the axis, just below its middle). The impact point is below.
export const FALL_START_DEFAULT = inWordFrame(EYE, [0, -0.2, -ALIGN.fallDepth])
const FALL = FALL_START_DEFAULT
const FALL_GROUND = [FALL[0], 0, FALL[2]]

// Camera waypoints. Position and look target are smooth functions of timeline time through these
// keys (core/cameraPath.js): velocity is continuous everywhere and never overshoots. `speed` below 1
// eases the camera as it passes a key without stopping. Two identical consecutive keys are an exact
// hold, entered and left at rest.
const R = HERO.radius
const { eye: ALIGN_EYE, target: ALIGN_TARGET, arrive: ALIGN_AT } = ALIGN
export const DIVE_EYE = [D[0], D[1], D[2] + 1.28 * R] // close enough that the drop covers every screen corner
export const DIVE_DROP = D
// Look targets in the dive sit far behind the drop on the same line: aiming at the drop's centre,
// only 1.28 radii away, would swing the view at the slightest movement.
const DIVE_AIM = [D[0], D[1], D[2] - 6]

// One key per drift drop: the camera on its line, DRIFT.lead before the drop, looking ahead and
// partly toward it.
const driftKeys = HERO_POSITIONS.slice(0, DRIFT_DROPS).map((drop, i) => {
  const pos = [0, DRIFT.y, drop[2] + DRIFT.lead]
  const reach = (3 + DRIFT.lead) / DRIFT.lead // extends the camera→drop ray to 3 units past the drop
  const k = DRIFT.lookToward * reach
  return {
    at: DRIFT.start + ((i + 1) * (DRIFT.end - DRIFT.start)) / (DRIFT_DROPS + 1),
    pos,
    look: [(drop[0] - pos[0]) * k, pos[1] + (drop[1] - pos[1]) * k, drop[2] - 3],
    speed: DRIFT.ease,
  }
})

export const CAMERA_KEYS = [
  { at: 0,    pos: [0, 16, 16],                          look: [0, 24, -20] },           // loader: high, facing dark sky
  { at: 1,    pos: [0, 5, 14],                           look: [0, 4, 0] },              // rain
  { at: 1.08, pos: [0, 5, 13.9],                         look: [0, 4, 0] },              // freeze
  { at: DRIFT.start, pos: [0, DRIFT.y, 10],              look: [0, DRIFT.y, 0] },        // drift start
  ...driftKeys,
  { at: 8,    pos: [D[0] + 0.08, D[1] + 0.04, D[2] + 2.5], look: DIVE_AIM },             // dive: approach, the drop a bead dead ahead
  { at: 9.4,  pos: DIVE_EYE,                             look: DIVE_AIM },               // drop fills the frame
  { at: 10.6, pos: DIVE_EYE,                             look: DIVE_AIM },               // inside the city
  { at: 11.5, pos: [D[0] - 1.6, D[1] + 0.6, D[2] + 1.8], look: DIVE_AIM },               // pulled back out, off the word's axis
  // Swing in from the side and from above: parallax keeps the word scrambled until the last stretch,
  // and seen from above its drops spread out instead of lining up into a flat strip.
  { at: 12.3, pos: inWordFrame(ALIGN_EYE, [-2.4, 1.8, 3.2]), look: inWordFrame(ALIGN_TARGET, [-1.5, 0, 0]) },
  { at: ALIGN_AT, pos: ALIGN_EYE,                        look: ALIGN_TARGET, speed: ALIGN.passSpeed }, // the word, for a moment
  // Beat 7: follow the falling drop down to a low, close view of the water. The look target is
  // blended onto the drop itself (rig.follow), so these keys only set where the camera stands.
  { at: SPLASH_AT + 0.9, pos: inWordFrame(FALL_GROUND, [0.5, 3.1, 3.6]),   look: ALIGN_TARGET },
  { at: SPLASH_AT + 1.8, pos: inWordFrame(FALL_GROUND, [0.4, 0.9, 1.2]),   look: inWordFrame(FALL_GROUND, [0, 0.4, 0]) },
  { at: SPLASH_AT + 2.5, pos: inWordFrame(FALL_GROUND, [0.28, 0.24, 0.8]), look: inWordFrame(FALL_GROUND, [0, 0.05, 0]) }, // impact
  { at: TIMELINE_END, pos: inWordFrame(FALL_GROUND, [0.2, 0.19, 0.6]),     look: inWordFrame(FALL_GROUND, [0, 0.04, 0]) }, // end
]

// Beat 5 timing, in timeline units. The drop's optics morph from ball lens to plain window
// (uDive 0 → 1) while it fills the frame, then back on the way out.
export const DIVE = {
  pinFrom: 6.5, // from here the dive drop keeps a full-size decoder, so the video is live well before
  pinTo: 12,
  inStart: 8.7,
  inEnd: 9.6,
  typeIn: 9.75,
  typeOut: 10.45,
  outStart: 10.6,
  outEnd: 11.3,
}

// Sound. Every sound is synthesized until a licensed file fills its slot (paths under public/).
// Log each file's license before it goes in (bible: license log).
export const AUDIO = {
  master: 0.9,
  cityLevel: 0.35,
  files: {
    rain: null, // e.g. 'audio/rain.mp3' — loops; the freeze pitches this same file down into the hum
    align: null,
    splash: null,
    ambience: {}, // { 'mexico-city': 'audio/ambience/mexico-city.mp3', … }
  },
}

// Final pass (Effects.jsx). `lut`: the master .cube exported from Resolve, under public/. The same
// LUT grades footage and CG together, so clips should be encoded neutral (Rec.709), not pre-graded.
export const GRADE = {
  lut: null, // e.g. 'grade/master.cube'
  grain: 0.05,
  vignette: 0.7,
  bloomThreshold: 0.85,
  bloomIntensity: 0.6,
}
