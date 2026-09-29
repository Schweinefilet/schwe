import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BACKDROP_CODEC, decodeBackdrop, encodeBackdrop } from '../src/content/backdropCodec.js'

const { knee, max } = BACKDROP_CODEC

// The build script encodes with encodeBackdrop and env.glsl decodes with the same formula; after 8-bit
// quantization every level from the dark sky to the lamps must come back within one code's step.
test('backdrop codec: 8-bit round trip, soft within 4%, sharp within 7% (a fixed step below the knee)', () => {
  for (const [range, rel] of [[max.soft, 0.04], [max.sharp, 0.07]])
    for (const v of [0.01, 0.05, 0.1, 0.5, 1, 4, 32, 200, range / 2]) {
      const back = decodeBackdrop(Math.round(encodeBackdrop(v, range) * 255) / 255, range)
      const tolerance = v < knee ? rel * knee : rel * v
      assert.ok(Math.abs(back - v) <= tolerance, `max ${range}: ${v} → ${back}`)
    }
})

test('backdrop codec: black is 0, the ceiling is 1, and it clamps beyond', () => {
  for (const range of [max.soft, max.sharp]) {
    assert.equal(encodeBackdrop(0, range), 0)
    assert.equal(encodeBackdrop(range, range), 1)
    assert.equal(encodeBackdrop(range * 10, range), 1)
    assert.equal(encodeBackdrop(-1, range), 0)
    assert.ok(Math.abs(decodeBackdrop(1, range) - range) < 1e-6 * range)
  }
})
