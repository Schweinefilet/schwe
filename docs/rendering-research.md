# Rendering New York photoreal in the browser: what the game engines do, and what this scene needs

Written 2026-11-22 for the photoreal New York (src/city/real/). The question: which techniques from current
game renderers would make the New York model read as a photograph, and which of them earn their cost in
WebGL 2 through three.js.

## The scene this is for

The site's New York view is unusual for a game. It is a long lens (8.5 degrees of vertical field of view,
about a 160 mm lens on full frame) from 17 km away and 4.1 km up, looking 14 degrees down, north-north-east
up Manhattan from over the Upper Bay. Everything in frame lies between 12 and 23 km from the camera. At
1920 x 1080 one pixel is 2.3 to 3.2 m on the ground. A storey (3.6 m) is one to two pixels, a window is
under one, a street is three to eight. The horizon is out of frame: the sky shows only in reflections, on
water and glass. About a third of the frame is water (the Hudson, the East River, the harbour).

Consequences that run through every section below:

1. The air between lens and city is the largest single cue. Seventeen kilometres of New York air is a
   visible veil in every real photograph from this distance: lifted blacks, blue-grey shadows, lower
   contrast at the far end. Atmosphere and aerial perspective rank first.
2. Detail below a pixel matters as average and as shimmer, not as shape. Window grids, mullions and roof
   clutter alias as the camera drifts. Temporal anti-aliasing ranks higher than it would in a close view,
   interior mapping and contact shadows rank lower.
