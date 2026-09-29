import cities from './content/cities.json'
import { SRGB_RGB } from './sky/spectrum.js'
import cityGlowAtlas from './content/cityGlow.json'
import { buildDrift } from './core/drift.js'
import { smoothKeys } from './core/cameraPath.js'

export const CITIES = cities

// ---- Content -----------------------------------------------------------------
// What the city drops show. 'sky': each city's sky computed from its real sun, moon, stars and weather
// (SKY below). 'footage': licensed clips (public/clips, the video budget, poster atlas and decoder pins
// run only in this mode). The drop lab also takes ?clip= to show one clip.
export const CONTENT = { source: 'sky' }

// ---- Scroll ----------------------------------------------------------------
// Timeline time is measured in "units". One unit = VH_PER_UNIT of scroll distance.
export const VH_PER_UNIT = 100
export const FREEZE_SECONDS = 1.5 // real time for uTimeScale to ease 1 → 0 (and back on rewind)
// How fast the picture follows the scroll (core/pace.js). It eases toward the scroll position over about
// `smooth` seconds, never faster than `max` units (100vh each) per second, and at `nearDrop` while a
// city drop is near (the camera within HERO.near of it, where its city shows), braking ahead of it at
// most `brake` units/s². Wheel and trackpad input runs at most `bank` units ahead of the picture: the
// rest of a hard flick is dropped instead of playing out for seconds after the hand has stopped.
// `maxTurn`: the view turns no faster than about this many degrees per second, however fast the scroll
// (averaged over `turnWindow` units, so the limit comes and goes smoothly). `round`: the
// limit's corners are rounded off over this many units, so following it never makes the camera's
// acceleration jump (kept under half the drops' spacing, so the camera still speeds up between them).
export const PACE = { max: 1.5, nearDrop: 0.45, brake: 2.5, smooth: 0.1, bank: 0.5, maxTurn: 40, turnWindow: 0.5, round: 0.5 }
// Soft landings (core/snap.js): after a swift scroll (it ran at least `swift` units ahead of the
// picture) the picture comes to rest where a city drop can be seen, not wherever its speed ran out:
// at a drift drop's slow point (DRIFT_PASSES, within `capture` of where the scroll would stop), or
// inside the dive drop while its name shows (`dive`). Never behind the picture, never after slow
// scrolling, none at the word (found, not announced). Decided once input has been quiet `idle` ms,
// while the picture still glides: the scroll moves to the point and the picture glides on to rest there.
export const SNAP = { swift: 0.12, capture: 0.3, dive: { at: 10.1, capture: 0.7 }, idle: 90 }

// The beats, in order. `at` is the label position in timeline units. The loader is a screen over the
// first one, not a beat: "enter" only fades it, and the top of the page is the rain.
export const BEATS = [
  { name: 'rain', at: 1 },
  { name: 'freeze', at: 1.08 }, // just past rain, so the first scroll triggers the freeze
  { name: 'drift', at: 2.5 },
  { name: 'dive', at: 8 },
  { name: 'align', at: 11.5 },
  { name: 'splash', at: 13.3 }, // SPLASH_AT; the camera passes the word's eye at 13 without stopping
]
const SPLASH_AT = 13.3 // beat 7 timings below are offsets from this
export const TIMELINE_START = BEATS[0].at // the top of the page
export const TIMELINE_END = SPLASH_AT + 6.0 // the jets have fallen back; the last frame holds

