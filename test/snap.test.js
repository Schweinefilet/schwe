import { test } from 'node:test'
import assert from 'node:assert/strict'
import { landing } from '../src/core/snap.js'

const points = [3.05, 3.6, 4.15].map((at) => ({ at, capture: 0.3 })).concat({ at: 10.1, capture: 0.6 })

test('lands on the point nearest where the scroll would stop, ahead of the picture', () => {
  assert.equal(landing({ picture: 2.9, target: 3.4, points }), 3.6)
  assert.equal(landing({ picture: 2.9, target: 3.2, points }), 3.05)
})

test('never lands behind the picture (no turning back)', () => {
  // The picture has just passed 3.6; the scroll stops a little after it: 4.15 is out of reach.
  assert.equal(landing({ picture: 3.65, target: 3.75, points }), null)
  // Scrolling up: only points above the picture count.
  assert.equal(landing({ picture: 4.3, target: 3.9, points }), 4.15)
  assert.equal(landing({ picture: 4.1, target: 3.7, points }), 3.6)
})

test('nothing within capture: rests where it stops', () => {
  assert.equal(landing({ picture: 5, target: 6, points }), null)
  assert.equal(landing({ picture: 9, target: 9.6, points }), 10.1) // the dive's wider capture
  assert.equal(landing({ picture: 9, target: 9.4, points }), null)
})

test('a picture already on a point does not land on it again', () => {
  assert.equal(landing({ picture: 3.6, target: 3.62, points }), null)
  assert.equal(landing({ picture: 3, target: 3, points }), null)
})

test('a new gesture can leave the point the last one landed on', () => {
  // Touch: the scroll already rests on the dive point while the picture is still far behind it. A new
  // swipe starting there is not pulled back to it.
  assert.equal(landing({ picture: 7, target: 10.6, points, from: 10.1 }), null)
  // A gesture that starts before the point still lands on it.
  assert.equal(landing({ picture: 7, target: 10.6, points, from: 8 }), 10.1)
  // Up from a point: it no longer counts, the next one above does.
  assert.equal(landing({ picture: 4.3, target: 3.7, points, from: 4.15 }), 3.6)
})
