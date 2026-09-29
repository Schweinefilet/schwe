// Builds the cloud noise off the main thread (cloudNoiseData.js), so the loader never stalls.
import { buildCloudNoise } from './cloudNoiseData.js'

self.onmessage = (e) => {
  const { data, size } = buildCloudNoise(e.data.seed)
  self.postMessage({ data, size }, [data.buffer])
}