// ---- Scene layout (world units, camera travels toward -z) ----------------
// The world behind the rain: a 360° night photograph, Poly Haven "rathaus" (Hamburg's town hall square,
// Greg Zaal, 2016, CC0), built by `npm run backdrop`. Every material reads it through env.glsl: the
// backdrop draws the soft (out-of-focus) copy, drops the sharp one. `exposure`: final brightness of the
// panorama's median luminance (linear); `yaw`: degrees the panorama is turned, here so the word's line
// of sight (40° left of -z) faces the square's darkest stretch, where its drops read (0: town hall at -z).
// `bokeh`: the soft copy's blur radius in degrees, as built (the build script's --bokeh).
// `view`: the start view, what the first shot sees in focus (FOCUS below). The two maps above come from
// the 2k copy, far too coarse to fill a screen in focus, so this is a window of the 8k copy, pixel for
// pixel (22.8 per degree; half size on the lower tiers, quality.backdropView). `lon`, `lat`: its edges
// in the panorama's own degrees, as printed by
//   npm run backdrop -- --in data/backdrop/rathaus_8k.hdr --out public/backdrop/rathaus \
//     --view -56,-4,110,70 --median-from data/backdrop/rathaus_2k.hdr --quality 5
// (centred where the first shot looks: longitude `yaw`, 4° down; wide enough for ultra-wide screens).
export const BACKDROP = {
  sharp: 'backdrop/rathaus.jpg',
  soft: 'backdrop/rathaus-soft.jpg',
  exposure: 0.006,
  yaw: -56,
  bokeh: 1.2,
  view: { full: 'backdrop/rathaus-view.jpg', half: 'backdrop/rathaus-view-half.jpg', lon: [-111.0059, -0.9668], lat: [-38.9795, 30.9814] },
}

// The first shot. After "enter" the lens is focused on the square behind the rain; `delay` s later it
// pulls focus forward onto the drops over `seconds` (the focus every later beat keeps). Scrolling on
// toward the drift completes the pull, so the drops are always sharp by the first pass.
// `aperture`: a drop `d` units away is blurred by aperture / d radians while the lens is focused far;
// `maxBlur`: CSS px cap on that blur (a drop that close has faded out anyway).
export const FOCUS = { delay: 0.8, seconds: 5, aperture: 0.05, maxBlur: 20 }

// Drop count comes from the quality tier (core/quality.js).
export const RAIN = {
  boxSize: [24, 18, 30], // the field repeats every box; it is centered ahead of the camera
  boxLead: 0.3, // how far ahead of the camera the box center sits, as a fraction of its depth
  speed: [9, 14], // units per simulated second, min/max
  radius: [0.01, 0.03], // world units
  shutter: 1 / 50, // motion-blur length in seconds; streak length = speed × shutter × uTimeScale
  wind: [0.12, 0.04], // horizontal drift per unit of fall
  fogDensity: 0.045,
  lensGain: 3, // light a bead passes on from the backdrop: 1 is physical; 3 reads like rain lit by a flash
  reflGain: 1,
  spec: 3,
  streakColor: [0.55, 0.6, 0.66],
}

