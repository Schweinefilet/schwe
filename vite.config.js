import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: the scene's shared state lives in plain modules (the look, the plaster's uniforms) that materials
// hold references to. Hot-swapping one leaves them on different copies, so a change to any plain module
// or JSON under src/ reloads the page; components and stylesheets still update in place.
const reloadOnSharedChange = {
  name: 'schwe-reload-on-shared-change',
  hotUpdate({ file }) {
    if (this.environment.name !== 'client' || !/\/src\/.+\.(js|json)$/.test(file)) return
    this.environment.hot.send({ type: 'full-reload' })
    return []
  },
}

export default defineConfig({
  plugins: [react(), reloadOnSharedChange],
  server: { host: true }, // expose on LAN for phone testing
  preview: { host: true },
})
