// DOM overlays placed from the render loop. React creates the elements and registers them here; the
// scene works out where they belong on screen each frame and writes their styles directly, so moving
// them never causes a render.
export const overlay = {
  labels: new Map(), // city id → label element (DropLabels.jsx)
  sketch: null, // { canvas, ctx, grain }: the word's pencil sketch (WordSketch.jsx)
}
