import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { DIVE, HERO, HERO_DROPS } from '../config.js'
import { quality } from '../core/quality.js'
import { createPosterAtlas } from '../content/posterAtlas.js'
import { pinDrop, registerDrop, unregisterDrop, updateVideoBudget } from '../content/videoManager.js'
import { state } from '../core/state.js'
import HeroDrop from './HeroDrop.jsx'

// The dive drop is always kept; lower tiers show fewer of the others.
const pickVisible = () => [
  ...HERO_DROPS.filter((d) => d.dive),
  ...HERO_DROPS.filter((d) => !d.dive).slice(0, quality.heroDrops - 1),
]

// Beats 4–5: the hero drops. Posters come from one atlas; the video budget manager decides which
// drops play live video.
export default function HeroDrops({ clips }) {
  const visible = useMemo(pickVisible, [])
  const atlas = useMemo(() => createPosterAtlas(), [])
  useEffect(() => () => atlas.dispose(), [atlas])
  const rects = useMemo(() => visible.map((_, i) => atlas.rectAt(i)), [atlas, visible])

  useEffect(() => {
    const byCity = Object.fromEntries((clips ?? []).map((c) => [c.city, c]))
    for (const d of visible) {
      registerDrop(d.city, { position: d.pos, radius: HERO.radius, urls: byCity[d.city]?.urls ?? null, full: d.dive })
    }
    atlas.update(visible.map((d) => ({ key: d.city, url: byCity[d.city]?.urls?.poster })))
  }, [clips, atlas, visible])

  useEffect(() => () => visible.forEach((d) => unregisterDrop(d.city)), [visible])

  const diveCity = visible.find((d) => d.dive).city
  useFrame(({ camera }, dt) => {
    // The dive drop holds a decoder through the whole dive, whatever else is on screen.
    pinDrop(diveCity, state.time >= DIVE.pinFrom && state.time <= DIVE.pinTo)
    updateVideoBudget(camera, Math.min(dt, 0.1))
  })

  return visible.map((drop, i) => (
    <HeroDrop
      key={drop.city}
      position={drop.pos}
      poster={atlas.texture}
      rect={rects[i]}
      slotKey={drop.city}
      dispersion={quality.name === 'high'}
      dive={drop.dive}
    />
  ))
}