3. Water is a third of the image, and at this angle (76 degrees from the water's normal) it reflects about
   a fifth of the light that reaches it from the sky and the towers on its banks. Water and its
   reflections rank high.
4. The scene is static. The sun moves a quarter of a degree a minute. Anything that depends only on the
   sun and the weather (sky lookup tables, the sky's environment map, the shadow map) is computed when they
   change, not every frame. That is the existing rule for the shadow map (CLAUDE.md) applied wider.
5. The model is geometry only: footprints raised to heights, roof shapes, baked occlusion, a ground map of
   occlusion and water. No textures, no facade data, no land use. Materials have to be procedural.
6. Every input is already live: the sun from SunCalc, the weather from one Open-Meteo reading (cloud
   cover, rain rate, snowfall, visibility, wind, humidity). Each technique below is driven by those.

## How the engines render cities

Unreal Engine 5. Sky and air from the Sky Atmosphere component (Hillaire 2020: lookup tables for
transmittance, multiple scattering and the sky view, plus a camera-frustum volume for aerial perspective),
exponential height fog with an optional froxel volumetric fog, Lumen for dynamic global illumination,
virtual shadow maps, Temporal Super Resolution, and a filmic tone curve. The Matrix Awakens city (the City
Sample) is procedural buildings assembled from kits and lit almost entirely by the sky and sun through
Lumen. Sources: Sky Atmosphere, https://dev.epicgames.com/documentation/unreal-engine/sky-atmosphere-component-in-unreal-engine ;
Exponential Height Fog, https://dev.epicgames.com/documentation/unreal-engine/exponential-height-fog-in-unreal-engine ;
Volumetric Fog, https://dev.epicgames.com/documentation/unreal-engine/volumetric-fog-in-unreal-engine ;
Lumen (Wright, Narkowicz, Kelly, Advances 2022), https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-Lumen-Wright%20et%20al.pdf ;
TSR, https://dev.epicgames.com/documentation/unreal-engine/temporal-super-resolution-in-unreal-engine ;
City Sample, https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration .

Frostbite. The engine that wrote the physically based rendering playbook games still follow: energy-
conserving GGX materials, physical light units and camera exposure, image-based lighting with
pre-integrated probes (Lagarde and de Rousiers 2014); a physically based sky with clouds (Hillaire 2016);
froxel volumetric fog unified with particles (Hillaire 2015); stochastic screen-space reflections
(Stachowiak 2015). Sources: https://seblagarde.wordpress.com/wp-content/uploads/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf ;
https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf ;
https://www.slideshare.net/slideshow/stochastic-screenspace-reflections/51840375 .

Decima (Horizon, Death Stranding). Nubis volumetric clouds, ray-marched against noise volumes at reduced
resolution and reprojected over frames, under 2 ms on a PS4; later versions add cloud shadows on the
terrain and fly-through clouds. Sources: Schneider and Vos, Advances 2015,
https://www.advances.realtimerendering.com/s2015/The%20Real-time%20Volumetric%20Cloudscapes%20of%20Horizon%20-%20Zero%20Dawn%20-%20ARTR.pdf ;
Nubis, Advances 2017, https://advances.realtimerendering.com/s2017/Nubis%20-%20Authoring%20Realtime%20Volumetric%20Cloudscapes%20with%20the%20Decima%20Engine%20-%20Final%20.pdf ;
Nubis Evolved, Advances 2022, https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-NubisEvolved-NoVideos.pdf .

Red Dead Redemption 2 (RAGE). One integrated system for sky, clouds, fog and light shafts: participating
media in froxels with the sun's shadow map sampled inside the fog, multiple scattering approximated by
adding attenuated octaves of the direct light, and the same media shading the sky, the distant terrain and
the clouds so nothing disagrees. Source: Bauer, "Creating the Atmospheric World of Red Dead Redemption 2: A
Complete and Integrated Solution", Advances 2019, https://advances.realtimerendering.com/s2019/index.htm .

GTA V (RAGE). A deferred renderer with five G-buffer targets, cascaded shadow maps (four cascades), screen-
space and planar reflections (water uses a planar reflection of a reduced scene), aggressive level of
detail for distant city blocks, bloom, depth of field, a filmic tone curve with eye adaptation, and at
night thousands of light sprites (street lamps, windows) rather than real lights for distant blocks.
Source: Courrèges, "GTA V Graphics Study", https://www.adriancourreges.com/blog/2015/11/02/gta-v-graphics-study/
(parts 2 and 3 for reflections, LOD and post). GTA VI: no technical talk yet. Digital Foundry's trailer
analyses report ray-traced global illumination and reflections with screen-space and planar reflections
kept where they suffice, wet surfaces and glass carrying the night's light, at about 1440p and 30 fps on
a PS5: https://wccftech.com/grand-theft-auto-vi-ray-tracing-global-illumination/ (secondary reporting).

Cyberpunk 2077 (REDengine 4). Night City by night: thousands of emissive surfaces, wet streets reflecting
them, volumetric fog lit by local lights, screen-space then ray-traced reflections; the Overdrive mode
replaces SSR, SSAO and its GI with one path-traced pass (ReSTIR direct and indirect). GDC 2022 "Bringing
Light to Night City" covers the artistic side. Sources:
https://www.gamedeveloper.com/marketing/find-out-how-cyberpunk-2077-lit-up-night-city-in-this-gdc-2022-session ;
https://www.nvidia.com/en-us/geforce/news/cyberpunk-2077-ray-tracing-overdrive-update-launches-april-11/ .

Marvel's Spider-Man (Insomniac). The closest game to this scene: Manhattan, seen from above. Procedural
city assembly; interior mapping behind every window; a time-of-day system where the sky and fog colours
are authored per hour; heavy use of reflection probes for glass towers. Sources: GDC 2019 "A Deep Dive into
the Look Creation of Manhattan", https://gdcvault.com/play/1026495/-Marvel-s-Spider-Man ; summary,
https://80.lv/articles/spider-man-a-deep-dive-into-the-look-creation-of-manhattan .

Microsoft Flight Simulator (Asobo). The only game whose usual view matches this one: a whole city from a
few kilometres up. Photogrammetry and procedural buildings from Bing and OSM footprints (the same kind of
data this model is built from), a physically based atmosphere fed by real weather (Meteoblue), volumetric
clouds with their shadows on the ground, and haze from real humidity and pollution. Sources:
https://developer.microsoft.com/en-us/games/articles/2021/07/microsoft-flight-simulator-the-future-of-game-development/ ;
https://www.airspacemag.com/flight-today/flight-box-180977303 .

Minecraft shader packs (OptiFine, Iris). Hobby renderers that run on consumer GPUs and get most of the way
to photographic with a short list: a procedural sky, screen-space reflections on water, volumetric light
from the shadow map, temporal anti-aliasing, bloom, filmic tone mapping, and surfaces that get wet
gradually when it rains and dry slowly afterwards (OptiFine's `wetness` uniform is rain strength smoothed
with a half-life). Source: OptiFine shader documentation,
https://raw.githubusercontent.com/sp614x/optifine/master/OptiFineDoc/doc/shaders.txt (the `wetness` and
`rainStrength` uniforms). The packs themselves (BSL, Complementary) are under licences that do not permit
copying here; only the ideas are used.

What they share, in the order this scene needs it: a physical sky and air that light and fog everything
consistently; materials whose reflectance follows Fresnel and roughness; reflections of the sky and of the
city in water and glass; temporal accumulation to resolve detail below a pixel; and an image pipeline
(exposure, bloom, tone curve, grade) that behaves like a camera.

## Techniques

Each entry: what it does, sources, how it maps to three.js and WebGL 2, expected GPU cost on a mid-range
laptop GPU at 1920 x 1080 (an integrated Intel Iris Xe or GTX 1650 class; these are estimates from the
sources' own figures scaled by resolution and pass count, not measurements), and its priority for this
scene (1 is highest). The outcome of each, after implementation, is in the table at the end.

### 1. HDR pipeline, physically based exposure, tone mapping (AgX or ACES)

What. Render in linear HDR (half-float), expose the image like a camera, then compress it to the display
with a tone curve that handles saturated highlights gracefully. ACES (via Narkowicz's fit or the RRT+ODT)
is the long-time game default; AgX (Sobotka, adopted by Blender 4.0) desaturates highlights toward white
the way film does and keeps hue more stable in bright colours, which matters for the night's lamps.

Sources. Lagarde and de Rousiers 2014, section 4 (physical camera, EV100):
https://seblagarde.wordpress.com/wp-content/uploads/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf ; Hable, filmic operators and MJP's survey,
https://therealmjp.github.io/posts/a-closer-look-at-tone-mapping ; AgX reference implementation,
https://github.com/EaryChow/AgX ; three.js AgX pull request, https://github.com/mrdoob/three.js/pull/27413 .

three.js. Render the scene into a `WebGLRenderTarget` with `HalfFloatType`; a final full-screen pass
applies exposure, `AgXToneMapping` (three's built-in GLSL, MIT) and the colour grade, then sRGB encoding.
Exposure: incident-light metering from the sun and sky illuminance on a horizontal surface (what a
photographer's meter reads), so noon, golden hour and night each get the exposure a photographer would
give them, with a floor at night set for the city's own lights. Deterministic, no flicker.

Cost. One full-screen pass, about 0.1 ms. Half-float targets double the bandwidth of the main pass
against 8-bit.

Priority 1. Everything else is tuned through it.

### 2. Physically based sky and atmospheric scattering

What. Sunlight through a modelled atmosphere: Rayleigh scattering (blue sky, red sunsets), Mie
scattering by aerosols (haze, the bright glow round the sun), ozone absorption (the blue of twilight).
From it come the sun's colour and strength at the ground, the sky's colour in every direction, and the
light the sky throws on the city. Hillaire 2020 computes it with small lookup tables: transmittance
(256 x 64), multiple scattering (32 x 32), the sky view (192 x 108), plus a camera volume for aerial
perspective (section 3). Bruneton and Neyret 2008 precompute 4D tables instead; heavier, no better for a
view that never leaves the ground's neighbourhood.

Sources. Hillaire, "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", EGSR 2020,
https://diglib7.eg.org/bitstream/handle/10.1111/cgf14050/v39i4pp013-022.pdf ; reference code (MIT),
https://github.com/sebh/UnrealEngineSkyAtmosphere ; Bruneton (BSD-3),
https://ebruneton.github.io/precomputed_atmospheric_scattering/ ; Hillaire, Frostbite sky and clouds 2016,
https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf .

three.js. Port Hillaire's three LUT shaders (MIT) to GLSL ES 3.0, each a full-screen pass into a small
float `WebGLRenderTarget`, recomputed when the sun or the weather changes. The sun's colour and strength
at the city come from the same transmittance integral on the CPU (40 steps, once a second). Mie density
is set from the live visibility reading (section 3). three's `Sky` example (Preetham) is the cheap
alternative but cannot take a measured aerosol density and has no multiple scattering.

Cost. Under 0.3 ms to rebuild all three tables, done about once a minute. Zero per frame otherwise.

Priority 2.

### 3. Aerial perspective

What. The air between the camera and each surface adds in-scattered light and removes transmitted light.
At 17 km this is the veil over the whole city in every real photograph from this distance.

Sources. Hillaire 2020 (above), section 5: a 32 x 32 x 32 froxel volume of in-scattering and
transmittance over the camera frustum, applied per pixel with one 3D texture read; UE's Sky Atmosphere
docs (above). For the aerosol density: Koschmieder's relation, visibility V = 3.912 / extinction (the WMO
guide to meteorological instruments, chapter 9,
https://old.wmo.int/extranet/pages/prog/www/IMOP/publications/CIMO-Guide/Prelim_2018_ed/8_I_9_en_MR_tc.pdf ),
which turns Open-Meteo's visibility reading into a Mie extinction coefficient at the ground.

three.js. A `WebGL3DRenderTarget` (32 x 32 x 32, half float), one layer rendered at a time
(`setRenderTarget(target, layer)`), then a full-screen pass that reads the scene's depth and applies it.
The volume follows the camera, so it is recomputed each frame (32 tiny draws).

Cost. About 0.1 ms for the volume, 0.1 ms to apply.

Priority 2 (with the sky).

### 4. Image-based lighting from the sky

What. The sky (and clouds) as a light source: diffuse irradiance for every surface the sun misses, and
specular reflections for glass and water, pre-filtered by roughness (the split-sum approximation).

Sources. Karis, "Real Shading in Unreal Engine 4", SIGGRAPH 2013 course notes,
https://blog.selfshadow.com/publications/s2013-shading-course/ ; Lagarde and de Rousiers 2014 (above),
section 4.9.

three.js. Render the sky (section 2) into a `WebGLCubeRenderTarget`, run it through `PMREMGenerator`, and
set the result as `scene.environment`; `MeshStandardMaterial` already does the split-sum lookup. Redone
when the sun or the weather changes. At night the sky is the city's own light pollution reflected by the
air and clouds (brighter under cloud), so the night environment is a dim orange-grey dome, not black.

Cost. 2 to 5 ms to rebuild, about once a minute; nothing per frame beyond the material's lookups.

Priority 2.

### 5. PBR materials

What. GGX specular with Fresnel and roughness, Lambert diffuse, metalness for metal, energy kept in
balance, albedos in measured ranges (brick 0.2 to 0.35, limestone 0.4 to 0.55, asphalt 0.05 to 0.1, tar
roofs 0.1, gravel roofs 0.25, glass curtain wall dark with strong Fresnel).

Sources. Karis 2013 and Lagarde and de Rousiers 2014 (above), especially the albedo charts; Burley,
"Physically Based Shading at Disney", 2012,
https://blog.selfshadow.com/publications/s2012-shading-course/burley/s2012_pbs_disney_brdf_notes_v3.pdf .

three.js. `MeshStandardMaterial` is this BRDF. The work is in the inputs: procedural facades from what
the model knows about each building at load (height, office or homes, district, its seed): brick,
brownstone, limestone and terracotta for the older and lower, glass curtain wall for the tall offices,
concrete in between; floor lines and window bands as roughness and albedo stripes that average correctly
below a pixel; roofs dark tar, grey gravel, some with mechanical clutter as noise. Streets as asphalt
where the ground map says buildings stand close, pavement and plazas lighter. No textures, so nothing to
license: procedural noise only.

Cost. Some ALU in the main pass, perhaps +15% of it.

Priority 3.

### 6. Glass and windows: reflections, interior mapping, night emission

What. Curtain-wall glass reflects the sky and the city (Fresnel: dark facing the camera, bright at
grazing angles). Interior mapping (van Dongen 2008) ray-casts a box room behind each window in the
fragment shader so interiors show parallax without geometry; Spider-Man uses it for every window in
Manhattan. Night emission lights windows from inside.

Sources. van Dongen, "Interior Mapping: a new technique for rendering realistic buildings", CGI 2008, and
his write-up, https://joostdevblog.blogspot.com/2018/09/interior-mapping-real-rooms-without.html ;
coverage of its use in Spider-Man, https://automaton-media.com/en/news/20231201-23558/ . Night emission:
this repo's own calibrated night (src/city/newYork.js, DECISIONS.md 2026-11-20).

three.js. Reflections come from the sky environment map (section 4) with a low roughness on glass and
a Fresnel term at the curtain wall's index (1.5). Interior mapping is a short function in the facade
shader. The night windows already exist; they are re-exposed for the new pipeline.

Cost. Reflections nearly free (one prefiltered lookup). Interior mapping about +5% of the main pass.

Priority 3 for glass reflections and night emission. Interior mapping: priority 13. A window here is
under a pixel (section "The scene this is for"), so the room behind it cannot show parallax at all.

### 7. Water

What. The rivers and harbour as a reflective surface: Fresnel reflection of sky and city, wave normals,
the water's own dark body colour, sun glitter when the sun is in front.

Sources. Tessendorf, "Simulating Ocean Water", SIGGRAPH 2001 course notes,
https://jtessen.people.clemson.edu/reports/papers_files/coursenotes2002.pdf (the spectrum and the
Fresnel term); GTA V's water (Courrèges, above, part 2).

three.js. The ground map already marks water. A sum of a few directional wave octaves (Tessendorf's
dispersion relation, scaled to wind speed and direction from the weather reading) gives a normal;
reflections from the sky environment map and from screen-space reflections (section 8).

Cost. Small in the ground pass; the reflections are counted in section 8.

Priority 3.

### 8. Screen-space reflections

What. Reflections of what is on screen, found by marching the reflected ray through the depth buffer.
Frostbite's stochastic SSR importance-samples the BRDF and filters over space and time to get glossy
reflections; McGuire and Mara's perspective-correct DDA marches without skipping or oversampling pixels.

Sources. Stachowiak, "Stochastic Screen-Space Reflections", Advances 2015,
https://www.slideshare.net/slideshow/stochastic-screenspace-reflections/51840375 ; McGuire and Mara, "Efficient GPU
Screen-Space Ray Tracing", JCGT 2014, https://jcgt.org/published/0003/04/04/paper.pdf .

three.js. three's `SSRPass` assumes a G-buffer of normals for every surface and is heavy. Here the only
mirror-like surfaces are water and wet ground, both horizontal, so the ground is drawn after the
buildings and traces its reflection through a copy of their colour and depth (the way forward renderers
do water). A 2D march in screen space (McGuire and Mara) with a few binary-search refinements, faded at
the screen's edges and where the ray leaves the depth buffer, falling back to the sky environment map.

Cost. 0.5 to 1.5 ms at full resolution on water pixels only.

Priority 4.

### 9. Temporal anti-aliasing (TAA), or SMAA

What. TAA jitters the projection by a sub-pixel offset each frame, reprojects last frame's result with the
camera's motion and blends, clamping history to the current frame's neighbourhood so it cannot ghost.
Detail below a pixel (here: window grids, storeys, mullions) converges to its average instead of
crawling. SMAA finds edges in the final image and blends across them; it fixes stair-steps but not
sub-pixel shimmer.

Sources. Karis, "High Quality Temporal Supersampling", Advances 2014,
https://advances.realtimerendering.com/s2014/index.html ; Salvi, "An Excursion in Temporal Supersampling",
GDC 2016 (variance clipping),
https://developer.download.nvidia.com/gameworks/events/GDC2016/msalvi_temporal_supersampling.pdf ;
Jimenez et al., "SMAA: Enhanced Subpixel Morphological Antialiasing", EG 2012,
https://www.iryoku.com/smaa/downloads/SMAA-Enhanced-Subpixel-Morphological-Antialiasing.pdf , code (MIT)
https://github.com/iryoku/smaa .

three.js. The scene is static and only the camera moves, so motion vectors come from depth and the
previous frame's view-projection matrix (no velocity buffer). Halton (2, 3) jitter in the projection
matrix, YCoCg variance clipping, Karis's luminance weighting against fireflies. three's `SMAAPass` (MIT)
is the fallback for the lite version.

Cost. TAA about 0.3 ms; SMAA about 0.5 ms (three passes).

Priority 4.

### 10. Bloom

What. The camera's and eye's scatter of bright light: lamps, screens and the sun's glint spill onto
their surroundings. Call of Duty: Advanced Warfare's version downsamples with a 13-tap filter (stable,
no fireflies), upsamples with a 3x3 tent and adds every level, with no threshold: a few percent of the
whole image, as a lens does.

Sources. Jimenez, "Next Generation Post Processing in Call of Duty: Advanced Warfare", Advances 2014,
https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/ ; Bjørge,
"Bandwidth-Efficient Rendering" (dual filter), SIGGRAPH 2015,
https://community.arm.com/cfs-file/__key/communityserver-blogs-components-weblogfiles/00-00-00-20-66/siggraph2015_2D00_mmg_2D00_marius_2D00_slides.pdf .

three.js. A mip chain of half-float targets, written from the two papers' descriptions (three's
`UnrealBloomPass` uses a threshold and separable Gaussians, which is the look to avoid).

Cost. 0.3 to 0.6 ms for six levels.

Priority 5.

### 11. Wet surfaces and puddles

What. Rain darkens porous materials (water fills their pores, so less light scatters back out), makes
everything smoother and more specular, and fills low flat spots with standing water that mirrors the
world. It takes time to wet and longer to dry.

Sources. Lagarde, "Water drop 3a/3b: physically based wet surfaces",
https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/ , and
"Observe rainy world", https://seblagarde.wordpress.com/2012/12/10/observe-rainy-world/ ; OptiFine's
`wetness` (above) for the lag.

three.js. In the facade, roof and ground shaders: albedo darkened by porosity, roughness lowered,
puddles on roofs and streets from a noise mask whose coverage grows with wetness, reflective through the
ground's SSR. Wetness comes from the rain rate and eases in and out (it already does in the look's blend).

Cost. Negligible ALU in existing passes.

Priority 6.

### 12. Volumetric fog and light shafts

What. Fog and haze that are lit and shadowed: light shafts between towers at a low sun, a glow round
lamps at night in mist. Wronski's froxel volume (AC4), Hillaire's unified Frostbite version, RDR2's
integrated media.

Sources. Wronski, "Volumetric Fog", Advances 2014,
https://www.advances.realtimerendering.com/s2014/wronski/bwronski_volumetric_fog_siggraph2014.pdf ;
Hillaire, "Physically Based and Unified Volumetric Rendering in Frostbite", Advances 2015,
https://www.slideshare.net/DICEStudio/physically-based-and-unified-volumetric-rendering-in-frostbite ;
Bauer 2019 (above).

three.js. A half-resolution full-screen pass that marches each view ray only through the slab of air
over the city (0 to 600 m), sampling the sun's shadow map (three's `DirectionalLight.shadow.map`) for
in-scattering with a Henyey-Greenstein phase, density from the visibility reading and humidity, then a
depth-aware upsample. Without the slab test the march would spend its steps in the 12 km of empty air
before the city.

