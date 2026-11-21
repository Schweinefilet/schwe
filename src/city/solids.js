import * as THREE from 'three'

// What each city's night needs to know about its buildings, worked out once at load. The model carries no
// per-building data beyond its occlusion, a seed and whether it is lit (scripts/models/build.mjs), but each
// solid (a building or one of its parts) is one connected piece of the index buffer, so its top is the
// highest vertex reachable through its triangles. Each city's `classify` then decides, once per solid
// rather than in every pixel, which landmark it belongs to, which rarer lights it can show and what kind
// of building it is (newYork.js, london.js, paris.js).

// `classify({ x, z, y, seed, lit, axis, length })` gets a solid's peak (the middle of its highest vertices,
// in the model's metres: x east, z south; y its top), its seed (0..255), what it does after dark (the
// bake's b: 1 windows, 0.5 floodlit, 0 neither) and, with `axes`, the direction of its footprint's long
// side (radians from the x axis, 0..pi), that side's length and the middle of all its vertices (cx, cz). It returns { flags, kind }: flags is a
// landmark number (1..15, 0 for none) plus 16 times the city's own bits, kind four bytes.
// Returns the vertex attributes (top: its solid's top and flags; kind) and the roofs at or above
// `lightsAbove` metres, for the red obstruction lights.
export function buildingTops(geometry, matrix, classify, { lightsAbove = Infinity, axes = false } = {}) {
  const pos = geometry.getAttribute('position')
  const index = geometry.index.array
  const n = pos.count
  const e = matrix.elements
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let i = 0; i < index.length; i += 3) {
    const a = find(index[i])
    const b = find(index[i + 1])
    if (a !== b) parent[a] = b
    const c = find(index[i + 2])
    const d = find(index[i + 1])
    if (c !== d) parent[c] = d
  }
  const y = new Float32Array(n)
  const top = new Float32Array(n).fill(-Infinity)
  for (let i = 0; i < n; i++) {
    y[i] = pos.getY(i) * e[5] + e[13]
    const r = find(i)
    if (y[i] > top[r]) top[r] = y[i]
  }
  // The middle of each solid's highest vertices: where its obstruction light goes, and which landmark
  // (if any) it is part of.
  const peaks = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (y[i] < top[r] - 0.5) continue
    let p = peaks.get(r)
    if (!p) peaks.set(r, (p = { x: 0, z: 0, k: 0, y: top[r] }))
    p.x += pos.getX(i) * e[0] + e[12]
    p.z += pos.getZ(i) * e[10] + e[14]
    p.k++
  }
  // The footprint's long side, from the second moments of the solid's vertices.
  let moments = null
  if (axes) {
    moments = new Map()
    for (let i = 0; i < n; i++) {
      const r = find(i)
      let m = moments.get(r)
      if (!m) moments.set(r, (m = [0, 0, 0, 0, 0, 0]))
      const x = pos.getX(i) * e[0] + e[12]
      const z = pos.getZ(i) * e[10] + e[14]
      m[0]++
      m[1] += x
      m[2] += z
      m[3] += x * x
      m[4] += z * z
      m[5] += x * z
    }
  }
  const bake = geometry.getAttribute('bake')
  const flags = new Map()
  const kind = new Map()
  for (const [r, p] of peaks) {
    const s = { x: p.x / p.k, z: p.z / p.k, y: p.y, seed: Math.round(bake.getY(r) * 255), lit: bake.getZ(r), axis: 0, length: 0, cx: 0, cz: 0 }
    if (moments) {
      const [k, sx, sz, sxx, szz, sxz] = moments.get(r)
      const cxx = sxx / k - (sx / k) ** 2
      const czz = szz / k - (sz / k) ** 2
      const cxz = sxz / k - (sx / k) * (sz / k)
      s.cx = sx / k
      s.cz = sz / k
      s.axis = (0.5 * Math.atan2(2 * cxz, cxx - czz) + Math.PI) % Math.PI
      // The long side of a uniform rectangle with this spread.
      s.length = Math.sqrt(12 * Math.max(0, (cxx + czz) / 2 + Math.hypot((cxx - czz) / 2, cxz)))
    }
    const c = classify(s)
    flags.set(r, c.flags)
    kind.set(r, c.kind)
  }
  const tops = new Float32Array(n * 2)
  const kinds = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const r = find(i)
    tops[i * 2] = top[r]
    tops[i * 2 + 1] = flags.get(r) ?? 0
    kinds.set(kind.get(r), i * 4)
  }
  // One light per roof: a tower's parts often share an outline's corner, so the nearby lower peaks go.
  const list = [...peaks.values()].filter((p) => p.y >= lightsAbove).map((p) => ({ x: p.x / p.k, y: p.y, z: p.z / p.k })).sort((a, b) => b.y - a.y)
  const kept = []
  for (const p of list) if (!kept.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 30)) kept.push(p)
  return { tops, kinds, peaks: kept }
}

// Orders the index buffer so the solids that can show the rarer lights (any flag set by classify) come
// last, as a second group; the mesh draws the first group with the plain material and the second with the
// full one. Same vertices, one more draw. (A shader that merely carries the rarer code, even behind a
// branch no pixel takes, pays for it in every pixel.)
export function splitByFlags(geometry) {
  const index = geometry.index.array
  const top = geometry.getAttribute('top').array
  const plain = []
  const full = []
  for (let i = 0; i < index.length; i += 3) (top[index[i] * 2 + 1] > 0.5 ? full : plain).push(index[i], index[i + 1], index[i + 2])
  index.set(plain, 0)
  index.set(full, plain.length)
  geometry.index.needsUpdate = true
  geometry.clearGroups()
  geometry.addGroup(0, plain.length, 0)
  geometry.addGroup(plain.length, full.length, 1)
  return { plain: plain.length / 3, full: full.length / 3 }
}

// Red obstruction lights on the tall roofs: some steady, some flashing 30 times a minute.
export function obstructionLights(peaks, uniforms) {
  const g = new THREE.BufferGeometry()
  const p = new Float32Array(peaks.length * 3)
  const phase = new Float32Array(peaks.length)
  peaks.forEach((q, i) => {
    p.set([q.x, q.y + 4, q.z], i * 3)
    // A deterministic hash of the position: the same roofs flash every visit.
    phase[i] = Math.abs(Math.sin(q.x * 12.9898 + q.z * 78.233) * 43758.5453) % 1
  })
  g.setAttribute('position', new THREE.BufferAttribute(p, 3))
  g.setAttribute('phase', new THREE.BufferAttribute(phase, 1))
  const m = new THREE.ShaderMaterial({
    // uScale: pixels per metre at a metre's distance (Maquette.jsx sets it each frame); uPx: the device's pixel.
    uniforms: { uNight: uniforms.uNight, uTime: uniforms.uTime, uScale: { value: 1000 }, uPx: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float phase;
      uniform float uNight;
      uniform float uTime;
      uniform float uScale;
      uniform float uPx;
      varying float vOn;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        // A lamp's glare about 10 m across on the model, never under a pixel or over two and a half.
        gl_PointSize = clamp(10.0 * uScale / -mv.z, 1.0 * uPx, 2.5 * uPx);
        float flashing = step(0.55, phase);
        vOn = uNight * mix(0.6, step(fract(uTime * 0.5 + phase * 7.0), 0.3), flashing);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vOn;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, r);
        gl_FragColor = vec4(vec3(1.0, 0.1, 0.06) * 2.2 * a * vOn, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(g, m)
  points.frustumCulled = false
  points.renderOrder = 2
  return points
}
