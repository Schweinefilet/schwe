# Decisions

## 2026-09-28 — Phase 1 scaffold
- JS (not TS). Vite 8, React 19, R3F 9, drei 10, GSAP 3.15 + ScrollTrigger, Lenis 1.3, @react-three/postprocessing 3.
- Single frame loop: gsap.ticker → lenis.raf → ScrollTrigger → master timeline → R3F advance(). Canvas frameloop="never".
- Timeline measured in units; 1 unit = 100vh of scroll. Beats: loader 0, rain 1, freeze 1.08, drift 2.5, dive 8, align 12, splash 15, end 19.
- After "enter", the site auto-scrolls (2.4s) from the loader pose to the rain label; scroll stays the single source of truth.
- Freeze: target frozen/unfrozen comes from scroll position; uTimeScale eases to it over 1.5s real time (power2.inOut).
- Shaders animate with uSimTime (dt × uTimeScale accumulated on CPU), never wall-clock time.
- Timeline tweens a plain `rig` object; scenes read it in useFrame. No React state in the frame path.
- Camera = centripetal Catmull-Rom splines for position and look target through CAMERA_KEYS in config.js.
- Clip naming: {city}_{light}_{weather}.{mp4|webm|jpg}; city ids kebab-case; light night|dawn|day|dusk; weather clear|rain.
- Clip spec: 1920x1080, 30fps, 10s, H.264 CRF23 + VP9 CRF36, keyframe every 1s, no audio track.
- City ambience ships as separate audio files; video is always muted.
- manifest.json generated from files present in the clip folder; fetched at runtime from VITE_CLIP_BASE_URL (default /clips/).
- Placeholder generator never overwrites existing files (protects real footage).
- Clip fallback: exact → same light clear → any clear for city → any for city → null.
- Light state: fixed local-hour bands (TODO SunCalc). Weather: always clear (TODO Open-Meteo).
- Dev overlay loaded via import.meta.env.DEV dynamic import; absent from production bundle.
- Phase 1 deploy: wrangler direct upload (clips gitignored). Later: Git-connected Pages + clips on R2.
- Open: 12 hero drops vs 10 cities. Open: city list is provisional.

