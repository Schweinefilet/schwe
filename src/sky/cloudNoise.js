import * as THREE from 'three'

// The cloud layer's pattern: one tileable 512² texture shared by every city (each reads its own
// stretch). Red: warped value-noise fBm, histogram-equalized so its values are uniform on 0..1, so
// thresholding it at 1 - cover covers exactly that share of the sky. Green: finer detail for density.
// Built on the CPU once (about 0.2 s), mipmapped so distant cloud averages instead of shimmering.

const SIZE = 512

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Periodic value noise: an n × n lattice of random values, smoothly interpolated, wrapping at n.
function lattice(n, random) {
  const v = new Float32Array(n * n)
  for (let i = 0; i < v.length; i++) v[i] = random()
  return (x, y) => {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    const x0 = ((xi % n) + n) % n
    const y0 = ((yi % n) + n) % n
    const x1 = (x0 + 1) % n
    const y1 = (y0 + 1) % n
    const a = v[y0 * n + x0] + (v[y0 * n + x1] - v[y0 * n + x0]) * sx
    const b = v[y1 * n + x0] + (v[y1 * n + x1] - v[y1 * n + x0]) * sx
    return a + (b - a) * sy
  }
}

// fBm over lattice sizes `sizes`, sampled at (u, v) in 0..1 (so it tiles).
function fbm(sizes, gain, random) {
  const octaves = sizes.map((n) => [n, lattice(n, random)])
  return (u, v) => {
    let sum = 0
    let amp = 1
    let norm = 0
    for (const [n, noise] of octaves) {
      sum += noise(u * n, v * n) * amp
      norm += amp
      amp *= gain
    }
    return sum / norm
  }
}

// Replaces each value with its rank: the result is uniform on 0..1 with the same shapes.
function equalize(values) {
  const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b])
  const out = new Float32Array(values.length)
  order.forEach((index, rank) => (out[index] = rank / (values.length - 1)))
  return out
}

export function createCloudNoise(seed = 7) {
  const random = rng(seed)
  const warp = fbm([4, 8], 0.5, random)
  const shape = fbm([4, 8, 16, 32, 64, 128], 0.55, random)
  const detail = fbm([32, 64, 128, 256], 0.5, random)
  const a = new Float32Array(SIZE * SIZE)
  const b = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE
      const v = y / SIZE
      const w = warp(u, v) - 0.5
      a[y * SIZE + x] = shape(u + 0.12 * w, v + 0.12 * warp(v + 0.37, u + 0.61) - 0.06)
      b[y * SIZE + x] = detail(u, v)
    }
  }
  const r = equalize(a)
  const g = equalize(b)
  const data = new Uint8Array(SIZE * SIZE * 2)
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i * 2] = Math.round(r[i] * 255)
    data[i * 2 + 1] = Math.round(g[i] * 255)
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGFormat, THREE.UnsignedByteType)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
