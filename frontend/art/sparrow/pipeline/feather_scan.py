"""Segment feathers on the Featherbase scans (grey card background); used by s06_feather_atlas."""
import os

import numpy as np

import splib as bt


def load_scan(name):
    img = bt.load_image(os.path.join(bt.FEATHER_SCANS, name))
    return bt.image_np(img)[::-1, :, :3].astype(np.float64)  # top-down


def bg_color(a, y0, y1, x0, x1):
    c = a[y0:y1, x0:x1].reshape(-1, 3)
    return np.median(c, axis=0)


def blur(a, passes=2):
    for _ in range(passes):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0)) / 3.0
        a = (a + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 3.0
    return a


def feather_alpha(a, bg, lo=0.10, hi=0.18, passes=2):
    """Soft alpha from distance to the card colour (plus a saturation boost for rufous feathers)."""
    a = blur(a, passes)
    d = np.linalg.norm(a - bg[None, None, :], axis=-1)
    mx, mn = a.max(-1), a.min(-1)
    sat = (mx - mn) / (mx + 1e-6)
    bg_sat = (bg.max() - bg.min()) / (bg.max() + 1e-6)
    d = d + 0.6 * np.clip(sat - bg_sat - 0.04, 0, None)
    return bt.smoothstep(lo, hi, d)


def column_runs(alpha, y0, y1, x0, x1, thr=0.5, min_gap=4, min_width=12):
    """Feather column ranges in a strip by projecting the alpha mask onto x."""
    proj = (alpha[y0:y1, x0:x1] > thr).sum(0)
    on = proj > max(3, 0.02 * (y1 - y0))
    runs = []
    start = None
    gap = 0
    for i, v in enumerate(on):
        if v:
            if start is None:
                start = i
            gap = 0
            end = i
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                if end - start + 1 >= min_width:
                    runs.append((x0 + start, x0 + end + 1))
                start = None
    if start is not None and end - start + 1 >= min_width:
        runs.append((x0 + start, x0 + end + 1))
    return runs
