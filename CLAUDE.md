# schwe

schwe.org: New York, London and Paris as matte white architectural models in a studio, shot with a long
lens. Each model is lit by its city's real sun at this minute, lights its windows after dark, and stands
under its city's current weather. The weather interface is the only interface. Switching cities is the
main interaction.

DECISIONS.md is the log of why things are the way they are. Its entries before 2026-11-10 describe the
frozen-rain film this replaced (tag `pre-salvage`); none of them bind.

## Stack

Vite 8, React 19, React Three Fiber 9, drei 10, three, SunCalc, detect-gpu. JavaScript, not TypeScript.
Node 22. No post-processing, no GSAP, no scroll library: the page is one fixed picture.

## Commands

    npm run dev        the site at localhost:5173
    npm run build      production build into dist/
    npm test           node --test (look, weather parsing, GPU tiering)
    npm run models:fetch -- --city new-york   Overture Maps extract into data/models/ (needs python3 + duckdb)
    npm run models -- --city new-york         data/models/ -> public/models/new-york.glb and -ground.png

Never push or deploy without being asked.

Dev-only query parameters (none work in a build):

    ?at=2026-11-10T17:00Z   pretend it is that moment
    ?wx=rain|snow|fog|overcast|clear   stand in for the selected city's weather
    ?cam=bearing,elevation,distance,fov[,east,up,north]   try a view
    ?still                  stop the camera's drift

`?lite` and `?lite=0` force the phone or desktop version anywhere. `#london` selects a city.

## Map

    src/App.jsx              weather fetching, city selection (click, arrow keys, swipe, hash), loader
    src/city/cities.js       the three cities and their hand-picked views (wide and tall)
    src/city/look.js         sun + weather -> every number the scene is lit by; blendable
    src/city/Stage.jsx       canvas, camera rig, light, shadow map, the move between cities
    src/city/Maquette.jsx    one city: GLB, plinth with the ground map, its patch of floor
    src/city/plaster.js      the plaster material: baked occlusion, night windows, street glow
    src/city/Precip.jsx      rain and snow over a plinth
    src/content/cityWeather.js   one Open-Meteo request for all cities; parsing
    src/content/models.json  each model's centre, plinth and night flags (shared with the build scripts)
    src/ui/                  CityPanel (corner readout, cities, credit), WeatherPanel and its charts
    scripts/models/          fetch.py (Overture -> JSON), build.mjs (JSON -> GLB + ground map)

## Rules

- No AI-generated images, video or art. Geometry comes from OpenStreetMap via Overture Maps; pictures of
  the site are screenshots of the site.
- Never invent data. Unread weather shows clear skies and the interface says "weather unavailable".
  A building with no mapped height gets the city's median, and the build prints how many did.
- The scene and the interface read the same weather object. Do not add a second request for either.
- 60 fps on a mid-range laptop. The scene is static: the shadow map is redrawn only when the sun moves or
  the city changes. Keep it that way. Phones get the lite version (smaller shadow map, lower pixel
  ratio, fewer particles), never a broken one.
- No hard cuts. A change of city is a camera move with the light blending; changes in light or weather
  ease in.
- When in doubt, remove an effect.
- Frame-rate numbers from headless Chrome mean nothing (software rendering). Measure on real hardware.
- Per-frame values live in plain objects mutated in useFrame (the look, the rig), never React state.
- Credits stay on screen: OpenStreetMap contributors and Overture Maps (ODbL), Open-Meteo (CC BY 4.0).
