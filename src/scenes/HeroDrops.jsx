import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { CONTENT, DIVE, HERO, SKY, heroDropsFor, visibleDrops } from '../config.js'
import { quality } from '../core/quality.js'
import { prewarm } from '../core/prewarm.js'
import { createPosterAtlas } from '../content/posterAtlas.js'
import { usesFootage } from '../content/contentSource.js'
import { pinDrop, registerDrop, unregisterDrop, updateVideoBudget } from '../content/videoManager.js'
import { state } from '../core/state.js'
import { useTier } from '../core/useTier.js'
import { acquireSky, onSkyReady, prefetchSkies, releaseSky, setSkyDetail, skyContent, startSky } from '../sky/skyManager.js'
import HeroDrop from './HeroDrop.jsx'
import DropLabelAnchors from './DropLabelAnchors.jsx'

const _p = new THREE.Vector3()

// The dive drop is always kept, and so is the ending's rain city; lower tiers show fewer of the others.
const pickVisible = (drops, keep) => visibleDrops(drops, quality.heroDrops, keep)

// The rain city as it was at "enter". A late answer (the weather came after "enter") does not move a
// city into a drop the visitor may already be looking at.
function useKeptCity(city) {
  const [kept, setKept] = useState(city)
  useEffect(() => {
    if (!state.unlocked) setKept(city)
  }, [city])
  return kept
}

// Beats 4–5: the hero drops. Each holds its city: its computed sky, or with footage its clip.
export default function HeroDrops({ clips, diveCity, rainCity }) {
  const keep = useKeptCity(rainCity)
  return usesFootage(CONTENT.source) ? <FootageDrops clips={clips} diveCity={diveCity} keep={keep} /> : <SkyDrops diveCity={diveCity} keep={keep} />
}

// Each drop refracts its city's sky (src/sky/skyManager.js keeps them current). The dive drop is the
// same shader: its sharp parts are computed per pixel, so it holds up full-screen.
function SkyDrops({ diveCity, keep }) {
  const tier = useTier()
  const { gl, camera, scene } = useThree()
  startSky(gl)
  const visible = useMemo(() => pickVisible(heroDropsFor(diveCity), keep), [tier, diveCity, keep])
  const group = useRef()

  // Each drop's city holds the images it can show (SKY.skyline): the dive drop the full set (half on a
  // small canvas), a drift drop the small set, the half one while the camera passes close.
  const wide = useThree((s) => Math.max(s.size.width, s.size.height) * s.viewport.dpr)
  const diveSet = wide <= SKY.skyline.diveHalfMax ? 'half' : 'full'
  const near = useRef(new Set())
  useEffect(() => {
    near.current.clear()
    for (const d of visible) setSkyDetail(d.city, 'drop', d.dive ? diveSet : null)
    return () => visible.forEach((d) => setSkyDetail(d.city, 'drop', null))
  }, [visible, diveSet])
  // The half sets of the drift's cities, fetched in the order the camera passes them once the visit
  // has begun, so each is in before the camera comes close (on a slow connection a set takes seconds).
  useEffect(() => onSkyReady(() => prefetchSkies(visible.filter((d) => !d.dive).map((d) => d.city), 'half')), [visible])
  // (Asked before the drops take their cities, so a city starts on the set it needs.)
  useEffect(() => {
    visible.forEach((d) => acquireSky(d.city))
    return () => visible.forEach((d) => releaseSky(d.city))
  }, [visible])
  useFrame(({ camera }) => {
    const [enter, leave] = SKY.skyline.near
    for (const d of visible) {
      if (d.dive) continue
      const dist = camera.position.distanceTo(_p.fromArray(d.pos))
      const was = near.current.has(d.city)
      if (was ? dist < leave : dist >= enter) continue
      if (was) near.current.delete(d.city)
      else near.current.add(d.city)
      setSkyDetail(d.city, 'drop', was ? null : 'half')
    }
  })

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
function FootageDrops({ clips, diveCity, keep }) {
  const tier = useTier()
  const visible = useMemo(() => pickVisible(heroDropsFor(diveCity), keep), [tier, diveCity, keep])
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
