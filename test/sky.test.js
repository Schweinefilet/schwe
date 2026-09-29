import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMoonIllumination, getPosition } from 'suncalc'
import {
  altAzFromDir,
  apply,
  cityToJ2000,
  dirFromAltAz,
  equatorialOfDate,
  litFraction,
  localSiderealTime,
  precessionMatrix,
  raDecToVec,
  vecToRaDec,
} from '../src/sky/astro.js'
import { cityBasis, exposureFor, meteredLuminance, skyInputs } from '../src/sky/inputs.js'
import { buildStarCells, cubeFace, faceDir, EMPTY_MAG } from '../src/sky/starCells.js'

const RAD = Math.PI / 180
const CITIES = [
  { id: 'tokyo', lat: 35.6762, lon: 139.6503 },
  { id: 'sydney', lat: -33.8688, lon: 151.2093 },
  { id: 'london', lat: 51.5072, lon: -0.1276 },
  { id: 'mumbai', lat: 19.076, lon: 72.8777 },
]
const DATES = ['2026-09-29T14:30Z', '2026-12-21T03:00Z', '2027-03-20T18:45Z'].map((d) => new Date(d))
// The values skyInputs reads from config.js SKY (config.js imports JSON, which node can't without attributes).
const SKY = {
  refreshDegrees: 0.25,
  facing: { pitch: 15, moonBelow: -12 },
  exposure: { key: 0.2, ref: 3000, range: 0.2 },
  sunLux: 1.28e5,
  moonLux: 0.3,
  moonColour: [1, 0.93, 0.84],
  earthshine: 1.2e-4,
  cityGlow: { colour: [1, 0.72, 0.48], zenith: 0.012, horizon: 4, cloud: 5, ground: 3 },
  clouds: { baseKm: 2, rainBaseKm: 1, tileKm: 40, tauMin: 3, tauMax: 25, tauPerMm: 4 },
  rainHaze: { coef: 0.25, exp: 0.63, fogPerKm: 7.8 },
  stars: { lux0: 2.5e-6 },
}
const transpose = (M) => [0, 1, 2].map((i) => M.map((row) => row[i]))
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const near = (a, b, eps) => Math.abs(a - b) <= eps

test('altitude/azimuth ↔ direction round trip, north is -z and east is +x', () => {
  const same = (a, b) => a.every((v, i) => near(v, b[i], 1e-12))
  assert.ok(same(dirFromAltAz(0, 0), [0, 0, -1]))
  assert.ok(same(dirFromAltAz(0, 90), [1, 0, 0]))
  const { alt, az } = altAzFromDir(dirFromAltAz(37.5, 212.25))
  assert.ok(near(alt, 37.5, 1e-9) && near(az, 212.25, 1e-9))
})

test('precession moves Polaris to its 2026 declination (+89.37°)', () => {
  const polaris = raDecToVec(37.9546 * RAD, 89.2641 * RAD) // J2000
  const { dec } = vecToRaDec(apply(precessionMatrix(new Date('2026-09-29T00:00Z')), polaris))
  assert.ok(near(dec / RAD, 89.372, 0.02), `dec ${dec / RAD}`)
})

test('the celestial pole stands at the latitude, due north or south', () => {
  for (const city of CITIES) {
    for (const date of DATES) {
      const pole = raDecToVec(0, (city.lat >= 0 ? 90 : -90) * RAD) // J2000 pole; precession moves it < 0.2°
      const local = apply(transpose(cityToJ2000(date, city.lat, city.lon)), pole)
      const { alt, az } = altAzFromDir(local)
      assert.ok(near(alt, Math.abs(city.lat), 0.2), `${city.id} pole altitude ${alt}`)
      assert.ok(near(az, city.lat >= 0 ? 0 : 180, 0.5) || near(az, 360, 0.5), `${city.id} pole azimuth ${az}`)
    }
  }
})

// The sun's RA/Dec of date (Astronomical Almanac low-precision formula, ~0.01°), placed with sidereal
// time, must land where SunCalc puts it. Above 10° altitude, where refraction is under 0.1°.
test('sidereal frame agrees with SunCalc on the sun', () => {
  for (const city of CITIES) {
    for (let h = 0; h < 24; h += 1.5) {
      const date = new Date(Date.parse('2026-09-29T00:00Z') + h * 3600e3)
      const sc = getPosition(date, city.lat, city.lon)
      if (sc.altitude < 10) continue
      const n = (date - Date.UTC(2000, 0, 1, 12)) / 86400000
      const g = (357.528 + 0.9856003 * n) * RAD
      const L = (280.46 + 0.9856474 * n) * RAD + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
      const eps = (23.439 - 4e-7 * n) * RAD
      const eq = raDecToVec(Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L)), Math.asin(Math.sin(eps) * Math.sin(L)))
      const local = apply(transpose(equatorialOfDate(city.lat, localSiderealTime(date, city.lon))), eq)
      const angle = Math.acos(Math.min(1, dot(local, dirFromAltAz(sc.altitude, sc.azimuth)))) / RAD
      assert.ok(angle < 0.15, `${city.id} ${date.toISOString()} off by ${angle.toFixed(3)}°`)
    }
  }
})

test("the moon's lit share, from the directions it is drawn with, matches SunCalc", () => {
  for (const city of CITIES) {
    for (let day = 0; day < 30; day += 2.5) {
      const date = new Date(Date.parse('2026-09-29T12:00Z') + day * 86400e3)
      const inputs = skyInputs({ city, date, sky: SKY })
      const f = litFraction(inputs.sun.dir, inputs.moon.dir)
      assert.ok(near(f, getMoonIllumination(date).fraction, 0.02), `${city.id} day ${day}: ${f} vs ${getMoonIllumination(date).fraction}`)
    }
  }
})

