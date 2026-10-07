// DOM overlays placed from the render loop. React creates the elements and registers them here; the
// scene works out where they belong on screen each frame and writes their styles directly, so moving
// them never causes a render.
export const overlay = {
  labels: new Map(), // city id → label element (DropLabels.jsx)
  sketch: null, // { canvas, ctx, grain }: the word's pencil sketch (WordSketch.jsx)
  // Where the ending's type stands on screen (CSS px: left, top, right, bottom), while it shows
  // (EndType.jsx): the rain on the puddle keeps its splashes out of it (PuddleRain.jsx).
  typeZone: null,
}
