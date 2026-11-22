# Rendering London photoreal in the browser: what the game engines do, and what this scene adds

Written 2026-11-22 for the photoreal London (src/city/real/), after New York and Paris. New York's
research (docs/rendering-research.md) covers the engines (Unreal 5, Frostbite, Decima, RDR2, GTA V,
Cyberpunk 2077, Spider-Man, Microsoft Flight Simulator) and every technique the brief names; Paris's
(docs/paris/rendering-research.md) adds a stone city under overcast skies, thin geometry, a river and
cobbles, and the fixes the shared renderer needed for a city away from the studio floor's origin. Their
sources, three.js mappings and measured outcomes carry over and are not repeated at length. This document
says what is different about London, researches only that, and ranks every technique again for this
scene. The outcome of each is in the table at the end.

## The scene this is for

London's landscape view (src/city/cities.js) looks east-north-east (bearing 68 degrees) from 9.3 km away
and 1.4 km up, 8.5 degrees down, with an 8.5 degree vertical field of view (about a 160 mm lens). The camera
hangs over Putney: the Palace of Westminster, the Abbey and the London Eye in front, the river's great
bend, the South Bank, then the City's towers and the Shard. Everything in frame lies between 6.3 and 19 km
from the camera, and the top of the frame (4.25 degrees down) reaches past the plinth into Hackney and
Stratford. At 1920 x 1080 a pixel is about 1.3 m across at Westminster and 1.6 m at the City, and the
ground is foreshortened about sevenfold. The portrait view looks west (bearing 276) from over Charlton,
10.5 km off and 2.6 km up, 14 degrees down.

What follows from that, against Paris's view (9 km, 1.3 km up, 7.5 degrees down) and New York's (17 km,
4.1 km, 14 degrees):

1. Paris's scale, New York's skyline. Storeys are two to three pixels, as in Paris, but the City's towers
   (100 to 310 m) are glass, as in New York: curtain walls that reflect the sky and each other, which the
   Paris pass did not need.
2. Brick, not stone. London's fabric is Victorian and Edwardian terraces and mansion blocks: yellow-grey
   London stock brick and red brick under grey Welsh slate, with white stucco in the west and Portland
   stone for the public buildings and the City's older offices. Its weathering is the opposite of Paris's
   limestone streaks: Portland stone weathers white where rain washes it and black where it is sheltered.
