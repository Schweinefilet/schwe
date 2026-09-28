// Runs once per drop (point). Moves it down by simulated time and wraps it inside the rain box.
uniform float uSimTime;
uniform float uSize;
uniform float uPixelRatio;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;

attribute float aSpeed;

varying float vAlpha;

void main() {
  vec3 p = position;
  p.y = uBoxMin.y + mod(p.y - uBoxMin.y - uSimTime * aSpeed, uBoxSize.y);

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  float depth = -mvPosition.z;
  gl_PointSize = clamp(uSize * uPixelRatio / depth, 1.0, 12.0 * uPixelRatio);
  vAlpha = clamp(1.0 - depth / 60.0, 0.15, 1.0);
}
