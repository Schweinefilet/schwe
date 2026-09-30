import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Which build a benchmark report measured: short commit, plus "+dirty" for uncommitted changes.
function buildId() {
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim()
    const dirty = execSync('git status --porcelain').toString().trim() ? '+dirty' : ''
    return hash + dirty
  } catch {
    return 'unknown'
  }
}

// Dev: the scene's shared state lives in plain modules (the uniforms, rig, timeline, loop, config) that
// materials and the timeline hold references to. Hot-swapping one leaves them on different copies:
// after an edit to uniforms.js the timeline froze the new time scale while the rain read the old one,
// so it never stopped. A change to any plain module (or shader, or JSON) under src/ reloads the page;
// components and stylesheets still update in place.
const reloadOnSharedChange = {
  name: 'schwe-reload-on-shared-change',
  hotUpdate({ file }) {
    if (this.environment.name !== 'client' || !/\/src\/.+\.(js|glsl|json)$/.test(file)) return
    this.environment.hot.send({ type: 'full-reload' })
    return []
  },
}

// Build: with the sky as the content source (CONTENT in src/config.js) the site never loads footage,
// so the 30 MB of clips in public/clips stay out of the deploy. They remain in public/ for the dev
// server (the drop lab's ?clip=) and for a switch back to footage.
const dropUnusedClips = {
  name: 'schwe-drop-unused-clips',
  apply: 'build',
  closeBundle() {
    const source = fs.readFileSync('src/config.js', 'utf8').match(/export const CONTENT = \{ source: '(\w+)' \}/)?.[1]
    if (source !== 'sky') return
    fs.rmSync(path.resolve('dist/clips'), { recursive: true, force: true })
  },
}

export default defineConfig({
  plugins: [react(), reloadOnSharedChange, dropUnusedClips],
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: { host: true }, // expose on LAN for phone testing
  preview: { host: true },
})
