// Vertex animation texture playback. Each baked frame is its own indexed mesh: its vertices in the
// vertex textures from row uVertRow, and three indices per triangle in the index texture from row
// uIdxRow. The mesh is a fixed list of MAX_TRIS × 3 corners that only carry their number; every
// frame, each corner reads its vertex index, then that vertex's position and normal. The draw range
// covers only the current frame's triangles.

uniform sampler2D uHi;      // high bytes of 16-bit x, y, z
uniform sampler2D uLo;      // low bytes
uniform sampler2D uNrm;     // octahedral normal in RG
uniform sampler2D uIdx;     // vertex index: high byte in R, low byte in G
uniform int uVertRow;       // the current frame's first row in the vertex textures
uniform int uIdxRow;        // and in the index texture
uniform int uWidth;
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

ivec2 texelOf(int i, int firstRow) {
  return ivec2(i - (i / uWidth) * uWidth, firstRow + i / uWidth);
}

void main() {
  vec2 ix = floor(texelFetch(uIdx, texelOf(int(aIndex), uIdxRow), 0).rg * 255.0 + 0.5);
  ivec2 texel = texelOf(int(ix.r * 256.0 + ix.g), uVertRow);

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
