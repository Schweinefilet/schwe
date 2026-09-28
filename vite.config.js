import { execSync } from 'node:child_process'
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

export default defineConfig({
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: { host: true }, // expose on LAN for phone testing
  preview: { host: true },
})
