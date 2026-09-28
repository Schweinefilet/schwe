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
