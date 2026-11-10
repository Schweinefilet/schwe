import MODELS from '../content/models.json'

// The three maquettes. Each sits on its own stretch of the studio floor, SPACING metres from the next, so
// a move between two crosses bare floor (which is when the shadow map changes hands).
//
// A view: the point looked at (metres east, up, north of the model's centre), the compass bearing the
// lens points along, its elevation above the horizon, the distance and the vertical field of view. Long
// lenses throughout: 9 to 14 degrees, a 135 to 200 mm lens on a full frame. `wide` is the view for a
// landscape window, `tall` for a portrait one; windows in between blend the two.
export const SPACING = 40000

const VIEWS = {
  'new-york': {
    tz: 'America/New_York',
    wide: { at: [-350, 150, -1000], bearing: 35, elevation: 10, distance: 16500, fov: 8.5 },
    tall: { at: [150, 150, -300], bearing: 30, elevation: 20, distance: 19000, fov: 15 },
  },
  london: {
    tz: 'Europe/London',
    wide: { at: [-300, 60, -250], bearing: 68, elevation: 8.5, distance: 9300, fov: 8.5 },
    tall: { at: [700, 60, 100], bearing: 276, elevation: 14, distance: 10500, fov: 14 },
  },
  paris: {
    tz: 'Europe/Paris',
    wide: { at: [-1000, 150, -100], bearing: 78, elevation: 7.5, distance: 9000, fov: 7 },
    tall: { at: [-1300, 150, -100], bearing: 80, elevation: 14, distance: 10500, fov: 14 },
  },
}

export const CITIES = Object.entries(MODELS).map(([id, m], i) => ({
  id,
  name: m.name,
  lat: m.center[0],
  lon: m.center[1],
  ...VIEWS[id],
  halfLength: m.halfLength,
  halfWidth: m.halfWidth,
  axisBearing: m.axisBearing,
  offset: [i * SPACING, 0, 0],
  glb: `/models/${id}.glb`,
  ground: `/models/${id}-ground.png`,
}))

export const cityById = (id) => CITIES.find((c) => c.id === id)
