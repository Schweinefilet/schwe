import * as THREE from 'three'

// Every drop that isn't playing live video shows its clip's poster from one shared texture: a
// 4×3 grid of 512×288 cells drawn into a canvas at runtime, only for the clips selected right now.
// One texture for all posters means drops cost no extra texture binds or memory per city.

const COLS = 4
const ROWS = 3
const CELL_W = 512
const CELL_H = 288
const INSET = 3 // px kept clear of each cell edge so filtering never bleeds a neighbor in

export function createPosterAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = COLS * CELL_W
  canvas.height = ROWS * CELL_H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter // drops are small on screen: mipmaps stop shimmer
  texture.anisotropy = 4

  const loaded = new Map() // key → poster URL currently drawn
  const wanted = new Map() // key → poster URL most recently asked for

  // UV rect (offset.xy, scale.zw) of cell `index`. Cells are assigned in the order entries are given.
  function rectAt(index) {
    const col = index % COLS
    const row = Math.floor(index / COLS)
    // Canvas row 0 is at the top; with flipY the texture's v=1 is the canvas top.
    const x = col * CELL_W + INSET
    const yTop = row * CELL_H + INSET
    const w = CELL_W - 2 * INSET
    const h = CELL_H - 2 * INSET
    return new THREE.Vector4(x / canvas.width, 1 - (yTop + h) / canvas.height, w / canvas.width, h / canvas.height)
  }

  // entries: [{ key, url }] with at most COLS × ROWS items. Only changed cells are redrawn.
  function update(entries) {
    entries.slice(0, COLS * ROWS).forEach(({ key, url }, i) => {
      if (!url || loaded.get(key) === url) return
      wanted.set(key, url)
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.decoding = 'async'
      img.onload = () => {
        if (wanted.get(key) !== url) return // a newer selection replaced this poster
        const col = i % COLS
        const row = Math.floor(i / COLS)
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, col * CELL_W, row * CELL_H, CELL_W, CELL_H)
        loaded.set(key, url)
        texture.needsUpdate = true
      }
      img.onerror = () => console.warn('[atlas] poster failed:', url)
      img.src = url
    })
  }

  return { texture, rectAt, update, dispose: () => texture.dispose() }
}
