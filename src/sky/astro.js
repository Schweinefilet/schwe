// Sky geometry for one place and moment. Pure math, no three.js, so it runs in tests.
//
// The city frame is right-handed with y up: x east, y up, z south. A direction at altitude `alt`
// and azimuth `az` (degrees, from north through east, as SunCalc 2 reports them) is
// (cos alt sin az, sin alt, -cos alt cos az).

const RAD = Math.PI / 180
const J2000 = Date.UTC(2000, 0, 1, 12) // JD 2451545.0
const DAY_MS = 86400000

export const daysSinceJ2000 = (date) => (date.getTime() - J2000) / DAY_MS

export function dirFromAltAz(altDeg, azDeg) {
  const alt = altDeg * RAD
  const az = azDeg * RAD
  return [Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az)]
}

export function altAzFromDir([x, y, z]) {
  const alt = Math.asin(Math.max(-1, Math.min(1, y))) / RAD
  const az = ((Math.atan2(x, -z) / RAD) % 360 + 360) % 360
  return { alt, az }
}

// Local mean sidereal time in radians: the right ascension on the meridian. Same series as SunCalc.
export function localSiderealTime(date, lonDeg) {
  const deg = 280.46061837 + 360.98564736629 * daysSinceJ2000(date) + lonDeg
  return (((deg % 360) + 360) % 360) * RAD
}

// Precession from the J2000 equator and equinox to the mean equator and equinox of `date`
// (IAU 1976, Meeus ch. 21). Row-major 3×3: v_date = P · v_J2000.
export function precessionMatrix(date) {
  const T = daysSinceJ2000(date) / 36525
  const as = RAD / 3600
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T ** 3) * as
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T ** 3) * as
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T ** 3) * as
  const [cZ, sZ, cz, sz, cT, sT] = [Math.cos(zeta), Math.sin(zeta), Math.cos(z), Math.sin(z), Math.cos(theta), Math.sin(theta)]
  return [
    [cZ * cT * cz - sZ * sz, -sZ * cT * cz - cZ * sz, -sT * cz],
    [cZ * cT * sz + sZ * cz, -sZ * cT * sz + cZ * cz, -sT * sz],
    [cZ * sT, -sZ * sT, cT],
  ]
}

const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]))
const transpose = (A) => [0, 1, 2].map((i) => A.map((row) => row[i]))
export const apply = (A, v) => A.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])

// Rows: the equatorial axes of date (RA 0h, RA 6h, north celestial pole) written in the city frame,
// so v_equatorial = E · v_city. The pole stands `lat` above the northern horizon; the equator crosses
// the meridian 90° − lat above the southern one, and turns westward with sidereal time.
export function equatorialOfDate(latDeg, lst) {
  const phi = latDeg * RAD
  const pole = [0, Math.sin(phi), -Math.cos(phi)]
  const meridian = [0, Math.cos(phi), Math.sin(phi)] // equator at hour angle 0
  const east = [1, 0, 0]
  const c = Math.cos(lst)
  const s = Math.sin(lst)
  return [
    [c * meridian[0] - s * east[0], c * meridian[1] - s * east[1], c * meridian[2] - s * east[2]],
    [s * meridian[0] + c * east[0], s * meridian[1] + c * east[1], s * meridian[2] + c * east[2]],
    pole,
  ]
}

// City frame → J2000 equatorial (the star catalogue's frame), as a row-major 3×3.
export function cityToJ2000(date, latDeg, lonDeg) {
  const E = equatorialOfDate(latDeg, localSiderealTime(date, lonDeg))
  return mul(transpose(precessionMatrix(date)), E)
}

export const raDecToVec = (ra, dec) => [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]

export function vecToRaDec([x, y, z]) {
  return { ra: ((Math.atan2(y, x) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), dec: Math.asin(Math.max(-1, Math.min(1, z))) }
}

// Share of the moon's disk that is lit, from the directions it is drawn with (the sun is far enough
// away that its direction from the moon equals its direction from here).
export const litFraction = (sunDir, moonDir) => (1 - (sunDir[0] * moonDir[0] + sunDir[1] * moonDir[1] + sunDir[2] * moonDir[2])) / 2

// Moon brightness relative to full at phase angle ψ (degrees, 0 = full). Allen's law, which includes
// the opposition surge that makes the full moon disproportionately bright.
export const moonPhaseLaw = (psi) => 10 ** (-0.4 * (0.026 * Math.abs(psi) + 4e-9 * psi ** 4))

// Disk-integrated brightness of a Lommel-Seeliger sphere (what the shader draws) relative to full.
export function lommelSeeligerPhase(psi) {
  const a = Math.abs(psi) * RAD
  if (a < 1e-4) return 1
  if (a > Math.PI - 1e-3) return 0
  return 1 - Math.sin(a / 2) * Math.tan(a / 2) * Math.log(1 / Math.tan(a / 4))
}

// Global horizontal illuminance of a clear sky by solar altitude (lux, log-linear between points),
// after published daylight and twilight measurements (Bond & Henderson 1963 and later).
const SUN_LUX = [
  [-90, -3.4], [-18, -3.2], [-12, -2.1], [-9, -0.9], [-6, 0.53], [-4, 1.1], [-2, 1.9], [0, 2.7],
  [2, 3.2], [5, 3.6], [10, 4.04], [20, 4.45], [30, 4.68], [45, 4.88], [60, 4.98], [90, 5.04],
]
export function sunLux(altDeg) {
  const a = Math.max(-90, Math.min(90, altDeg))
  let i = 1
  while (i < SUN_LUX.length - 1 && SUN_LUX[i][0] < a) i++
  const [x0, y0] = SUN_LUX[i - 1]
  const [x1, y1] = SUN_LUX[i]
  return 10 ** (y0 + ((a - x0) / (x1 - x0)) * (y1 - y0))
}

// Initial great-circle bearing from a to b ([lat, lon], degrees), clockwise from north like SunCalc's
// azimuths.
export function bearing([lat1, lon1], [lat2, lon2]) {
  const p1 = lat1 * RAD
  const p2 = lat2 * RAD
  const dl = (lon2 - lon1) * RAD
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360
}

// The middle of several bearings (their circular mean), degrees.
export function meanBearing(bearings) {
  const x = bearings.reduce((s, b) => s + Math.cos(b * RAD), 0)
  const y = bearings.reduce((s, b) => s + Math.sin(b * RAD), 0)
  return ((Math.atan2(y, x) / RAD) % 360 + 360) % 360
}
