import * as THREE from 'three'

// First use of a material or texture costs a shader compile or a GPU upload on the frame it first
// draws. Beat 7's pieces (puddle, falling drop, baked splash) first draw at the moments that matter
// most, so they are prepared ahead: shaders compiled and textures uploaded while nothing depends on it.

// three picks a shader variant partly from where it draws: the screen (sRGB output, tone mapping) or
// an offscreen target (linear). The effects pass renders the scene offscreen, so compile for that.
let offscreen = null

// Compiles every material under `object`, even hidden ones. three only compiles visible objects, so
// hidden ones are shown for the synchronous part of the call and hidden again before any frame draws.
export function prewarm(gl, object, camera, scene, textures = []) {
  if (!object) return
  for (const t of textures) if (t) gl.initTexture(t)
  const hidden = []
  object.traverse((o) => {
    if (!o.visible) {
      hidden.push(o)
      o.visible = true
    }
  })
  offscreen ??= new THREE.WebGLRenderTarget(1, 1)
  const previous = gl.getRenderTarget()
  gl.setRenderTarget(offscreen)
  try {
    // compileAsync compiles synchronously, then only waits (with KHR_parallel_shader_compile the
    // driver finishes off the main thread); older three falls back to a blocking compile.
    if (gl.compileAsync) gl.compileAsync(object, camera, scene).catch(() => {})
    else gl.compile(object, camera, scene)
  } finally {
    gl.setRenderTarget(previous)
    for (const o of hidden) o.visible = false
  }
}
