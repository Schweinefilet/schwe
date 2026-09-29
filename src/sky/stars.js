import * as THREE from 'three'
import { buildStarCells } from './starCells.js'

// The star catalogue (public/sky/stars.bin, built by scripts/build-stars.mjs) as a cell texture the
// sky shader reads with texelFetch. Half floats: positions in a cell keep 1/2048 of a cell.
export async function loadStarTexture(url, cells) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`stars: HTTP ${res.status}`)
  const stars = new Float32Array(await res.arrayBuffer())
  const { data, width, height, placed, merged } = buildStarCells(stars, cells)
  const half = new Uint16Array(data.length)
  for (let i = 0; i < data.length; i++) half[i] = THREE.DataUtils.toHalfFloat(data[i])
  const texture = new THREE.DataTexture(half, width, height, THREE.RGBAFormat, THREE.HalfFloatType)
  texture.minFilter = texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return { texture, count: stars.length / 4, placed, merged }
}
