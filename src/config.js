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
  { name: 'align', at: 12 },
  { name: 'splash', at: 15 },
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
}
// One hero drop per city, so no city repeats. The dive drop is always shown; lower tiers drop others.
const HERO_POSITIONS = [
  [1.2, 4.6, 4], [-1.4, 3.8, 1], [0.9, 3.9, -3], [-0.6, 5.0, -6],
  [1.8, 4.4, -10], [-2.2, 4.0, -13], [0.4, 3.6, -17], [-1.0, 4.7, -21],
  [-1.8, 3.9, -28], [0.6, 4.1, -36],
]
export const DIVE_DROP_INDEX = 9
export const HERO_DROPS = HERO_POSITIONS.map((pos, i) => ({ pos, city: CITIES[i % CITIES.length].id, dive: i === DIVE_DROP_INDEX }))
const D = HERO_POSITIONS[DIVE_DROP_INDEX]

export const WORD = { text: 'schwe', pos: [0, 4, -64], fontSize: 2 }
export const PUDDLE = { pos: [0, 0, -73], size: 12, dropStartY: 6 }

// Camera waypoints. Position and look target are each a Catmull-Rom spline through these points;
// the timeline moves along the spline from key to key. `ease` shapes the segment that ends at that
// key: 'power2.out' settles into a hold, 'power2.in' leaves one. Two identical consecutive keys are
// an exact hold (the camera does not move at all between them).
const R = HERO.radius
const DIVE_EYE = [D[0], D[1], D[2] + 1.28 * R] // close enough that the drop covers every screen corner
export const CAMERA_KEYS = [
  { at: 0,    pos: [0, 16, 16],                          look: [0, 24, -20] },           // loader: high, facing dark sky
  { at: 1,    pos: [0, 5, 14],                           look: [0, 4, 0] },              // rain
  { at: 1.08, pos: [0, 5, 13.9],                         look: [0, 4, 0] },              // freeze
  { at: 2.5,  pos: [0, 4.6, 10],                         look: [0, 4.2, -4] },           // drift start
  { at: 5.5,  pos: [-1.6, 4.3, -8],                      look: [0.4, 4.1, -22] },
  { at: 8,    pos: [D[0] + 0.35, D[1] + 0.15, D[2] + 4.5], look: D },                    // dive: approach
  { at: 9.4,  pos: DIVE_EYE,                             look: D, ease: 'power2.out' },  // drop fills the frame
  { at: 10.6, pos: DIVE_EYE,                             look: D },                      // inside the city
  { at: 11.5, pos: [D[0] - 0.5, D[1] + 0.5, D[2] + 1.8], look: [D[0], D[1], D[2] - 6], ease: 'power2.in' }, // pulled back out
  { at: 12,   pos: [0, 4, -50],                          look: [0, 4, -64] },            // align viewpoint
  { at: 15,   pos: [0, 4, -52.5],                        look: [0, 4, -64] },            // splash start
  { at: 17,   pos: [0, 2.2, -66],                        look: [0, 0, -73] },
  { at: 19,   pos: [0, 1.6, -68.5],                      look: [0, 0, -73] },            // end
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
