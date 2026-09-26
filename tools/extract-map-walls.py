"""Trace long architectural strokes from the supplied floor plans into geometry.

Raster pixels are only used offline. The app loads meshes, never this wall image.
Thresholds reject coloured room fills, text and dimension marks; small parallel
strokes are consolidated into a single wall centreline. Coordinates follow map-data.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'lib/map-data.json').read_text(encoding='utf-8'))

def runs(row, minimum):
    transitions = np.diff(np.r_[False, row, False].astype(np.int8))
    return [(int(a), int(b)) for a, b in zip(np.where(transitions == 1)[0], np.where(transitions == -1)[0]) if b-a >= minimum]

result = {}
for floor in data['floors']:
    pixels = np.asarray(Image.open(ROOT / 'public' / floor['image']).convert('RGB')).astype(np.int16)
    threshold = 245 if floor['floor'] in (1,2) else 215 if floor['floor'] == 5 else 175
    black = (pixels.max(2) < threshold) & (pixels.max(2)-pixels.min(2) < 65)
    x0,y0,x1,y1 = floor['imageBox']
    sx,sy = (x1-x0)/pixels.shape[1], (y1-y0)/pixels.shape[0]
    walls = []
    for vertical, mask in [(False,black),(True,black.T)]:
        segments = []
        for row in range(mask.shape[0]):
            for a,b in runs(mask[row], 24):
                # Collapse both ink edges of one wall, without bridging door gaps.
                match = next((s for s in reversed(segments) if row-s[3] <= 12 and row-s[2] <= 14 and min(b,s[1])-max(a,s[0]) >= .65*min(b-a,s[1]-s[0])), None)
                if match:
                    match[0]=min(a,match[0]); match[1]=max(b,match[1]); match[3]=row
                else:
                    segments.append([a,b,row,row])
        for a,b,r0,r1 in segments:
            c=(r0+r1)/2
            ax,ay,bx,by = (c,a,c,b) if vertical else (a,c,b,c)
            ax,bx=x0+ax*sx,x0+bx*sx; ay,by=y0+ay*sy,y0+by*sy
            mx,my=(ax+bx)/2,(ay+by)/2
            if not any(l-1 <= mx <= r+1 and t-1 <= my <= btm+1 for l,t,r,btm in floor['footprint']): continue
            # Large typography can contain long straight strokes too.
            if any('box' in q and min(ax,bx)>q['box'][0]+5 and max(ax,bx)<q['box'][2]-5 and min(ay,by)>q['box'][1]+5 and max(ay,by)<q['box'][3]-5 and abs(my-q['y'])<16 for q in floor['rooms']+floor['places']): continue
            walls.append([round(ax,1),round(ay,1),round(bx,1),round(by,1)])
    result[str(floor['floor'])] = walls
    print(f"Floor {floor['floor']}: {len(walls)} wall segments")
(ROOT / 'lib/map-walls.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')

