import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SPLASH, WATER } from '../config.js'
import { rig } from '../core/rig.js'
import { state } from '../core/state.js'
import { fall, fallPosition } from '../core/fall.js'
import { prewarm } from '../core/prewarm.js'
import { pinDrop, registerDrop, unregisterDrop } from '../content/videoManager.js'
import envChunk from '../shaders/env.glsl?raw'
import waterChunk from '../shaders/water.glsl?raw'
import vertexShader from '../shaders/splash.vert.glsl?raw'
import HeroDrop from './HeroDrop.jsx'

const fragmentShader = /* glsl */ `
${envChunk}
${waterChunk}
uniform float uCrop;     // radius (sim units) where the baked mesh ends and the puddle takes over
uniform float uSurface;  // resting water height (sim units)
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLocalXZ;
varying float vLocalY;
void main() {
  vec3 v = normalize(vWorld - cameraPosition);
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n; // the crown is a thin sheet: both sides are seen
  // Calm water at rest height is left to the puddle underneath (which carries the rings), so only
  // what the drop disturbed is drawn: the crater, crown, jet. The crop edge fades out too.
  float disturbed = max(smoothstep(0.002, 0.004, abs(vLocalY - uSurface)), smoothstep(0.03, 0.1, 1.0 - abs(n.y)));
  float edge = 1.0 - smoothstep(0.55 * uCrop, 0.85 * uCrop, length(vLocalXZ));
  gl_FragColor = vec4(shadeWater(v, n), disturbed * edge);
}`

function loadData(base) {
  const loader = new THREE.TextureLoader()
  const tex = (file) =>
    new Promise((resolve, reject) =>
      loader.load(
        `${base}${file}`,
        (t) => {
          // Raw data, not an image: exact texel values, no filtering, no color conversion.
          t.flipY = false
          t.colorSpace = THREE.NoColorSpace
          t.minFilter = t.magFilter = THREE.NearestFilter
          t.generateMipmaps = false
          resolve(t)
        },
        undefined,
        reject
      )
    )
  return Promise.all([
    fetch(`${base}splash.json`).then((r) => r.json()),
    tex('splash_hi.png'),
    tex('splash_lo.png'),
    tex('splash_nrm.png'),
  ]).then(([meta, hi, lo, nrm]) => ({ meta, hi, lo, nrm }))
}