3. A wide, opaque river. The Thames at Westminster is 250 m wide (Paris's Seine 100 to 200) and brown with
   silt, so its body colour shows through its reflections; it is tidal (7 m at London Bridge) and choppy.
   In this view it is the largest single surface after the roofs.
4. One thin landmark in front: the London Eye, a 120 m rim on cable spokes, 6.6 km from the camera. The
   model holds its rim and a few spokes as geometry (OSM parts), so unlike the Eiffel Tower it is already
   open: it needs antialiasing, not a coverage trick.
5. London is as grey as Paris in November: about 71 hours of sun in the month, 2.4 a day (Met Office
   1991 to 2020 averages for Heathrow,
   https://www.metoffice.gov.uk/research/climate/maps-and-data/uk-climate-averages/gcpsvg3nc ), and its
   rain is more often drizzle than downpour.
6. The sun is behind the camera's right shoulder in the afternoon, as in Paris: golden hour lights the
   south- and west-facing fronts the lens sees.

## What the engines add for London

Watch Dogs: Legion (Ubisoft, 2020) is the one game set in present-day London at one to one scale. Its
ray tracing is spent on reflections alone (no ray-traced shadows or global illumination), on PC and on the
PS5 and Xbox Series consoles alike, because London's glass and wet streets are where it shows. Sources
(secondary reporting of Digital Foundry's analyses; Ubisoft published no rendering talk):
https://gamesradar.com/watch-dogs-legion-shows-impressive-ray-tracing-in-ps5-and-xbox-series-x-comparison ;
https://www.gamestar.de/artikel/watch-dogs-legion-raytracing,3359813.html . What carries over: reflections
on glass and water are the London-specific priority, and screen-space reflections are the WebGL part of it.

Microsoft Flight Simulator's London (photogrammetry since its launch) shows what a footprint-and-height
model misses: the terraces' pitched slate roofs in rows, the courtyards and gardens behind them, street
trees. The same lesson as Paris's: the city's own roof and facade grammar, not a generic one.

The rest (Hillaire's atmosphere, Karis's TAA, Jimenez's bloom and GTAO, Stachowiak's and McGuire and
Mara's SSR, Lagarde's wet surfaces) is as for New York and Paris.

## Techniques

Each entry: what it does for London, sources, how it maps to three.js and WebGL 2, expected GPU cost on a
mid-range laptop GPU at 1920 x 1080 (estimates from the sources and the other cities' relative
measurements), and its priority for this scene (1 is highest).

### 1. HDR pipeline, exposure, tone curve (AgX or ACES)

As New York's and Paris's (docs/rendering-research.md section 1): a half-float frame, incident and
reflected metering, a filmic curve. Both cities kept ACES after comparing AgX against their photographs;
London compares again. Sources: Lagarde and de Rousiers 2014,
https://seblagarde.wordpress.com/wp-content/uploads/2015/07/course_notes_moving_frostbite_to_pbr_v32.pdf ;
https://github.com/EaryChow/AgX . Shared code. Cost about 0.1 ms. Priority 1.

### 2. Physically based sky and atmosphere

As New York's section 2 (Hillaire 2020,
https://diglib7.eg.org/bitstream/handle/10.1111/cgf14050/v39i4pp013-022.pdf ; code (MIT)
https://github.com/sebh/UnrealEngineSkyAtmosphere ), haze from the visibility reading by Koschmieder's
relation. London stands 40 km from the studio floor's origin; the offset fix made for Paris applies.
Shared code. Cost under 0.3 ms a rebuild, about once a minute. Priority 2.

### 3. Aerial perspective

As Paris's section 3: the share of each view ray's air that counts, per city. London's photographers stood
at 1 to 8 km (airliners on the Heathrow approach, Greenwich Park at 8 km from the City); its camera is 9.3
km off and 1.4 km up, as Paris's is. Start from Paris's share (0.3) and set it against the photographs.
Shared. Cost about 0.2 ms. Priority 2.

### 4. Image-based lighting from the sky

As New York's section 4 (Karis 2013, https://blog.selfshadow.com/publications/s2013-shading-course/ ).
Shared. Cost 2 to 5 ms once a minute. Priority 2.

### 5. Overcast diffuse light

As Paris's section 5: the cloud deck's light on the air held above the camera (1.4 km up, above
London's stratus), neutral under a thick deck, the CIE overcast gradient on the deck (CIE, "CIE Standard
Overcast Sky and Clear Sky", https://www.cie.co.at/publications/cie-standard-overcast-sky-and-clear-sky ).
London's commonest sky, so priority 3. Shared code, switched on per city. Cost none per frame.

### 6. PBR materials: stock brick, red brick, Portland stone, stucco, slate (London-specific)

What. London stock brick: yellow-grey to brown when new, darkened by a century of soot, albedo about 0.2
to 0.3. Red brick (Victorian and Edwardian mansion blocks, Bermondsey and Southwark's warehouses),
about 0.2. White stucco (Belgravia, Pimlico) and Portland stone (the public buildings, the City's
older offices), 0.5 to 0.65 clean. Portland stone's weathering is distinctive: where rain washes it, it
stays white; where it is sheltered (under cornices, on north faces, in the lee of mouldings), soot and
lichen blacken it. Roofs: Welsh slate on the pitched roofs of the terraces (dark blue-grey, about 0.08,
glossy when wet), black felt and grey gravel on the flat ones, rows of brick chimney stacks on the party
walls. The windows: sashes about 1 m wide on a 2.4 to 2.8 m pitch, storeys of 3.2 m, a parapet hiding the
roof.

Sources. Lagarde and de Rousiers 2014 (above, the albedo chart: brick, limestone, slate); Lagarde,
"Water drop 3b" for porosity, https://seblagarde.wordpress.com/2013/04/14/water-drop-3b-physically-based-wet-surfaces/ ;
for the stone's weathering: Historic England, "Practical Building Conservation: Stone" (2012), the chapter
on soiling and its washing pattern; for the brick: Historic England, "Practical Building Conservation:
Earth, Brick and Terracotta" (2015). The colours themselves are read off the reference photographs
(docs/london/reference.md, 01, 02, 08), not off a chart.

three.js. MeshStandardMaterial with inputs from a London facade function (src/city/real/london.js), as
Paris's: by height, kind and district (the model's office zones: the City, the South Bank, Whitehall),
brick or stone or stucco; sash windows and storeys as box-filtered pulses; Portland stone's weathering as
a sheltered-face darkening (north faces and the band under each cornice) rather than vertical streaks.
Cost: ALU in the main pass, about as Paris's. Priority 3.

### 7. Glass towers and their reflections (London-specific in part)

What. The City's towers (the Gherkin's diagrid, the Cheesegrater, 22 Bishopsgate, the Walkie-Talkie, the
Scalpel) and the Shard are glass. Curtain walls reflect the sky by Fresnel (dark facing the lens, bright
at grazing angles), and a concave one (the Walkie-Talkie) focuses the sun (it famously melted a car in
2013). The Shard's glass is extra-white (low-iron) and its facets reflect the sky so that it changes
colour with the weather.

Sources. New York's section 6 (Karis 2013; glass as a coated dielectric); the Walkie-Talkie's solar focus:
BBC News Magazine, "Who, what, why: How does a skyscraper melt a car?", 2013,
https://www.bbc.co.uk/news/magazine-23944679 .

three.js. New York's glass (materials.js: glassOf, curtain-wall tints, spandrels and mullions) for the
offices tall enough, more of it in the City; the Shard as low-iron glass. Reflections of other towers
would need SSR on the towers themselves; New York did not do it and London's towers stand in one cluster
1.5 km across, where they would matter more. Not built: see the table.

Cost. Nearly free (prefiltered environment lookups). Priority 4.

### 8. Thin geometry: the London Eye, the bridges, window grids

What. The Eye's rim (a tube about 2 m thick at 6.6 km, under two pixels) and its spokes (cables, far
below a pixel); the bridges' parapets and lamp standards; the sash windows. Filtered patterns (Apodaca and
Gritz 1999) for the windows; temporal antialiasing for the rest. The Eye is modelled open (its rim and a
few spokes are OSM parts), so Paris's stochastic coverage is not needed: the rim is white steel, and TAA
resolves it.

Sources. Paris's section 7 (Apodaca and Gritz; Olano and Baker 2010; Enderton et al. 2010); Karis 2014.

three.js. The facade shader's pulses; the Eye a material of its own (white paint over steel). Cost: none
beyond TAA. Priority 4.

### 9. Temporal antialiasing (TAA), or SMAA

As New York's section 9 (Karis 2014, https://advances.realtimerendering.com/s2014/index.html ; Salvi 2016;
SMAA, Jimenez et al. 2012, https://www.iryoku.com/smaa/ ). Shared. Cost about 0.3 ms. Priority 4.

### 10. The Thames: water and its reflections (London-specific in part)

What. The Thames through London is turbid with fine sediment stirred by the tide, so it is opaque and
brown-grey, its own colour showing through its
reflection, unlike the Hudson's dark green or the Seine's olive (references 01, 02, 04). It is tidal, with
a range of about 7 m at London Bridge: at low tide strips of mud and shingle (the foreshore) show along both
banks. It is choppy: the tide and the boats' wakes keep its surface broken even in light wind.

Sources. Tessendorf 2001 and Cox and Munk 1954 (New York's section 7); the Port of London Authority's
tide tables for the range, https://www.pla.co.uk/ (London Bridge springs about 7 m); McGuire and Mara
2014 and Stachowiak 2015 for the reflections.

three.js. The shared ground shader with London's body colour (brown, lighter than the other cities'
rivers) and a fetch that keeps the river's chop (a cap above Paris's). The tide: the site's one weather
request carries no tide, and CLAUDE.md forbids a second request and invented data; a harmonic tide
prediction needs the PLA's or UKHO's constants. Rejected for this pass: the foreshore is 10 to 40 m
wide, two or three pixels tall from 8.5 degrees up. Screen-space reflections as the other cities'.