## 2026-09-28 — Overnight: Phases 2, 3, 5, 6, 7, 8, 9 (first pass, headless-tested only)
- Rain: one instanced draw of screen-space capsules; streak length = speed × shutter (1/50 s) × uTimeScale, so freezing collapses streaks into beads. Field repeats in a 24×18×30 box that tracks the camera; faces fade out.
- Beads and hero drops shade as ball lenses against one shared environment (env.glsl): dark sky, warm street glow below, faint skyglow above the horizon.
- ShaderMaterials with shared uniforms are built by hand (new THREE.ShaderMaterial), never as <shaderMaterial uniforms>: R3F copied the uniforms object and cut the link to globalUniforms, so rain never froze.
- Hero drop: per-pixel ray-traced water sphere, IOR 1.333; inversion comes from the optics. Dispersion ±0.0035 (water's real spread), high tier only. Video frames decoded from sRGB in-shader (three leaves video undecoded for custom shaders).
- One hero drop per city: 10 drops (tiers 10/8/4). Dive drop = mexico-city, index 9, always kept. Drops alternate ±0.5 units either side of the camera path.
- Clip naming adds optional _720 size suffix and weather 'snow'. Placeholders: clear + rain only, 1080p + 720p.
- Light state: SunCalc altitude, night < −6°, day > 6°, dawn/dusk by altitude trend (10 min ahead). suncalc 2 returns degrees.
- Weather: one Open-Meteo request for all cities, WMO code → clear/rain/snow + label; 4 s timeout → clear. Reselect every 10 min.
- Poster atlas: 4×3 cells of 512×288 drawn into one canvas texture, mipmapped. Video budget: quality.decoders live videos, scored radius/distance, 25% hysteresis, 0.4 s poster↔video crossfade. Drops use 720p; dive drop uses full size.
- Dive: camera stops 1.28 R from the dive drop (covers all screen corners). rig.dive eases IOR 1.333 → 1.0 and clip framing → cover-fit; at 1 the drop is the fullscreen clip from the same decoder. No separate fullscreen plane.
- Camera keys: per-segment eases; identical consecutive keys are exact holds.
- Alignment: Inter Tight 600 (OFL, @fontsource, self-hosted), seeded jittered-grid sampling; drops at random depth 3.5–18 from the eye; radius ∝ depth. Word width 62% of screen width, capped at 40% height; beads scale with it. Eye [0, 4.8, −41] → target [0, 4.8, −60]. Side swing-in from 12.3; arrive 13; hold to 14.5.
- Alignment drops are hidden until the dive is over (rig.wordReveal, 11.9 → 12.5): the drift flies close to the word's sight line, where it would already read in the distance. Pull-out swings 1.6 units off-axis.
- Beats now: loader 0, rain 1, freeze 1.08, drift 2.5, dive 8, align 11.5, splash 14.5, end 19.
- Splash: Blender 4.2 LTS Mantaflow (the pip bpy wheel's Mantaflow is broken), res 160, pool + 6 mm drop at 4 m/s, time scale 0.05, 72 frames. Bake ≈ 20 min on 4 CPU cores.
- VAT export is plain numpy (vat_from_cache.py) reading Mantaflow's .bobj.gz cache directly: crop radius 60 mm, vertex clustering (fine on the crown, 5× coarser on calm water, cell size searched per frame) to ≤ 6000 tris. Re-export takes ~30 s without re-simulating.
- VAT = triangle soup, 12-bit positions in hi/lo RGB PNGs + octahedral normals; 72 frames = 5.6 MB. Resting water height is measured from frame 1 (30.6 mm, not the nominal 30) and put exactly on the puddle plane.
- Calm water at rest height is dropped by the exporter (and drawn transparent if any remains); the puddle (which writes depth) carries it and the rings, so the triangle budget goes to crown, jet and crater. Same VAT on all tiers (no pre-rendered splash video for low).
- Sim scale = fall radius 0.03 / sim drop radius. Falling drop = hero-drop optics with no clip (env only, lens gain 30). Hand-off to the VAT's own drop at frame 0.
- Puddle exists only in beat 7, fades beyond ~5 units; rings = three wave packets.
- Splash data loads at timeline 3.5 (during the drift), not at startup.
- Audio: Web Audio, all procedural placeholders until AUDIO.files slots get licensed files. Freeze pitches and low-passes the rain bed itself into the hum. One-shots fire on crossing in either scroll direction.
- Final pass: bloom (high only, threshold 0.85), LUT when GRADE.lut set, grain, vignette. Low tier keeps vignette (the pass runs anyway).
- Grade: footage should be encoded neutral Rec.709; the site's final LUT grades CG and footage together (avoids grading clips twice).
- Tier: detect-gpu with self-hosted benchmarks; desktop tier 3 → high, tier ≥ 2 → medium, else low; phones cap at medium. Live drop after 2 s averaging > 20 ms; stalls > 250 ms ignored; 4 s cooldown.
- Still page for prefers-reduced-motion and no WebGL: public/still.jpg (saved from /?lab=drop with S) + city list.
- Dev tools: /?lab=drop, ?tier=, ?at=ISO, ?still, window.__schwe.goto(units).

## 2026-09-28 — Dependency sync after the Phase 9 merge
- After any pull that changes package-lock.json, run `npm ci` (not `npm install`) so node_modules matches the lockfile exactly.
- Missing-import errors for @fontsource / detect-gpu / suncalc mean node_modules is stale, not that code is wrong.

## 2026-09-28 — Dive city chosen by the world
- Each visit dives into the most interesting city now: rain clip +3; dusk/dawn 2, night 1, day 0; random tie-break (content/diveChoice.js).
- Scored on the clip that will actually play, not raw weather (snow and missing rain clips don't count as rain).
- Chosen once per visit from the first selection; the 10-min reselect never changes it. Fallback: DEFAULT_DIVE_CITY (mexico-city).
- Drop positions and camera path fixed; heroDropsFor(city) swaps the chosen city into slot DIVE_DROP_INDEX.
- Loader "enter" fades in only after the choice (≤4 s weather timeout), so layout and ambience are fixed before scroll.
- Ambience reads state.diveCity; AUDIO.diveCity and HERO_DROPS removed.
- Dev-only ?dive=<city> forces the pick; not in production builds.

## 2026-09-28 — Direction: "where is it raining now?"
- The site answers where it is raining hardest right now; the one drop that falls in beat 7 carries that city. Plan B (tap to visit any drop during the drift) deferred to a later phase.
- Weather request adds current rain+showers (mm per 900 s → mm/h) and minutely_15 rain+showers for 6 h. Snow never counts as rain.
- Ending choice (content/rainChoice.js), once per visit before "enter": 'now' = heaviest mm/h among cities whose rain clip plays (tie → WMO severity); else 'soon' = earliest ≥0.1 mm slot; else 'none'. Weather failure → 'none'. Never invented.
- Dive city excludes the ending city, so each visit shows two cities.
- Falling drop: 'fall' video slot, 720p, pinned from SPLASH.fallPinFrom (13) to impact; city poster until live; envOnly when 'none'.
- Ending type (ui/EndType.jsx, rig.endType) in at SPLASH.answerAt (17.5), leaves with #fade. Copy: "Raining hardest now" / "Rain reaches X in about N min" / "Nowhere else is it raining right now."
- Sound: second source on the rain bed under the fall (lowpass 3.5 kHz, 'now' only), ducked by the splash; chime at the answer. AUDIO.files.ambience[city] replaces it when licensed.
- Title: "schwe: where is it raining now?".
- Dev-only ?rain=<city> | <city>@<minutes> | none.

## 2026-09-28 — Housekeeping, tests, benchmark mode
- Work lands on main directly (no feature branches). Commits end with the Co-Authored-By line; nothing is pushed without asking.
- __pycache__/ and *.pyc ignored. favicon.svg: a frozen drop drawn by hand in SVG (dark lens, inverted street glow, rim, glint).
- `npm test`: node's built-in runner, no test dependency. Covers rainChoice, diveChoice, weather parsing (mocked Open-Meteo) and bench stats.
- `npm run smoke`: Vite + headless Chrome (puppeteer-core, CHROME env) through every beat forward and back for the natural ending and each ?rain= ending. Checks beats, freeze/unfreeze, ending text, dive ≠ ending city, decoder budget, page errors. Frame rates from it are meaningless (software GPU).
- Benchmark mode `?bench` (production too, its own ~3 KB chunk): after "enter", 4 s idle at rain, then a constant-speed pass to the end (1.6 s per unit) and back, scroll locked. Per frame: interval, main-thread CPU ms, beat, tier, dir, live videos. Report per beat × tier: fps, p50/p95/p99/max, % over 20 ms (tier guard budget), % over 33 ms, CPU p95, plus tier changes. Hand back via "download json" (includes raw frames) or "copy summary" (plain table).
- GPU time is not measured (not reliably exposed); CPU ms low + interval high = GPU-bound.
- Display rate reported only when idle frames sit within 6% of a common refresh rate; otherwise unknown.
- Build id (short commit, +dirty) is compiled in via __BUILD__ so every report names the build it measured.
- Combine ?bench with ?tier=high|medium|low to measure one tier; the live tier guard is off when a tier is forced.

## 2026-09-29 — First device bench (Apple M5, Chrome): tier fix and beat-7 prewarm
- detect-gpu's data stops at Apple M4 (library last updated Feb 2025); the M5 came back FALLBACK tier 1 and got the low tier. The live guard only steps down, so a low start is permanent.
- core/gpuScore.js effectiveTier: FALLBACK + Apple Silicon ("apple m<n>") → 3; any other FALLBACK → 2; known GPUs keep their tier. Bench reports now show detect-gpu's type and the score used.
- The one 58.9 ms frame was beat 7's first use: puddle + falling-drop shaders at the fall, splash shader + VAT textures at impact.
- core/prewarm.js compiles hidden objects (made visible only for the synchronous compile call) and uploads their textures ahead: puddle and falling drop at mount (loader), VAT right after its download (drift). Compiles into a 1×1 offscreen target, because the effect composer renders the scene offscreen and three keys shader variants on the output target (sRGB screen vs linear offscreen).
- Verified with renderer.info: all 7 programs exist by drift; none compile in beat 7.

## 2026-09-29 — Second M5 bench (high tier) and four changes
- Bench on high: 60 fps, p95 ≤ 17.3 ms every beat; splash max 58.9 → 18 ms (prewarm works). One 55 ms frame moved into the drift: the splash data's decode/upload/compile landing at once. Now: images decoded with image.decode() before resolving, then one texture upload per frame, then the compile.
- Hero drops are ordinary drops: HERO.radius 0.18 → 0.03 (the largest rain bead). The drift is now a macro dolly (config DRIFT): drops generated around the camera line at DRIFT.pass 0.12 (4 radii), mostly above/below it (angles 60/240/120/300°) so portrait phones keep them in frame; one camera key DRIFT.lead 0.4 before each drop at speed 0.5, look turned 0.3 of the way toward it. Drops and keys come from the same numbers.
- Dive scales with the drop (DIVE_EYE = 1.28 R). CameraRig pulls the near plane in only near the dive drop (0.5 × gap to its proxy, clamped 0.002–0.02). Dive look targets aim 6 units behind the drop (DIVE_AIM), not at its centre, which swung the view on any movement.
- Word: no hold. The camera passes the eye at 13 with speed 0.45 (legible ≈12.8–13.2); rain dimming (uFade) and the glow pulse removed; widthFrac 0.62 → 0.42, maxHeightFrac 0.4 → 0.28, beads 2600/1800/1000 → 900/650/450. Chime → faint two-note shimmer (peak 0.018).
- Beat 7 moved 1.2 units earlier: splash at SPLASH_AT = 13.3, its timings are offsets from it, TIMELINE_END = 17.8. fallPinFrom 12.4.
- Camera path (core/cameraPath.js, tested): per-axis cubic Hermite over timeline time with Steffen tangents: continuous velocity, no overshoot, identical keys = exact hold entered/left at rest, key `speed` scales velocity. Replaces index-parameterised Catmull-Rom + per-segment eases (speed jumps at every key and a standing start out of each hold). The camera reads state.time directly; no pathT tween.
- Measured at 1080p, 0.025-unit steps: worst speed jump per step 200% → 25%; steps over 20%: 10 → 7 (the remaining are smooth accelerations out of holds).
- UI theme decided: dreamy + smooth, white + pastel colors. Not applied yet; open question whether it covers only the UI layer or also the scene/grade.

## 2026-09-29 — The word is found in the rain, not revealed
- The word's drops exist from the first frame (rig.wordReveal / uReveal removed) and are drawn exactly like frozen rain: rain brightness range (0.55–1.0, was 0.8–1.2), radii within RAIN.radius (clamped beadAngle × depth: grow with depth up to 0.03, then shrink with distance like any rain), same fog, near fade, and the rain box's face fade (uBoxCenter is now a shared global uniform).
- Depth along each sight line: 2–9 from the eye, density ∝ depth (depthPower 1). Word drops fade out beyond 7–9 units from the camera (ALIGN.visibleWithin): seen from farther, hundreds of sub-pixel drops bunch into a visible band; far rain is specks anyway, so none missing is noticeable.
- Word axis turned 40° left of the drift line (ALIGN_YAW) and the eye moved to [-3, 4.8, -41], so the drift and dive never look down the word's axis and stay ≥ 9.4 from its drops. Swing-in comes from above (+1.8) so the approach sees the drops spread, not as a flat strip.
- Word frame helper inWordFrame(origin, [x, y, z]): target, swing-in, falling-drop start, puddle and beat-7 camera keys are all expressed in the word's frame, so they turn with it.
- Checked in screenshots: nothing at 8.4–11.6; a loose patch coheres 12.0–12.75; the word at 13.0 (landscape and portrait); scattered by 13.3.

## 2026-09-29 — Footage ingest, contact sheet; theme scope
- Low-end/phone performance: verified by the user on device (numbers not recorded here).
- UI theme (dreamy + smooth, white + pastel) covers the UI layer only: loader, city type, the ending's answer, overlays, still page. The scene, shaders and grade stay a night storm.
- Shader look pass waits for real footage: tuning the drop shader against flat placeholders would be redone.
- `npm run clips:ingest -- <file> --city --light --weather [--start --duration 10 --fade 1 --focus 0.5 --out --force]`: 30 fps, 1920×1080 cover crop (focus = horizontal crop position), seamless loop (duration + fade read; the tail, fading out, is laid over the start, so frame 0 continues from the last frame), no audio, tagged Rec.709, neutral (the site LUT grades). Encodes: H.264 high/slow CRF 20 max 8M (1080), CRF 21 max 4M (720); VP9 good/cpu-used 2 CRF 31 cap 6M (1080), CRF 33 cap 3M (720); keyframe every 1 s, faststart. Poster = loop frame 0 at 960×540. Rebuilds the manifest when writing to public/clips.
- Ingested files carry comment `schwe-ingest:<source>@<start>s`; placeholders (untagged) are replaced freely, ingested footage only with --force. HDR sources (bt2020 / HLG / PQ) are refused: export SDR Rec.709 from Resolve first. Warnings for < 1080p, portrait, and non-30/60 fps sources.
- Verified with a time-encoded source (luma = 16 × t): loop's last frame = source 10.94 s, frame 0 = 11.00 s (one frame on), frame 30 = 2.00 s.
- `npm run clips:sheet -- [--city] [--real] [--dir] [--out review/contact-sheet.jpg]`: one row per clip: start | end (loop seam) | middle | in a drop (inverted both ways, 150 px tall = a drift drop's city on a 1080p screen, at actual size). review/ is gitignored.
- scripts/lib/ffmpeg.mjs: shared run/probe/font helpers (probe parses `ffmpeg -i`, no ffprobe needed).

## 2026-09-29 — Word density halved
- ALIGN.count 900/650/450 → 450/325/225 (high/medium/low): more natural, closer to the surrounding rain. Still legible from the eye on every tier and in portrait; the approach patch (≈12.6) is lighter.

## 2026-09-29 — Sky in a drop: lab prototype (approved; what is final and what is still provisional: "Sky in the main scene" below)
- Provisional. A second content source beside footage, in /?lab=drop only. Footage pipeline, ingest scripts, video budget and the main timeline are untouched; the site never sets the SKY define (≈1.3 KB of shader text ships, never compiled).
- Model: Hillaire 2020 (Rayleigh, Mie, ozone, planet shadow, multiple scattering approximated). Chosen over analytic fits (Preetham, Hosek-Wilkie: no twilight below the horizon) and single-scattering marches (blue hour too dark, too heavy full-screen).
- Bruneton 2017 stays open for later: the only interface is the per-city sky-view texture (atmosphere.glsl layout) plus a transmittance texture in Bruneton's parameterization. Any model object with shared / init() / renderSkyView() can replace src/sky/hillaire.js.
- Per visit: transmittance 256×64, multiple scattering 32×32, half float. Per city: sky-view texture 192×108 (high, medium) / 128×64 (low), absolute azimuth (lit by sun and moon), re-rendered only when the sun or moon moves 0.25° or the pre-exposure changes.
- Sharp parts are per pixel (sky.glsl), so the dive drop runs the same shader and needs no high-res texture: sun disk (limb darkened); moon as a Lommel-Seeliger sphere lit by the real sun direction (phase and tilt from geometry, brightness scaled to Allen's phase law, earthshine); catalogue stars; the cloud deck. Discs smaller than a pixel keep their light.
- Stars: Yale Bright Star Catalogue 5th rev. (Hoffleit & Warren 1991, via CDS V/50), 904 stars to V 4.5 → public/sky/stars.bin (14 KB, `npm run sky:stars`). J2000 → date by IAU 1976 precession, placed by local sidereal time and latitude. Cube cells 64 per face; 42 stars share a cell with a brighter one and add their light to it. Visibility is left to the numbers (star flux vs sky brightness vs pixel footprint).
- Star catalogue license: CDS distributes it freely and asks for acknowledgement; its ReadMe carries no license statement. To confirm and log in the bible's license log.
- Weather: the one Open-Meteo request adds current cloud_cover (0..1, null on failure); weather.js also returns the WMO code. No data → clear, dry, no haze, sky from sun and moon alone.
- Clouds: one layer. Pattern is one tileable 512² warped value-noise fBm, histogram-equalized so threshold 1 − cover covers exactly that share; per-city offset. Deck at 2 km (1 km when raining); optical depth 3–25 with cover + 4 per mm/h. Thin cloud scatters once toward the light; thick cloud is two-stream grey; bases lit from below after sunset.
- Rain haze: extinction 0.25 × R^0.63 per km (R in mm/h) up to the deck; fog (WMO 45, 48) 7.8 per km. City glow: one constant for all ten (warm, zenith 0.012 cd/m², ×4 at the horizon, ×5 on cloud bases, ×3 on the ground); per-city values would be invented.
- Facing: the drop's axis maps to a city view toward the sun's azimuth (the moon's once the sun is below −12° and the moon is up), 15° above the horizon. A rotation, so the optics still invert it. The sky covers every direction: no frame edge; the dark rim comes only from Fresnel and the ground. Reflections stay on env.glsl.
- Exposure: pre-exposure from sun altitude, moon, cloud and rain keeps half floats in range; the final exposure is metered in the shader, center-weighted on what the view faces: L → 0.2 × (L / 3000)^0.2, about 3.6 stops from clear noon to a city night (the plan's 5 stops left nights near black). Twilight is metered as all sky light (the first pass used daylight's 15% and blew dusk out).
- A highlight shoulder (linear to 0.6, rolling off to 1) puts the sky in footage's 0..1 range, like a camera's knee; the one LUT grades both.
- Lab: ?city=, ?at=ISO, sliders (cloud, rain, local time), views orbit / drift (true size, posed as at a drift key) / dive plus a dive slider, readout with sky-refresh and frame GPU ms where EXT_disjoint_timer_query_webgl2 exists (not Safari). The lab now shows the sky by default; ?clip= shows footage as before. window.__lab drives it from scripts.
- `npm run sky:stills`: headless stills to review/ (Tokyo night rain, Mumbai dusk, London overcast midday, Sydney clear dawn; drift and dive; sky-sheet.jpg). Weather comes from the sliders: previews, not live readings.
- Known limits: three-wavelength RGB renders the blue-hour zenith violet-grey, not deep blue (a spectral model such as Bruneton's would fix it); city nights are dim and nearly featureless (true, but a night drop carries little); a sky cannot name its city (no skyline); low cloud near sunset reads as flat dark slabs on the horizon.
- Performance: estimated 1–1.5 ms per city refresh and 2–4 ms extra for the full-screen dive on a low-tier phone. Not yet measured on a device; the lab readout is the place to measure.

## 2026-09-29 — Sky in the main scene
Final (approved from the prototype):
- The sky is the default content source for every hero drop: the drift drops, the dive drop and the falling drop. `CONTENT.source` in config.js ('sky' | 'footage') is the one switch; the lab's ?clip= still shows one clip. Footage mode is unchanged and still passes smoke: the video budget, poster atlas and decoder pins run only in it. In sky mode the clip manifest is not fetched.
- Model: Hillaire 2020. The atmosphere model's only interface is its object (glsl, shared, init / initSteps, renderSkyView): the per-city sky-view texture plus a transmittance texture in Bruneton's layout. Bruneton 2017 stays deferred.
- Sharp parts per pixel (sun, moon lit by the real sun direction, catalogue stars, clouds). The dive keeps the per-pixel shader and its existing timings; no high-res dive texture.
- Stars: Yale BSC5 as built by `npm run sky:stars` (904 to V 4.5, precessed, sidereal time). Facing: the sun's azimuth, the moon's once the sun is below −12° and the moon is up, 15° up.
- Exposure: the center-weighted meter in the shader, L → 0.2 × (L / 3000)^0.2. The highlight shoulder (linear to 0.6, rolling off to 1) is approved: the sky arrives in footage's 0..1 range and the one LUT grades both. Pre-exposure now follows the sun and moon only, so weather never re-renders a texture.
- Wavelengths: 610 / 550 / 465 nm (the sRGB primaries' dominant wavelengths) replace Hillaire's 680 / 550 / 440, which turned the blue-hour zenith violet. Rayleigh 8.960 / 13.558 / 26.535 and ozone 2.505 / 1.881 / 0.197 (×10⁻³ per km), from Bruneton 2017's constants and IUP Bremen ozone cross-sections (src/sky/spectrum.js). Noon zenith chromaticity moved toward measured clear skies. A 630 nm red was tried: lavender zenith, slightly more orange glow; rejected. The lab's ?wl=hillaire renders the old set for comparison.
- Rain choice with the sky: every city where it is raining counts (weather variant 'rain'; snow never), no clip gate. The dive choice scores the light and weather the sky shows. Footage keeps both clip gates (src/content/contentSource.js). Selection rows now carry cloudCover and the WMO code.
- src/sky/skyManager.js: one CitySky per drawn city (tier's visible drops plus the ending's city); inputs re-read every 15 s and on each 10-minute reselect; new weather eases in (0.5 s time constant, 98% in 2 s); at most one piece of GPU work per frame (a setup step or one city's texture).
- Loader: "enter" waits for the skies to be prepared (tables drawn one per frame, star catalogue, cloud noise built in a Web Worker, each drawn city's texture, the SKY drop variants compiled by prewarm), capped at 6 s so it never hangs.
- stars.bin is preloaded by index.html and cached 7 days (/sky/* in public/_headers). Production bundle 1,433.9 → 1,475.3 kB (gzip 415.5 → 432.3), plus a 1.3 kB worker.
- public/still.jpg re-saved from the lab: Mumbai at dusk, 30% cloud, orbit view.
- Dev: ?weather=tokyo:1:6 (cloud 0..1 : rain mm/h) sets a city's weather as if read live, so sky, type and rain choice agree. src/core/clock.js `now()` makes ?at= move the city and ending type's clock too (they read the real clock before). `npm run sky:stills -- --timeline` (real site at each city's drift key and inside the dive) and `-- --still`.
- Smoke: in sky mode it checks the skies were prepared before "enter" and that no video ever decodes.
- Night sky brightness data: World Atlas of Artificial Night Sky Brightness (Falchi et al. 2016), doi:10.5880/GFZ.1.4.2016.001, license CC BY-NC 4.0 (DataCite record). schwe.org is non-commercial (confirmed). Credit on the still page, shown only once values are in use. `npm run sky:glow -- --in World_Atlas_2015.tif` (GFZ GeoTIFF, 5×5-pixel mean; `geotiff` dev dependency) or `-- --values "sydney=…,…"` (lightpollutionmap.info World Atlas 2015 point readouts, FAQ 31, same values; that site asks to be credited "Jurij Stare, www.lightpollutionmap.info"). Its FAQ 29 downloads are rendered RGB images, not values: not usable. Every city needs a value or nothing is written; the natural sky (0.171 mcd/m²) is added. Credit in use since 2026-09-29: the still page line links the paper (Science Advances, doi:10.1126/sciadv.1600377), the GFZ dataset and CC BY-NC 4.0; the full citation is an HTML comment in index.html. The atlas README (15 June 2016) asks every use to cite both the dataset and the paper, and prohibits redistributing the files: the zip, kmz and TIFF stay out of git (.gitignore) and out of dist/.

Still provisional:
- Per-city glow values: in (see "Per-city glow values from the atlas" below), provisional until the look is approved. The one constant (0.012 cd/m²) is now only the fallback for a city without a value.
- Horizon clouds: below ~15° the deck's pattern gives way to its average (opacity to the cover fraction, colour to the haze), aerial fade 25 km. Removes the flat slabs; to be judged on screen.
- Performance: unmeasured on devices. Awaiting ?bench on the Mac at high and low, before and after, drift / dive / splash beats. Estimates stand: ≈1–1.5 ms per city refresh on low (one per frame), 2–4 ms extra for the full-screen dive on a low-tier phone.
- City nights render dim and nearly featureless (true to a city night; the drops carry little then). No change proposed.

## 2026-09-29 — Per-city glow values from the atlas
- File: World_Atlas_2015.tif (3,012,927,014 bytes, 2.8 GiB) from GFZ's World_Atlas_2015.zip, unzipped to data/atlas/. data/atlas/, the zip and NewWorldAtlas_ArtificialSkyBrightness.kmz are gitignored; the .kmz is rendered imagery and was not used. Checked with geotiff.js before sampling: 43200 × 17406, one float32 band, EPSG:4326 (WGS 84), top-left origin (−180°, 85.054°), resolution 0.00833333° (30″) with y negative, nodata −3.4e38.
- `npm run sky:glow -- --in data/atlas/World_Atlas_2015.tif`: mean of the 5×5 pixels (about 4 km) around each city's coordinates in cities.json. The site adds the natural sky, 0.171 mcd/m².
- Values, artificial only (mcd/m²): Sydney 5.138, Tokyo 6.609, Hong Kong 7.78, Mumbai 4.739, Istanbul 8.017, Paris 9.459, London 10.47, São Paulo 10.31, New York 10.49, Mexico City 4.239.
- Dry-run checks: every city used all 25 pixels (no nodata, water included); none under 1 or over 100; centre pixel vs 5×5 mean within 1.21× (Sydney, whose window takes in the harbour; the rest within 1.16×).
- Flagged: all ten are below the old shared constant (12 mcd/m² artificial), from 0.35× (Mexico City) to 0.87× (London, New York). Tokyo's point in cities.json is about 5 km west of Shinjuku; coordinates not moved.
- The atlas is from 2015 VIIRS data and predates many cities' LED changes, so values may understate today's glow.
- Look (lab dive view at night, cloud 0 and 1, and `sky:stills -- --timeline` before/after, headless SwiftShader): cities now differ, but only a little on screen. The metered exposure (L → 0.2 × (L / 3000)^0.2) takes most of it back: Mexico City's glow is 2.5× dimmer than New York's, its exposure 3.0 vs 1.5, its frame mean about 10% lower. A few more stars show in the dimmer cities. Dusk (Mumbai) and the drift frames are unchanged to the eye. No constant changed.
- Checks: npm test 55/55, smoke 5/5, build 1,475.55 kB (+0.25 kB); dist/ holds no atlas file.

## 2026-09-29 — Backdrop: a night square behind the rain, refracted by every drop
- Asked for: a background, and every water drop refracting it. Chosen (user): a real 360° night photograph over drawn lights or the dive city's sky. Poly Haven "rathaus": Hamburg's Rathausmarkt at night, overcast and wet, Greg Zaal, taken 2016-11-03. License log: CC0 (polyhaven.com/license: "all licensed as CC0"), no attribution required. Source rathaus_2k.hdr (sha256 89a5a24c…b4d0a2) in data/backdrop/, gitignored; only the built JPEGs ship.
- `npm run backdrop -- --in data/backdrop/rathaus_2k.hdr --out public/backdrop/rathaus`: sharp map 1024×512 (48 KB, what drops see) and soft map 2048×1024 (91 KB, the backdrop itself: each direction the mean over a 1.2°-radius disc, 256 taps, so lamps become even, round bokeh). Log-encoded 4:4:4 JPEGs, values relative to the panorama's solid-angle-weighted median luminance. Codec (src/content/backdropCodec.js, tested): soft up to 256× the median, sharp up to 2^18×, because 76% of the square's light is in lamps above 256× (the brightest is 207,759×) and a small bead averages everything it sees.
- env.glsl now reads the photo in place of the procedural night (dark sky, street-glow pools; the "one shared environment" of phase 2 stays, with new content). The backdrop and water (puddle, splash) use the soft map: a flat surface's image of the far city is as out of focus as the city. Drops use the sharp map: their image forms inside the drop, where the lens is focused. Mip level from each pixel's angular footprint, not uv derivatives (they jump where longitude wraps).
- The sharp map's mip chain is built at load time in linear light (src/content/backdrop.js). GPU mipmaps would average the log-encoded values and turn lamps into dim smudges for small beads.
- Beads (rain and word) use the exact water-sphere deviation 2(θi − θt) along each bead's own view ray: about 83° all round behind it, upside down (the old approximation saw 45°). Fresnel losses in and out, rim reflection, key-light glint kept. Blending is premultiplied instead of additive: a bead covers the backdrop, a streak covers it for its share of the shutter.
- Changed from recorded decisions: frozen beads no longer use the 0.55–1.0 brightness range (it now dims streaks only; a lens is opaque), so the word's drops are drawn like frozen rain as before, but without it. The word's falling bead is hidden by radius 0 instead of brightness 0.
- Gains that lifted the old dim environment: RAIN.lensGain 30 → 3 (1 is physical; at 1 most beads blend into the square and the word is faint; 3 reads like rain lit by a flash, user's choice), RAIN.reflGain 8 → 1, HERO.reflGain 4 → 1, HERO.envOnlyGain 14 → RAIN.lensGain, WATER.reflGain 4 → 1, WATER.transGain 2 → 1.
- BACKDROP.exposure 0.006 (the median's final linear brightness). At 0.012 city drops at night read as dark discs against the lamp-lit square; the user chose one stop darker. BACKDROP.yaw −56°: the word's line of sight (40° left of −z) faces the square's darkest stretch. At 0° it sat on the brightest lamps and did not read, even at 3×.
- City drops keep their own city's sky inside (recorded decision); only their rim reflection shows the square.
- Checked in headless Chrome at 2× pixel ratio (the high tier's), 1280×720: freeze 1.5, drift 3.6, dive 10.1, word 13.0, fall 15.7, splash 16.2 and 16.8. The word is legible at the eye, but weaker than the old glowing word on black. Comparison: review/backdrop-compare.jpg (local).
- Loader: "enter" also waits for the backdrop (the same 6 s cap; a failed load draws black and never blocks). index.html preloads both images; /backdrop/* cached 7 days. Download +140 KB. GPU memory about 8 MB (soft) + 2.8 MB (sharp with mips). Bundle 1,475.55 → 1,479.59 kB. npm test 57/57, smoke 5/5.
- Performance: the bead shader trades eight noise lookups for two asin and two texture reads, so it should not be slower; not measured on a device.
- Still open: public/still.jpg shows the old look; the shader look pass still waits for real footage.

## 2026-09-29 — City drops only up close; drop labels; the word's outline
- City drops no longer stand out from afar. Beyond HERO.near[1] (1.8 units) from the camera a city drop is an ordinary bead refracting the backdrop at the rain's lens gain; its city fades in toward HERO.near[0] (0.9). At a drift pass the camera is 0.42 away, so each city shows in full as it goes by; the next drop, 4.9 ahead, looks like rain. Same for the dive drop (a bead on the approach, its city as the camera closes in) and the falling drop (its city shows only in the last part of the fall). A distant drop skips its city shader entirely (the branch is uniform per drop).
- The backdrop through any city drop uses RAIN.lensGain (was 1 for city drops, HERO.envOnlyGain for the falling drop without a city); HERO.envOnlyGain removed.
- City drop labels (ui/DropLabels.jsx, placed by scenes/DropLabelAnchors.jsx): the first of the white UI. City name (light weight, white, soft white glow), then local time and weather (small caps, pastel lavender #e6e3ff). Beside the drop on the side toward the screen's middle, so it stays in view as the drop slides outward (checked on a 390×844 phone too). Fades in with the drop's city (HERO.near) and settles 8 px as it does; gives way to the corner type inside the dive and does not return on the way out. The falling drop has none (the ending's type names it). HTML placed from the render loop through ui/overlay.js: no React renders per frame; the text changes at most once a minute.
- (Superseded the same day by the pencil sketch below.) The word's outline (ui/WordOutline.jsx, placed by AlignmentWord.jsx; ALIGN.outline): one loose loop around the whole word (user's choice over tracing each letter), a rounded superellipse (n 2.4) with a gentle wobble that runs on 0.32 rad past its start and drifts slightly outward, like a hand-drawn ring. White 1.3 px line over a 9 px pastel lavender glow blurred 9 px (the glow is skipped on the low tier: its blur repaints while it draws). It appears only when the visitor stays: within 0.15 timeline units of the eye (13) and 0.35 s without scrolling, then draws over 3.2 s (eased in and out; measured in headless Chrome: starts at 0.4 s, complete at 3.6 s). It fades as the camera moves off and draws afresh on the next stay. It lies on the plane at the drops' mean depth (6.24 from the eye), so it frames the word exactly from the eye and moves with the drops just off it (checked at 13.1 and on a 390×844 phone).
- Softens "found, not announced": the word is still found first, since the outline only comes after lingering on it. No hold or scroll snap was added ("Word: no hold" stands).
- Bundle 1,479.59 → 1,484.14 kB; npm test 57/57, smoke 5/5.

## 2026-09-29 — The word's outline becomes a pencil sketch of its silhouette
- User feedback on the loop: the outline should follow the word's shape closely, draw in like an artist sketching (many rough lines, a pencil texture), start with the chime rather than after a dwell, and retract smoothly when the visitor scrolls away.
- Shape (content/wordPoints.js wordContours): the word drawn in the drops' own font and layout with a round-joined stroke of twice ALIGN.sketch.margin (14 px at the 240 px sampling size), which merges the letters into one silhouette; its outer edge is traced (Moore neighbour), smoothed and resampled every 5 px, in the same units as the drops, so it hugs them exactly. Letter counters (the e's eye) are left out.
- Sketch (ui/pencilSketch.js): seven pencil passes on high (six medium, four low): three quick loops round the silhouette that overshoot their start, a late loop, and short accents, over 2.6 s from the chime. Each pass wanders off the outline by smooth noise (up to about 3 px), drifts so its end misses its start, is lighter at both ends, and sets off quickly, slowing to finish. Lines are white with a 128 px paper-grain pattern as their fill, so they break up like white pencil; a soft pastel drop-shadow halo on high and medium.
- Timing: draws from ALIGN.chimeAt (12.98, where the word's shimmer plays going forward; the audio now reads the same constant) while the camera is within ALIGN.sketch.until (0.15) past the eye; outside that, in either direction, it retracts 1.6× as fast, last stroke first, each from its tip. No dwell, no fade. Scrolling back into the window draws it again (without a chime, which only plays forward).
- Drawn on a 2D canvas sized to the word's area on screen (64 px steps, at most 2× pixel ratio), placed by the same mean-depth plane as before, and redrawn only when the sketch or the camera changed. ui/WordOutline.jsx removed; ui/WordSketch.jsx holds the canvas.
- Checked in headless Chrome at fixed sketch times (0.3, 0.7, 1.2, 1.8, 2.6 s), fully drawn at 2×, retracting after scrolling back, and on a 390×844 phone at the low tier. Bundle 1,484.14 → 1,488.41 kB; npm test 57/57, smoke 5/5.
- Negative space (user: "the c and e need more clarity"): the letters in ALIGN.sketch.inner.letters ('c', 'e') also get lines through their negative space, 7 px off the letter. Each letter is closed separately (its openings bridged: grown by 0.18 of the font size, then shrunk back, by distance transforms), and the edge of what lies inside the closed letter but outside the letter itself is traced where it runs along the letter: a closed loop for the e's eye, open arcs for the c's bowl and the e's lower counter, ending at the stroke ends so the openings still read. Holes of the widened silhouette were tried first and rejected: at the 14 px margin they are slivers, and the c's counter merges with the gap before the h. Inner lines start 0.45 s after the silhouette, take the three full passes only (no accents) and wander 0.6× as much. Tracing costs about 144 ms once, when the word loads (headless Chrome). Checked at sketch times 0.5, 1.0, 1.6 and 3.2 s.
