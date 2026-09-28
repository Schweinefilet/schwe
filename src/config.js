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
  { name: 'splash', at: 14.5 },
]
export const TIMELINE_END = 19

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
  radius: 0.18,
  ior: 1.333,
  dispersion: 0.0035, // water's real red-to-blue IOR spread; high tier only
  clipFov: 60, // horizontal field of view the clip is assumed to cover, in degrees
  exposure: 1.0,
  reflGain: 4,
  glint: 2,
  envOnlyGain: 14, // the falling drop has no clip: it shows the street glow, as bright as a rain bead's
  envOnlyGlint: 6,
}
// One hero drop per city, so no city repeats. The dive drop is always shown; lower tiers drop others.
// A corridor: drops alternate left and right of the camera path about half a unit out, so each one
// passes close enough to show its city, one every ~4.5 units of travel.
const HERO_POSITIONS = [
  [0.5, 4.7, 5], [-0.55, 4.2, 0.5], [0.45, 4.35, -4], [-0.6, 4.75, -8.5],
  [0.5, 4.15, -13], [-0.45, 4.6, -17.5], [0.55, 4.35, -22], [-0.5, 4.1, -26.5],
  [-0.65, 4.7, -31], [0.6, 4.1, -36],
]
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
export const ALIGN = {
  text: 'schwe',
  eye: [0, 4.8, -41],
  target: [0, 4.8, -60],
  fov: CAMERA_FOV,
  depth: [3.5, 18], // drops sit at a random distance from the eye in this range
  widthFrac: 0.62, // word width as a share of the screen width…
  maxHeightFrac: 0.4, // …unless that would make it taller than this share of the screen height
  beadAngle: 0.0032, // bead radius as an angle seen from the eye (≈2.5 px at 720p, 16:9; scaled with the word)
  count: { high: 2600, medium: 1800, low: 1000 },
  fallDepth: 9.4, // distance from the eye of the one drop that falls in beat 7 (puddle is below it)
  arrive: 13, // camera reaches the eye
  holdUntil: 14.5,
}
// Beat 7. One drop of the word falls into a puddle on the ground (y = 0) directly below it.
// The splash is a Mantaflow sim baked to a vertex animation texture (blender/splash/bake_splash.py).
export const SPLASH = {
  url: 'splash/', // splash.json + PNGs, relative to the site root
  loadAfter: 3.5, // timeline time at which the splash data starts downloading (during the drift)
  fallRadius: 0.03, // world radius of the falling drop; the sim is scaled to match its drop
  fallAt: 14.6, // time resumes for this one drop
  impactAt: 17.0, // it reaches the water; the VAT takes over
  splashEnd: 18.5, // last VAT frame
  ringStart: 17.3,
  ringEnd: 19,
  fadeStart: 18.2,
  groundY: 0,
  puddleSize: 80, // the wet ground, fading into darkness with distance
}
// Water look shared by the splash and the puddle (water.glsl).
export const WATER = { reflGain: 4, deep: [0.004, 0.006, 0.009], transGain: 2 }

// Where the falling drop starts until the word is laid out (AlignmentWord replaces it with the exact
// word sample it picks). The impact point is straight below.
export const FALL_START_DEFAULT = [0, 4.6, -50.4]

// Camera waypoints. Position and look target are each a Catmull-Rom spline through these points;
// the timeline moves along the spline from key to key. `ease` shapes the segment that ends at that
// key: 'power2.out' settles into a hold, 'power2.in' leaves one. Two identical consecutive keys are
// an exact hold (the camera does not move at all between them).
const R = HERO.radius
const { eye: ALIGN_EYE, target: ALIGN_TARGET, arrive: ALIGN_AT, holdUntil: ALIGN_HOLD } = ALIGN
const DIVE_EYE = [D[0], D[1], D[2] + 1.28 * R] // close enough that the drop covers every screen corner
export const CAMERA_KEYS = [
  { at: 0,    pos: [0, 16, 16],                          look: [0, 24, -20] },           // loader: high, facing dark sky
  { at: 1,    pos: [0, 5, 14],                           look: [0, 4, 0] },              // rain
  { at: 1.08, pos: [0, 5, 13.9],                         look: [0, 4, 0] },              // freeze
  { at: 2.5,  pos: [0, 4.5, 10],                         look: [0, 4.4, 0] },            // drift start
  { at: 5.25, pos: [0.05, 4.45, -11],                    look: [0, 4.4, -22] },
  { at: 8,    pos: [D[0] + 0.35, D[1] + 0.15, D[2] + 4.5], look: D },                    // dive: approach
  { at: 9.4,  pos: DIVE_EYE,                             look: D, ease: 'power2.out' },  // drop fills the frame
  { at: 10.6, pos: DIVE_EYE,                             look: D },                      // inside the city
  { at: 11.5, pos: [D[0] - 1.6, D[1] + 0.6, D[2] + 1.8], look: [D[0], D[1], D[2] - 6], ease: 'power2.in' }, // pulled back out, off the word's axis
  // Swing in from the side: parallax keeps the word scrambled until the last stretch of the approach.
  { at: 12.3, pos: [ALIGN_EYE[0] - 2.4, ALIGN_EYE[1] + 0.9, ALIGN_EYE[2] + 3.2], look: [ALIGN_TARGET[0] - 1.5, ALIGN_TARGET[1], ALIGN_TARGET[2]] },
  { at: ALIGN_AT, pos: ALIGN_EYE,                        look: ALIGN_TARGET, ease: 'power1.out' }, // the word locks in
  { at: ALIGN_HOLD, pos: ALIGN_EYE,                      look: ALIGN_TARGET },           // hold for a beat
  // Beat 7: follow the falling drop down to a low, close view of the water. The look target is
  // blended onto the drop itself (rig.follow), so these keys only set where the camera stands.
  { at: 15.4, pos: [0.5, 3.1, -46.8],                    look: ALIGN_TARGET },
  { at: 16.3, pos: [0.4, 0.9, -49.2],                    look: [0, 0.4, -50.4] },
  { at: 17.0, pos: [0.28, 0.24, -49.6],                  look: [0, 0.05, -50.4], ease: 'power1.out' }, // impact
  { at: 19,   pos: [0.2, 0.19, -49.8],                   look: [0, 0.04, -50.4] },            // end
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
