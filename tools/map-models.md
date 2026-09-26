# Campus models

The app loads `public/map/models/f{floor}.glb` for floors 1, 2, 5, 6 and 7.
These are texture-free architectural cutaway meshes, not planes with a PDF image.
The original drawing remains available only in the separate PDF view.

## How walls are made

Walls are not traced from the raster plan (that gave stray strokes from columns,
dashed lines, text and stair symbols). Every closed space is a box:

- rooms, toilets, halls and stairwells from `lib/map-data.json`
  (`tools/build_map.py`; toilet boxes are measured by hand, see `MEASURED` there);
- lift cars and unnumbered rooms from `lib/map-plan.json`
  (`tools/plan-features.html`).

`tools/build-map-models.mjs` turns the boxes into walls: facing edges of neighbouring
boxes become one wall, rooms along the outline share the outer wall (with windows),
wall ends are joined to the walls they meet, and every room gets a door on the side
that faces the corridor rather than another room. Stairwells and halls marked `open`
(«Сачок») have no wall towards the corridor. Lift cars get closed sliding doors
towards the lift hall.

## Regeneration

From the repository root:

```sh
node tools/plan-vectors.mjs          # vector line work of floors 1, 2, 5 → tools/out/
npx vite                             # open /tools/plan-features.html, save its JSON as lib/map-plan.json
node tools/build-map-models.mjs --svg
node --test tests/map-model.test.mjs
```

`--svg` writes `tools/out/f{floor}.svg` with the walls (red), outer shell (blue) and
doors (green) for checking against the plan. Floors 6 and 7 are scanned images inside
the PDF, so their features are read from `public/map/f6.jpg` and `f7.jpg`.

The supplied document is a floor plan, not an elevation survey. Wall heights,
stair rises, rail details and material finishes are schematic. Do not use the
model as a construction drawing or a surveyed evacuation plan.

Models use local X/Z = map coordinates minus (980, 390). Floor height is applied
by the viewer. Geometry is merged by material (12–16 batches per floor), and
contains no external assets. Material names let the viewer adapt to dark themes.
The existing service worker precaches all five models for offline use.