test('city basis is a rotation with right = view × up, as the drop frame has it', () => {
  for (const [yaw, pitch] of [[0, 15], [123, 15], [271, -5]]) {
    const { view, right, up } = cityBasis(yaw, pitch)
    for (const v of [view, right, up]) assert.ok(near(Math.hypot(...v), 1, 1e-9))
    assert.ok(near(dot(view, up), 0, 1e-9) && near(dot(view, right), 0, 1e-9))
    const c = cross(view, up)
    assert.ok(c.every((x, i) => near(x, right[i], 1e-9)))
  }
})

test('no weather data: clear, dry, no haze (never invented)', () => {
  const inputs = skyInputs({ city: CITIES[0], date: DATES[0], weather: null, sky: SKY })
  assert.equal(inputs.cloud, 0)
  assert.equal(inputs.rain, 0)
  assert.equal(inputs.haze, 0)
  const failed = { variant: 'clear', code: null, mmPerHour: null, cloudCover: null }
  assert.equal(skyInputs({ city: CITIES[0], date: DATES[0], weather: failed, sky: SKY }).clouds.cover, 0)
})

test('the sky texture key changes only when the sun has moved', () => {
  const at = (min) => skyInputs({ city: CITIES[2], date: new Date(Date.parse('2026-09-29T17:00Z') + min * 60000), sky: SKY }).lutKey
  assert.equal(at(0), at(0.2))
  assert.notEqual(at(0), at(10))
})

test('exposure: brighter skies still read brighter, over far fewer stops', () => {
  const out = (L) => L * exposureFor(L, SKY.exposure)
  const day = out(5000)
  const night = out(0.012)
  assert.ok(day > night)
  const stops = Math.log2(day / night)
  assert.ok(near(stops, Math.log2(5000 / 0.012) * SKY.exposure.range, 1e-9), `${stops} stops`)
})

test('twilight is metered as sky light, not as a sunlit day', () => {
  const at = (sunAlt) => meteredLuminance({ sunAlt, moonAlt: -10, moonLaw: 1, cloud: 0, rain: 0 }, SKY)
  assert.ok(at(-3) > 5 && at(-3) < 20, `sun -3°: ${at(-3)} cd/m²`)
  assert.ok(at(60) > 3000 && at(60) < 8000, `sun 60°: ${at(60)} cd/m²`)
  assert.ok(at(-20) < 0.05)
})

test('star cells: every star is found where it is, and merged pairs keep their light', () => {
  const stars = new Float32Array([
    0.1, 0.2, 1.0, 0.5,
    0.1 + 1e-4, 0.2, 2.0, 1.1, // shares the first star's cell
    2.5, -1.2, 3.0, 9,
    4.0, 0.7, 4.4, -0.1,
  ])
  const cells = 64
  const { data, width, placed, merged } = buildStarCells(stars, cells)
  assert.equal(placed, 3)
  assert.equal(merged, 1)
  for (const i of [0, 8, 12]) {
    const dir = raDecToVec(stars[i], stars[i + 1])
    const { face, u, v } = cubeFace(dir)
    const cx = Math.floor(u * cells)
    const cy = Math.floor(v * cells)
    const k = (cy * width + face * cells + cx) * 4
    const back = faceDir(face, (cx + data[k]) / cells, (cy + data[k + 1]) / cells)
    assert.ok(Math.acos(Math.min(1, dot(back, dir))) < 1e-5, `star ${i / 4} position`)
    if (i === 0) assert.ok(near(10 ** (-0.4 * data[k + 2]), 10 ** -0.4 + 10 ** -0.8, 1e-6), 'merged flux')
    else assert.ok(near(data[k + 2], stars[i + 2], 1e-6))
  }
  const empty = data.filter((_, i) => i % 4 === 2 && data[i] === EMPTY_MAG).length
  assert.equal(empty, width * cells - 3)
})

test('moon tilt: at night a risen moon within the view is tilted into frame', async () => {
  const { moonTiltPitch } = await import('../src/sky/inputs.js')
  const facing = { pitch: 15, moonBelow: -12, moonTilt: { halfWidth: 40, below: 10, max: 60 } }
  const at = (alt, az, yaw = 100, night = true) => moonTiltPitch({ night, moon: { altitude: alt, azimuth: az }, yaw, facing })
  assert.equal(at(50, 110), 40) // 10° under the moon
  assert.equal(at(80, 100), 60) // no higher than max
  assert.equal(at(20, 100), 15) // never lower than the usual pitch
  assert.equal(at(50, 160), 15) // outside the view's width: no tilt
  assert.equal(at(50, 350, 20), 40) // across north: 30° off
  assert.equal(at(-5, 100), 15) // below the horizon
  assert.equal(at(50, 100, 100, false), 15) // daytime
})

test('vantages: bearings from each city view toward its landmarks', async () => {
  const { bearing, meanBearing } = await import('../src/sky/astro.js')
  const { viewBearing } = await import('../src/sky/inputs.js')
  const views = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../src/content/vantages.json', import.meta.url), 'utf8'))
  // Trocadéro → Eiffel Tower is south-east, Azumabashi → Skytree almost due east.
  assert.ok(Math.abs(bearing(views.paris.from.at, views.paris.toward[0].at) - 134.3) < 0.5)
  assert.ok(Math.abs(viewBearing(views.tokyo) - 90) < 2)
  assert.ok(Math.abs(meanBearing([350, 10])) < 1e-9 || Math.abs(meanBearing([350, 10]) - 360) < 1e-9)
  for (const [id, v] of Object.entries(views)) if (id !== '_about') assert.ok(Number.isFinite(viewBearing(v)), id)
})
