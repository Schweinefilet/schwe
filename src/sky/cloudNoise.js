import * as THREE from 'three'
import { buildCloudNoise } from './cloudNoiseData.js'

// The cloud noise as a texture: built in a worker, mipmapped so distant cloud averages instead of
// shimmering. Where workers fail, it is built here instead (a 0.2 s stall, never a missing sky).
export function loadCloudNoise(seed = 7) {
  return new Promise((resolve) => {
    const fallback = () => resolve(toTexture(buildCloudNoise(seed)))
    let worker
    try {
      worker = new Worker(new URL('./cloudNoise.worker.js', import.meta.url), { type: 'module' })
    } catch {
      return fallback()
    }
    worker.onmessage = (e) => {
      worker.terminate()
      resolve(toTexture(e.data))
    }
    worker.onerror = () => {
      worker.terminate()
      fallback()
    }
    worker.postMessage({ seed })
  })
}

function toTexture({ data, size }) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.UnsignedByteType)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}
