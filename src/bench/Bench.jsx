import { useEffect, useRef, useState } from 'react'
import { setFrameHook } from '../core/loop.js'
import { state } from '../core/state.js'
import { detected, onTierChange, quality } from '../core/quality.js'
import { liveCount } from '../content/videoManager.js'
import { BUDGET_MS, report, toText } from './stats.js'

// ?bench: after "enter", records the rain at rest, then scrolls the whole film at a constant speed and
// back up, logging every frame. Ends with a table, a JSON download and a copyable summary to hand back.
// Combine with ?tier=high|medium|low to measure one tier (the live tier guard is off when forced).
const IDLE_MS = 4000
const SECONDS_PER_UNIT = 1.6 // ≈ 28 s per pass; slower than a hurried visitor, faster than a lingering one
const HOLD_MS = 1500
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'unknown'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn) => {
  while (!fn()) await sleep(100)
}

export default function Bench({ scroll }) {
  const status = useRef()
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    const rec = { dt: [], cpu: [], beat: [], tier: [], dir: [], live: [] }
    let dir = null
    let last = 0
    let frame = 0
    let interrupted = false
    const tierStart = quality.name
    const tierEvents = []
    let prevTier = quality.name
    const offTier = onTierChange((name) => {
      tierEvents.push({ from: prevTier, to: name, beat: state.beat })
      prevTier = name
    })
    const onHidden = () => document.hidden && dir && (interrupted = true)
    document.addEventListener('visibilitychange', onHidden)

    const show = (text) => status.current && (status.current.textContent = text)
    show('bench · tap enter, then hands off')

    setFrameHook((t0, cpu) => {
      if (dir && last) {
        rec.dt.push(t0 - last)
        rec.cpu.push(cpu)
        rec.beat.push(state.beat)
        rec.tier.push(quality.name)
        rec.dir.push(dir)
        rec.live.push(liveCount())
      }
      last = t0
      if (dir && ++frame % 15 === 0) show(`bench · ${dir} · ${state.beat} · ${quality.name}`)
    })

    ;(async () => {
      const s = scroll.current
      await until(() => cancelled || (state.unlocked && Math.abs(state.time - s.labels.rain) < 0.005))
      if (cancelled) return
      s.setLocked(true) // no stray touches while measuring
      await sleep(300)
      dir = 'idle'
      await sleep(IDLE_MS)
      const end = s.duration()
      const pass = (end - s.labels.rain) * SECONDS_PER_UNIT
      dir = 'forward'
      await s.scrollToTime(end, pass)
      dir = 'hold'
      await sleep(HOLD_MS)
      dir = 'back'
      await s.scrollToTime(s.labels.rain, pass)
      dir = null
      setFrameHook(null)
      s.setLocked(false)
      if (cancelled) return

      const summary = report(rec)
      const r = detected.result
      const meta = {
        build: BUILD,
        date: new Date().toISOString(),
        url: location.href,
        device: {
          ua: navigator.userAgent,
          cores: navigator.hardwareConcurrency ?? null,
          memoryGB: navigator.deviceMemory ?? null,
          dpr: window.devicePixelRatio,
          screen: `${screen.width}x${screen.height}`,
          viewport: `${innerWidth}x${innerHeight}`,
        },
        gpu: r?.gpu ?? null,
        gpuTier: r?.tier ?? null,
        isMobile: r?.isMobile ?? null,
        forcedTier: new URLSearchParams(location.search).has('tier'),
        tierStart,
        tierEnd: quality.name,
        tierEvents,
        interrupted,
        secondsPerUnit: SECONDS_PER_UNIT,
      }
      const frames = Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, typeof v[0] === 'number' ? v.map((x) => Math.round(x * 100) / 100) : v]))
      setResult({ meta, summary, text: toText(meta, summary), json: { schema: 1, meta, summary, frames } })
      show('')
    })()

    return () => {
      cancelled = true
      setFrameHook(null)
      offTier()
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [scroll])

  return (
    <>
      <div ref={status} className="bench-status" />
      {result && <Report result={result} />}
    </>
  )
}

function Report({ result }) {
  const { meta, summary, text, json } = result
  const textArea = useRef()
  const [copied, setCopied] = useState(false)

  const download = () => {
    const blob = new Blob([JSON.stringify(json)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `schwe-bench-${meta.build}-${meta.tierStart}-${meta.date.slice(0, 16).replace(/[:T]/g, '')}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // The clipboard API needs a secure context; a phone on the LAN dev server is plain http.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      textArea.current.select()
      document.execCommand('copy')
    }
    setCopied(true)
  }

  const rows = [...summary.rows, summary.total]
  return (
    <div className="bench-panel" data-lenis-prevent>
      <h2>schwe bench</h2>
      <p>
        build {meta.build} · {meta.gpu ?? 'unknown GPU'} · {summary.displayHz ?? '?'} Hz · tier {meta.tierStart}
        {meta.forcedTier ? ' (forced)' : ''} → {meta.tierEnd}
        {meta.interrupted && <strong> · interrupted (tab hidden): run again</strong>}
      </p>
      <table>
        <thead>
          <tr>
            <th>beat</th><th>tier</th><th>fps</th><th>p50</th><th>p95</th><th>p99</th><th>max</th><th>&gt;{BUDGET_MS} ms</th><th>cpu p95</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.beat}|${r.tier}`} className={r.p95 > BUDGET_MS ? 'is-bad' : ''}>
              <td>{r.beat}</td><td>{r.tier}</td><td>{r.fps}</td><td>{r.p50}</td><td>{r.p95}</td><td>{r.p99}</td><td>{r.max}</td><td>{r.overBudget}%</td><td>{r.cpuP95}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bench-actions">
        <button onClick={download}>download json</button>
        <button onClick={copy}>{copied ? 'copied' : 'copy summary'}</button>
        <button onClick={() => location.reload()}>run again</button>
      </div>
      <textarea ref={textArea} readOnly value={text} rows={6} />
    </div>
  )
}
