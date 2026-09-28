#!/usr/bin/env node
// Copies detect-gpu's benchmark data into public/benchmarks so GPU tiering never calls a CDN.
// Runs automatically before `npm run dev` and `npm run build`.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'node_modules/detect-gpu/dist/benchmarks')
const OUT = path.join(ROOT, 'public/benchmarks')

fs.mkdirSync(OUT, { recursive: true })
for (const file of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, file), path.join(OUT, file))
