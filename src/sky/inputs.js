import { getMoonIllumination, getMoonPosition, getPosition } from 'suncalc'
import { bearing, cityToJ2000, dirFromAltAz, lommelSeeligerPhase, meanBearing, moonPhaseLaw, sunLux } from './astro.js'

// Everything a city's sky is computed from, for one moment: sun and moon from SunCalc, stars from
// sidereal time, weather from the one Open-Meteo request. `sky` is SKY from config.js (passed in so
// this runs in tests). `weather` may be null: no data counts as clear, and nothing is made up.
// `override` (lab sliders): { cloud 0..1, rain mm/h, fog, wind m/s, windFrom degrees } replace the live
// values when set.

const MOON_RADIUS_KM = 1737.4
const SUN_RADIUS = 0.004654 // radians (mean angular radius 0.2666°)
const FOG_CODES = new Set([45, 48])

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b
const tint = (c) => c.map((v) => v / luminance(c))

export function skyInputs({ city, date, weather = null, override = {}, sky }) {
  const sunPos = getPosition(date, city.lat, city.lon)
  const moonPos = getMoonPosition(date, city.lat, city.lon)
  const illum = getMoonIllumination(date)
  const sunDir = dirFromAltAz(sunPos.altitude, sunPos.azimuth)
  const moonDir = dirFromAltAz(moonPos.altitude, moonPos.azimuth)

  const cloud = clamp01(override.cloud ?? weather?.cloudCover ?? 0)
  const rain = Math.max(0, override.rain ?? weather?.mmPerHour ?? 0)
  const fog = override.fog ?? FOG_CODES.has(weather?.code)
  // Wind at 10 m: no data counts as calm. Where it blows to (clockwise from north), null when unknown.
  const windMs = Math.max(0, override.wind ?? weather?.windMs ?? 0)
  const windFrom = override.windFrom ?? weather?.windFromDeg ?? null

  // Phase angle ψ (sun-moon-earth) from the lit fraction SunCalc reports: fraction = (1 + cos ψ) / 2.
  const psi = (Math.acos(Math.max(-1, Math.min(1, 2 * illum.fraction - 1))) * 180) / Math.PI
  const moonLaw = moonPhaseLaw(psi)

  // Pre-exposure: keeps the sky-view texture and the light values inside half-float range. It follows
  // the sun and moon only, so a weather change never re-renders the texture; the final exposure is
  // metered in the shader from what the view actually faces, weather included (sky.glsl, skyMeter).
  const glowZenith = cityGlowZenith(city.id, sky.cityGlow)
  const metered = meteredLuminance({ sunAlt: sunPos.altitude, moonAlt: moonPos.altitude, moonLaw, cloud: 0, rain: 0, cityZenith: glowZenith }, sky)
  const exposure = exposureFor(metered, sky.exposure)

  // The view faces the city's chosen vantage (sky.facing.views, content/vantages.json): from there toward
  // its landmarks. A city without one faces the sun, or the moon once the sun is well down and it is up.
  const night = sunPos.altitude < sky.facing.moonBelow
  const useMoon = night && moonPos.altitude > 0
  const view = sky.facing.views?.[city.id]
  const yaw = view ? viewBearing(view) : useMoon ? moonPos.azimuth : sunPos.azimuth
  const toward = view ? 'view' : useMoon ? 'moon' : 'sun'
  const pitch = moonTiltPitch({ night, moon: moonPos, yaw, facing: view ? { ...sky.facing, pitch: sky.facing.viewPitch ?? sky.facing.pitch } : sky.facing })

  const moonRadius = Math.asin(MOON_RADIUS_KM / moonPos.distance)
  const moonColour = tint(sky.moonColour)
  const moonE = sky.moonLux * moonLaw * exposure
  const glow = sky.cityGlow
  const haze = Math.max(rain > 0 ? sky.rainHaze.coef * rain ** sky.rainHaze.exp : 0, fog ? sky.rainHaze.fogPerKm : 0)

  const q = (deg) => Math.round(deg / sky.refreshDegrees)
  return {
    city: city.id,
    date,
    sun: { alt: sunPos.altitude, az: sunPos.azimuth, dir: sunDir },
    moon: { alt: moonPos.altitude, az: moonPos.azimuth, dir: moonDir, distanceKm: moonPos.distance, fraction: illum.fraction, phaseAngle: psi, radius: moonRadius },
    cloud,
    rain,
    fog,
    wind: { ms: windMs, towardDeg: windFrom == null ? null : (windFrom + 180) % 360 },
    metered,
    exposure,
    facing: { yaw, pitch, toward },
    cityBasis: cityBasis(yaw, pitch),
    equatorial: cityToJ2000(date, city.lat, city.lon),
    // Light, already multiplied by the exposure. Colours are linear RGB of unit luminance.
    sunE: sky.sunLux * exposure,
    sunDisk: (sky.sunLux * exposure) / (Math.PI * SUN_RADIUS ** 2),
    moonE: moonColour.map((c) => c * moonE),
    moonTint: moonColour,
    moonOn: moonPos.altitude > -3,
    // The shader shades the disk as a Lommel-Seeliger sphere; this scales it to Allen's measured
    // brightness at the current phase. Radiance of the full disk, before that correction:
    moonDisk: ((sky.moonLux * exposure) / (Math.PI * moonRadius ** 2)) * (moonLaw / Math.max(lommelSeeligerPhase(psi), 1e-3)),
    earthshine: sky.earthshine * (1 - illum.fraction),
    starScale: sunPos.altitude < -4 ? sky.stars.lux0 * exposure * 2 ** (sky.stars.exposureStops ?? 0) : 0,
    // The skyline's lit windows (decorative): the share of the evening's lit windows still on at this
    // local hour, and how dark it is (none by day).
    windows: { late: lateness(localHour(date, city.tz)), dark: smoothstep(3, -6, sunPos.altitude) },
    cityGlow: tint(glow.colour).map((c) => c * glowZenith * exposure),
    clouds: {
      cover: cloud,
      tau: sky.clouds.tauMin + (sky.clouds.tauMax - sky.clouds.tauMin) * cloud + sky.clouds.tauPerMm * rain,
      baseKm: rain > 0 ? sky.clouds.rainBaseKm : sky.clouds.baseKm,
      tileKm: sky.clouds.tileKm,
      offset: cityOffset(city.id),
    },
    haze,
    // The sky-view texture depends only on these; everything else is a uniform, free to change.
    lutKey: [q(sunPos.altitude), q(sunPos.azimuth), q(moonPos.altitude), q(moonPos.azimuth), Math.round(Math.log2(exposure) * 32), moonPos.altitude > -3].join(),
  }
}

