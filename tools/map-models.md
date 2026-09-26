# Campus models

The app loads `public/map/models/f{floor}.glb` for floors 1, 2, 5, 6 and 7.
These are texture-free architectural cutaway meshes, not planes with a PDF image.
The original drawing remains available only in the separate PDF view.

Regeneration from repository root:

```sh
python tools/extract-map-walls.py
node tools/build-map-models.mjs
node --test tests/map-model.test.mjs
```

The extractor requires Pillow and NumPy. It traces long orthogonal strokes from
the existing cropped source plans, removes ink outside the footprint and label
strokes inside known rooms. Room polygons, stairwell locations and lifts come
from `lib/map-data.json`. Inspect regenerated models against the source before
publishing: image tracing is approximate, especially at very small openings.

The supplied document is a floor plan, not an elevation survey. Wall heights,
stair rises, rail details and material finishes are schematic. Do not use the
model as a construction drawing or a surveyed evacuation plan.

Models use local X/Z = map coordinates minus (980, 390). Floor height is applied
by the viewer. Geometry is merged by material (11–14 batches per floor), and
contains no external assets. Material names let the viewer adapt to dark themes.
The existing service worker precaches all five models for offline use.
