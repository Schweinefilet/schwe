import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { HERO } from '../config.js'
import { getSlot } from '../content/videoManager.js'
import { rig } from '../core/rig.js'
import envChunk from '../shaders/env.glsl?raw'
import dropFrag from '../shaders/drop.frag.glsl?raw'

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const fragmentShader = `${envChunk}\n${dropFrag}`

// Until a clip arrives the drop refracts plain black, i.e. only the environment and glints show.
const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
BLACK.needsUpdate = true
const FULL_RECT = new THREE.Vector4(0, 0, 1, 1)

// The proxy mesh only has to cover the sphere's silhouette; the shader finds the exact surface.
// A little larger than the radius so the low-poly outline never clips the true edge.
const proxy = new THREE.SphereGeometry(1.06, 32, 24)

export function createDropMaterial({ radius = HERO.radius, dispersion = true } = {}) {
  const halfFov = THREE.MathUtils.degToRad(HERO.clipFov / 2)
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    defines: dispersion ? { DISPERSION: '' } : {},
    uniforms: {
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: radius },
      uIor: { value: HERO.ior },
      uDispersion: { value: HERO.dispersion },
      uPoster: { value: BLACK },
      uPosterRect: { value: FULL_RECT.clone() },
      uVideo: { value: BLACK },
      uLive: { value: 0 },
      uClipTan: { value: new THREE.Vector2(Math.tan(halfFov), Math.tan(halfFov) * (9 / 16)) },
      uExposure: { value: HERO.exposure },
      uReflGain: { value: HERO.reflGain },
      uGlint: { value: HERO.glint },
      uDive: { value: 0 },
      uCoverTan: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true, // for the anti-aliased rim only; the body is opaque
  })
}

const CLIP_ASPECT = 16 / 9
const COVER_MARGIN = 0.985 // keeps the clip's own edge just outside the screen

// Framing (tan of half the view angle, x and y) at which a 16:9 clip exactly covers the screen, like
// CSS object-fit: cover. At rig.dive = 1 the drop shows the clip with this framing.
function coverTan(camera, out) {
  const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const tx = ty * camera.aspect
  if (camera.aspect > CLIP_ASPECT) out.set(tx, tx / CLIP_ASPECT)
  else out.set(ty * CLIP_ASPECT, ty)
  out.multiplyScalar(COVER_MARGIN)
}

// One hero drop. `poster` + `rect`: its cell in the poster atlas. The video budget manager's record
// for `slotKey` ({ live, texture }) is read every frame, so going live never re-renders React.
// `slot` can be passed directly instead (the drop lab does). `dive`: this is the drop the camera
// enters, so it follows rig.dive.
export default function HeroDrop({ position, radius = HERO.radius, poster = null, rect = null, slotKey = null, slot = null, dispersion = true, dive = false }) {
  const material = useMemo(() => createDropMaterial({ radius, dispersion }), [radius, dispersion])
  const u = material.uniforms

  u.uCenter.value.set(...position)
  u.uPoster.value = poster ?? BLACK
  u.uPosterRect.value.copy(rect ?? FULL_RECT)

  useFrame(({ camera }) => {
    if (dive) {
      u.uDive.value = rig.dive
      if (rig.dive > 0) coverTan(camera, u.uCoverTan.value)
    }
    const s = slot ?? (slotKey ? getSlot(slotKey) : null)
    const live = s?.texture ? s.live : 0
    u.uLive.value = live
    u.uVideo.value = live > 0 ? s.texture : BLACK
  })

  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={proxy} material={material} position={position} scale={radius} />
}
