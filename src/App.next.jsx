import Stage from './city/Stage.jsx'

// Dev: ?wx=rain|snow|fog|overcast stands in for a reading, to look at each kind of weather on the model.
const FAKE = {
  rain: { code: 63, cloud: 100, mmPerHour: 4, visibilityM: 7000, windKmh: 22, windFromDeg: 250 },
  snow: { code: 73, cloud: 100, mmPerHour: 0, snowCm: 0.6, visibilityM: 5000, windKmh: 10, windFromDeg: 20 },
  fog: { code: 45, cloud: 100, mmPerHour: 0, visibilityM: 400, windKmh: 3, windFromDeg: 0 },
  overcast: { code: 3, cloud: 100, mmPerHour: 0, visibilityM: 20000, windKmh: 12, windFromDeg: 200 },
}
const params = new URLSearchParams(location.search)
const wx = import.meta.env.DEV ? FAKE[params.get('wx')] : null
const city = params.get('city') ?? 'new-york'

export default function App() {
  return <Stage cityId={city} weather={wx ? { [city]: { current: wx } } : null} onReady={(id) => (document.documentElement.dataset.ready = id)} />
}
