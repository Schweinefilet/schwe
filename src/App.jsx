import { useCallback, useEffect, useRef, useState } from 'react'
import { CITIES, cityById } from './city/cities.js'
import Stage from './city/Stage.jsx'
import { fetchCities } from './content/cityWeather.js'
import { detectQuality } from './core/quality.js'
import CityPanel from './ui/CityPanel.jsx'

const REFRESH_MS = 10 * 60 * 1000
const STALE_MS = 40 * 60 * 1000 // a reading older than this is no longer "now": back to unread

// Dev: ?wx=rain|snow|fog|overcast|clear stands in for the selected city's reading, to look at each kind of
// weather on the model. Never in a build.
const FAKE = {
  rain: { code: 63, cloud: 100, mmPerHour: 4, visibilityM: 7000, windKmh: 22, windFromDeg: 250, tempC: 9, feelsC: 6 },
  snow: { code: 73, cloud: 100, mmPerHour: 0, snowCm: 0.6, visibilityM: 5000, windKmh: 10, windFromDeg: 20, tempC: -1, feelsC: -5 },
  fog: { code: 45, cloud: 100, mmPerHour: 0, visibilityM: 400, windKmh: 3, windFromDeg: 0, tempC: 6, feelsC: 5 },
  overcast: { code: 3, cloud: 100, mmPerHour: 0, visibilityM: 20000, windKmh: 12, windFromDeg: 200, tempC: 11, feelsC: 9 },
  clear: { code: 0, cloud: 0, mmPerHour: 0, visibilityM: 30000, windKmh: 8, windFromDeg: 300, tempC: 14, feelsC: 13 },
}
const params = new URLSearchParams(location.search)
const fake = import.meta.env.DEV ? FAKE[params.get('wx')] : null
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

// The city in the address (#london) or the first.
const fromHash = () => cityById(location.hash.slice(1))?.id ?? cityById(params.get('city'))?.id ?? CITIES[0].id

export default function App() {
  const [cityId, setCityId] = useState(fromHash)
  const [quality, setQuality] = useState(null)
  const [ready, setReady] = useState(false)
  const [weather, setWeather] = useState(null)
  const [status, setStatus] = useState('reading')
  const [veiled, setVeiled] = useState(false)
  const readAt = useRef(0)

  useEffect(() => {
    detectQuality().then(setQuality)
  }, [])

  // The weather, now and every ten minutes. A failed refresh keeps the last reading while it is fresh.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      let read = null
      try {
        read = await fetchCities(CITIES)
      } catch (err) {
        console.warn('[weather] unavailable:', err.message)
      }
      if (cancelled) return
      if (read && Object.values(read).some(Boolean)) {
        readAt.current = Date.now()
        setWeather(read)
        setStatus('read')
      } else {
        if (Date.now() - readAt.current > STALE_MS) setWeather(null)
        setStatus('failed')
      }
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const select = useCallback(
    (id) => {
      if (id === cityId) return
      history.replaceState(null, '', `#${id}`)
      // Reduced motion: no swing across the studio. The picture dips out, changes, and comes back.
      if (reducedMotion) {
        setVeiled(true)
        setTimeout(() => {
          setCityId(id)
          setTimeout(() => setVeiled(false), 120)
        }, 320)
      } else setCityId(id)
    },
    [cityId]
  )

  // Left and right step through the cities.
  useEffect(() => {
    const step = (by) => select(CITIES[(CITIES.findIndex((c) => c.id === cityId) + by + CITIES.length) % CITIES.length].id)
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (document.querySelector('.wx-panel')) return
      step(e.key === 'ArrowRight' ? 1 : -1)
    }
    const onHash = () => setCityId(fromHash())
    // A swipe across the picture does the same (not one that starts on a control or in the panel).
    let down = null
    const onDown = (e) => (down = e.target.closest('button, a, .wx-panel') ? null : { x: e.clientX, y: e.clientY })
    const onUp = (e) => {
      if (!down) return
      const dx = e.clientX - down.x
      const dy = e.clientY - down.y
      down = null
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
      step(dx < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [cityId, select])

  const onReady = useCallback(() => setReady(true), [])
  const onTone = useCallback((tone) => (document.documentElement.dataset.tone = tone), [])

  const shown = fake ? { ...weather, [cityId]: { current: fake, hourly: null, daily: null, nowcast: null, air: null } } : weather
  const noModel = quality && !quality.webgl
  return (
    <>
      {quality?.webgl && (
        <Stage cityId={cityId} weather={shown} lite={quality.lite} still={reducedMotion} className={veiled ? 'stage is-veiled' : 'stage'} onReady={onReady} onTone={onTone} />
      )}
      {noModel && <p className="no-model">This browser cannot draw the models (no WebGL). The weather below is live all the same.</p>}
      {(ready || noModel) && <CityPanel cityId={cityId} onSelect={select} weather={shown} status={fake ? 'read' : status} />}
      <div className={`loader${ready || noModel ? ' is-done' : ''}`} aria-hidden={ready || noModel}>
        <div>
          <div className="loader__name">schwe</div>
          <div className="loader__note">setting up the model</div>
        </div>
      </div>
    </>
  )
}