Cost. 0.5 to 1 ms at half resolution with 24 steps.

Priority 7.

### 13. Clouds and their shadows

What. Cloud cover is a measured input. Clouds shade the city in patches (MSFS, Decima), they are what
the water and glass reflect on an overcast day, and at night they reflect the city's light back down.

Sources. Schneider and Vos 2015; Nubis 2017 and 2022 (above); Hillaire 2016 (above).

three.js. The clouds never appear directly in this view (the horizon is out of frame), so a full
ray-marched cloud volume would be paid for and never seen. Instead: a 2D cloud layer from noise at about
1.5 km, its coverage from the reading, drawn into the sky's environment map (so reflections show it) and
projected along the sun's direction onto the city as a cloud-shadow term in the materials.

Cost. One or two noise lookups per pixel; the environment map side is in the once-a-minute rebuild.

Priority 8.

### 14. Colour grading

What. The last creative step: white balance, contrast, saturation, a slight toe. Games author a 3D LUT
per scene; here the grade is set against the reference photographs (docs/reference.md), the way the
night's colours were calibrated (DECISIONS.md 2026-11-20).

Sources. UE colour grading docs, https://dev.epicgames.com/documentation/unreal-engine/color-grading-and-the-filmic-tonemapper-in-unreal-engine ;
Hable's discussion of LUT-based grading (MJP's survey above).

