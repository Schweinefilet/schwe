import * as THREE from 'three'

// A muted, inline, looping <video> for use as a WebGL texture. Muted + playsinline is what lets iOS
// autoplay it without a gesture. crossOrigin is required for clips served from R2: without CORS
// headers a cross-origin video can't be uploaded to the GPU.
export function createClipVideo(urls) {
  const video = document.createElement('video')
  video.muted = true
  video.defaultMuted = true
  video.playsInline = true
  video.setAttribute('playsinline', '')
  video.loop = true
  video.crossOrigin = 'anonymous'
  video.preload = 'auto'
  // MP4 first: Safari's WebM support is unreliable.
  for (const [type, src] of [['video/mp4', urls.mp4], ['video/webm', urls.webm]]) {
    if (!src) continue
    const source = document.createElement('source')
    source.src = src
    source.type = type
    video.appendChild(source)
  }
  if (urls.poster) video.poster = urls.poster
  return video
}

export function createVideoTexture(video) {
  const tex = new THREE.VideoTexture(video)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.generateMipmaps = false
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

export function destroyClipVideo(video) {
  video.pause()
  video.removeAttribute('src')
  video.replaceChildren()
  video.load() // releases the decoder
}

const loader = new THREE.TextureLoader()
export function loadPosterTexture(url) {
  return new Promise((resolve, reject) =>
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        resolve(tex)
      },
      undefined,
      reject
    )
  )
}
