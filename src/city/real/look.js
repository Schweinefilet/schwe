import { getPosition } from 'suncalc'
import { lookFor, weatherOf } from '../look.js'
import { SUN_E, mieFor, sunAt } from './atmosphere.js'
import { cloudThreshold } from './clouds.js'

// Everything the photoreal New York is lit by at one moment, from the same inputs as the studio's look
// (look.js): the sun's position (SunCalc) and the city's one weather reading. Plain numbers and arrays, so
// two can be blended (weather arriving eases in, as in the studio).
//
//   visibility -> the haze (atmosphere.js, Koschmieder)
//   cloud cover -> the cloud layer's cover; rain, snow and fog make it full and low
//   wind -> the clouds' drift, the water's waves (materials.js, Cox-Munk)
//   rain rate -> wetness (the studio's `wet`, eased)
//
// Exposure is incident-light metering: the camera is set so that a surface of 18% albedo under the light
// falling on level ground (sun and sky) reads 0.18, as a photographer's hand meter would set it. After
// dark it stops at NIGHT_EXPOSURE, where the night's windows (calibrated in the studio against
// photographs, DECISIONS.md 2026-11-20) read as they did.

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export const NIGHT_EXPOSURE = 1.15
const METER = 1.0 // exposure x illuminance / pi for an 18% card to read 0.18

export function realLookFor(city, date, wx) {
  const base = lookFor(city, date, wx)
  const w = weatherOf(wx)
  const sun = getPosition(date, city.lat, city.lon)
  // SunCalc 2 reports degrees, azimuth from north through east (as look.js uses it).
  const alt = sun.altitude
  const az = sun.azimuth
  const mie = mieFor(wx?.current?.visibilityM ?? null)
  const s = sunAt(alt, az, mie)
  // Rain, snow and fog mean a full, low, thick deck.
  const deck = Math.max(w.rain, w.snow, w.fog)
  const cover = Math.max(w.cloud, smooth(0, 0.3, deck))
  const opacity = 0.85 + 0.15 * Math.max(smooth(0.7, 1, cover), deck)
  // The share of the sun's direct light the clouds let through, on average, for the meter.
  const sunThrough = 1 - cover * opacity
  const up = Math.max(0, s.dir[1])
  const direct = s.E.map((e) => e * up)
  // A cloud's underside: the light on its top, diffused through it (a thick deck lets through about a
  // quarter, a fair-weather cumulus half), darker in rain.
  const through = (0.5 - 0.25 * smooth(0.6, 1, cover)) * (1 - 0.45 * w.rain)
  const cloudLit = s.E.map((e) => ((e * up + SUN_E * 0.02 * smooth(-4, 6, alt)) * through) / Math.PI)
  // The ground's radiance for the lower half of the sky cube (a city of albedo 0.12).
  const ground = direct.map((e) => (0.12 * (e * sunThrough + e * 0.25)) / Math.PI)
  // The city's own light on the air and the clouds after dark (sodium and LED, about 3000 K), several
  // times stronger under a deck: zenith sky over Manhattan is about 0.02 cd/m² clear, 0.3 overcast.
  const dark = base.night
  const glow = dark * (0.0004 + 0.004 * cover)
  const nightGlow = [glow * 1.0, glow * 0.72, glow * 0.48]
  const windMs = w.windKmh / 3.6
  const to = ((w.windFromDeg + 180) * Math.PI) / 180
  const wind = [Math.sin(to), -Math.cos(to)] // x east, z south
  // The clouds' drift: the wind at their height is about twice the surface wind.
  const drift = ((date.getTime() / 1000) * windMs * 2) / 1000
  return {
    ...base,
    // The sun for the shadow map (held above the horizon, as the studio's is) and the true one for the sky.
    sunDir: s.dir.map((v, i) => (i === 1 ? Math.max(v, 0.02) : v)),
    sunTrue: s.dir,
    alt,
    sunE: SUN_E,
    sunLight: s.E,
    sunThrough,
    mieExt: mie.ext,
    mieScat: mie.scat,
    cover,
    cloudTh: cloudThreshold(cover),
    cloudH: deck > 0.3 ? 700 : cover > 0.8 ? 1000 : 1600,
    cloudOpacity: opacity,
    cloudLit,
    cloudShift: [(drift * wind[0]) % 500, (drift * wind[1]) % 500],
    ground,
    nightGlow,
    wind,
    windMs,
    direct,
  }
}

// The camera's exposure for a look, given the sky's irradiance on level ground (read from the sky cube).
export function exposureFor(look, skyIrradiance) {
  const e = look.direct.map((d, i) => d * look.sunThrough + skyIrradiance[i])
  const E = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2]
  return Math.min(NIGHT_EXPOSURE, (METER * Math.PI) / Math.max(E, 1e-6))
}