Cost. As New York's water and SSR, 0.5 to 1.5 ms on water and wet pixels. Priority 4.

### 11. Screen-space reflections

As New York's section 8. On the Thames by day the sky; at night the bridges, the Embankments' lamps and
the South Bank. Shared. Cost 0.5 to 1.5 ms. Priority 4 (with the water).

### 12. Bloom

As New York's section 10 (Jimenez 2014,
https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/ ). London at night:
white LED streets, the City's offices, the Eye's rim. Shared. Cost 0.3 to 0.6 ms. Priority 6.

### 13. Wet surfaces: brick, slate, Portland stone (London-specific in part)

What. Drizzle more than downpours: surfaces stay wet for hours. Stock brick is very porous and darkens a
great deal; slate barely darkens but turns mirror-like; Portland stone darkens; puddles on flat roofs and
streets. Lagarde (above). Shared ground shader and London's porosities. Cost negligible. Priority 6.

### 14. Night: lamps and windows for a photograph

London's night (src/city/london.js) was calibrated in the studio against photographs from the Shard
(DECISIONS.md 2026-11-21): white LED streets, the City's offices white and late, the landmarks floodlit,
the Eye one colour a night. The aerial photographs (09 to 11) show what New York's and Paris's did: the
street grid brightest, the river black, the windows a fainter speckle, cloud lit orange from below. The
other cities' gains, and the surroundings' night set against the photographs. Cost none. Priority 7.

