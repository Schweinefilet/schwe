// Dev only: GPU time of a stretch of draw calls, where the browser exposes
// EXT_disjoint_timer_query_webgl2 (desktop Chrome, some Android). Safari has none: returns null.
// Queries cannot nest; results arrive a frame or more later through poll().
export function createGpuTimer(renderer) {
  const gl = renderer.getContext()
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  if (!ext) return null
  const pending = []
  let active = null
  return {
    begin() {
      if (active) return null
      active = gl.createQuery()
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active)
      return active
    },
    end(query, done) {
      if (!query || query !== active) return
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      active = null
      pending.push({ query, done })
    },
    poll() {
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT)
      for (let i = pending.length - 1; i >= 0; i--) {
        const { query, done } = pending[i]
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue
        if (!disjoint) done(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
        gl.deleteQuery(query)
        pending.splice(i, 1)
      }
    },
  }
}
