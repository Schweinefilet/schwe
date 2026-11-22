# Rendering Paris photoreal in the browser: what the game engines do, and what this scene adds

Written 2026-11-22 for the photoreal Paris (src/city/real/), after the photoreal New York. The New York
research (docs/rendering-research.md) covers the engines (Unreal 5, Frostbite, Decima, RDR2, GTA V,
Cyberpunk 2077, Spider-Man, Microsoft Flight Simulator) and every technique the brief names; its sources,
its three.js mappings and its measured outcomes carry over and are not repeated at length here. This
document says what is different about Paris, researches only what Paris adds, and ranks every technique
again for this scene. The outcome of each is in the table at the end.

## The scene this is for

The site's Paris view (src/city/cities.js) looks east-north-east (bearing 78 degrees) from 9 km away and
1.3 km up, 7.5 degrees down, with a 7 degree vertical field of view (about a 190 mm lens on full frame).
The camera hangs over Sèvres and Saint-Cloud, so the frame is the classic view from the Parc de
Saint-Cloud, seen from higher: the Eiffel Tower in front, the 7th and 15th arrondissements, the
Invalides, then the Louvre, the Île de la Cité and the east of the city. Everything in frame lies between
6.8 and 19 km from the camera, and the top of the frame (4 degrees down) reaches past the plinth into the
eastern suburbs. At 1920 x 1080 one pixel is about 1.0 m across at the Eiffel Tower and 1.4 m at the
Louvre, and the ground is foreshortened sevenfold (sin 7.5 degrees), so a street 12 m wide is one or two
pixels tall where it runs across the view.

What follows from that, against New York's view (17 km off, 4.1 km up, 14 degrees down):

1. Twice as near, twice as sharp. A Haussmann storey (3 m) is three pixels, a window (1.2 m) one, a
   wrought-iron balcony rail a third of one. New York's windows were below a pixel; Paris's facades have
   to show their pattern of tall windows, continuous balconies and a band of grey roof, and the pattern
   has to be filtered, or it crawls.
2. Lower, so walls rather than roofs. From 7.5 degrees up a 20 m building shows about seven times as much
   wall as roof. Paris is a city of walls of the same height (the 1902 rules cap a street wall at 20 m
   with a roof above) whose most visible features are the cream limestone and the grey zinc of the
   mansards on top. Materials matter more than in New York, where the towers' glass and the roofs dominated.
3. Less water. The Seine is 100 to 200 m wide and runs mostly across the view, so it is a thin band
   (10 to 30 pixels tall) between stone quays. Its reflections matter at night, when the bridges and the
   quays' lamps streak in it.
4. A thin landmark in front. The Eiffel Tower stands 7.5 km from the camera, 320 pixels tall, a lattice of
   members a few tens of centimetres across: the worst aliasing case in either city, and in the
   photographs it is partly see-through, its gaps the colour of the haze behind.
5. Paris is grey more often than not. November in Paris averages a little over 2 hours of sun a day
   against New York's nearly 5 (Météo-France's normals for Paris-Montsouris, about 65 hours in the month;
   NOAA's for Central Park, about 145); the default case is an unbroken low deck, light from the whole
   sky, no shadows. Overcast lighting ranks higher than in New
   York.
6. The sun is behind the camera in the afternoon (south-west in November), so golden hour lights the
   facades that face the lens; in the morning it is in front, low, through the haze (reference 16 in the
   Saint-Cloud set shows the sun rising behind the tower).
7. As in New York the scene is static and every input is live (SunCalc, one Open-Meteo reading): the
   tables, the sky's environment and the shadow map are redrawn when the sun or the weather moves.

## What the engines add for a European stone city

New York's research covers the general case. Three sources speak to Paris in particular.

