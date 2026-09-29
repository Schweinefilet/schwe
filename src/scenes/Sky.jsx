import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import envChunk from '../shaders/env.glsl?raw'
import { envUniforms, loadBackdrop, viewUniforms } from '../content/backdrop.js'
import { globalUniforms } from '../core/uniforms.js'
import { quality } from '../core/quality.js'
import { BACKDROP } from '../config.js'

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position; // sphere centered on the camera: local position is the view direction
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // depth = 1: always behind everything
}`

// Focused on the rain (uFocus 1) the backdrop is the soft copy. Focused far (0, the first shot) it is
// the start view (BACKDROP.view), sharp, with the sharp map standing in outside its window, both held
// to the soft copy's range so lamps do not flare in the bloom. In between it blurs through its mip
// levels (the blur grows with uFocus) and hands over to the soft copy's round bokeh.
const fragmentShader = /* glsl */ `
${envChunk}
uniform float uFocus;
uniform float uBokeh; // the soft copy's blur radius, radians
uniform sampler2D uEnvView;
uniform float uEnvViewOn;
uniform vec4 uEnvViewEdges;   // longitude min, max, latitude min, max (radians, the panorama's own)
uniform float uEnvViewLevels; // its highest mip level
uniform vec2 uEnvCodecView;
varying vec3 vDir;

// One mip level of the start view, bilinear in linear light: the four texels are decoded, then blended.
// Blending the log codes would keep each lamp's light inside its own texel, which reads as blocks.
vec3 viewLevel(vec2 uv, int level) {
  ivec2 size = textureSize(uEnvView, level);
  vec2 p = uv * vec2(size) - 0.5;
  vec2 f = fract(p);
  ivec2 i = ivec2(floor(p));
  ivec2 hi = size - 1;
  vec3 a = envDecode(texelFetch(uEnvView, clamp(i, ivec2(0), hi), level).rgb, uEnvCodecView);
  vec3 b = envDecode(texelFetch(uEnvView, clamp(i + ivec2(1, 0), ivec2(0), hi), level).rgb, uEnvCodecView);
  vec3 c = envDecode(texelFetch(uEnvView, clamp(i + ivec2(0, 1), ivec2(0), hi), level).rgb, uEnvCodecView);
  vec3 e = envDecode(texelFetch(uEnvView, clamp(i + ivec2(1, 1), ivec2(0), hi), level).rgb, uEnvCodecView);
  return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
}

// A blurred level (1 and up), read with a cubic B-spline over 4 × 4 decoded texels: blurs come out round
// and smooth, as a lens's do, where bilinear reads of a coarse level show its square texels.
vec4 bspline(float f) {
  float g = 1.0 - f;
  return vec4(g * g * g, 3.0 * f * f * f - 6.0 * f * f + 4.0, 3.0 * g * g * g - 6.0 * g * g + 4.0, f * f * f) / 6.0;
}
vec3 viewLevelSmooth(vec2 uv, int level) {
  ivec2 size = textureSize(uEnvView, level);
  vec2 p = uv * vec2(size) - 0.5;
  ivec2 i = ivec2(floor(p)) - 1;
  ivec2 hi = size - 1;
  vec4 wx = bspline(fract(p.x));
  vec4 wy = bspline(fract(p.y));
  vec3 sum = vec3(0.0);
  for (int y = 0; y < 4; y++) {
    vec3 row = vec3(0.0);
    for (int x = 0; x < 4; x++) row += wx[x] * envDecode(texelFetch(uEnvView, clamp(i + ivec2(x, y), ivec2(0), hi), level).rgb, uEnvCodecView);
    sum += wy[y] * row;
  }
  return sum;
}
vec3 viewAt(vec2 uv, int level) {
  return level == 0 ? viewLevel(uv, 0) : viewLevelSmooth(uv, level);
}

// The start view toward d, blurred to take in \`foot\` radians per pixel. \`inside\`: 1 within its window,
// fading to 0 over the outer 3% of it.
vec3 envView(vec3 d, float foot, out float inside) {
  float mid = 0.5 * (uEnvViewEdges.x + uEnvViewEdges.y);
  float lon = atan(d.x, -d.z) + uEnvYaw;
  lon = mid + mod(lon - mid + ENV_PI, 2.0 * ENV_PI) - ENV_PI; // the turn nearest the window
  vec2 uv = vec2(
    (lon - uEnvViewEdges.x) / (uEnvViewEdges.y - uEnvViewEdges.x),
    (asin(clamp(d.y, -1.0, 1.0)) - uEnvViewEdges.z) / (uEnvViewEdges.w - uEnvViewEdges.z)
  );
  vec2 edge = smoothstep(vec2(0.0), vec2(0.03), uv) * smoothstep(vec2(0.0), vec2(0.03), 1.0 - uv);
  inside = edge.x * edge.y;
  if (inside <= 0.0) return vec3(0.0);
  float texelsPerRadian = float(textureSize(uEnvView, 0).x) / (uEnvViewEdges.y - uEnvViewEdges.x);
  float level = clamp(log2(max(foot * texelsPerRadian, 1.0)), 0.0, uEnvViewLevels);
  int l0 = int(floor(level));
  return mix(viewAt(uv, l0), viewAt(uv, min(l0 + 1, int(uEnvViewLevels))), fract(level));
}

void main() {
  vec3 d = normalize(vDir);
  float pixel = length(fwidth(d)); // outside the branch: derivatives need every pixel
  vec3 soft = envSoft(d);
  if (uFocus >= 1.0) {
    gl_FragColor = vec4(soft, 1.0);
    return;
  }
  float foot = max(pixel, 2.0 * uFocus * uBokeh);
  vec3 sharp = envColor(d, foot);
  if (uEnvViewOn > 0.0) {
    float inside;
    vec3 view = envView(d, foot, inside);
    sharp = mix(sharp, view, inside);
  }
  sharp = min(sharp, vec3(uEnvCodecSoft.y * (exp2(uEnvCodecSoft.x) - 1.0)));
  gl_FragColor = vec4(mix(sharp, soft, smoothstep(0.35, 1.0, uFocus)), 1.0);
}`

// The world at infinity: the backdrop photograph (BACKDROP in config.js), out of focus except in the
// first shot. Follows the camera. Starts the backdrop's download and upload (with `view`, the start view
// at the tier's size too); the loader's "enter" waits for it.
export default function Sky({ view = false }) {
  const ref = useRef()
  const gl = useThree((s) => s.gl)
  useEffect(() => void loadBackdrop(gl, view ? quality.backdropView : null), [gl, view])
  useFrame(({ camera }) => ref.current.position.copy(camera.position))

  // Built by hand so the uniforms stay the shared envUniforms (see Rain.jsx).
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: { ...envUniforms, ...viewUniforms, uFocus: globalUniforms.uFocus, uBokeh: { value: THREE.MathUtils.degToRad(BACKDROP.bokeh) } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    []
  )

  return (
    <mesh ref={ref} renderOrder={-1} frustumCulled={false} material={material}>
      <sphereGeometry args={[100, 48, 24]} />
    </mesh>
  )
}