### 15. Volumetric fog and light shafts

As New York's section 12 and Paris's section 14: shadowed in-scattering in the slab of air over the city
(Wronski 2014, https://www.advances.realtimerendering.com/s2014/wronski/bwronski_volumetric_fog_siggraph2014.pdf ;
Bauer 2019), the froxel volume rejected. London's fog is a reading of visibility, which the aerial
perspective already takes. Shared. Cost about 0.5 ms. Priority 8; the froxel volume priority 14 (reject).

### 16. Clouds and their shadows

As New York's section 13. Shared. Priority 8.

### 17. Colour grading

A grade per city, set against the photographs: London's are cooler and greyer than Paris's. Shared.
Cost none. Priority 9.

### 18. GTAO

New York and Paris tried the post-pass version and rejected it (it darkens sunlit walls with the shade
and double-counts the baked occlusion; on Paris's overcast frame it changed 0.8%). London's terraces have
deep, narrow back gardens 6 to 10 m across, four to eight pixels, which the baked sky visibility already
darkens. Priority 10: trial in the stage replay, keep only if it adds.

### 19. Shadows: cascaded, contact, soft (PCSS)

As Paris's section 18: one 4096 map over a 4.8 by 3 km plinth is about 1.3 m a texel against 1.3 m a
pixel. Priority 12: check the screenshots; reject otherwise.

### 20. Interior mapping

A sash window is under a pixel. Priority 13: reject.

### 21. Global illumination

As the other cities: needs compute shaders and ray queries WebGL 2 lacks. Priority 15: reject.

### 22. The surroundings

What. The plinth is 4.8 by 3 km; the landscape frame reaches 19 km from the camera, over Shoreditch,
Hackney and Stratford, and its bottom edge shows Battersea and Vauxhall beyond the plinth's south-west
corner. As for the other cities: Overture's footprints and heights in a box round the plinth (0.28 W to
0.13 E, 51.46 to 51.61 N: 589,349 buildings), towers of 30 m and more as boxes, the rest a relief-mapped
height field with London's palette (stock and red brick, slate). 305,582 had no mapped height and took the
median of their 1 km cell, 69 the box's (6.4 m). Shared. Cost: the relief march on ground pixels beyond the
plinth. Priority 3.

## Order of work