three.js. A few lines in the tone-mapping pass (lift, gain, saturation in a log space before AgX). No LUT
file: nothing to license, nothing to load.

Cost. Nothing measurable (folded into the tone-mapping pass).

Priority 9.

### 15. Ambient occlusion (GTAO)

What. Ground-truth-based AO: for each pixel, the horizon angles in a few directions over the depth
buffer, integrated against the cosine lobe; 0.5 ms on a PS4 at 1080p with temporal filtering.

Sources. Jimenez, Wu, Pesce, Jarabo, "Practical Realtime Strategies for Accurate Indirect Occlusion",
SIGGRAPH 2016, https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf ;
XeGTAO (MIT), https://github.com/GameTechDev/XeGTAO .

three.js. three's `GTAOPass` (MIT), or a half-resolution pass reading the scene's depth. This model
already carries baked occlusion: sky visibility per vertex and per ground texel, measured from a 2 m
height field (DECISIONS.md 2026-11-10). At 2.3 to 3.2 m a pixel, GTAO with a useful radius (30 to 60 m)
would mostly re-measure what the bake already holds.

Cost. 0.5 to 1 ms at half resolution.

Priority 10: implement, compare with and without against the photographs, keep only if it adds.

### 16. Shadows: cascaded, contact, soft (PCSS)

