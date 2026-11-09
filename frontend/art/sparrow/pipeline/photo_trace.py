"""Segment a bird from a smooth bokeh background and return its silhouette (used by s03_body).

Writes <name>_mask.png (overlay) into build/debug and returns outline arrays in pixel coords
(origin top-left, y down).
"""
import os
from collections import deque

import numpy as np

import splib as bt

DEBUG = bt.DEBUG


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn + 1e-9
    h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    s = np.where(mx > 0, (mx - mn) / (mx + 1e-9), 0)
    return h, s, mx


def largest_component(mask, seed=None):
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    best = None
    best_n = 0
    seeds = [seed] if seed else zip(*np.nonzero(mask[:: 7, :: 7]))
    for sy, sx in seeds:
        if seed is None:
            sy, sx = sy * 7, sx * 7
        if not mask[sy, sx] or seen[sy, sx]:
            continue
        comp = []
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(comp) > best_n:
            best_n = len(comp)
            best = comp
        if seed is not None:
            break
    out = np.zeros_like(mask, dtype=bool)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def fill_holes(mask):
    inv = ~mask
    h, w = mask.shape
    border = np.zeros_like(mask)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if inv[y, x] and not border[y, x]:
                border[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if inv[y, x] and not border[y, x]:
                border[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and inv[ny, nx] and not border[ny, nx]:
                border[ny, nx] = True
                q.append((ny, nx))
    return ~border


def segment(photo, bg_hue=(42.0, 160.0), min_sat=0.16, crop=None, seed=None, scale=0.5):
    img = bt.load_image(os.path.join(bt.PHOTOS, photo))
    a = bt.image_np(img)[::-1, :, :3]  # top-down
    if scale != 1.0:
        step = int(round(1 / scale))
        a = a[::step, ::step]
    h, s, v = rgb_to_hsv(a)
    bg = (h > bg_hue[0]) & (h < bg_hue[1]) & (s > min_sat)
    mask = ~bg
    if crop is not None:
        y0, y1, x0, x1 = crop
        m2 = np.zeros_like(mask)
        m2[y0:y1, x0:x1] = mask[y0:y1, x0:x1]
        mask = m2
    mask = largest_component(mask, seed)
    mask = fill_holes(mask)
    over = a.copy()
    edge = mask ^ np.roll(mask, 1, 0) | mask ^ np.roll(mask, 1, 1)
    over[edge] = (1.0, 0.0, 0.0)
    over[~mask] *= 0.55
    bt.np_image(over[::-1], "dbg_" + photo, path=os.path.join(DEBUG, os.path.splitext(photo)[0] + "_mask.png"))
    return a, mask


def outline(mask):
    cols = np.nonzero(mask.any(0))[0]
    top = np.array([np.argmax(mask[:, x]) for x in cols])
    bot = np.array([mask.shape[0] - 1 - np.argmax(mask[::-1, x]) for x in cols])
    return cols, top, bot
