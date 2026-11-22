# schwe

schwe.org: New York, London and Paris as matte white architectural models in a studio, shot with a long
lens. New York and Paris are also drawn as photographs (src/city/real/, on by default, `?real=0` for the
plaster): the same models, sun and weather through a game-style renderer. Each model is lit by its city's real sun at this minute, lights its windows after dark, and stands
under its city's current weather. The weather interface is the only interface. Switching cities is the
main interaction.

DECISIONS.md is the log of why things are the way they are. Its entries before 2026-11-10 describe the
frozen-rain film this replaced (tag `pre-salvage`); none of them bind.

## Stack

Vite 8, React 19, React Three Fiber 9, drei 10, three, SunCalc, detect-gpu. JavaScript, not TypeScript.
Node 22. No GSAP, no scroll library: the page is one fixed picture. The studio has no post-processing; the
photoreal New York renders through its own passes (src/city/real/pipeline.js), no postprocessing library.

## Commands

    npm run dev        the site at localhost:5173
    npm run build      production build into dist/
    npm test           node --test (look, weather parsing, GPU tiering)
    npm run models:fetch -- --city new-york   Overture Maps extract into data/models/ (needs python3 + duckdb)
    npm run models -- --city new-york         data/models/ -> public/models/new-york.glb and -ground.png
    python3 scripts/models/cover.py --city new-york && node scripts/models/cover.mjs --city new-york
                                              parks and trees on the plinth -> public/models/new-york-cover.png
    python3 scripts/models/context.py --city new-york && node scripts/models/context.mjs --city new-york
                                              the surroundings -> public/models/new-york-context.{png,bin,json}
    node scripts/shots.mjs [--city paris] [--url ...]   noon, golden hour, night, rain (and Paris's
                                              overcast) screenshots -> docs/shots/, docs/paris/shots/
    xvfb-run -a node scripts/bench.mjs [--city paris]   frame time at 1920 x 1080 in a headed Chrome
    node scripts/stages.mjs [--city paris] --url ...    the photoreal stack one technique at a time

Never push or deploy without being asked.

Dev-only query parameters (none work in a build):

    ?at=2026-11-10T17:00Z   pretend it is that moment
    ?wx=rain|snow|fog|overcast|clear   stand in for the selected city's weather
    ?cam=bearing,elevation,distance,fov[,east,up,north[,near]]   try a view
    ?still                  stop the camera's drift

`?lite` and `?lite=0` force the phone or desktop version anywhere. `#london` selects a city. `?real=0`
keeps New York plaster; `?fx=-taa,-ssr` (any of aerial, ibl, pbr, ssr, taa, bloom, wet, shafts, clouds,
grade) turns photoreal techniques off and `?fx=+gtao` turns the trial GTAO on, anywhere; `?tm=agx` or
`?tm=aces` overrides the city's tone curve.

## Map

    src/App.jsx              weather fetching, city selection (click, arrow keys, swipe, hash), loader
    src/city/cities.js       the three cities and their hand-picked views (wide and tall)
    src/city/look.js         sun + weather -> every number the scene is lit by; blendable
    src/city/Stage.jsx       canvas, camera rig, light, shadow map, the move between cities
    src/city/Maquette.jsx    one city: GLB, plinth with the ground map, its patch of floor
    src/city/plaster.js      the plaster material: baked occlusion, night windows, street glow
    src/city/newYork.js      New York's own night: lamp colours, Times Square, crowns, red roof lights
    src/city/london.js       London's night: lamps, landmarks, the Eye, bridges, the Embankments
    src/city/paris.js        Paris's night: lamps, the Eiffel Tower's schedule, monuments, the Champs-Élysées
    src/city/nightKit.js     what London's and Paris's nights share: windows, floodlights, street lamps, traffic
    src/city/solids.js       per-building facts worked out at load, the draw split, red obstruction lights
    src/city/Precip.jsx      rain and snow over a plinth
    src/content/cityWeather.js   one Open-Meteo request for all cities; parsing
    src/content/models.json  each model's centre, plinth and night flags (shared with the build scripts)
    src/ui/                  CityPanel (corner readout, cities, credit), WeatherPanel and its charts
    src/city/rig.js          the camera's views and drift, the shadow fit, city clocks, the shared look object
    src/city/real/           the photoreal New York and Paris: RealCity.jsx (the component, its frame, each
                             city's STYLES), look.js (sun, haze, clouds, exposure from the reading),
                             atmosphere.js (Hillaire's sky and air), clouds.js, materials.js (facades, ground,
                             water, context), paris.js (Paris's facades, roofs, setts, Seine), pipeline.js
    scripts/models/          fetch.py (Overture -> JSON), build.mjs (JSON -> GLB + ground map), cover.*,
                             context.* (parks; the surroundings)
    docs/                    rendering-research.md (techniques, sources, results), reference.md (the
                             photographs; files gitignored), assets.md (licences), shots/; paris/ the same
                             for Paris

## Rules

- No AI-generated images, video or art. Geometry comes from OpenStreetMap via Overture Maps; pictures of
  the site are screenshots of the site.
- Never invent data. Unread weather shows clear skies and the interface says "weather unavailable".
  A building with no mapped height gets the city's median, and the build prints how many did.
- The scene and the interface read the same weather object. Do not add a second request for either.
- 60 fps on a mid-range laptop in the studio; the photoreal cities' target is 30 fps at 1080p (not yet
  measured on real hardware: docs/rendering-research.md). The scene is static: the shadow map is redrawn
  only when the sun moves or the city changes; the sky's tables and environment only when the sun or the
  weather moves. Keep it that way. Phones get the lite version (smaller shadow map, lower pixel
  ratio, fewer particles), never a broken one.
- No hard cuts. A change of city is a camera move with the light blending; changes in light or weather
  ease in.
- When in doubt, remove an effect.
- Frame-rate numbers from headless Chrome mean nothing (software rendering). Measure on real hardware.
- Per-frame values live in plain objects mutated in useFrame (the look, the rig), never React state.
- Credits stay on screen: OpenStreetMap contributors and Overture Maps (ODbL), Open-Meteo (CC BY 4.0).