// What a camera meters: sky luminance (cd/m²) from sun, moon and the city's own light. The sky's share
// of the light is about 15% under a high sun, all of it once the sun is down or behind cloud. Cloud
// cuts the light (Kasten-Czeplak); rain darkens it further.
export function meteredLuminance({ sunAlt, moonAlt, moonLaw, cloud, rain, cityZenith = null }, sky) {
  const cut = (1 - 0.75 * cloud ** 3.4) / (1 + 0.08 * rain)
  const clearShare = sunAlt <= 0 ? 1 : 0.15 + 0.85 * Math.exp(-sunAlt / 6)
  const diffuse = clearShare + (1 - clearShare) * cloud
  const sun = (sunLux(sunAlt) * cut * diffuse) / Math.PI
  const moon = (sky.moonLux * moonLaw * Math.max(Math.sin((moonAlt * Math.PI) / 180), 0) * cut * 0.15) / Math.PI
  const city = (cityZenith ?? sky.cityGlow.zenith) * (1 + 3 * cloud)
  return sun + moon + city
}

// The city's own light at the zenith of a clear night (cd/m²): its World Atlas value plus the natural
// sky where src/content/cityGlow.json has one, else the one shared constant.
export const NATURAL_SKY_MCD = 0.171168465 // 22.00 mag/arcsec²
export function cityGlowZenith(cityId, glow) {
  const artificial = glow.atlas?.values?.[cityId]
  return artificial == null ? glow.zenith : (artificial + NATURAL_SKY_MCD) / 1000
}

// A metered luminance L comes out at key × (L / ref)^range: brighter skies still read brighter, over a
// few stops instead of eighteen.
export const exposureFor = (L, { key, ref, range }) => (key * (L / ref) ** range) / L

// Columns: the city-frame directions the drop's axis, right and up map to. A rotation, so the lens
// still inverts the image exactly as the optics say.
// Hours of a local day → how late in the night it is for lit windows: 0 through the evening, rising
// to 1 by 2 am, easing back through the early morning. Decorative, not data.
const LATE = [[0, 0.6], [2, 1], [5, 1], [6.5, 0.4], [8, 0.2], [18, 0], [21, 0], [24, 0.6]]
export function lateness(hour) {
  const h = ((hour % 24) + 24) % 24
  for (let i = 1; i < LATE.length; i++) {
    const [h0, v0] = LATE[i - 1]
    const [h1, v1] = LATE[i]
    if (h <= h1) return v0 + ((v1 - v0) * (h - h0)) / (h1 - h0)
  }
  return LATE[0][1]
}

export function localHour(date, tz) {
  if (!tz) return 12
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value])
  )
  return Number(parts.hour) + Number(parts.minute) / 60
}

const smoothstep = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1)
  return t * t * (3 - 2 * t)
}

// A vantage's facing: the bearing from it to its landmark, or to the middle of its landmarks.
export const viewBearing = (view) => meanBearing(view.toward.map((t) => bearing(view.from.at, t.at)))

// How far up the view looks: `facing.pitch`, or at night, when the moon is up and within
// moonTilt.halfWidth of the view's direction, high enough to hold it `moonTilt.below` above the centre.
export function moonTiltPitch({ night, moon, yaw, facing }) {
  const tilt = facing.moonTilt
  const off = Math.abs((((moon.azimuth - yaw) % 360) + 540) % 360 - 180)
  if (!tilt || !night || moon.altitude <= 0 || off > tilt.halfWidth) return facing.pitch
  return Math.min(Math.max(moon.altitude - tilt.below, facing.pitch), tilt.max)
}

export function cityBasis(yawDeg, pitchDeg) {
  const view = dirFromAltAz(pitchDeg, yawDeg)
  const up = dirFromAltAz(pitchDeg + 90, yawDeg)
  const right = [view[1] * up[2] - view[2] * up[1], view[2] * up[0] - view[0] * up[2], view[0] * up[1] - view[1] * up[0]]
  return { view, right, up }
}

// Each city gets its own stretch of the shared cloud noise, fixed for the visit.
function cityOffset(id) {
  let h = 2166136261
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return [((h >>> 0) % 1000) / 1000, ((h >>> 10) % 1000) / 1000]
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))
