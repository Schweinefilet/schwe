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
export const RAIN = {
  count: 20000,
  boxMin: [-25, 0, -90],
  boxSize: [50, 28, 110],
  speed: [14, 22], // units per simulated second, min/max
  size: 6,
}

export const HERO_RADIUS = 0.35
const HERO_POSITIONS = [
  [1.2, 4.6, 4], [-1.4, 3.8, 1], [0.9, 3.9, -3], [-0.6, 5.0, -6],
  [1.8, 4.4, -10], [-2.2, 4.0, -13], [0.4, 3.6, -17], [-1.0, 4.7, -21],
  [2.0, 4.2, -25], [-1.8, 3.9, -28], [0.6, 4.1, -36], [-0.4, 4.9, -42],
]
// 12 hero drops cycle through the 10 cities, so two cities appear twice.
export const HERO_DROPS = HERO_POSITIONS.map((pos, i) => ({ pos, city: CITIES[i % CITIES.length].id }))
export const DIVE_DROP_INDEX = 10
const D = HERO_POSITIONS[DIVE_DROP_INDEX]

export const WORD = { text: 'schwe', pos: [0, 4, -64], fontSize: 2 }
export const PUDDLE = { pos: [0, 0, -73], size: 12, dropStartY: 6 }

// Camera waypoints. Position and look target are each a Catmull-Rom spline through these points;
// the timeline moves along the spline from key to key.
export const CAMERA_KEYS = [
  { at: 0,    pos: [0, 16, 16],                  look: [0, 24, -20] },           // loader: high, facing dark sky
  { at: 1,    pos: [0, 5, 14],                   look: [0, 4, 0] },              // rain
  { at: 1.08, pos: [0, 5, 13.9],                 look: [0, 4, 0] },              // freeze
  { at: 2.5,  pos: [0, 4.6, 10],                 look: [0, 4.2, -4] },           // drift start
  { at: 5.5,  pos: [-1.6, 4.3, -8],              look: [0.4, 4.1, -22] },
  { at: 8,    pos: [0.2, 4.2, -30],              look: [D[0], D[1], D[2] - 2] }, // dive: approach
  { at: 10,   pos: [D[0], D[1], D[2]],           look: [D[0], D[1], D[2] - 2] }, // inside the drop
  { at: 11.2, pos: [-0.8, 4.4, -34.5],           look: [0, 4, -60] },            // pulled back out
  { at: 12,   pos: [0, 4, -50],                  look: [0, 4, -64] },            // align viewpoint
  { at: 15,   pos: [0, 4, -52.5],                look: [0, 4, -64] },            // splash start
  { at: 17,   pos: [0, 2.2, -66],                look: [0, 0, -73] },
  { at: 19,   pos: [0, 1.6, -68.5],              look: [0, 0, -73] },            // end
]
