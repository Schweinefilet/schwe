import * as THREE from 'three'
import { CITIES } from './cities.js'
import { PLINTH_DEPTH } from './Maquette.jsx'

// The camera rig's pieces shared by the studio (Stage.jsx) and the photoreal New York (real/RealNewYork.jsx):
// each city's view for a window's shape, the drift, the shadow map's fit, the city clocks, the scene's one
// look object.

export const MOVE_S = 3.4 // a move between cities
export const DRIFT = { bearing: 4.5, bearingS: 96, elevation: 0.5, elevationS: 61 }
const LIGHT_DISTANCE = 30000
const TALLEST = 620 // above every roof on the three models
export const RAD = Math.PI / 180
// Which night it is in a city: its local date twelve hours ago, as a day number (so one night is one number).
export const DAY = Object.fromEntries(CITIES.map((c) => [c.id, new Intl.DateTimeFormat('en-CA', { timeZone: c.tz, year: 'numeric', month: '2-digit', day: '2-digit' })]))
export const nightNumber = (city, date) => Math.round(Date.parse(DAY[city.id].format(new Date(date.getTime() - 12 * 3600e3))) / 86400e3) % 10000
// The city's month on its own clock (1..12): the night it belongs to, as above.
export const nightMonth = (city, date) => Number(DAY[city.id].format(new Date(date.getTime() - 12 * 3600e3)).slice(5, 7))

export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
export const smooth = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
export const mix = (a, b, t) => a + (b - a) * t

// Dev: ?cam=bearing,elevation,distance,fov[,east,up,north[,near]] replaces the selected city's view, for
// choosing one (near: the camera's near plane, for a view from inside the model).
export const CAM = import.meta.env.DEV ? new URLSearchParams(location.search).get('cam')?.split(',').map(Number) : null
// Dev: ?still stops the drift, so two screenshots of one view match.
export const STILL = import.meta.env.DEV && new URLSearchParams(location.search).has('still')

// A city's view for a window of this shape, in world coordinates.
export function viewOf(city, aspect) {
  const t = smooth(0.8, 1.45, aspect)
  const a = city.tall
  const b = city.wide
  let bearing = a.bearing + (((b.bearing - a.bearing + 540) % 360) - 180) * t
  let elevation = mix(a.elevation, b.elevation, t)
  // The wide view is composed for 16:9; a squarer window stands farther back to keep the model's width.
  let distance = mix(a.distance, b.distance, t) * Math.max(1, (16 / 9 / Math.max(aspect, 1.45)) ** 0.9) * (aspect < 0.8 ? Math.max(1, (0.5 / aspect) ** 0.7) : 1)
  let fov = mix(a.fov, b.fov, t)
  let at = a.at.map((v, i) => mix(v, b.at[i], t))
  if (CAM) [bearing, elevation, distance, fov, at] = [CAM[0], CAM[1], CAM[2], CAM[3], CAM.length > 6 ? CAM.slice(4, 7) : at]
  return { x: city.offset[0] + at[0], y: at[1], z: city.offset[2] - at[2], bearing, elevation, distance, fov }
}

export function blendView(out, a, b, t) {
  for (const k of ['x', 'y', 'z', 'elevation', 'distance', 'fov']) out[k] = mix(a[k], b[k], t)
  out.bearing = a.bearing + (((b.bearing - a.bearing + 540) % 360) - 180) * t
  return out
}

// A model that has just arrived asks for the shadow map again, for a few frames while it uploads.
export const redraw = { frames: 0 }

// One look object for the whole scene, mutated every frame (never React state).
export const LOOK = { current: {} }

const X = new THREE.Vector3()
const Y = new THREE.Vector3()
const Z = new THREE.Vector3()
const P = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

// Aims the sun at a city and fits its shadow camera round the plinth and everything on it.
export function fitShadow(light, city, dir) {
  const [cx, , cz] = city.offset
  Z.set(dir[0], dir[1], dir[2])
  light.position.set(cx + Z.x * LIGHT_DISTANCE, Z.y * LIGHT_DISTANCE, cz + Z.z * LIGHT_DISTANCE)
  light.target.position.set(cx, 0, cz)
  light.target.updateMatrixWorld()
  X.crossVectors(UP, Z).normalize()
  Y.crossVectors(Z, X)
  const b = city.axisBearing * RAD
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity }
  for (const u of [-city.halfLength, city.halfLength])
    for (const v of [-city.halfWidth, city.halfWidth])
      for (const h of [-PLINTH_DEPTH, TALLEST]) {
        P.set(u * Math.sin(b) + v * Math.cos(b), h, -u * Math.cos(b) + v * Math.sin(b))
        const x = P.dot(X)
        const y = P.dot(Y)
        const z = P.dot(Z)
        box.x0 = Math.min(box.x0, x)
        box.x1 = Math.max(box.x1, x)
        box.y0 = Math.min(box.y0, y)
        box.y1 = Math.max(box.y1, y)
        box.z0 = Math.min(box.z0, z)
        box.z1 = Math.max(box.z1, z)
      }
  const cam = light.shadow.camera
  const pad = 80
  cam.left = box.x0 - pad
  cam.right = box.x1 + pad
  cam.bottom = box.y0 - pad
  cam.top = box.y1 + pad
  cam.near = LIGHT_DISTANCE - box.z1 - 200
  cam.far = LIGHT_DISTANCE - box.z0 + 200
  cam.updateProjectionMatrix()
}

