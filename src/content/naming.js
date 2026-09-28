// Clip naming convention, shared by the app and the Node scripts.
// Final filenames: {city}_{light}_{weather}.{mp4|webm|jpg}, e.g. new-york_dusk_rain.webm
// 720p encodes add a size suffix: new-york_dusk_rain_720.mp4 (used inside drops and on the low tier).
// City ids are kebab-case so "_" stays an unambiguous separator.

export const LIGHT_STATES = ['night', 'dawn', 'day', 'dusk']
export const WEATHERS = ['clear', 'rain', 'snow']
export const FALLBACK_WEATHER = 'clear'

export const VIDEO_EXTS = ['mp4', 'webm']
export const POSTER_EXT = 'jpg'
export const MANIFEST_FILE = 'manifest.json'

export const clipId = (city, light, weather) => `${city}_${light}_${weather}`

export const SIZE_SUFFIXES = ['720']

const CLIP_RE = new RegExp(
  `^([a-z0-9]+(?:-[a-z0-9]+)*)_(${LIGHT_STATES.join('|')})_(${WEATHERS.join('|')})(?:_(${SIZE_SUFFIXES.join('|')}))?\\.(${[...VIDEO_EXTS, POSTER_EXT].join('|')})$`
)

// Returns { id, city, light, weather, size, ext } or null if the name does not follow the convention.
// `size` is null for the full-size encode, '720' for the 720p one.
export function parseClipFilename(filename) {
  const m = CLIP_RE.exec(filename)
  if (!m) return null
  const [, city, light, weather, size = null, ext] = m
  return { id: clipId(city, light, weather), city, light, weather, size, ext }
}
