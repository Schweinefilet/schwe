// Reads the World Atlas of Artificial Night Sky Brightness (Falchi et al. 2016) at a point: the mean
// of a (2r+1)² window of pixels around it. The atlas is a 30″ GeoTIFF in lat/lon (EPSG:4326) whose
// values are artificial zenith brightness in mcd/m²; only the window's tiles are read.

// image: a geotiff.js GeoTIFFImage.
export async function sampleAtlas(image, lat, lon, radius = 2) {
  const [lon0, lat0] = image.getOrigin() // top-left corner
  const [dx, dy] = image.getResolution() // dy is negative: rows go south
  const width = image.getWidth()
  const height = image.getHeight()
  const px = Math.floor((lon - lon0) / dx)
  const py = Math.floor((lat - lat0) / dy)
  if (px < 0 || py < 0 || px >= width || py >= height) throw new Error(`(${lat}, ${lon}) is outside the atlas`)
  const window = [Math.max(0, px - radius), Math.max(0, py - radius), Math.min(width, px + radius + 1), Math.min(height, py + radius + 1)]
  const [band] = await image.readRasters({ window })
  const nodata = image.getGDALNoData()
  const values = Array.from(band).filter((v) => Number.isFinite(v) && v !== nodata && v >= 0)
  if (!values.length) throw new Error(`no atlas data around (${lat}, ${lon})`)
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, pixels: values.length, center: [px, py] }
}
