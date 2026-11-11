import { getPosition } from 'suncalc'

// How the studio is lit for one city at one moment: every number the scene needs, as plain values, so two
// looks can be blended (a move between cities) and the scene can ease toward one (time passing, weather
// arriving). Colours are linear RGB triples.

// The model's frame: x east, y up, z south. A direction at altitude `alt` and azimuth `az` (degrees, from
// north through east, as SunCalc 2 reports them).
export function dirFromAltAz(altDeg, azDeg) {
  const alt = altDeg * (Math.PI / 180)
  const az = azDeg * (Math.PI / 180)
  return [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)]
}

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)]
const srgb = (hex) => [0, 2, 4].map((i) => (parseInt(hex.slice(1 + i, 3 + i), 16) / 255) ** 2.2)

const SUN_LOW = srgb('#ffa25e')
const SUN_MID = srgb('#ffe2bd')
const SUN_HIGH = srgb('#fff6ea')
const SKY_DAY = srgb('#dfe8ff')
const SKY_GOLD = srgb('#d6d0e4')
const SKY_NIGHT = srgb('#414c66')
const BOUNCE_DAY = srgb('#f1e9dd')
const BOUNCE_NIGHT = srgb('#1c2030')
const FLOOR = srgb('#e9e6e0') // the studio floor's plaster (plaster.js floorMaterial)
export const EXPOSURE = 1.05

// Khronos PBR Neutral, as three's NeutralToneMapping applies it to everything it draws: the backdrop is a
// clear colour, which three does not tone map, so the look does it here.
function neutral(c) {
  const start = 0.8 - 0.04
  const x = Math.min(c[0], c[1], c[2])
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04
  const o = c.map((v) => v - offset)
  const peak = Math.max(o[0], o[1], o[2])
  if (peak < start) return o
  const d = 1 - start
  const newPeak = 1 - (d * d) / (peak + d - start)
  const g = 1 - 1 / (0.15 * (peak - newPeak) + 1)
  return o.map((v) => mix(v * (newPeak / peak), newPeak, g))
}

// The hour on the city's own clock, 0..24.
export function localHour(city, date) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: city.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  return get('hour') + get('minute') / 60
}

// The share of windows lit at a local hour once it is dark: most in the evening, few in the small hours,
// some again before dawn. `late` is how far into the night it is (offices empty first).
const LIT = [[0, 0.2], [1.5, 0.12], [4.5, 0.08], [6, 0.2], [7.5, 0.36], [16, 0.42], [18.5, 0.6], [21, 0.56], [23, 0.34], [24, 0.2]]
export function occupancy(hour) {
  for (let i = 1; i < LIT.length; i++) {
    if (hour <= LIT[i][0]) return mix(LIT[i - 1][1], LIT[i][1], (hour - LIT[i - 1][0]) / (LIT[i][0] - LIT[i - 1][0]))
  }
  return LIT[0][1]
}
export const lateness = (hour) => (hour < 12 ? 1 - smooth(5.5, 8, hour) : smooth(19, 23, hour))

// The weather as the scene uses it. `wx` is a city's reading (content/weather.js) or null: unread weather
// is a clear sky, and the interface says so.
export function weatherOf(wx) {
  const code = wx?.current?.code ?? null
  const cur = wx?.current
  const rainy = code != null && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95)
  const snowy = code != null && ((code >= 71 && code <= 77) || code === 85 || code === 86)
  const foggy = code === 45 || code === 48
  const rate = cur?.mmPerHour ?? 0
  return {
    cloud: clamp01((cur?.cloud ?? 0) / 100),
    // 0..1 over drizzle to a downpour (8 mm/h and more); a rain code with no rate still shows as light rain.
    rain: rainy ? clamp01(0.25 + Math.sqrt(rate / 8) * 0.75) : 0,
    snow: snowy ? clamp01(0.35 + (cur?.snowCm ?? 0) * 0.5) : 0,
    // From the visibility reading when there is one (10 km and more: none), else from the fog codes.
    fog: Math.max(foggy ? 0.75 : 0, cur?.visibilityM != null ? 1 - smooth(400, 7000, cur.visibilityM) : 0),
    windKmh: cur?.windKmh ?? 0,
    windFromDeg: cur?.windFromDeg ?? 0,
  }
}

