import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createCameraPath } from '../src/core/cameraPath.js'
import { applyTurn, createFraming } from '../src/core/framing.js'

// A straight dolly down −z, looking ahead; one drop off to the right of the path, 0.4 ahead of the
// camera at its slow point (t = 2), like a drift pass.
const path = createCameraPath([
  { at: 0, pos: [0, 0, 4], look: [0, 0, -6] },
  { at: 4, pos: [0, 0, -4], look: [0, 0, -14] },
])
const drop = { pos: [0.12, 0, -0.4], at: 2 }
const opts = { fov: 50, height: 844, radius: 0.03, margin: 24 }
const PHONE = 390 / 844
const DESKTOP = 1440 / 900

// Px from the drop's edge to the nearest edge of the screen, with the framing's turn applied.
function room(framing, aspect, t, width = opts.height * aspect) {
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }
  path.sample(t, out)
  applyTurn(out.pos, out.look, framing(t))
  const cam = new THREE.PerspectiveCamera(opts.fov, aspect, 0.01, 100)
  cam.position.copy(out.pos)
  cam.lookAt(out.look)
  cam.updateMatrixWorld()
  const p = new THREE.Vector3(...drop.pos)
  const dist = p.distanceTo(cam.position)
  const ndc = p.project(cam)
  const focal = opts.height / 2 / Math.tan(THREE.MathUtils.degToRad(opts.fov / 2))
  const r = (opts.radius / Math.sqrt(dist * dist - opts.radius ** 2)) * focal
  const x = ((ndc.x + 1) / 2) * width
  const y = ((1 - ndc.y) / 2) * opts.height
  return Math.min(x - r, y - r, width - x - r, opts.height - y - r)
}

test('a drop cut off by a narrow screen is brought fully into frame at its slow point', () => {
  const none = () => [0, 0]
  assert.ok(room(none, PHONE, 2) < 0, 'the drop starts off the edge')
  const framing = createFraming(path, [drop], { ...opts, aspect: PHONE })
  assert.ok(room(framing, PHONE, 2) >= opts.margin - 1, `room ${room(framing, PHONE, 2)}`)
  assert.ok(framing(2)[0] < 0, 'it turns right, toward the drop')
})

test('screens where the drop fits are left alone', () => {
  const framing = createFraming(path, [drop], { ...opts, aspect: DESKTOP })
  for (let t = 0; t <= 4; t += 0.05) assert.deepEqual([...framing(t)], [0, 0])
})

test('the turn eases in and out around the slow point and is zero outside its window', () => {
  const framing = createFraming(path, [drop], { ...opts, aspect: PHONE, window: 0.3 })
  const peak = framing(2)[0]
  assert.equal(framing(1.7)[0], 0)
  assert.equal(framing(2.3)[0], 0)
  assert.ok(Math.abs(framing(1.85)[0] - peak / 2) < 1e-9, 'half way at half the window (raised cosine)')
  // No jump anywhere: consecutive samples stay close.
  let prev = framing(1.6)[0]
  for (let t = 1.6; t <= 2.4; t += 0.001) {
    const v = framing(t)[0]
    assert.ok(Math.abs(v - prev) < Math.abs(peak) * 0.02, `jump at ${t}`)
    prev = v
  }
})
