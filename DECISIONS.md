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