export const HERO = {
  radius: 0.03, // the largest ordinary rain bead (RAIN.radius): a city drop is a normal drop
  ior: 1.333,
  dispersion: 0.0035, // water's real red-to-blue IOR spread; high tier only
  clipFov: 60, // horizontal field of view the clip is assumed to cover, in degrees
  exposure: 1.0,
  reflGain: 1,
  glint: 2,
  envOnlyGlint: 6, // the falling drop with no city (ending 'none')
  // Camera distance at which a city shows: in full within the first, not at all beyond the second,
  // where the drop is an ordinary bead refracting the backdrop like the rain around it.
  near: [0.9, 1.8],
}
// Beats 2–5: the camera floats from the rain at the top, weaving between the city drops, straight into
// the dive drop (core/drift.js). Hero drops are ordinary-sized, so a city only shows up close: the
// camera passes each drop DRIFT.pass from its centre, slowing as it comes up, gaze glancing toward it.
// Drops sit mostly above and below the path (angles in DRIFT.around), so they stay in frame on portrait
// phones, whose horizontal view is narrow. One drop per city; lower tiers show fewer.
export const DRIFT = {
  start: 2.5, // timeline units: the drift's first slow point is one step after this…
  end: 8, // …its last one step before this, the dive's approach
  y: 4.45, // camera height through the drift
  pass: 0.12, // distance from the camera's path to each drop's centre (4 radii)
  lead: 0.4, // the camera is slowest this far before each drop: its city then fills ~1/7 of the frame height
  around: [60, 240, 120, 300], // offset direction per drop, degrees (0 = right, 90 = up), cycled
  // The weave (user's choice of slalom, leaf and corkscrew): side to side `weave[0]` units, once every
  // `weave[1]` units travelled (4 drops), with a bob of `bob[0]` every `bob[1]`.
  weave: [1.3, 18],
  bob: [0.35, 11],
  // Timing: one smooth speed profile, no jumps in acceleration. At each drop the camera slows to `ease`
  // of its cruising speed (a Gaussian dip `sigma` units wide); it starts from rest over `rampIn`; over
  // `blendOut` before the approach it settles to `approach` × the approach's average speed, then comes
  // to rest inside the dive drop.
  ease: 0.55,
  sigma: 0.14,
  rampIn: 1.8,
  blendOut: 0.7,
  approach: 1.5,
  lookToward: 0.35, // how far the gaze turns toward each drop as it comes up (0 not at all, 1 fully)
  ahead: 3, // the gaze looks this far along the path, so it turns and tilts into each bend
  sway: [0.07, 0.035], // and drifts slowly of its own: yaw and pitch, radians…
  swayPeriod: [2.2, 1.6], // …once every so many timeline units
}
const DRIFT_DROPS = 9 // the tenth drop is the dive drop, placed separately below
const DIVE_DROP_POS = [0.05, DRIFT.y, 5 - (DRIFT_DROPS + 0.1) * 4.5]
const DIVE_AIM = [DIVE_DROP_POS[0], DIVE_DROP_POS[1], DIVE_DROP_POS[2] - 6] // far behind the drop, on its line
// When the camera is slowest at each drift drop.
export const DRIFT_PASSES = Array.from({ length: DRIFT_DROPS }, (_, i) => DRIFT.start + ((i + 1) * (DRIFT.end - DRIFT.start)) / (DRIFT_DROPS + 1))
const TAU = 2 * Math.PI
const drift = buildDrift({
  from: { at: 1, pos: [0, 5, 14], look: [0, 4, 0] }, // the top: the rain, at rest
  start: { z: 10 }, // the height has settled to DRIFT.y by here
  end: { at: DRIFT.end, pos: [DIVE_DROP_POS[0], DIVE_DROP_POS[1], DIVE_DROP_POS[2] + 2.5], look: DIVE_AIM }, // on its axis, the drop a bead dead ahead
  arrive: { at: 9.4, pos: [DIVE_DROP_POS[0], DIVE_DROP_POS[1], DIVE_DROP_POS[2] + 1.28 * HERO.radius], look: DIVE_AIM }, // it covers every screen corner
  y: DRIFT.y,
  passes: DRIFT_PASSES,
  drops: { pass: DRIFT.pass, around: DRIFT.around, lead: DRIFT.lead },
  timing: { ease: DRIFT.ease, sigma: DRIFT.sigma, rampIn: DRIFT.rampIn, blendOut: DRIFT.blendOut, approach: DRIFT.approach },
  curve: (s) => [DRIFT.weave[0] * Math.sin((TAU * s) / DRIFT.weave[1]), DRIFT.bob[0] * Math.sin((TAU * s) / DRIFT.bob[1] + 0.9)],
  fade: [6, 7], // the weave comes in over the first 6 units travelled and goes over the last 7 before the approach
  gaze: { ahead: DRIFT.ahead, lookToward: DRIFT.lookToward, sway: DRIFT.sway, swayPeriod: DRIFT.swayPeriod },
})
const HERO_POSITIONS = [...drift.drops, DIVE_DROP_POS]
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
// The drops a tier shows (quality.heroDrops of them): the dive drop always, then the first of the rest.
export const visibleDrops = (drops, count) => [...drops.filter((d) => d.dive), ...drops.filter((d) => !d.dive).slice(0, count - 1)]
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
  chimeAt: 13 - 0.02, // the word's shimmer plays crossing this forward, and its sketch starts drawing
  passSpeed: 0.45, // camera speed at the eye relative to its average: a slow pass, not a stop
  // A pencil sketch around the word's silhouette (ui/pencilSketch.js): it draws in from chimeAt while the
  // camera is within `until` units past the eye, and retracts `retract` times as fast once it leaves
  // (either way). `margin`: how far the outline stands off the letters, px at the 240 px sampling size.
  // `inner`: letters whose negative space also gets lines (their counters and inner curves), `margin`
  // px inside it, starting `delay` s after the silhouette.
  sketch: { until: 0.15, retract: 1.6, margin: 14, passes: { high: 7, medium: 6, low: 4 }, inner: { letters: 'sce', margin: 7, delay: 0.45 } },
}
// Beat 7. One drop of the word falls into a puddle on the ground (y = 0) directly below it.
// The splash is a Mantaflow sim baked to a vertex animation texture (blender/splash/bake_splash.py).
export const SPLASH = {
  url: 'splash/', // splash.json + PNGs, relative to the site root
  loadAfter: 3.5, // timeline time at which the splash data starts downloading (during the drift)
  fallRadius: 0.03, // world radius of the falling drop; the sim is scaled to match its drop
  fallAt: SPLASH_AT + 0.1, // time resumes for this one drop
  impactAt: SPLASH_AT + 2.5, // it reaches the water; the VAT takes over
  // Last VAT frame. 168 stored frames play evenly from impactAt to here (48 per unit). The bake's
  // own speed ramp (vat_from_cache.py --ramp) keeps the crown in full slow motion and speeds up as
  // the water calms: the main jet rises and falls back, a second, smaller one follows, and the last
  // frame holds on what swell is left.
  splashEnd: TIMELINE_END,
  // The jets fall back into the pool (cache frames 163 and 221, stored frames 127 and 148).
  jetFallAt: SPLASH_AT + 5.16,
  jet2FallAt: SPLASH_AT + 5.6,
  ringStart: SPLASH_AT + 2.8,
  ringEnd: TIMELINE_END,
  ringSeconds: 7.5, // the ripples' own clock over ringStart → ringEnd (the pace of the original 4 s over 1.7 units)
  quietAt: SPLASH_AT + 5.0, // the sound fades out over 0.8 units from here, as the water calms
  answerAt: SPLASH_AT + 3.0, // the ending's type fades in as the rings spread, and stays
  // As the drop meets the water the frozen moment ends: the rain around eases to `timeScale` of its
  // speed over `seconds` (real time) and keeps falling slowly on the held last frame.
  rainAgain: { at: SPLASH_AT + 2.5, timeScale: 0.2, seconds: 3 },
  // Once the scroll passes autoFrom going down, the ending plays itself (the scroll moves with it,
  // locked) to the end at about autoRate units per second, then holds on the last frame.
  autoFrom: SPLASH_AT + 0.1, // the drop leaves the word (fallAt)
  autoRate: 0.8,
  fallPinFrom: 12.4, // the falling drop's clip starts decoding after the dive drop's pin ends (12)
  groundY: 0,
  puddleSize: 80, // the wet ground, fading into darkness with distance
}
// Water look shared by the splash and the puddle (water.glsl).
export const WATER = { reflGain: 1, deep: [0.004, 0.006, 0.009], transGain: 1 }

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
// Look targets in the dive sit far behind the drop on the same line (DIVE_AIM): aiming at the drop's
// centre, only 1.28 radii away, would swing the view at the slightest movement.

