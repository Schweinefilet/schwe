#!/usr/bin/env node
// The photoreal New York built up one technique at a time (docs/rendering-research.md, "Order of work"):
// for each stage, the benchmark (scripts/bench.mjs) and the four screenshots (scripts/shots.mjs), with
// the techniques not yet reached turned off through ?fx=. Run against a production build:
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/stages.mjs --url http://localhost:4173/ [--only 3,4] [--headed]
//
// Writes docs/shots/stages/<n>-<name>/{noon,golden,night,rain}.jpg and docs/shots/stages/bench.json.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const URL_ = arg('url', 'http://localhost:4173/')
const ONLY = arg('only', '')
const OUT = 'docs/shots/stages'
const ALL = ['aerial', 'ibl', 'pbr', 'ssr', 'taa', 'bloom', 'wet', 'shafts', 'clouds', 'grade']
// Each stage: its name and the techniques it adds (cumulative).
export const STAGES = [
  ['0-plaster', null],
  ['1-hdr-agx', []],
  ['2-sky-air-ibl', ['aerial', 'ibl']],
  ['3-pbr-glass-water', ['pbr']],
  ['4-ssr', ['ssr']],
  ['5-taa', ['taa']],
  ['6-bloom', ['bloom']],
  ['7-wet', ['wet']],
  ['8-shafts', ['shafts']],
  ['9-clouds', ['clouds']],
  ['10-grade', ['grade']],
  ['11-gtao-trial', ['+gtao']],
]

const results = fs.existsSync(path.join(OUT, 'bench.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'bench.json'), 'utf8')) : {}
const on = new Set()
for (const [name, adds] of STAGES) {
  if (adds) for (const a of adds) on.add(a)
  if (ONLY && !ONLY.split(',').includes(name.split('-')[0])) continue
  const fx = adds === null ? null : [...ALL.filter((t) => !on.has(t)).map((t) => `-${t}`), ...(on.has('+gtao') ? ['+gtao'] : [])].join(',')
  const query = adds === null ? 'real=0' : fx ? `fx=${fx}` : ''
  const dir = path.join(OUT, name)
  fs.mkdirSync(dir, { recursive: true })
  console.log(`== ${name} ${query}`)
  execFileSync('node', ['scripts/shots.mjs', '--jpeg', '--url', URL_, '--out', dir, '--settle', arg('settle', '20000'), ...(query ? ['--query', query] : [])], { stdio: 'inherit' })
  const bench = {}
  for (const shot of ['noon', 'night']) {
    const out = execFileSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', 'node', 'scripts/bench.mjs', '--url', URL_, '--shot', shot, '--seconds', arg('seconds', '20'), ...(query ? ['--query', query] : [])], { encoding: 'utf8' })
    bench[shot] = JSON.parse(out.slice(out.indexOf('{')))
    console.log(shot, bench[shot].medianMs, 'ms median,', bench[shot].renderer)
  }
  results[name] = { query, ...bench }
  fs.writeFileSync(path.join(OUT, 'bench.json'), JSON.stringify(results, null, 1))
}
