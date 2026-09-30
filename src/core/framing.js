import * as THREE from 'three'

// Keeps each drift drop fully in frame at its slow point on any screen shape. The camera path is the
// same for every screen, and a portrait phone sees a narrow slice of it: four drops sat partly off
// its edge just where their city shows. For each drop this works out how far the view must turn, at
// the moment the camera is slowest before it, to bring the drop `margin` px inside the frame (nothing
// on screens where it fits), and eases that turn in and out over `window` units of timeline time
// either side. A fixed, smooth bump, not a chase: aiming at the drop itself would swing the view
// round as the camera passes beside it.
//
// `path`: core/cameraPath.js; `drops`: [{ pos, at }], each drop and its slow point; `fov`: vertical,
// degrees; `aspect`, `height`: the screen (px); `radius`: a drop's radius. Returns turnAt(t) → [yaw,
// pitch] in radians (yaw about world up, positive to the left; pitch about the view's right, positive up).
export function createFraming(path, drops, { fov, aspect, height, radius, margin = 24, window = 0.3 }) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.01, 100)
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  const v = new THREE.Vector3()
  const halfY = THREE.MathUtils.degToRad(fov / 2)
  const halfX = Math.atan(Math.tan(halfY) * aspect)
  const focal = height / 2 / Math.tan(halfY)
  const bumps = []
  for (const { pos, at } of drops) {
    path.sample(at, out)
    cam.position.copy(out.pos)
    cam.lookAt(out.look)
    cam.updateMatrixWorld()
    v.fromArray(pos).applyMatrix4(cam.matrixWorldInverse) // x right, y up, −z ahead
    if (v.z >= 0) continue
    const dist = v.length()
    const room = Math.asin(Math.min(radius / dist, 1)) + margin / focal // the drop's own size, and the margin
    const ax = Math.atan2(v.x, -v.z)
    const ay = Math.atan2(v.y, -v.z)
    const yaw = -Math.sign(ax) * Math.max(0, Math.abs(ax) - (halfX - room))
    const pitch = Math.sign(ay) * Math.max(0, Math.abs(ay) - (halfY - room))
    if (yaw || pitch) bumps.push({ at, yaw, pitch })
  }
  const turn = [0, 0]
  return (t) => {
    turn[0] = turn[1] = 0
    for (const b of bumps) {
      const x = (t - b.at) / window
      if (x <= -1 || x >= 1) continue
      const w = 0.5 + 0.5 * Math.cos(Math.PI * x) // raised cosine: no jump in the turn's speed
      turn[0] += b.yaw * w
      turn[1] += b.pitch * w
    }
    return turn
  }
}

const UP = new THREE.Vector3(0, 1, 0)
const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()

// Turns the look target `look` seen from `pos` by [yaw, pitch] (createFraming), in place.
export function applyTurn(pos, look, [yaw, pitch]) {
  if (!yaw && !pitch) return look
  _dir.subVectors(look, pos).applyAxisAngle(UP, yaw)
  _right.crossVectors(_dir, UP).normalize()
  _dir.applyAxisAngle(_right, pitch)
  return look.copy(pos).add(_dir)
}
