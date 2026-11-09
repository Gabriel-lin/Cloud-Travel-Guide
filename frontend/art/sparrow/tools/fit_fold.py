"""Headless fill pass for the photo-fitted folded wing.

Renders the real per-pixel feather-group map (measure_side.region_map, z-buffer + scan alpha), finds
pixels of each traced photo region that show a LOWER group / body / nothing instead of that group,
and adds cards whose tips land in those gaps (lower and tip edges, holes). Repeats, keeps the best
set per group and writes build/fold_extra.json, which s07 reads.
  blender -b sparrow_wip.blend --python tools/fit_fold.py
"""
import json, os, sys
import numpy as np
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "pipeline"))
sys.path.insert(0, HERE)
import s07_feathers as sf  # noqa: E402
import measure_side as ms  # noqa: E402
import spshape as bs  # noqa: E402

ITERS = int(os.environ.get("FIT_ITERS", "4"))
meta = json.load(open(os.path.join(sf.BUILD, "feather_atlas.json"), encoding="utf-8"))
atlas = bpy.data.images["SP_Feather_Atlas"]
bg = sf.photo_background()
pm = {r: ms._poly_mask(p) & ~bg for r, p in ms.PHOTO_REGIONS.items()}
for m in pm.values():
    m[: ms.REGION_TOP] = False
lift = {r: g[3] for r, g in sf.FOLD_GROUPS.items()}
extra = {str(r): [] for r in sf.FOLD_GROUPS}
best = {}


def evaluate():
    sf.FOLD_EXTRA = extra
    sf.build_wing_fold(meta, atlas)
    reg = ms.region_map()
    reg[: ms.REGION_TOP] = 0
    out = {}
    for r in sf.FOLD_GROUPS:
        mm = reg == r
        out[r] = (mm & pm[r]).sum() / max((mm | pm[r]).sum(), 1)
    return reg, out


for it in range(ITERS + 1):
    reg, iou = evaluate()
    print("iter", it, " ".join("%d:%.3f" % (r, iou[r]) for r in sorted(iou)), flush=True)
    for r in sf.FOLD_GROUPS:
        if iou[r] > best.get(r, (-1, None))[0]:
            best[r] = (iou[r], list(extra[str(r)]))
    if it == ITERS:
        break
    for r, (axis, L, wr, lf, step, bone) in sf.FOLD_GROUPS.items():
        if iou[r] >= 0.86:
            continue
        a = np.asarray(axis, float); a /= np.linalg.norm(a)
        Lpx = L / (bs.PX_MM * 2.0)
        hw = 0.5 * Lpx * wr
        lower = np.zeros_like(reg, bool)
        for r2, l2 in lift.items():
            if l2 < lf:
                lower |= reg == r2
        fixable = pm[r] & (reg != r) & ((reg == 0) | lower | (reg == 8))
        ys, xs = np.nonzero(fixable)
        if len(xs) == 0:
            continue
        # gap density on a coarse grid; seed tips at the densest cells, spaced half a vane apart
        cell = max(2, int(hw * 0.6))
        keys = (ys // cell) * 10000 + xs // cell
        uk, cnt = np.unique(keys, return_counts=True)
        order = np.argsort(-cnt)
        added = []
        for k in order[:12]:
            if cnt[k] < max(4, cell * cell * 0.35):
                break
            sel = keys == uk[k]
            c = np.array([xs[sel].mean(), ys[sel].mean()]) + 0.5
            tip = c + a * min(0.3 * Lpx, 4.0)  # tip just past the gap, along the feather
            if not pm[r][int(min(max(tip[1], 0), 425)), int(min(max(tip[0], 0), 639))]:
                tip = c
            if any(np.hypot(*(tip - q)) < hw for q in added):
                continue
            added.append(tip)
        extra[str(r)] += [tuple(round(float(x), 1) for x in t) for t in added]

final = {str(r): b[1] for r, b in best.items()}
sf.FOLD_EXTRA = final
_reg, iou = evaluate()
print("FINAL", " ".join("%d:%.3f" % (r, iou[r]) for r in sorted(iou)), {r: len(v) for r, v in final.items()})
json.dump(final, open(os.path.join(sf.BUILD, "fold_extra.json"), "w"))