Assassin's Creed Unity (Ubisoft, Anvil). The closest game to this scene: revolutionary Paris at one to one
scale (the city before Haussmann, but the same limestone, the same zinc and slate roofs). It drew its
dense city with a GPU-driven pipeline (cluster culling and batching of thousands of building pieces) and
lit it with baked global illumination: probes every half metre over 4 km², four key frames of the time of
day, baked over four days, about 15 GB on disc, because the city is static and its time of day moves
slowly. Sources: Haar and Aaltonen, "GPU-Driven Rendering Pipelines", Advances 2015 (the Unity half),
https://advances.realtimerendering.com/s2015/aaltonenhaar_siggraph2015_combined_final_footer_220dpi.pdf ;
Ubisoft, "Raytracing the world of Assassin's Creed Shadows", Advances 2025 (its table of the series'
baked GI, Unity's row),
https://www.realtimerendering.com/advances/s2025/content/Advances%202025%20-%20Raytracing%20the%20world%20of%20Assassin's%20Creed%20Shadows.pdf .
What carries over: precomputed lighting is legitimate for a static city, which is what this model's baked
sky visibility already is, at the resolution this distance needs.

Microsoft Flight Simulator (Asobo). Already in New York's research, and more apt here: outside its
photogrammetry its cities are OSM footprints and heights raised into procedural buildings, as this model
is, under real weather. Its World Update IV (France and the Benelux, April 2021) replaced Paris's
procedural buildings with photogrammetry and added a procedural generator with regional architectural
elements, because the generic buildings read wrong for French cities. Sources:
https://news.xbox.com/en-us/2021/04/13/flight-simulator-world-update-iv/ ;
https://flightsimulator.com/release-notes-1-15-7-0-world-update-iv-france-benelux-now-available .
What carries over: a Paris built from footprints needs Paris's own facade and roof grammar, not a
generic city's.

Unreal Engine 5's City Sample and the Matrix Awakens demo (2021). The procedural buildings use
trim-sheet materials with a weathering layer driven by world position and height (streaks under
cornices, dirt at the base), the "macro variation" texture that breaks up repetition at a distance.
Source: https://dev.epicgames.com/documentation/unreal-engine/city-sample-project-unreal-engine-demonstration .
What carries over: procedural streaking and base grime, scaled to what a pixel at 9 km can show.

## Techniques

Each entry: what it does for Paris, sources (New York's, docs/rendering-research.md, plus Paris's own),
how it maps to three.js and WebGL 2, expected GPU cost on a mid-range laptop GPU at 1920 x 1080 (an
integrated Iris Xe or a GTX 1650 class; estimates from the sources and New York's relative measurements,
not measurements of Paris), and its priority for this scene (1 is highest).

### 1. HDR pipeline, exposure, tone curve (AgX or ACES)

What. As New York: a half-float frame, incident-light metering blended with the frame's own mean by day,
a filmic curve. New York compared AgX and ACES against its photographs and kept ACES. Paris's photographs
are lower in contrast and less saturated (limestone and zinc under haze), which is AgX's strength, so the
comparison is made again for Paris rather than assumed.

Sources. New York's section 1: Lagarde and de Rousiers 2014; Hable and MJP's survey; Sobotka's AgX,
https://github.com/EaryChow/AgX ; three.js AgX, https://github.com/mrdoob/three.js/pull/27413 .

three.js. Shared code (src/city/real/pipeline.js). The curve becomes a per-city choice.

Cost. One full-screen pass, about 0.1 ms. Priority 1.

### 2. Physically based sky and atmosphere (Hillaire 2020)

What. As New York: Rayleigh, Mie and ozone in lookup tables, the sun's colour and strength at the city,
the sky's light. The Paris-specific input is the haze: Koschmieder's relation turns the visibility
reading into Mie extinction. Paris's November visibility is typically 8 to 20 km, lower than New York's.

Sources. Hillaire, EGSR 2020, https://diglib7.eg.org/bitstream/handle/10.1111/cgf14050/v39i4pp013-022.pdf ;
code (MIT), https://github.com/sebh/UnrealEngineSkyAtmosphere ; WMO CIMO guide ch. 9 for Koschmieder.

three.js. Shared (src/city/real/atmosphere.js). Two fixes Paris needs and New York did not: the camera
volume took the camera's world position as its place on the planet, and Paris's model stands 80 km east
of New York's on the studio floor, which put the camera 0.5 km higher in the atmosphere than it is; the
city's offset is now subtracted. And see section 5 for the deck.

Cost. Under 0.3 ms to rebuild the tables, about once a minute. Priority 2.

### 3. Aerial perspective

What. The veil of air between lens and city. In every Saint-Cloud photograph (references 01, 04, 06) the
Eiffel Tower, 6 km off, is already paler and bluer than the trees in front, and the east of the city
fades to the sky's colour.

Sources. Hillaire 2020 section 5; UE's Sky Atmosphere "Aerial Perspective View Distance Scale",
https://dev.epicgames.com/documentation/unreal-engine/sky-atmosphere-component-in-unreal-engine .

three.js. Shared. New York counts the air over the last quarter of each ray (about 4 km of its 17), to
stand where its photographers stood. Paris's photographers stood 6 to 9 km off, as the site's camera does,
so Paris counts most of its ray. The share becomes a per-city value.

Cost. About 0.2 ms (the volume and its application). Priority 2.

### 4. Image-based lighting from the sky

What. As New York: the sky cube, prefiltered (PMREM), as diffuse and specular light. Under Paris's usual
deck it is almost all the light there is.

Sources. Karis 2013, https://blog.selfshadow.com/publications/s2013-shading-course/ .

three.js. Shared. Cost: 2 to 5 ms once a minute. Priority 2.

### 5. Overcast diffuse light (Paris-specific)

What. Under an unbroken deck there is no sun, no shadow, and the sky is brightest overhead (the CIE
standard overcast sky: zenith luminance about three times the horizon's, Moon and Spencer 1942). Walls
are lit by the sky they see, so streets and courtyards darken by how much sky they see, and the image's
contrast comes from occlusion and albedo alone. In the photographs (04, 05, 12) the city is a soft field
of cream and grey under a white sky, its depth carried by the haze and by dark slots of street.

Sources. CIE, "CIE Standard Overcast Sky and Clear Sky" (the overcast distribution L(theta) = Lz (1 + 2 sin
theta) / 3, theta above the horizon, after Moon and Spencer 1942), https://www.cie.co.at/publications/cie-standard-overcast-sky-and-clear-sky ;
ISO 15469:2004 / CIE S 011/E:2003, the general sky that keeps it as a special case; Hillaire 2016 (Frostbite sky and clouds) for clouds
lighting the air beneath them,
https://media.contentapi.ea.com/content/dam/eacom/frostbite/files/s2016_pbs_frostbite_sky_clouds.pdf .

three.js. Three things, all in shared code. The deck already lights the air below it with its own
underside (atmosphere.js); but Paris's camera is 1.3 km up and a November stratus deck is often lower, so
the air between the lens and the city was lit as if above the cloud, by the full sun. Every reference
photograph is taken from under the deck, and the frame never shows the cloud (its top is 4 degrees below
the horizon), so the deck's lighting height is held above the camera. The sky cube under a full deck
takes the CIE gradient from the cloud's own thickness (brighter overhead). And the baked sky visibility
(per vertex and per ground texel) already scales the sky's light, which under a deck is all of it.

Cost. None per frame (folded into the once-a-minute rebuild and the existing occlusion). Priority 3.

### 6. PBR materials: Haussmann limestone, zinc and slate roofs (Paris-specific)

What. The city's two materials. Lutetian limestone ("pierre de Paris"), cream to warm grey, measured
albedo about 0.45 to 0.6 when clean; Paris requires facades to be cleaned every ten years (Code de la
construction, article L132-1, the "ravalement" rule), so most read clean, some grey with soot. Its
weathering is vertical: dark streaks under cornices and balconies where rain runs, grime at the base
(UE City Sample's approach, above). Haussmann's grammar: a tall ground floor (shops, rusticated stone),
an entresol, the "étage noble" with a continuous balcony, two plain storeys, a fifth storey with a second
continuous balcony, then a mansard of zinc with dormers, and chimney stacks with orange terracotta pots.
Zinc: rolled sheets with standing seams every half metre, a matte blue-grey patina (zinc carbonate, a
dielectric: albedo about 0.25 to 0.35, roughness 0.45 to 0.6, specular at grazing angles); slate on older
and grander roofs, darker (about 0.1). Post-war blocks (the Front de Seine, Beaugrenelle, the 13th) in
concrete and glass.

Sources. Lagarde and de Rousiers 2014 (the albedo chart: limestone, slate, concrete),
https://seblagarde.wordpress.com/wp-content/uploads/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf ;
Burley 2012; the facade-cleaning rule of the Code de la construction et de l'habitation (formerly article
L132-1: every ten years); for the grammar: Loyer, "Paris XIXe siècle: l'immeuble et la rue", 1987 (the
storeys, the balconies at the second and fifth floors, the 1884 and 1902 height rules). The colours of
the stone and the zinc were read off the reference photographs (docs/paris/reference.md, 03, 07), not off
a supplier's chart.

three.js. MeshStandardMaterial with the inputs made in the facade shader, as New York's
(src/city/real/materials.js), with a Paris facade function: the storeys and their windows as box-filtered
pulses (exact averages below a pixel), the two balcony bands, the mansard as the top 4.5 to 6 m of every
wall of a building of five storeys or more (the model's roofs are mostly flat: OSM maps few mansards), the
flat roof as zinc with chimney stacks as noise, landmarks in their own stone (the Invalides' dome gilded,
Notre-Dame's lead roof). No textures.

Cost. ALU in the main pass, perhaps +15% of it. Priority 3.

### 7. Thin geometry: filtered patterns and stochastic transparency (Paris-specific)

What. Wrought-iron balconies, window bars, the Eiffel Tower's lattice: geometry far thinner than a
pixel that a rasterizer either misses or hits in a crawling pattern. Three tools. Analytic filtering of
procedural patterns (Apodaca and Gritz, box-filtered pulses), already used for New York's windows,
handles balconies and windows drawn in the shader. LEAN-style folding of what cannot be resolved into the
roughness. And for the tower, which the model holds as solid parts: its lattice drawn as coverage, with
the fraction of each pixel that is iron kept by discarding the rest stochastically (alpha-to-coverage's
idea without MSAA: stochastic transparency, Enderton et al. 2010) and resolved by the temporal
antialiasing, as Unreal resolves dithered foliage and hair. The gaps show the haze and the city behind.

Sources. Apodaca and Gritz, "Advanced RenderMan", 1999, ch. 11; Olano and Baker, "LEAN Mapping", I3D
2010, https://www.csee.umbc.edu/~olano/papers/lean/ ; Enderton, Sintorn, Shirley, Luebke, "Stochastic
Transparency", I3D 2010, https://www.cse.chalmers.se/~d00sint/StochasticTransparency_I3D2010.pdf ; Karis
2014 for the temporal resolve.

three.js. In the facade shader (pulses) and, for the tower, a `discard` against a per-pixel hash compared
with the lattice's coverage, varied each frame with the TAA's jitter so sixteen frames average it. The
shadow pass draws the solid tower (its shadow on the Champ de Mars is a dappled one in reality; at 1 m a
pixel, a solid shadow scaled by the coverage is close).

Cost. A few ALU on the tower's pixels. Priority 4.

### 8. Temporal antialiasing (TAA), or SMAA

What and sources. New York's section 9: Karis 2014, Salvi 2016, Jimenez et al. 2012 (SMAA). Paris
needs it more: the facades' detail is at one to three pixels, where crawling is worst.

three.js. Shared (pipeline.js). Cost about 0.3 ms. Priority 4.

### 9. The Seine: water and its reflections (Paris-specific in part)

What. The Seine's colour is its own: an olive to brown-green, turbid (suspended sediment), rarely blue
even under a clear sky; under cloud lead-grey (references 05, 12). Its surface is calmer than the harbour's
(no fetch for waves; barges' wakes), so reflections of the quays and bridges are sharper. Stone quays
with a lower level (the "bas-ports") line both banks.

Sources. Tessendorf 2001 and Cox and Munk 1954 (New York's section 7); the water's colour read off the
references (03, 05, 09); McGuire and Mara 2014 and Stachowiak 2015 for the reflections.

three.js. Shared ground shader (water from the ground and context maps), with the water's body colour
and the wind's fetch per city: on a river the waves are short whatever the wind, so the slope variance
is capped (a river's fetch is its width). Screen-space reflections as New York's.

Cost. As New York's water and SSR: 0.5 to 1.5 ms on water and wet pixels. Priority 4.

### 10. Screen-space reflections

What and sources. New York's section 8. For Paris: the Seine and, in rain, the streets and the zinc.
three.js: shared. Cost 0.5 to 1.5 ms. Priority 4 (with the water).

### 11. Bloom

What and sources. New York's section 10 (Jimenez 2014). Paris at night is lit by warm points: the
street lamps, the Eiffel Tower's gold and its sparkle. three.js shared. Cost 0.3 to 0.6 ms. Priority 6.

### 12. Wet surfaces: cobblestones, limestone, zinc (Paris-specific in part)

What. Rain darkens porous stone a great deal (limestone is very porous: Lagarde measures darkening of up
to half the albedo), barely darkens metal, and films everything. Cobblestones ("pavés", granite setts on
the quays, the squares and some streets) hold water in their joints: the joints, a fifth of the surface,
go mirror-like first, the stones' tops later; asphalt ponds in its low spots. Zinc roofs turn into
mirrors of the sky. Wetness lags the rain and dries slowly.

Sources. Lagarde, "Water drop 3a/3b",
https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/ , and "Observe
rainy world", https://seblagarde.wordpress.com/2012/12/10/observe-rainy-world/ (the porosity and the
puddle model); OptiFine's `wetness` (New York's section 11).

three.js. In the facade and ground shaders: porosity per material (limestone high, zinc none, slate low),
the joints of the setts as a box-filtered pattern whose wet share grows first, puddles from noise on
asphalt. The roofs' wet zinc reflects the sky cube. Wetness eases in and out (the shared look).

Cost. Negligible ALU. Priority 6.

### 13. Night: warm street lamps for a photograph (Paris-specific in part)

What. Paris's night (src/city/paris.js) was calibrated in the studio against photographs from the Arc
de Triomphe and the Eiffel Tower (DECISIONS.md 2026-11-21): warm windows, orange to gold streets, the
tower gold. The aerial photographs (09, 10) and the Saint-Cloud night (08) show what New York's showed: a
dark city whose brightest structure is the street grid, in orange-gold, with the avenues brightest, and
the windows a fainter speckle; under cloud the sky glows orange-brown. As for New York, the night is
re-balanced for the photograph: windows dimmer, streets brighter, the river's lamps reflected.

Sources. This repository's calibrations (DECISIONS.md 2026-11-20, 2026-11-21); the references.

three.js. Gains per city in the shared materials (New York's window and street gains are fixed numbers).

Cost. None. Priority 7.

### 14. Volumetric fog and light shafts

What and sources. New York's section 12: Wronski 2014, Hillaire 2015, Bauer 2019. For Paris: with the
sun behind the lens in the afternoon, shafts are faint (back-scatter); in the morning (sun in front)
they matter more. The full froxel fog adds nothing the aerial perspective and the shafts do not already
give at this distance: the fog has no local lights to scatter in the day, and at night the lamps' glow is
the bloom's job.

three.js. Shared (the shadowed in-scattering correction in pipeline.js). Cost about 0.5 ms. Priority 8;
the froxel volume: priority 14 (reject).

### 15. Clouds and their shadows

What and sources. New York's section 13 (Schneider and Vos 2015, Nubis). Paris's broken skies (the
Saint-Cloud set is full of them: 01, 02, 06, 11) throw moving patches of shadow across the city.

three.js. Shared. Cost: noise reads in the main pass, rebuild once a minute. Priority 8.

### 16. Colour grading

What. New York's section 14: a few lines before the curve. Paris's photographs are cooler and less
saturated by day than New York's (limestone, zinc, haze), warmer at night. A grade per city.

Cost. None measurable. Priority 9.

### 17. Ambient occlusion (GTAO), applied to the indirect light only

What. New York tried GTAO as a post-pass and rejected it: in a forward renderer it darkened the sunlit
walls as well as the shade, and double-counted the baked occlusion. Paris's overcast case is the one
where a screen-space AO could matter (all light is indirect), and the courtyards ("cours") of the
Haussmann blocks are 10 to 20 m across, 10 to 20 pixels here. The version worth trying writes the
indirect light to a second render target, so that the AO multiplies only it.

Sources. Jimenez et al. 2016,
https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf ;
XeGTAO (MIT), https://github.com/GameTechDev/XeGTAO .

three.js. A WebGLRenderTarget with two colour attachments (three's `count`), the materials writing their
indirect light to the second. Cost: double the main pass's bandwidth plus 0.5 to 1 ms.

Priority 10: trial; keep only if it adds against the overcast photographs.

### 18. Shadows: cascaded, contact, soft (PCSS)

What and sources. New York's section 16. For Paris: one 4096 map over a 5.2 by 4 km plinth (plus the
height of the Montparnasse tower in light space) is about 1.5 m a texel against 1.0 m a pixel at the
tower. Cascades would split a depth range of 7 to 12 km (a ratio under two). The sun's penumbra behind a
20 m Haussmann wall is 0.2 m. Contact shadows would find occluders under a pixel.

Priority 12: check the screenshots for shadow aliasing; reject otherwise.

### 19. Interior mapping

At one pixel a window, a room behind cannot show parallax. Priority 13: reject.

### 20. Global illumination

New York's section 17. Assassin's Creed Unity baked its GI into probes because the city is static (above); this
model's baked sky visibility is the same idea at the resolution this distance needs. Dynamic GI needs
compute shaders and ray queries WebGL 2 lacks. Priority 15: reject.

### 21. The surroundings (from Microsoft Flight Simulator's approach)

What. The plinth is 5.2 by 4 km; the frame's top reaches 19 km from the camera, over the 11th, 12th and
20th arrondissements to Montreuil, and its bottom edge shows Boulogne and the Bois. As for New York,
Overture's footprints and heights round the plinth (2.17 to 2.53 E, 48.80 to 48.95 N: 697,306 buildings),
towers of 30 m and more as boxes, the rest as a relief-mapped height field. Paris's heights are mostly
unmapped (518,471 of 697,306); the box's median known height is 7.1 m, the suburbs' houses, so an
unmapped building takes the median of its 1 km cell where at least 25 are mapped (the same rule as
CLAUDE.md's, at a finer grain).

three.js. Shared (materials.js), with Paris's colours: limestone and render walls, zinc roofs.

Cost. As New York's: the relief march on ground pixels beyond the plinth. Priority 3 (with the
materials: without it the top third of the frame is empty).

## Order of work

1. HDR, exposure, the tone curve (1). 2. Sky, air, IBL, with the offset fix and Paris's air share (2, 3,
4). 3. Haussmann materials, zinc, the surroundings, and the overcast deck (6, 21, 5). 4. The Seine and
SSR (9, 10). 5. TAA, then the tower's stochastic lattice (8, 7). 6. Bloom (11). 7. Wetness (12). 8. Night
gains (13). 9. Shafts (14). 10. Clouds (15). 11. Grade and the curve's comparison (16, 1). 12. GTAO on
the indirect light (17). 13. Shadows check (18).

A limitation, as for New York: this work is done in a cloud container without a GPU, whose Chrome renders
WebGL through llvmpipe (Mesa's CPU rasterizer). Frame times measured here (scripts/bench.mjs --city
paris) rank costs between versions; they are not frame rates, and the 30 fps target cannot be tested
here.

## Results

Built in the order above, then replayed one technique at a time from the build of that moment
(scripts/stages.mjs --city paris), with the techniques not yet reached turned off through `?fx=`: for each
stage, the production build (exit 0), the five screenshots (noon, overcast, golden hour, night, rain) and
the benchmark at noon and at night (scripts/bench.mjs, headed Chrome under Xvfb, 1920 x 1080, the median of
a frame's work with the GPU forced to finish, over 15 s after an 8 s warm-up). The stages' screenshots are
in docs/paris/shots/stages/<n>-<name>/ and their timings in docs/paris/shots/stages/bench.json; the final
set is docs/paris/shots/{noon,overcast,golden,night,rain}.png, and the AgX comparison
docs/paris/shots/*-agx.jpg. No stage logged a console error.

The timings are llvmpipe's (Mesa's CPU rasterizer): relative costs, not frame rates (see the limitation
above). Each stage is compared with the one before as the RMSE of the screenshots, in percent, noon /
overcast / golden / night / rain.

### What each step changed, and what still looked fake after it

0. The studio's plaster Paris (`?real=0`): 468 ms at noon, 613 at night.
1. HDR, metering, ACES (464 / 508 ms). No sky, so no fill: black shadows, a black floor round the
   plinth. Fake: everything.
2. Sky, air, image-based light (570 / 611 ms; changes 34 / 61 / 49 / 5 / 50%). The largest change, as in
   New York. Without the clouds' deck the overcast and rain frames are a clear sky's haze over white
   plaster. Fake: plaster, and a blue veil over all of it (the air's share was then 0.8; see below).
3. Haussmann materials, zinc, the surroundings, the overcast deck (582 / 611 ms; 16 / 15 / 11 / 7 / 13%).
   Cream limestone walls, grey-blue roofs, the post-war towers in concrete and dark glass, the Invalides'
   dome gold; the surroundings fill the top third of the frame where the studio floor was; the night's
   city gold. Three problems found here and fixed: the aerial perspective had placed the camera half a
   kilometre up the Earth's curve (Paris stands 80 km from the planet origin on the studio floor); the
   surroundings' relief march, at 7.5 degrees, took steps three texels long and speckled (more, shorter
   steps for Paris); the first overcast frame was a brown murk, the deck lighting the air above the camera
   with the low sun's colour (the deck's light is now held above the camera and neutral under a thick
   cover). Fake: the facades read as flat cream boxes, their windows and balconies too fine to show at 1 to
   3 pixels a storey; the roofs, a sea of grey-blue, outweigh the walls; the tower is noise.
4. The Seine and SSR (592 / 621 ms; under 1.1% everywhere). From 7.5 degrees up the river is a thin band
   and reflects mostly the sky by day. Fake: at night its reflections of the bridges and quays are faint.
5. TAA and the tower's lattice (640 / 702 ms; 7 / 1 / 4 / 10 / 1%). The tower's stochastic coverage
   resolves into a see-through lace that shows the haze and the city behind it, as every photograph does;
   the window grids stop crawling. But at night the TAA averaged the tower's glowing fragments to a ghost
   where photograph 08 shows the brightest thing in the frame (fixed after the replay: the surviving
   fragments glow by the inverse of the coverage). Fake: the night's lit windows, averaged below a pixel,
   read as a brown glow, not as points.
6. Bloom (706 / 722 ms; 2 / 10 / 15 / 1 / 17%). The large change in the grey and golden frames is the
   reflected metering, which reads the bloom chain's smallest level and so arrives with it: the frame is
   exposed for its own mean. Fake: the overcast and rain frames lifted to a pale veil.
7. Wetness (670 / 709 ms; 1.2% in rain, nothing elsewhere). Darker, glossier limestone and roofs, setts
   whose joints wet first. At 9 km a wet city mostly reads as darker.
8. Light shafts (793 / 717 ms; under 0.5%). With the sun behind the lens by afternoon, its shafts are
   back-scattered and faint; at noon they cost +123 ms on llvmpipe for half a percent. Kept, as in New York
   (the march is texture-bound, which llvmpipe overstates), and listed first to cut if real hardware misses
   the target.
9. Grade (791 / 724 ms; 1 to 3%). A warmer balance, contrast 1.18, saturation 1.1.
10. GTAO (trial, `?fx=+gtao`; 868 / 793 ms, +77 / +70). Darker seams between buildings at noon (2.9%), and
    0.8% on the overcast frame, the case it was meant for, where the veil swallows it. Rejected; see the
    table.

### After the replay

Three changes, set against the photographs once the replay had shown them, are in the final set and not in
the stages: the air's share from 0.4 to 0.3 (the overcast tower is now drawn as photograph 04 draws it,
pale but whole); the surroundings' night lamps and windows 2.5 times brighter (the top third of the night
frame had been a dark band where photograph 08 has a carpet of lights); the tower's night glow compensated
for its coverage (above).

AgX against ACES (docs/paris/shots/*-agx.jpg against *.png; `?tm=agx`). Paris's photographs are lower in
contrast than New York's, which should favour AgX, but beside them AgX flattened the golden frame's
front-lit facades, paled the overcast and rain frames further (already the weakest), and desaturated the
night's gold streets. Its one gain: a whiter tower at night, nearer photograph 08's pale gold. ACES stays,
as for New York.

## Remaining gaps against the reference photographs

Noon (01, 02, 03). The photographs' facades have a rhythm the renders lose: tall dark windows in rows,
the shadow line under each balcony, the cornices, the zinc band of the mansards with their dormers and the
orange chimney pots on top. Here the walls read as cream boxes with a faint grid, because the pattern is
flat at 1 to 3 pixels a storey and the model's roofs are flat, so roofs outweigh walls (in the photographs
the mansards are walls of zinc). No street trees: the photographs' avenues and quays are lines of plane
trees. The tower is a uniform lace, where the photographs show its four legs, its arches and its
platforms as distinct dark lines.

Overcast (04, 05). The tower is drawn as 04 draws it, pale but whole. But the whole frame is a step paler
and flatter than 04, whose near city is crisp: the meter exposes the grey frame for its own mean, and the
site's nearest building is 7 km off, where 04's foreground is 1 km.

Golden hour (06, 07). The front-lit facades and long shadows across the streets match 06. The haze turns
pink-orange where 06's stays grey-blue under a dark shower sky; the shadows are warm where 06's are cold.

Night (08, 09, 10). The tower is the brightest thing in the frame, gold, as in 08; the street grid is the
city's structure, gold, as in 09 and 10. The windows average into a brown glow where the photographs show
points; the beacon is absent; the Seine's reflections of the bridges are faint; the surroundings are a
dimmer carpet than 08's.

Rain (11, 12). A grey veil over the city, the far side gone, as 11. Too pale: 12's city is lead-grey
under a dark deck, and here the meter lifts it. No rain shafts (11's shower is a visible column).

## What to try next

1. Measure on real hardware (scripts/bench.mjs --city paris prints the renderer). If the stack misses 30
   fps on a mid-range laptop: the shafts and the surroundings' relief at half resolution, then a lower
   internal resolution under the TAA.
2. Facade relief at the pixel scale this view has: the balconies' and cornices' shadows as a parallax
   offset in the facade shader (the walls are 1 to 3 pixels a storey; a shadow line under each balcony
   would carry the Haussmann rhythm the flat pattern loses).
3. Real mansards: the model's flat roofs raised to a mansard slope where OSM has no roof shape and the
   building is Haussmann-tall, in scripts/models/build.mjs, so the roofs show as walls of zinc and the flat
   tops shrink.
4. The Seine at night: more SSR rays on water and a sharper (calmer) surface after dark, so the bridges'
   and quays' lamps streak as they do in every night photograph.
5. Street trees from OSM's tree rows: the plane trees along the avenues and the quays are a large part of
   the photographs' colour, and absent here.
6. The overcast and rain exposure: a darker key under a full deck (as New York's rain), so a grey day is
   printed grey rather than pale.
7. The CIE overcast gradient and the neutral deck for New York too, after checking against its rain
   photographs (they are Paris-only now, to keep New York unchanged).

## Table: what shipped, its cost, what still looks fake, what to try next

Frame cost: the median frame time on llvmpipe at 1920 x 1080, noon / night, from the replay, and what the
step added to the one before. Runs of the same build differ by up to about 6% (New York's measurement),
so steps under about 40 ms are within noise. The studio's plaster Paris: 468 / 613 ms (480 / 610 measured
again at the end). The full stack in the replay (stage 9): 791 / 724 ms, 1.69 / 1.18 times the plaster's.
The final build, benchmarked on its own over 20 s: 820 / 734 ms (median of 25 / 27 frames), no console
errors. New York, the
original build against this one at noon, three alternating pairs: 866 against 856 ms (the original's own
six runs ranged from 825 to 893); at night 783 against 781 ms (and 804 in one more run of the final build, inside the same spread). New York
is not slower beyond the measurement's noise. These are not frame
rates: llvmpipe draws Paris at 1.2 to 1.4 fps and the plaster studio at 1.6 to 2.1. The 30 fps target at
1080p is untested here; scripts/bench.mjs --city paris prints the renderer and should be run on a
mid-range laptop.

| Technique (rank) | Outcome | Frame cost, noon / night ms (added) | Still looks fake | Try next |
| --- | --- | --- | --- | --- |
| HDR target, metering, ACES (1) | Shipped; AgX compared and dropped | 464 / 508 (-3 / -104: the studio's MSAA gone) | Grey days metered pale. | A darker key under a full deck. |
| Sky and atmosphere, Hillaire (2) | Shipped; the planet-offset bug fixed | 570 / 611 (+106 / +103), with the air and IBL | Golden haze pinker than the photographs'. | An aerosol type from humidity. |
| Aerial perspective (3) | Shipped; Paris's share 0.3 of each ray | in row 2 | A uniform veil; the photographs' far city fades in bands of smog. | A shallower second layer on hazy days. |
| Image-based light (4) | Shipped | in row 2 | Every roof reflects the same sky. | - |
| Overcast diffuse light (5) | Shipped: the deck's light above the camera, neutral, the CIE gradient | in row 6 (no per-frame cost) | Grey frames lifted toward white by the meter. | Key and contrast per condition. |
| Haussmann materials, zinc, slate (6) | Shipped | 582 / 611 (+12 / 0), with the surroundings | Facades as flat cream with a faint grid; roofs outweigh walls. | Parallax balconies; real mansards in the model. |
| Thin geometry: filtered patterns, the tower's stochastic lattice (7) | Shipped | in rows 6 and 8 | The tower's members do not resolve as lines; the lace is uniform. | The lattice's real panel geometry. |
| TAA (8) | Shipped | 640 / 702 (+48 / +81) | Night windows average to a glow. | A sharpening pass. |
| SMAA (8) | Rejected: TAA resolves edges and the sub-pixel lattice on every tier; SMAA would add three passes for edges alone | none | - | - |
| The Seine, water (9) | Shipped: olive, calm (fetch capped) | in row 10 | Thin by day; faint streaks at night. | More rays on water after dark. |
| Screen-space reflections (10) | Shipped | 592 / 621 (+10 / +10) | As row 9. | As row 9. |
| Bloom (11) | Shipped | 706 / 722 (+66 / +20) | The tower's sparkle and the lamps glow rather than point. | A dimmer, wider tail. |
| Wet surfaces, setts, zinc (12) | Shipped | 670 / 709 (-36 / -12) | At 9 km mostly darker. | Reflections of the lamps in wet streets at night. |
| Night: lamps and windows for a photograph (13) | Shipped: New York's gains, the tower's glow compensated, the surroundings 2.5 times | none (uniforms) | Windows a glow, not points; the beacon absent. | The beacon as a light shaft in the haze. |
| Light shafts (14) | Shipped | 793 / 717 (+123 / +8) | Faint with the sun behind the lens. | Half resolution, or off for Paris after measuring on a GPU. |
| Froxel volumetric fog (14) | Rejected: no local lights to scatter by day, the aerial perspective and the shafts carry the air, the bloom the lamps' glow at night | none | - | - |
| Clouds and their shadows (15) | Shipped (with row 6: the deck) | in row 6 | Clouds never seen directly; no rain shafts. | Rain shafts in the air. |
| Colour grading (16) | Shipped: warmer balance, contrast 1.18, saturation 1.1 | 791 / 724 (-2 / +7) | One grade for every condition. | A grade per condition. |
| GTAO on the indirect light (17) | Rejected. The post-pass version, tried: 2.9% at noon, 0.8% on the overcast frame it was meant for, +77 / +70 ms. The indirect-only version (a second render target the materials write their ambient light to) was not built: under a deck the baked sky visibility already carries the occlusion, and the trial showed the screen-space term lost in the veil | 868 / 793 on trial | - | Only with a nearer view. |
| Cascaded, contact, soft shadows (18) | Rejected: one fitted 4096 map is about 1.5 m a texel against 1 m a pixel, and no shadow aliasing shows in the noon or golden frames; the sun's penumbra behind a 20 m wall is 0.2 m | none | - | Only for a closer view. |
| Interior mapping (19) | Rejected: a window is one pixel; no parallax to show | none | - | - |
| Global illumination (20) | Rejected: needs compute shaders and ray queries WebGL 2 lacks; the baked sky visibility and the sky's light stand in, as Assassin's Creed Unity's baked probes do | none | No bounce between walls. | - |
| The surroundings (21) | Shipped: Overture, local median heights, a longer relief march | in row 6 | The relief's walls soft and uniform; the suburbs' houses read as the same blocks. | Real extrusions near the plinth. |
