// Many raindrop splashes from one baked library entry: the hero's vertex animation texture layout
// (splash.vert.glsl), instanced, each instance at its own frame. The mesh is the longest frame's list
// of triangle corners; corners past this instance's frame's triangles are dropped outside the clip
// volume. Positions come out of the bake in meters, Y-up, with the resting water at uSurfaceY.

uniform sampler2D uHi;
uniform sampler2D uLo;
uniform sampler2D uNrm;
uniform sampler2D uIdx;
uniform sampler2D uFrames;  // per frame: first vertex row, first index row, triangle count
uniform int uWidth;
uniform vec3 uBoundsMin;
uniform vec3 uBoundsMax;
uniform float uQuantMax;
uniform float uSurfaceY;
uniform float uWorldPerMeter;

attribute float aIndex;
attribute vec4 iPosFrame;   // xyz: impact point (world, on the resting water); w: frame
attribute vec4 iRotScale;   // x, y: cos and sin of the turn about +y; z: scale; w: fade (0..1)

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;        // meters, the bake's own frame, rest at y = 0 (before turn and scale)
varying float vFrame;
varying float vFade;

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
  vFrame = iPosFrame.w;
  vFade = iRotScale.w;
  vec4 f = texelFetch(uFrames, ivec2(int(iPosFrame.w), 0), 0);
  int corner = int(aIndex);
  if (float(corner) >= f.z * 3.0 || iRotScale.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vWorld = vNormal = vLocal = vec3(0.0);
    return;
  }
  vec2 ix = floor(texelFetch(uIdx, texelOf(corner, int(f.y)), 0).rg * 255.0 + 0.5);
  ivec2 texel = texelOf(int(ix.r * 256.0 + ix.g), int(f.x));
  vec3 hi = floor(texelFetch(uHi, texel, 0).rgb * 255.0 + 0.5);
  vec3 lo = floor(texelFetch(uLo, texel, 0).rgb * 255.0 + 0.5);
  vec3 p = mix(uBoundsMin, uBoundsMax, (hi * 256.0 + lo) / uQuantMax);
  p.y -= uSurfaceY;
  vec3 n = octDecode(texelFetch(uNrm, texel, 0).rg);
  vLocal = p;

  float c = iRotScale.x;
  float s = iRotScale.y;
  mat3 turn = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); // about +y
  vec3 w = iPosFrame.xyz + turn * p * (iRotScale.z * uWorldPerMeter);
  vWorld = w;
  vNormal = turn * n;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
