import { MANIFEST_FILE } from './naming.js'

// Where clips live. Local dev: public/clips. Production: set VITE_CLIP_BASE_URL to the R2 URL (trailing slash).
export const CLIP_BASE = import.meta.env.VITE_CLIP_BASE_URL ?? '/clips/'

const EMPTY = { version: 1, clips: [] }

// Fetched at runtime, not bundled, so swapping clips in the bucket needs no rebuild.
export async function loadManifest() {
  try {
    const res = await fetch(`${CLIP_BASE}${MANIFEST_FILE}`, { cache: 'no-cache' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } catch (err) {
    console.warn('[manifest] could not load, using empty manifest:', err.message)
    return EMPTY
  }
}

export function clipUrls(entry) {
  if (!entry) return null
  const url = (file) => (file ? `${CLIP_BASE}${file}` : null)
  return {
    mp4: url(entry.sources.mp4),
    webm: url(entry.sources.webm),
    poster: url(entry.poster),
  }
}
