// Landmarks the skyline draws from their real dimensions instead of raising their OpenStreetMap
// outline (build-skyline.mjs). Each returns, for a ray from the vantage along the ground direction
// (dx, dy), the elevation spans it covers: { dist (m), bottom, top (degrees), light(el) → 0 | 1 | 2 }.
// `replaces`: OSM elements it stands in for. `lights`: OSM element → height ranges (m) lit at night.

const RAD = Math.PI / 180

// A Ferris wheel in the vertical plane through its OSM footprint's long axis.
function wheel({ osm, local, eye, id, hub, radius, rim }) {
  const el = osm.elements.find((e) => `${e.type}/${e.id}` === id)
  if (!el?.geometry) throw new Error(`landmark ${id} is not in the OSM data`)
  const pts = el.geometry.map(local)
  const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  // Long axis of the footprint (the wheel's plane): the direction of greatest spread.
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const [x, y] of pts) {
    sxx += (x - c[0]) ** 2
    sxy += (x - c[0]) * (y - c[1])
    syy += (y - c[1]) ** 2
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const u = [Math.cos(a), Math.sin(a)]
  const n = [-u[1], u[0]]
  return (dx, dy) => {
    const dn = dx * n[0] + dy * n[1]
    if (Math.abs(dn) < 1e-3) return []
    const t = (c[0] * n[0] + c[1] * n[1]) / dn
    if (t <= 0) return []
    const s = (t * dx - c[0]) * u[0] + (t * dy - c[1]) * u[1] // offset along the wheel from its hub
    const elOf = (z) => Math.atan2(z - eye, t) / RAD
    const spans = []
    const band = (z0, z1, light) => spans.push({ dist: t, bottom: elOf(z0), top: elOf(z1), light: () => light })
    // The rim with its capsules, where this ray crosses it: above and below the hub.
    const inner = radius - rim / 2
    const outer = radius + rim / 2
    if (Math.abs(s) <= outer) {
      const zo = Math.sqrt(outer * outer - s * s)
      const zi = Math.abs(s) < inner ? Math.sqrt(inner * inner - s * s) : 0
      band(hub + zi, hub + zo, 1)
      band(hub - zo, hub - zi, 1)
    }
    if (Math.abs(s) < 5) band(hub - 5, hub + 5, 0) // the hub
    return spans
  }
}

const LANDMARKS = {
  london: ({ osm, local, eye }) => [
    {
      name: 'London Eye',
      replaces: ['way/204068874'],
      // 135 m tall, 120 m across (London Eye): hub at 75 m. Rim and capsules drawn 7 m thick; its
      // lights are on at night. The A-frame legs are left out: their exact geometry is not to hand.
      spans: wheel({ osm, local, eye, id: 'way/204068874', hub: 75, radius: 60, rim: 7 }),
    },
    {
      name: 'Elizabeth Tower clock faces',
      // The four dials, 7 m across, lit at night (drawn as the band of the tower they sit in).
      lights: { 'way/123557148': [[52, 59]] },
      spans: () => [],
    },
  ],
}

export function landmarksFor(city, ctx) {
  const make = LANDMARKS[city]
  if (!make) return []
  return make(ctx).map((l) => ({ ...l, spans: typeof l.spans === 'function' ? l.spans : () => [] }))
}
