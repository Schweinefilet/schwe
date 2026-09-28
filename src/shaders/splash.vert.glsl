// Vertex animation texture playback. The mesh is a fixed list of MAX_TRIS × 3 vertices that only
// carry an index; every frame, each vertex looks up its position and normal for the current sim
// frame. Unused vertices all sit at one point, so their triangles collapse and are skipped.

uniform sampler2D uHi;      // high bytes of 16-bit x, y, z
uniform sampler2D uLo;      // low bytes
uniform sampler2D uNrm;     // octahedral normal in RG
uniform float uFrame;
uniform int uWidth;
uniform int uRowsPerFrame;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
uniform float uQuantMax;   // largest stored 16-bit value (depends on the bake's precision)

attribute float aIndex;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLocalXZ;
varying float vLocalY;

vec3 octDecode(vec2 e) {
  e = e * 2.0 - 1.0;
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  float t = clamp(-n.z, 0.0, 1.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}

void main() {
  int idx = int(aIndex);
  int row = int(uFrame) * uRowsPerFrame + idx / uWidth;
  ivec2 texel = ivec2(idx - (idx / uWidth) * uWidth, row);

  vec3 hi = floor(texelFetch(uHi, texel, 0).rgb * 255.0 + 0.5);
  vec3 lo = floor(texelFetch(uLo, texel, 0).rgb * 255.0 + 0.5);
  vec3 p = mix(uBoundsMin, uBoundsMax, (hi * 256.0 + lo) / uQuantMax);
  vec3 n = octDecode(texelFetch(uNrm, texel, 0).rg);

  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vLocalXZ = p.xz;
  vLocalY = p.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
