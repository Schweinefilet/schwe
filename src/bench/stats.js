// Benchmark statistics. Pure functions over recorded frames, so they run in tests too.
//
// A recording is parallel arrays, one entry per frame:
//   dt   frame interval in ms (time since the previous frame started; what the visitor sees)
//   cpu  ms spent in the frame loop on the main thread (scroll, timeline, React-free scene updates,
//        draw submission; not GPU time, which browsers don't expose reliably)
//   beat, tier, dir ('idle' | 'forward' | 'hold' | 'back'), live (videos decoding)

export const BUDGET_MS = 20 // the live tier guard's threshold (core/perfGuard.js)
export const STUTTER_MS = 33.4 // two missed frames at 60 Hz: visible

export function percentile(sorted, p) {
  if (!sorted.length) return NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

const round = (x, d = 1) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null)

export function summarize(dts, cpus, lives = []) {
  const n = dts.length
  if (!n) return null
  const sorted = [...dts].sort((a, b) => a - b)
  const cpuSorted = [...cpus].sort((a, b) => a - b)
  const mean = dts.reduce((a, b) => a + b, 0) / n
  return {
    frames: n,
    fps: round(1000 / mean),
    mean: round(mean),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[n - 1]),
    overBudget: round((100 * dts.filter((d) => d > BUDGET_MS).length) / n),
    stutter: round((100 * dts.filter((d) => d > STUTTER_MS).length) / n),
    cpuP50: round(percentile(cpuSorted, 50), 2),
    cpuP95: round(percentile(cpuSorted, 95), 2),
    liveMax: lives.length ? Math.max(...lives) : null,
  }
}

// One row per (beat, tier) in the order they were first seen, plus one for the whole run.
// Idle frames (rain before scrolling) get their own row; they also give the display's refresh rate.
export function report(rec) {
  const groups = new Map()
  for (let i = 0; i < rec.dt.length; i++) {
    const beat = rec.dir[i] === 'idle' ? 'rain (idle)' : rec.beat[i]
    const key = `${beat}|${rec.tier[i]}`
    if (!groups.has(key)) groups.set(key, { beat, tier: rec.tier[i], idx: [] })
    groups.get(key).idx.push(i)
  }
  const pick = (arr, idx) => idx.map((i) => arr[i])
  const rows = [...groups.values()].map((g) => ({ beat: g.beat, tier: g.tier, ...summarize(pick(rec.dt, g.idx), pick(rec.cpu, g.idx), pick(rec.live, g.idx)) }))
  const moving = rec.dir.map((d, i) => (d === 'idle' ? -1 : i)).filter((i) => i >= 0)
  const total = { beat: 'whole run (moving)', tier: '', ...summarize(pick(rec.dt, moving), pick(rec.cpu, moving), pick(rec.live, moving)) }
  return { rows, total, displayHz: displayHz(rec) }
}

// Refresh rate from the idle frames' median interval, when it sits on a common display rate. A device
// that can't keep up even at rest runs between rates; then the display rate is unknown (null).
export function displayHz(rec) {
  const idle = rec.dt.filter((_, i) => rec.dir[i] === 'idle').sort((a, b) => a - b)
  if (idle.length < 10) return null
  const hz = 1000 / percentile(idle, 50)
  const rate = [48, 50, 60, 75, 90, 100, 120, 144, 165, 240].find((r) => Math.abs(hz - r) / r < 0.06)
  return rate ?? null
}

// Plain-text table to paste back into a chat.
export function toText(meta, rep) {
  const head = ['beat', 'tier', 'frames', 'fps', 'p50', 'p95', 'p99', 'max', `>${BUDGET_MS}ms%`, `>${Math.round(STUTTER_MS)}ms%`, 'cpu p95', 'video']
  const line = (r) => [r.beat, r.tier, r.frames, r.fps, r.p50, r.p95, r.p99, r.max, r.overBudget, r.stutter, r.cpuP95, r.liveMax ?? ''].join(' | ')
  return [
    `schwe bench · build ${meta.build} · ${meta.date}`,
    `device: ${meta.device.ua}`,
    `gpu: ${meta.gpu ?? 'unknown'} · detect-gpu tier ${meta.gpuTier ?? '?'} (${meta.gpuType ?? '?'}, used ${meta.gpuScore ?? '?'})${meta.isMobile ? ' (mobile)' : ''} · display ${rep.displayHz ?? '?'} Hz · dpr ${meta.device.dpr} · viewport ${meta.device.viewport}`,
    `tier: start ${meta.tierStart}${meta.forcedTier ? ' (forced)' : ''} → end ${meta.tierEnd}${meta.tierEvents.length ? ` · changes: ${meta.tierEvents.map((e) => `${e.from}→${e.to} at ${e.beat}`).join(', ')}` : ''}`,
    '',
    head.join(' | '),
    head.map(() => '---').join(' | '),
    ...rep.rows.map(line),
    line(rep.total),
  ].join('\n')
}