export function lookFor(city, date, wx) {
  const sun = getPosition(date, city.lat, city.lon) // degrees; azimuth from north through east
  const alt = sun.altitude
  const w = weatherOf(wx)
  const day = smooth(-6, 5, alt)
  const gold = smooth(-6, 0, alt) * (1 - smooth(4, 16, alt))
  const overcast = Math.max(smooth(0.45, 1, w.cloud), w.rain * 0.9, w.snow * 0.8, w.fog)
  const hour = localHour(city, date)

  const sunColor = alt < 6 ? mix3(SUN_LOW, SUN_MID, smooth(0, 6, alt)) : mix3(SUN_MID, SUN_HIGH, smooth(6, 35, alt))
  const sunLight = 3.5 * smooth(-1, 7, alt) * mix(0.75, 1, smooth(7, 40, alt)) * (1 - 0.76 * overcast)
  let sky = mix3(SKY_NIGHT, mix3(SKY_DAY, SKY_GOLD, gold), day)
  // Under cloud the fill is the cloud's own grey-white and stronger: shadows lose their edge.
  sky = mix3(sky, mix3(SKY_NIGHT, [0.82, 0.84, 0.88], day), overcast * 0.7)
  const skyLight = mix(0.75, mix(1.15, 1.5, gold), day) * (1 + 0.5 * overcast * day)
  // The backdrop is the floor's own colour under this light (flat, facing up), so floor and wall are one
  // sweep at any hour: the light a matte surface returns is its colour times the light on it over pi.
  const up = Math.sin(Math.max(alt, 0) * (Math.PI / 180))
  const floor = FLOOR.map((a, i) => (a * (sunColor[i] * sunLight * up + sky[i] * skyLight)) / Math.PI)
  // The camera's exposure: opened up when the sun is low and the floor gets little of it (a winter noon,
  // the golden hour), the way a photographer would, but only part of the way, so low light still looks low.
  const exposure = EXPOSURE * mix(1, Math.min(1.5, Math.max(0.85, (0.72 / Math.max(floor[1], 0.05)) ** 0.6)), day)
  const bg = neutral(floor.map((v) => v * exposure))

  // The sun's direction, held just above the horizon once it has set so the shadow map never flips;
  // by then its light is zero.
  const dir = dirFromAltAz(Math.max(alt, 1.5), sun.azimuth)
  const wind = (w.windFromDeg + 180) * (Math.PI / 180) // where the wind blows to
  const lean = Math.min(0.6, w.windKmh / 60)
  return {
    sunDir: dir,
    sunColor,
    sunLight,
    sky,
    bounce: mix3(BOUNCE_NIGHT, BOUNCE_DAY, day),
    skyLight,
    bg,
    exposure,
    night: 1 - smooth(-5, 3, alt),
    lit: occupancy(hour),
    late: lateness(hour),
    rain: w.rain,
    snow: w.snow,
    fog: w.fog,
    wet: Math.max(w.rain, w.snow * 0.4),
    // What falls leans with the wind (model east, south).
    lean: [Math.sin(wind) * lean, -Math.cos(wind) * lean],
  }
}

export function blendLook(out, a, b, t) {
  for (const k in b) {
    const va = a[k]
    const vb = b[k]
    if (typeof vb === 'number') out[k] = mix(va, vb, t)
    else {
      const o = out[k] ?? (out[k] = [])
      for (let i = 0; i < vb.length; i++) o[i] = mix(va[i], vb[i], t)
    }
  }
  const d = out.sunDir
  const len = Math.hypot(d[0], d[1], d[2]) || 1
  d[0] /= len
  d[1] /= len
  d[2] /= len
  return out
}

export const copyLook = (a) => blendLook({}, a, a, 1)
