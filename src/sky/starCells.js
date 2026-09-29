// The star catalogue packed for per-pixel lookup: each cube face (J2000 equatorial frame) is split
// into `cells` × `cells` cells, and a cell holds its brightest star as (x, y within the cell,
// V magnitude, B-V). A pixel reads the 2 × 2 cells around it, so a star is drawn whole wherever it
// sits in its cell. Pure math, shared with the shader's cubeCell()/cellDir(), and run in tests.

export const EMPTY_MAG = 99

// Face 0..5 (+x, -x, +y, -y, +z, -z) and position on it, each 0..1.
export function cubeFace([x, y, z]) {
  const ax = Math.abs(x)
  const ay = Math.abs(y)
  const az = Math.abs(z)
  let face
  let u
  let v
  if (ax >= ay && ax >= az) [face, u, v] = x > 0 ? [0, -z / ax, y / ax] : [1, z / ax, y / ax]
  else if (ay >= az) [face, u, v] = y > 0 ? [2, x / ay, -z / ay] : [3, x / ay, z / ay]
  else [face, u, v] = z > 0 ? [4, x / az, y / az] : [5, -x / az, y / az]
  return { face, u: u * 0.5 + 0.5, v: v * 0.5 + 0.5 }
}

export function faceDir(face, u, v) {
  const s = u * 2 - 1
  const t = v * 2 - 1
  const d = [[1, t, -s], [-1, t, s], [s, 1, -t], [s, -1, t], [s, t, 1], [-s, t, -1]][face]
  const l = Math.hypot(...d)
  return d.map((c) => c / l)
}

// stars: Float32Array of [ra, dec, vmag, bv] records, brightest first. Returns RGBA texels for a
// (cells × 6) × cells texture, face-major along x. A star landing in an occupied cell adds its light
// to the brighter one there (close pairs read as one star at this size anyway), so no light is lost.
export function buildStarCells(stars, cells) {
  const width = cells * 6
  const data = new Float32Array(width * cells * 4)
  for (let i = 0; i < width * cells; i++) data[i * 4 + 2] = EMPTY_MAG
  let placed = 0
  let merged = 0
  for (let i = 0; i < stars.length; i += 4) {
    const [ra, dec, mag, bv] = [stars[i], stars[i + 1], stars[i + 2], stars[i + 3]]
    const dir = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
    const { face, u, v } = cubeFace(dir)
    const cx = Math.min(cells - 1, Math.floor(u * cells))
    const cy = Math.min(cells - 1, Math.floor(v * cells))
    const k = (cy * width + face * cells + cx) * 4
    if (data[k + 2] === EMPTY_MAG) {
      data.set([u * cells - cx, v * cells - cy, mag, bv], k)
      placed++
    } else {
      data[k + 2] = -2.5 * Math.log10(10 ** (-0.4 * data[k + 2]) + 10 ** (-0.4 * mag))
      merged++
    }
  }
  return { data, width, height: cells, placed, merged }
}