// Beat 7: one drop falls, then the baked crown splash plays. The VAT frame follows scroll, so
// scrolling back up plays the splash in reverse and lifts the drop back into the word.
export default function Splash({ clips, rainCity }) {
  const [data, setData] = useState(null)
  const vatMesh = useRef()
  const drop = useRef()

  // Load order (bible): rain and the first clips first; the splash data streams in during the drift.
  const [wanted, setWanted] = useState(false)
  useFrame(() => {
    if (!wanted && state.time >= SPLASH.loadAfter) setWanted(true)
  })

  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    loadData(`${import.meta.env.BASE_URL}${SPLASH.url}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => console.warn('[splash] VAT not available:', err.message))
    return () => {
      cancelled = true
    }
  }, [wanted])

  const vat = useMemo(() => {
    if (!data) return null
    const { meta } = data
    const n = meta.vertsPerFrame
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)) // unused; three requires it
    geometry.setAttribute('aIndex', new THREE.BufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1))
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uHi: { value: data.hi },
        uLo: { value: data.lo },
        uNrm: { value: data.nrm },
        uFrame: { value: 0 },
        uWidth: { value: meta.width },
        uRowsPerFrame: { value: meta.rowsPerFrame },
        uBoundsMin: { value: new THREE.Vector3(...meta.boundsMin) },
        uBoundsMax: { value: new THREE.Vector3(...meta.boundsMax) },
        uQuantMax: { value: meta.quantMax ?? 65535 },
        uCrop: { value: Math.min(-meta.boundsMin[0], meta.boundsMax[0]) },
        uSurface: { value: meta.surfaceY },
        uReflGain: { value: WATER.reflGain },
        uDeep: { value: new THREE.Color(...WATER.deep) },
        uTransGain: { value: WATER.transGain },
      },
      side: THREE.DoubleSide,
      transparent: true,
    })
    const scale = SPLASH.fallRadius / meta.dropRadius
    fall.handoffHeight = meta.dropStartAbove * scale
    return { geometry, material, scale, surfaceY: meta.surfaceY, frames: meta.frames }
  }, [data])

  useEffect(
    () => () => {
      vat?.geometry.dispose()
      vat?.material.dispose()
    },
    [vat]
  )

  // The falling drop carries the ending's city (where it is raining hardest, or where rain arrives
  // first). Its clip decodes from the word's arrival to the impact; outside that it holds no decoder.
  const urls = (rainCity?.city && clips?.find((c) => c.city === rainCity.city)?.urls) || null
  useEffect(() => {
    if (!urls) return
    registerDrop(FALL_SLOT, { position: FALL_ORIGIN, radius: SPLASH.fallRadius, urls, full: false })
    return () => unregisterDrop(FALL_SLOT)
  }, [urls])
  const poster = usePoster(urls?.poster)

  // Prepare beat 7 ahead of time: the falling drop (its material variant and poster) while the loader
  // is up, the baked splash (shader and data textures) as soon as it downloads during the drift.
  // Otherwise both compile on the frames they first appear: the fall's start and the impact.
  const { gl, camera, scene } = useThree()
  useEffect(() => prewarm(gl, drop.current, camera, scene, [poster]), [gl, camera, scene, poster, urls])
  useEffect(() => {
    if (vat) prewarm(gl, vatMesh.current, camera, scene, [data.hi, data.lo, data.nrm])
  }, [gl, camera, scene, vat, data])

  useFrame(() => {
    if (urls) pinDrop(FALL_SLOT, state.time >= SPLASH.fallPinFrom && state.time <= SPLASH.impactAt)
    fallPosition(rig.fall)
    // Hand-off: the VAT's first frame holds the sim's own drop exactly where the falling drop ends.
    const handedOff = !!vat && rig.fall >= 1
    if (drop.current) drop.current.visible = rig.fall > 0 && !handedOff
    if (!vat) return
    const m = vatMesh.current
    m.visible = handedOff
    // The sim's resting surface sits at surfaceY; put it on the ground under the impact point.
    m.position.set(fall.impact.x, fall.impact.y - vat.surfaceY * vat.scale, fall.impact.z)
    vat.material.uniforms.uFrame.value = Math.round(rig.splash * (vat.frames - 1))
  })

  return (
    <>
      <group ref={drop} visible={false}>
        {/* A function, not fall.pos: children run their frame callbacks before this component does,
            so reading fall.pos there would draw the drop one frame behind the camera. */}
        {urls ? (
          <HeroDrop key="city" position={FALL_ORIGIN} radius={SPLASH.fallRadius} positionRef={currentFallPosition} slotKey={FALL_SLOT} poster={poster} dispersion={false} />
        ) : (
          <HeroDrop key="env" position={FALL_ORIGIN} radius={SPLASH.fallRadius} positionRef={currentFallPosition} envOnly dispersion={false} />
        )}
      </group>
      {vat && <mesh ref={vatMesh} geometry={vat.geometry} material={vat.material} scale={vat.scale} frustumCulled={false} visible={false} />}
    </>
  )
}

const FALL_ORIGIN = [0, 0, 0]
const FALL_SLOT = 'fall'

// The city's poster, shown until its video is live (a slow network never leaves the drop black).
function usePoster(url) {
  const [texture, setTexture] = useState(null)
  useEffect(() => {
    if (!url) return
    let tex = null
    let cancelled = false
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace
      if (cancelled) t.dispose()
      else setTexture((tex = t))
    })
    return () => {
      cancelled = true
      tex?.dispose()
      setTexture(null)
    }
  }, [url])
  return texture
}
const currentFallPosition = () => fallPosition(rig.fall)