What. Cascaded shadow maps split the view's depth into ranges, each with its own map, so near shadows get
more texels. Contact shadows (Days Gone's screen-space shadows) march a short ray toward the light in
the depth buffer to catch detail the map misses. PCSS widens the penumbra with distance from the blocker,
as a real sun's 0.53 degree disc does.

Sources. Microsoft, "Cascaded Shadow Maps",
https://learn.microsoft.com/en-us/windows/win32/dxtecharts/cascaded-shadow-maps , and "Common Techniques
to Improve Shadow Depth Maps",
https://learn.microsoft.com/en-us/windows/win32/dxtecharts/common-techniques-to-improve-shadow-depth-maps ;
Bend Studio, "Inside Bend: Screen Space Shadows", https://www.bendstudio.com/blog/inside-bend-screen-space-shadows/ ;
Fernando, "Percentage-Closer Soft Shadows", SIGGRAPH 2005,
https://developer.download.nvidia.com/shaderlibrary/docs/shadow_PCSS.pdf .

three.js. The scene's depth range is narrow (12 to 23 km, a ratio under 2), and one 4096 map fitted to
the plinth gives about 2.2 m a texel against 2.3 to 3.2 m a pixel: already one texel per pixel, which is
what cascades exist to achieve. Contact shadows would find occluders a few metres long, under a pixel.
The sun's penumbra behind a 300 m tower is 300 x 0.0093 = 2.8 m, about a pixel. Under cloud the sun's
shadow should soften to nothing, which is a light-strength change already in the look.

Cost. Cascades would multiply the shadow pass (redrawn only when the sun moves) by their count; PCSS
adds a blocker search per pixel (16 to 32 taps).

Priority 12 (reject unless the screenshots show shadow aliasing).

### 17. Global illumination

What. Light bouncing between surfaces: sunlit walls lighting the street, the warm bounce of a sunlit
facade on its shaded neighbour. Lumen and path tracing (above) do it in full.

three.js. Out of reach in WebGL 2 at this scale. The cheap part that matters at this distance is the
ground's bounce: a hemisphere ground colour taken from the sunlit ground's albedo times the sun on it,
and the baked occlusion. Recorded for completeness.

Priority 14 (approximate only).

## Order of work

1. HDR, exposure, AgX (1). 2. Sky, aerial perspective, IBL (2, 3, 4). 3. Materials, glass, water (5, 6,
7). 4. SSR (8). 5. TAA (9). 6. Bloom (10). 7. Wet surfaces (11). 8. Volumetric light (12). 9. Clouds (13).
10. Grade (14). 11. GTAO trial (15). 12. Shadows check (16). 13. Interior mapping decision (6).

A limitation of the measurements, stated once here: this work was done in a cloud container without a
GPU. Its Chrome renders WebGL through llvmpipe (Mesa's CPU rasterizer), where the existing plaster scene
takes about 715 ms a frame at 1920 x 1080. Frame times measured here (scripts/bench.mjs) are relative
costs between versions, not frame rates anyone will see, and the 30 fps target cannot be tested here.
The benchmark prints the renderer it ran on and should be run on real hardware.

## Results

(Filled in as each technique lands; see the table below.)
