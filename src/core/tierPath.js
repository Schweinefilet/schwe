import { driftFor } from '../config.js'
import { createCameraPath } from './cameraPath.js'
import { quality } from './quality.js'

const paths = new Map()

// The camera path for the tier now showing (config.js driftFor: it slows only at the drops this tier
// shows), and its drift's slow points. Shared by the camera rig and the scroll's pacing, so both swap
// paths on the same frame when a tier drops.
export function tierPath() {
  const count = quality.heroDrops
  if (!paths.has(count)) {
    const d = driftFor(count)
    paths.set(count, { path: createCameraPath(d.keys), passes: d.passes })
  }
  return paths.get(count)
}
