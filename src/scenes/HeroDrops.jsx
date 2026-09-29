import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { CONTENT, DIVE, HERO, heroDropsFor, visibleDrops } from '../config.js'
import { quality } from '../core/quality.js'
import { prewarm } from '../core/prewarm.js'
import { createPosterAtlas } from '../content/posterAtlas.js'
import { usesFootage } from '../content/contentSource.js'
import { pinDrop, registerDrop, unregisterDrop, updateVideoBudget } from '../content/videoManager.js'
import { state } from '../core/state.js'
import { useTier } from '../core/useTier.js'
import { acquireSky, releaseSky, skyContent, startSky } from '../sky/skyManager.js'
import HeroDrop from './HeroDrop.jsx'
import DropLabelAnchors from './DropLabelAnchors.jsx'

// The dive drop is always kept; lower tiers show fewer of the others.
const pickVisible = (drops) => visibleDrops(drops, quality.heroDrops)

// Beats 4–5: the hero drops. Each holds its city: its computed sky, or with footage its clip.
export default function HeroDrops({ clips, diveCity }) {
  return usesFootage(CONTENT.source) ? <FootageDrops clips={clips} diveCity={diveCity} /> : <SkyDrops diveCity={diveCity} />
}

// Each drop refracts its city's sky (src/sky/skyManager.js keeps them current). The dive drop is the
// same shader: its sharp parts are computed per pixel, so it holds up full-screen.
function SkyDrops({ diveCity }) {
  const tier = useTier()
  const { gl, camera, scene } = useThree()
  startSky(gl)
  const visible = useMemo(() => pickVisible(heroDropsFor(diveCity)), [tier, diveCity])
  const group = useRef()

  useEffect(() => {
    visible.forEach((d) => acquireSky(d.city))
    return () => visible.forEach((d) => releaseSky(d.city))
  }, [visible])

  // Compile the drop's sky variant now (under the loader), not on the frame a drop first comes into view.
  useEffect(() => prewarm(gl, group.current, camera, scene), [gl, camera, scene, visible])

  return (
    <group ref={group}>
      {visible.map((drop) => (
        <HeroDrop key={drop.city} position={drop.pos} sky={skyContent(drop.city)} dispersion={quality.name === 'high'} dive={drop.dive} />
      ))}
      <DropLabelAnchors drops={visible} />
    </group>
  )
}

// Footage: posters from one atlas; the video budget manager decides which drops play live video.
function FootageDrops({ clips, diveCity }) {
  const tier = useTier()
  const visible = useMemo(() => pickVisible(heroDropsFor(diveCity)), [tier, diveCity])
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

  useFrame(({ camera }, dt) => {
    // The dive drop holds a decoder through the whole dive, whatever else is on screen.
    pinDrop(diveCity, state.time >= DIVE.pinFrom && state.time <= DIVE.pinTo)
    updateVideoBudget(camera, Math.min(dt, 0.1))
  })

  return (
    <>
      {visible.map((drop, i) => (
        <HeroDrop
          key={drop.city}
          position={drop.pos}
          poster={atlas.texture}
          rect={rects[i]}
          slotKey={drop.city}
          dispersion={quality.name === 'high'}
          dive={drop.dive}
        />
      ))}
      <DropLabelAnchors drops={visible} />
    </>
  )
}
