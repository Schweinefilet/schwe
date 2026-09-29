import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCameraPath } from '../src/core/cameraPath.js'

const key = (at, pos, extra = {}) => ({ at, pos, look: [0, 0, -10], ...extra })
const at = (path, t) => path.sample(t, { pos: null, look: null }).pos
const near = (a, b, eps = 1e-9) => a.every((v, i) => Math.abs(v - b[i]) < eps)
const velocity = (path, t, dt = 1e-5) => at(path, t + dt).map((v, i) => (v - at(path, t - dt)[i]) / (2 * dt))

// Uneven spacing on purpose: like rain (1) → freeze (1.08) → drift (2.5).
const keys = [key(0, [0, 16, 16]), key(1, [0, 5, 14]), key(1.08, [0, 5, 13.9]), key(2.5, [0, 4.5, 10]), key(5, [1, 4, -10]), key(8, [0, 4.2, -30])]
const path = createCameraPath(keys)

test('passes exactly through every key', () => {
  for (const k of keys) assert.ok(near(at(path, k.at), k.pos), `key at ${k.at}`)
})

test('velocity is continuous at every inner key (no speed jumps)', () => {
  for (const k of keys.slice(1, -1)) {
    // One-sided velocities just either side of the key must agree.
    const before = velocity(path, k.at - 1e-6, 1e-7)
    const after = velocity(path, k.at + 1e-6, 1e-7)
    before.forEach((v, i) => assert.ok(Math.abs(v - after[i]) < 1e-3 * (1 + Math.abs(v)), `axis ${i} at ${k.at}: ${v} vs ${after[i]}`))
  }
})

test('never overshoots between two keys (short segment stays between its ends)', () => {
  for (let t = 1; t <= 1.08; t += 0.004) {
    const [, y, z] = at(path, t)
    assert.ok(y <= 5 + 1e-9 && y >= 5 - 1e-9, `y ${y}`)
    assert.ok(z <= 14 + 1e-9 && z >= 13.9 - 1e-9, `z ${z} at ${t}`)
  }
})

test('identical consecutive keys hold exactly, and are entered and left at rest', () => {
  const p = createCameraPath([key(0, [0, 0, 0]), key(1, [1, 0, 0]), key(2, [1, 0, 0]), key(3, [2, 0, 0])])
  for (let t = 1; t <= 2; t += 0.1) assert.ok(near(at(p, t), [1, 0, 0]))
  assert.ok(Math.abs(velocity(p, 1 - 1e-3)[0]) < 0.01)
  assert.ok(Math.abs(velocity(p, 2 + 1e-3)[0]) < 0.01)
})

test('speed < 1 slows the camera at that key without stopping it', () => {
  const plain = createCameraPath([key(0, [0, 0, 0]), key(1, [1, 0, 0]), key(2, [2, 0, 0])])
  const slow = createCameraPath([key(0, [0, 0, 0]), key(1, [1, 0, 0], { speed: 0.4 }), key(2, [2, 0, 0])])
  const v = velocity(plain, 1)[0]
  const vs = velocity(slow, 1)[0]
  assert.ok(vs > 0 && vs < 0.5 * v, `${vs} vs ${v}`)
})

test('clamps outside the key range', () => {
  assert.ok(near(at(path, -1), keys[0].pos))
  assert.ok(near(at(path, 99), keys.at(-1).pos))
})
