"""Finds the walls around every labelled point of the floor plans.

For each seed (room label, stair, toilet…) the walls are searched outwards: first left/right
within a thin band, then top/bottom between those walls, then left/right again over the full
height. A wall is a line of dark, unsaturated pixels that crosses most of the room.
"""
import numpy as np, pymupdf

SCALE = 2  # analysis image = 2 × display (4000 px wide)

def wall_mask(page, floor):
    z = 2000 * SCALE / page.rect.width
    pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
    a = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(np.int16)
    mx, mn = a.max(axis=2), a.min(axis=2)
    if floor in (6, 7):
        return (mx < 120)                       # raster plan: black walls, coloured fills
    return (mx < 215) & (mx - mn < 70)          # vector plan: thin grey/blue lines

def _scan(mask, fixed, lo, hi, start, step, limit, vertical, need):
    """Walks from `start` by `step`; returns the first line whose dark fraction over [lo, hi) >= need."""
    pos = start
    for _ in range(limit):
        pos += step
        if pos <= 1 or pos >= (mask.shape[1] if vertical else mask.shape[0]) - 1: return None
        if vertical:
            seg = mask[lo:hi, pos - 1:pos + 2].any(axis=1)
        else:
            seg = mask[pos - 1:pos + 2, lo:hi].any(axis=0)
        if seg.size and seg.mean() >= need: return pos
    return None

def room_box(mask, x, y, max_w=420, max_h=420, need=0.6):
    """Display-space box (x0, y0, x1, y1) around the display point (x, y), or None."""
    cx, cy = int(x * SCALE), int(y * SCALE)
    lim_w, lim_h = max_w * SCALE, max_h * SCALE
    band = 16 * SCALE
    skip = 7 * SCALE                            # step over the label itself
    l = _scan(mask, None, cy - band, cy + band, cx - skip, -1, lim_w, True, need)
    r = _scan(mask, None, cy - band, cy + band, cx + skip, 1, lim_w, True, need)
    if l is None or r is None: return None
    inset = max(2, (r - l) // 8)
    t = _scan(mask, None, l + inset, r - inset, cy - skip, -1, lim_h, False, need)
    b = _scan(mask, None, l + inset, r - inset, cy + skip, 1, lim_h, False, need)
    if t is None or b is None: return None
    inset = max(2, (b - t) // 8)
    l2 = _scan(mask, None, t + inset, b - inset, cx - skip, -1, lim_w, True, need)
    r2 = _scan(mask, None, t + inset, b - inset, cx + skip, 1, lim_w, True, need)
    l, r = (l2 if l2 is not None else l), (r2 if r2 is not None else r)
    return (l / SCALE, t / SCALE, r / SCALE, b / SCALE)

def box_in_band(mask, x, y, axis, band, max_len=420, need=0.55):
    """Room inside a known row (axis 'y': band = top/bottom) or column (axis 'x': band = left/right)."""
    a0, a1 = int(band[0] * SCALE), int(band[1] * SCALE)
    inset = max(2, (a1 - a0) // 6); skip = 7 * SCALE; lim = max_len * SCALE
    if axis == 'y':
        c = int(x * SCALE)
        l = _scan(mask, None, a0 + inset, a1 - inset, c - skip, -1, lim, True, need)
        r = _scan(mask, None, a0 + inset, a1 - inset, c + skip, 1, lim, True, need)
        return None if l is None or r is None else (l / SCALE, band[0], r / SCALE, band[1])
    c = int(y * SCALE)
    t = _scan(mask, None, a0 + inset, a1 - inset, c - skip, -1, lim, False, need)
    b = _scan(mask, None, a0 + inset, a1 - inset, c + skip, 1, lim, False, need)
    return None if t is None or b is None else (band[0], t / SCALE, band[1], b / SCALE)

def clip_by_neighbours(box, seed, others):
    """A room never contains another label: cut halfway towards any label inside it."""
    x0, y0, x1, y1 = box
    sx, sy = seed
    for ox, oy in others:
        if not (x0 < ox < x1 and y0 < oy < y1) or (ox, oy) == (sx, sy): continue
        if abs(ox - sx) >= abs(oy - sy):
            if ox > sx: x1 = min(x1, (sx + ox) / 2)
            else: x0 = max(x0, (sx + ox) / 2)
        else:
            if oy > sy: y1 = min(y1, (sy + oy) / 2)
            else: y0 = max(y0, (sy + oy) / 2)
    return (x0, y0, x1, y1)