1. HDR, exposure, the curve (1). 2. Sky, air, IBL (2, 3, 4). 3. Brick, stone, slate, glass, the Eye, the
surroundings and the overcast deck (6, 7, 8, 22, 5). 4. The Thames and SSR (10, 11). 5. TAA (9). 6. Bloom
(12). 7. Wetness (13). 8. Night gains (14). 9. Shafts (15). 10. Clouds (16). 11. Grade and the curve's
comparison (17, 1). 12. GTAO trial (18). 13. Shadows check (19).

The limitation stated for the other cities applies: this work is done in a container without a GPU, whose
Chrome renders WebGL through llvmpipe (Mesa's CPU rasterizer). Frame times measured here rank costs; they
are not frame rates, and the 30 fps target cannot be tested here.

## Results

Built in the order above, then replayed one technique at a time from that build (scripts/stages.mjs --city
london), the techniques not yet reached turned off through `?fx=`: for each stage the production build
(exit 0), the five screenshots and the benchmark at noon and at night (scripts/bench.mjs, headed Chrome
under Xvfb, 1920 x 1080, a frame's work with the GPU forced to finish, the median over 15 s). The stages'
screenshots are in docs/london/shots/stages/<n>-<name>/ and their timings in
docs/london/shots/stages/bench.json; the final set is docs/london/shots/{noon,overcast,golden,night,rain}.png
and the AgX comparison docs/london/shots/*-agx.jpg. No stage logged a console error.

The timings are llvmpipe's: relative costs, not frame rates. Each stage is compared with the one before as
the RMSE of the screenshots, in percent, noon / overcast / golden / night / rain.

### What each step changed, and what still looked fake after it

0. The studio's plaster London (`?real=0`): 331 ms at noon, 415 at night.
1. HDR, metering, ACES (449 / 478 ms). London's plaster is the cheapest of the three cities, so the
   photoreal frame's fixed passes cost it most in proportion. Fake: everything.
2. Sky, air, image-based light (500 / 526 ms; 33 / 57 / 49 / 5 / 50%). The air, as in the other cities,
   is the largest change. Fake: white plaster under a blue veil.
3. Brick, stone, slate, glass, the Eye, the surroundings, the overcast deck (534 / 575 ms; 16 / 17 / 12 /
   10 / 16%). The City's towers turn to glass, Westminster honey stone, the terraces grey-yellow brick
   under slate, the Eye a white ring; the surroundings fill the top third of the frame. A first palette
   (a quarter red brick, red tiles on the low roofs of the surroundings) turned the whole city orange
   beside the photographs' grey-beige and was cut before the replay; the first build also failed to
   compile (WebGL's GLSL allows no ternary on structures), caught by the console check. Fake: the facades
   flat; the overcast and rain frames a pale veil.
4. The Thames and SSR (536 / 577 ms; under 1.2%). From 8.5 degrees up the river reflects mostly the sky by
   day; at night the bridges' lamps. Fake: its brown body colour barely shows at this grazing angle, where
   the photographs (taken steeper) are brown.
5. TAA (591 / 624 ms; 7 / 1 / 5 / 11 / 1%). The Eye's rim and the window grids stop crawling; the night's
   lit windows average into a glow.
6. Bloom (636 / 665 ms; 2 / 7 / 13 / 1 / 15%). Again most of the change in the grey and golden frames is
   the reflected metering, which arrives with the bloom chain.
7. Wetness (627 / 686 ms; 1.7% in rain).
8. Light shafts (747 / 660 ms; under 0.6%). +120 ms at noon on llvmpipe for half a percent: the first
   thing to cut on a GPU that misses the target.
9. Grade (766 / 649 ms; 1 to 2%). Balance (1.01, 1, 0.97), contrast 1.16, saturation 1.08.
10. GTAO (trial, `?fx=+gtao`; 860 / 733 ms, +94 / +84). 2.6% at noon (darker seams), 1.0% on the overcast
    frame. Rejected, as in the other cities.

### After the replay

Two London-only changes, set against the photographs once the replay had shown them, are in the final set
and not in the stages. The grey days printed darker: a full deck lowers the exposure key by 30% (the frame's
own metering had lifted them to a pale veil; photographs 05 and 12 are leaden); the overcast frame's mean
went from 150 to 132 of 255. The streets brighter at night: the replay ran at 3.5 times the studio's street
light (New York and Paris use 2), the final at 5; the night frame's mean went from 37 to 45 (photograph 09:
76, most of it in bright points the model's lamps, averaged below a pixel, cannot make).

AgX against ACES (docs/london/shots/*-agx.jpg against *.png; `?tm=agx`). AgX flattened the noon frame's
glass and brick, dulled the golden frame's lit fronts, and darkened the night, already the gap furthest from
its photographs. ACES stays, as for New York and Paris.

## Remaining gaps against the reference photographs

Noon (01, 02, 03). The layout reads (Westminster, the Eye, the river's bend, the City's cluster, the
Shard), and the palette is the photographs' grey-beige with some red. But the facades are flat colour with
a faint grid; the terraces are flat-topped boxes where the photographs show rows of grey slate ridges and
chimney stacks; there are no street trees, so the green of the Embankments and the squares is missing; the
City's glass reflects one sky, not its neighbours. The Thames reads grey-blue (sky) where the photographs,
taken steeper, show its brown.

Overcast (04 to 07). A grey veil with the City's towers and the Shard standing out darker, as in 06 and
07; still paler and flatter than the aerial 04 and 05, which are taken from much nearer.

Golden hour (08). The lit fronts and long shadows match 08's direction of light; the haze goes pink-orange
where 08's air stays clear; the terraces lack the rhythm of lit ridge and shadowed back that makes 08 read.

Night (09, 10, 11). The river is black, the City's offices white, the Eye its colour of the night, the
streets a grid of light. But the streets are a gold glow where 09 and 10 show white points; the frame's
mean is 45 of 255 against 09's 76; under low cloud (11) the cloud lit orange from below is not drawn.

Rain (12). A leaden veil over the city. No curtains of rain under the deck, and no gap of light.

## What to try next

1. Measure on real hardware (scripts/bench.mjs --city london prints the renderer); if the stack misses 30
   fps, the shafts first, then the surroundings' relief at half resolution.
2. The terraces' roofs as roofs: OSM maps few of London's pitched slate roofs, so the model's terraces are
   flat-topped boxes; raising them to a pitch in scripts/models/build.mjs where the building is a low home
   would give the rows of grey ridges every aerial photograph shows.
3. Reflections between the City's towers: SSR on the curtain walls (the buildings' pass reading its own
   copy), where the cluster's towers mirror each other.
4. Street trees and the Embankments' planes from OSM's tree rows.
5. The night's lamps as points: a sprite per lamp beyond the distance where the lamp shader averages them
   away (GTA V's approach for distant city lights, docs/rendering-research.md).
6. The Thames's tide, if a tide reading can come from the same request as the weather (Open-Meteo's marine
   API reports sea level at the estuary, not at London Bridge).

## Table: what shipped, its cost, what still looks fake, what to try next

Frame cost: the median frame time on llvmpipe at 1920 x 1080, noon / night, from the replay, and what the
step added to the one before. Runs of the same build differ by up to about 6%, so steps under about 40 ms
are within noise. The studio's plaster London: 331 / 415 ms. The full stack in the replay (stage 9): 766 / 649
ms, 2.3 / 1.6 times the plaster's (London's plaster is the lightest of the three models, so the photoreal
frame's fixed passes weigh most here). The final build on its own over 20 s: 771 / 689 ms (median of 26 / 29
frames), no console errors. The other two cities before and after London's change, two runs each on the
same machine: New York 838 / 827 ms before, 847 / 804 after; Paris 832 / 728 before, 809 / 746 after.
Neither is slower beyond the measurement's noise, and their frames differ from before by 0.14 to 0.35%
RMSE. These are not frame rates: llvmpipe draws London at 1.3 to 1.5 fps. The 30 fps target at 1080p is
untested here; scripts/bench.mjs --city london prints the renderer and should be run on a mid-range
laptop.

| Technique (rank) | Outcome | Frame cost, noon / night ms (added) | Still looks fake | Try next |
| --- | --- | --- | --- | --- |
| HDR target, metering, ACES (1) | Shipped; AgX compared and dropped | 449 / 478 (+118 / +63) | - | - |
| Sky and atmosphere, Hillaire (2) | Shipped | 500 / 526 (+51 / +48), with the air and IBL | A uniform veil. | - |
| Aerial perspective (3) | Shipped; London's share 0.3 of each ray | in row 2 | The far city fades evenly where the photographs' haze is whiter near the horizon. | - |
| Image-based light (4) | Shipped | in row 2 | Every tower reflects the same sky. | Row 7. |
| Overcast diffuse light (5) | Shipped: the deck above the camera, neutral, the CIE gradient, a darker key under a full deck | in row 6 (no per-frame cost) | Still paler than photograph 12's leaden storm. | - |
| Brick, stucco, Portland stone, slate (6) | Shipped | 534 / 575 (+34 / +49), with glass, the Eye and the surroundings | Flat facades; flat-topped terraces where the photographs show slate ridges. | Pitched terrace roofs in the model. |
| Glass towers (7) | Shipped: New York's curtain walls, by height and district | in row 6 | The towers reflect the sky, not each other; no Walkie-Talkie glare. | SSR on the curtain walls. |
| The London Eye and thin geometry (8) | Shipped: white steel, resolved by TAA; filtered window grids | in rows 6 and 9 | The spokes are a few thick lines, the model's. | - |
| TAA (9) | Shipped | 591 / 624 (+55 / +48) | Night windows average to a glow. | Lamp sprites. |
| SMAA (9) | Rejected: TAA resolves edges and the Eye's rim on every tier | none | - | - |
| The Thames, water (10) | Shipped: brown, silt-opaque, choppy | in row 11 | Its brown hardly shows at 8.5 degrees. | - |
| The Thames's tide (10) | Rejected: no tide in the one weather reading (CLAUDE.md forbids a second request and invented data); the foreshore is two or three pixels tall from here | none | No mud at low tide. | A tide reading from the same request. |
| Screen-space reflections (11) | Shipped | 536 / 577 (+3 / +2) | Faint streaks at night. | More rays on water after dark. |
| Bloom (12) | Shipped | 636 / 665 (+45 / +40) | Lamps glow rather than point. | - |
| Wet surfaces (13) | Shipped: porous brick and stone dark, slate glossy | 627 / 686 (-9 / +21) | Mostly darker at 9 km. | - |
| Night (14) | Shipped: windows 0.45 of the studio's, streets 5 times, the surroundings 2 times | none (uniforms) | A gold glow where photograph 09 is a white grid of points. | Lamp sprites. |
| Light shafts (15) | Shipped | 747 / 660 (+120 / -26) | Faint with the sun behind the lens. | Cut first if a GPU misses the target. |
| Froxel volumetric fog (15) | Rejected: the visibility reading and the aerial perspective carry London's fog; no local lights to scatter by day | none | - | - |
| Clouds and their shadows (16) | Shipped (with row 5) | in row 6 | No rain shafts (photograph 12's curtains of rain). | Rain shafts in the air. |
| Colour grading (17) | Shipped: (1.01, 1, 0.97), contrast 1.16, saturation 1.08 | 766 / 649 (+19 / -11) | - | - |
| GTAO (18) | Rejected: 2.6% at noon, 1.0% on the overcast frame, +94 / +84 ms; it darkens sunlit walls and double-counts the baked occlusion | 860 / 733 on trial | - | - |
| Cascaded, contact, soft shadows (19) | Rejected: one fitted 4096 map is about a texel a pixel; no shadow aliasing in the noon or golden frames | none | - | - |
| Interior mapping (20) | Rejected: a sash window is under a pixel | none | - | - |
| Global illumination (21) | Rejected: needs compute shaders and ray queries WebGL 2 lacks; the baked sky visibility and the sky's light stand in | none | - | - |
| The surroundings (22) | Shipped: Overture, local median heights, the longer relief march | in row 6 | Uniform blocks; no slate ridges. | Row 6's pitched roofs, there too. |
