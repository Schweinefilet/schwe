import * as THREE from 'three'
import { BACKDROP } from '../config.js'
import { BACKDROP_CODEC, backdropRange, decodeBackdrop, encodeBackdrop } from './backdropCodec.js'

// The backdrop's textures and decoding, shared by reference: every material that includes env.glsl
// spreads envUniforms into its own uniforms. Black until loadBackdrop() has put them on the GPU.
function black() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
  t.needsUpdate = true
  return t
}

// env.glsl's decoder: x: the log range in stops, y: knee × exposure.
const codec = (max) => new THREE.Vector2(backdropRange(max), BACKDROP_CODEC.knee * BACKDROP.exposure)

export const envUniforms = {
  uEnvSharp: { value: black() },
  uEnvSoft: { value: black() },
  uEnvCodecSharp: { value: codec(BACKDROP_CODEC.max.sharp) },
  uEnvCodecSoft: { value: codec(BACKDROP_CODEC.max.soft) },
  uEnvYaw: { value: THREE.MathUtils.degToRad(BACKDROP.yaw) },
}

// The start view (BACKDROP.view), for the backdrop only (Sky.jsx): the window of the square the first
// shot sees in focus, from a high-resolution copy. Off until loaded; outside it, the sharp map stands in.
const rad = THREE.MathUtils.degToRad
export const viewUniforms = {
  uEnvView: { value: black() },
  uEnvViewOn: { value: 0 },
  uEnvViewEdges: { value: new THREE.Vector4(rad(BACKDROP.view.lon[0]), rad(BACKDROP.view.lon[1]), rad(BACKDROP.view.lat[0]), rad(BACKDROP.view.lat[1])) },
  uEnvViewLevels: { value: 0 }, // its highest mip level
  uEnvCodecView: { value: codec(BACKDROP_CODEC.max.soft) },
}

let loading = null
let ready = false
const listeners = new Set()

function load(url) {
  return new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}${url}`).then((t) => {
    t.wrapS = THREE.RepeatWrapping // longitude wraps
    t.generateMipmaps = false // the backdrop is magnified; it is read at level 0 only
    t.minFilter = THREE.LinearFilter
    return t
  })
}

// A log-encoded map with its mip chain built here, in linear light. A small bead takes in a wide angle
// through each pixel, so it reads the coarse levels, and the start view blurs through them as focus
// moves; the GPU would average the log codes, which turns a lamp in a dark street into a dim smudge
// instead of the light it adds to the average.
async function loadWithMips(url, max) {
  const blob = await (await fetch(`${import.meta.env.BASE_URL}${url}`)).blob()
  // Rows bottom-up, as the texture's v runs; values exactly as stored (they are not colours).
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'flipY', colorSpaceConversion: 'none' })
  const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height })
  const g = canvas.getContext('2d', { willReadFrequently: true })
  g.drawImage(bitmap, 0, 0)
  const top = g.getImageData(0, 0, bitmap.width, bitmap.height)
  const linear = Float32Array.from({ length: 256 }, (_, i) => decodeBackdrop(i / 255, max))
  const levels = [{ data: new Uint8Array(top.data.buffer), width: top.width, height: top.height }]
  for (let { data, width, height } = levels[0]; width > 1 || height > 1; ) {
    const w = Math.max(1, width >> 1)
    const h = Math.max(1, height >> 1)
    const next = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (Math.min(2 * y, height - 1) * width + Math.min(2 * x, width - 1)) * 4
        const dx = width > 1 ? 4 : 0
        const dy = height > 1 ? width * 4 : 0
        for (let c = 0; c < 3; c++) {
          const mean = (linear[data[i + c]] + linear[data[i + dx + c]] + linear[data[i + dy + c]] + linear[data[i + dx + dy + c]]) / 4
          next[(y * w + x) * 4 + c] = Math.round(encodeBackdrop(mean, max) * 255)
        }
        next[(y * w + x) * 4 + 3] = 255
      }
    levels.push({ data: next, width: w, height: h })
    ;({ data, width, height } = levels.at(-1))
  }
  const t = new THREE.DataTexture(levels[0].data, levels[0].width, levels[0].height)
  t.mipmaps = levels
  t.generateMipmaps = false
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.wrapS = THREE.RepeatWrapping
  t.needsUpdate = true
  return t
}

// Idempotent. Loads the maps and uploads them, then reports ready, which holds the loader's "enter"
// (App.jsx). `view`: 'full' or 'half' also loads the start view at that size (the tier's
// quality.backdropView); the drop lab, which has no first shot, passes nothing. A failed load leaves
// that map black (the start view off) and still reports ready, so "enter" never hangs.
export function loadBackdrop(renderer, view = null) {
  loading ??= Promise.all([
    Promise.all([loadWithMips(BACKDROP.sharp, BACKDROP_CODEC.max.sharp), load(BACKDROP.soft)])
      .then(([sharp, soft]) => {
        renderer.initTexture(sharp)
        renderer.initTexture(soft)
        envUniforms.uEnvSharp.value = sharp
        envUniforms.uEnvSoft.value = soft
      })
      .catch((err) => console.warn('[backdrop] not loaded, drawing black:', err?.message ?? err)),
    view &&
      loadWithMips(BACKDROP.view[view], BACKDROP_CODEC.max.soft)
        .then((t) => {
          renderer.initTexture(t)
          viewUniforms.uEnvView.value = t
          viewUniforms.uEnvViewLevels.value = t.mipmaps.length - 1
          viewUniforms.uEnvViewOn.value = 1
        })
        .catch((err) => console.warn('[backdrop] start view not loaded, using the sharp map:', err?.message ?? err)),
  ]).finally(() => {
    ready = true
    listeners.forEach((fn) => fn())
  })
  return loading
}

export const isBackdropReady = () => ready

export function onBackdropReady(fn) {
  if (ready) fn()
  else listeners.add(fn)
  return () => listeners.delete(fn)
}
