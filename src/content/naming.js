// Clip naming convention, shared by the app and the Node scripts.
// Final filenames: {city}_{light}_{weather}.{mp4|webm|jpg}, e.g. new-york_dusk_rain.webm
// City ids are kebab-case so "_" stays an unambiguous separator.

export const LIGHT_STATES = ['night', 'dawn', 'day', 'dusk']
export const WEATHERS = ['clear', 'rain']
export const FALLBACK_WEATHER = 'clear'

export const VIDEO_EXTS = ['mp4', 'webm']
export const POSTER_EXT = 'jpg'
export const MANIFEST_FILE = 'manifest.json'

export const clipId = (city, light, weather) => `${city}_${light}_${weather}`

const CLIP_RE = new RegExp(
  `^([a-z0-9]+(?:-[a-z0-9]+)*)_(${LIGHT_STATES.join('|')})_(${WEATHERS.join('|')})\\.(${[...VIDEO_EXTS, POSTER_EXT].join('|')})$`
)

// Returns { id, city, light, weather, ext } or null if the name does not follow the convention.
export function parseClipFilename(filename) {
  const m = CLIP_RE.exec(filename)
  if (!m) return null
  const [, city, light, weather, ext] = m
  return { id: clipId(city, light, weather), city, light, weather, ext }
}