// After the dive the keys are placed by hand; smoothKeys (core/cameraPath.js) resamples them smoothed,
// so acceleration never jumps at a key either. The eye (the word only lines up from there) and the last
// frame stay exact; the camera eases out of the dive drop from about 10.0 instead of starting at 10.6.
const AFTER_DIVE = [
  { at: 9.4,  pos: DIVE_EYE,                             look: DIVE_AIM },               // inside the city (held)
  { at: 10.6, pos: DIVE_EYE,                             look: DIVE_AIM },
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
export const CAMERA_KEYS = [
  ...drift.keys, // the rain (1) → the weave between the drops → the approach (8) → the drop fills the frame (9.4)
  ...smoothKeys(AFTER_DIVE, { sigma: 0.2, pins: [ALIGN_AT, TIMELINE_END] }),
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

// Sky in a drop (provisional, lab only: /?lab=drop). Each city's real sky, computed from the sun,
// moon, stars and weather there, as a second content source beside footage. Atmosphere after
// Hillaire 2020 (src/sky/hillaire.js); the per-city sky-view texture is the only thing a drop reads
// from the atmosphere model, so another model (Bruneton's precomputed one) can fill the same texture.
export const SKY = {
  // Scattering and absorption at the wavelengths the channels stand for: the sRGB primaries' dominant
  // wavelengths (610, 550, 465 nm). Hillaire's 680/550/440 turned the blue-hour zenith violet.
  atmosphere: SRGB_RGB,
  viewHeightKm: 0.2, // the viewer stands on a rooftop
  groundAlbedo: 0.08, // a city seen from above: dark
  skyView: { high: [192, 108], medium: [192, 108], low: [128, 64] }, // per-city texture size by tier
  refreshDegrees: 0.25, // re-render a city's sky once its sun or moon has moved this far
  // Which way the city view faces. The drop's axis (camera → drop) maps to this direction, so the
  // lens inverts it exactly as it inverted footage. Moon's azimuth once the sun is below moonBelow.
  // At night, a moon that is up and within `halfWidth` degrees of the view's direction is tilted into
  // frame: the view looks up to `below` degrees under it (at most `max`), never lower than `pitch`.
  facing: { pitch: 15, moonBelow: -12, moonTilt: { halfWidth: 40, below: 10, max: 60 } },
  // Camera exposure: a metered sky luminance L (cd/m²) comes out at key × (L / ref)^range, so the
  // 18 stops between a clear noon and a city night compress to about 3.6.
  exposure: { key: 0.2, ref: 3000, range: 0.2 },
  sunLux: 1.28e5, // illuminance above the atmosphere
  moonLux: 0.3, // full moon above the atmosphere; other phases follow Allen's phase law
  moonColour: [1.0, 0.93, 0.84], // moonlight is a little redder than sunlight
  earthshine: 1.2e-4, // dark limb radiance as a share of the full-moon disk's, at new moon
  // The city's own light at the zenith of a clear night: per city from the World Atlas of Artificial
  // Night Sky Brightness (Falchi et al. 2016, CC BY-NC 4.0) once src/content/cityGlow.json has values;
  // until then `zenith` (cd/m², ≈ 17.8 mag/arcsec²) for all ten. The atlas has no colour, so the
  // colour and the horizon, cloud-base and ground ratios are one set for every city.
  // `colour`: a warm LED white (user's choice, 2026-09-29; the old sodium orange [1, 0.72, 0.48] read as
  // brown when dim). The atlas has no colour, so it is one choice for all ten cities.
  // `mottle`: the city-lit cloud base follows the deck's own density, thin patches darker (0: even; 0.8:
  // ±40%), so an overcast night has structure instead of one even colour.
  cityGlow: { atlas: cityGlowAtlas, colour: [1.0, 0.85, 0.7], zenith: 0.012, horizon: 4, cloud: 5, ground: 3, mottle: 0.8 },
  clouds: { baseKm: 2.0, rainBaseKm: 1.0, tileKm: 40, tauMin: 3, tauMax: 25, tauPerMm: 4 },
  // Extinction from rain, per km: 0.25 × R^0.63 (R in mm/h). Fog (WMO 45, 48): visibility 0.5 km.
  rainHaze: { coef: 0.25, exp: 0.63, fogPerKm: 7.8 },
  // `exposureStops`: stars as a long exposure over a city would record them (user's choice): this many
  // stops above what the metered sky alone would show. Positions and magnitudes stay the catalogue's.
  stars: { url: 'sky/stars.bin', maxMag: 4.5, cells: 64, seeingDeg: 0.02, lux0: 2.5e-6, exposureStops: 4 },
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
