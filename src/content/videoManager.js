import * as THREE from 'three'
import { quality } from '../core/quality.js'
import { createClipVideo, createVideoTexture, destroyClipVideo } from './video.js'

// Video budget. Phones stall with many videos decoding at once, so at most `quality.decoders` drops
// play live video; every other drop shows its poster from the atlas. The drops that fill the most
// screen (radius / distance, in front of the camera) get the decoders. A pinned drop (the one the
// camera dives into) always gets one. Going live and going back to the poster are crossfades.
//
// Each slot is a plain object the drop's material reads every frame:
//   slot.live     0..1 mix from poster to video
//   slot.texture  THREE.VideoTexture while a video is attached, else null

const ASSIGN_EVERY_MS = 250
const FADE_PER_SECOND = 2.5 // 0 → 1 in 0.4 s
const HYSTERESIS = 1.25 // a challenger must fill 25% more screen to take a decoder away
const MIN_SCORE = 0.012 // radius / distance below which a drop is too small to be worth decoding

const slots = new Map() // key → slot
let lastAssign = 0
const _forward = new THREE.Vector3()
const _to = new THREE.Vector3()

export function registerDrop(key, { position, radius, urls, full = false }) {
  let slot = slots.get(key)
  if (!slot) {
    slot = { key, position: new THREE.Vector3(), radius, urls: null, full, pinned: false, want: false, live: 0, video: null, texture: null, ready: false }
    slots.set(key, slot)
  }
  slot.position.set(...position)
  slot.radius = radius
  if (slot.urls?.mp4 !== urls?.mp4) {
    // The clip changed (new light state or weather). A live drop fades back to its poster first
    // (no hard cut) and picks up the new clip once released; an idle one switches at once.
    if (slot.video) slot.nextUrls = urls
    else slot.urls = urls
  }
  return slot
}

export function unregisterDrop(key) {
  const slot = slots.get(key)
  if (!slot) return
  release(slot)
  slots.delete(key)
}

export function pinDrop(key, pinned) {
  const slot = slots.get(key)
  if (slot) slot.pinned = pinned
}

export const getSlot = (key) => slots.get(key)

function sourcesFor(slot) {
  const u = slot.urls
  // Inside drops the image is small, so 720p is plenty; the dive drop ends up filling the screen, so
  // it always gets the full encode unless the tier caps video at 720p.
  const full = slot.full && quality.videoHeight >= 1080
  return {
    mp4: (!full && u.mp4_720) || u.mp4,
    webm: (!full && u.webm_720) || u.webm,
    poster: u.poster,
  }
}

function attach(slot) {
  const video = createClipVideo(sourcesFor(slot))
  const texture = createVideoTexture(video)
  slot.video = video
  slot.texture = texture
  slot.ready = false
  const markReady = () => {
    if (slot.video === video) slot.ready = true
  }
  // Only fade in once a real frame is decoded, so the drop never flashes black.
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(markReady)
  else video.addEventListener('playing', markReady, { once: true })
  video.play().catch(() => {}) // autoplay of muted inline video is allowed; ignore aborts on release
}

function release(slot) {
  if (slot.nextUrls !== undefined) {
    slot.urls = slot.nextUrls
    delete slot.nextUrls
  }
  if (slot.video) destroyClipVideo(slot.video)
  slot.texture?.dispose()
  slot.video = null
  slot.texture = null
  slot.ready = false
  slot.live = 0
}

function assign(camera) {
  camera.getWorldDirection(_forward)
  const scored = []
  for (const slot of slots.values()) {
    if (!slot.urls) continue
    _to.subVectors(slot.position, camera.position)
    const dist = Math.max(_to.length(), 1e-3)
    const facing = _to.dot(_forward) / dist
    let score = facing > 0.2 ? slot.radius / dist : 0
    if (slot.want) score *= HYSTERESIS
    if (slot.pinned) score = Infinity
    scored.push([score, slot])
  }
  scored.sort((a, b) => b[0] - a[0])
  // A slot waiting to switch clips gives up its decoder first, so it can fade out and reload.
  scored.forEach(([score, slot], i) => (slot.want = i < quality.decoders && score >= MIN_SCORE && slot.nextUrls === undefined))
}

// Called once per frame (from HeroDrops). Assignment is throttled; fades run every frame.
export function updateVideoBudget(camera, dt) {
  const now = performance.now()
  if (now - lastAssign > ASSIGN_EVERY_MS) {
    lastAssign = now
    assign(camera)
  }

  // Count decoders in use, including ones still fading out, so the budget is never exceeded.
  let inUse = 0
  for (const slot of slots.values()) if (slot.video) inUse++

  for (const slot of slots.values()) {
    if (slot.want) {
      if (!slot.video && inUse < quality.decoders) {
        attach(slot)
        inUse++
      }
      if (slot.ready) slot.live = Math.min(1, slot.live + dt * FADE_PER_SECOND)
    } else if (slot.video) {
      slot.live = Math.max(0, slot.live - dt * FADE_PER_SECOND)
      if (slot.live === 0) {
        release(slot)
        inUse--
      }
    }
  }
}

export function liveCount() {
  let n = 0
  for (const slot of slots.values()) if (slot.video) n++
  return n
}
