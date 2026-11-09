"""Step 6: feather texture atlas.

Real feathers are cut from the Featherbase scans of Wilfried Hansen's collection (CC BY 4.0, credit in
sources/CREDITS.md): flight feathers H1-H10 / A1-A9, tail S1-S6, primary coverts, greater coverts and
scapulars. Body contour feathers are generated (white, tinted per card by vertex colour).
Output: textures/feather_atlas.png (RGBA, straight alpha) + build/feather_atlas.json.
"""
import json
import math
import os
from collections import deque

import numpy as np

import splib as bt
import feather_scan as ts

ATLAS = 2048
PAD = 6
PX_PER_MM = 200.0 / 25.4  # scans are 200 dpi
BUILD = bt.BUILD

FLIGHT = dict(
    scan="hansen_4010_flight_tail.jpg", y0=900, y1=1340, x0=300, x1=2250,
    names=["A9", "A8", "A7", "A6", "A5", "A4", "A3", "A2", "A1", "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9", "H10"],
    counts=[1, 8, 2, 3, 1, 1, 1, 1, 1],
)
TAIL = dict(scan="hansen_4010_flight_tail.jpg", y0=300, y1=700, x0=120, x1=780, names=["S1", "S2", "S3", "S4", "S5", "S6"], counts=[2, 4],
            clean=True)
# (name, scan, x0, x1, y0, y1, count) boxes in full-res scan pixels for loose feathers
LOOSE = [
    ("HD", "hansen_4010_flight_tail.jpg", 1850, 2090, 540, 728, 4),
    ("GC0", "hansen_4010_flight_tail.jpg", 1495, 1600, 630, 788, 1),
    ("SCAP", "hansen_4009_full_set.jpg", 1255, 1765, 300, 556, 4),
    ("GC", "hansen_4009_full_set.jpg", 1315, 1640, 812, 984, 3),
]
CONTOUR_VARIANTS = 8


# ---------------------------------------------------------------- scan segmentation


def _split(proj, count, min_sep=40):
    """Cut positions (count-1) at the deepest valleys of a smoothed column projection."""
    if count <= 1:
        return []
    k = np.exp(-0.5 * (np.arange(-12, 13) / 4.0) ** 2)
    sm = np.convolve(proj, k / k.sum(), mode="same")
    minima = [i for i in range(2, len(sm) - 2) if sm[i] <= sm[i - 1] and sm[i] <= sm[i + 1]]
    minima.sort(key=lambda i: sm[i])
    cuts = []
    for i in minima:
        if all(abs(i - c) >= min_sep for c in cuts) and min_sep // 2 < i < len(sm) - min_sep // 2:
            cuts.append(i)
        if len(cuts) == count - 1:
            break
    return sorted(cuts)


def _largest(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask)
    best = []
    for sy, sx in zip(*np.nonzero(mask[::5, ::5])):
        sy, sx = sy * 5, sx * 5
        if seen[sy, sx] or not mask[sy, sx]:
            continue
        comp, q = [], deque([(sy, sx)])
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            comp.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if len(comp) > len(best):
            best = comp
    out = np.zeros_like(mask)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def _dilate(m, r):
    out = m.copy()
    for _ in range(r):
        out = out | np.roll(out, 1, 0) | np.roll(out, -1, 0) | np.roll(out, 1, 1) | np.roll(out, -1, 1)
    return out


def _clean_vane(alpha, rach, base_frac=0.14, win=31, slack_px=2.0):
    """Clip stray barbs outside the (running-median) vane outline and fade the downy base to the bare
    shaft - on the bird that base sits under the tail coverts. alpha: top-down, tip at row 0."""
    h, w = alpha.shape
    rx = np.interp(np.arange(h), np.linspace(0.08, 0.92, 9) * (h - 1), np.asarray(rach) * (w - 1))
    left, right = np.zeros(h), np.zeros(h)
    for r in range(h):
        on = alpha[r] > 0.35
        c = int(np.clip(round(rx[r]), 0, w - 1))
        if not on.any():
            continue
        if not on[c]:
            idx = np.nonzero(on)[0]
            c = int(idx[np.argmin(np.abs(idx - c))])
        a_, b_ = c, c
        while a_ > 0 and on[a_ - 1]:
            a_ -= 1
        while b_ < w - 1 and on[b_ + 1]:
            b_ += 1
        left[r], right[r] = rx[r] - a_, b_ - rx[r]
    pad = win // 2
    lp, rp = np.pad(left, pad, mode="edge"), np.pad(right, pad, mode="edge")
    lim_l = np.array([np.median(lp[r : r + win]) for r in range(h)]) * 1.08 + slack_px
    lim_r = np.array([np.median(rp[r : r + win]) for r in range(h)]) * 1.08 + slack_px
    cols = np.arange(w)[None, :]
    dx = cols - rx[:, None]
    lim = np.where(dx < 0, lim_l[:, None], lim_r[:, None])
    keep = 1.0 - bt.smoothstep(0.0, 1.5, np.abs(dx) - lim)
    t = (np.arange(h) / max(h - 1, 1))[:, None]
    shaft = 1.0 - bt.smoothstep(1.5, 3.0, np.abs(dx))
    base = bt.smoothstep(1.0 - base_frac, 1.0 - base_frac + 0.06, t)
    return alpha * keep * (1.0 - base * (1.0 - shaft))


def _smooth_rachis(rach, alpha):
    """The brightest-pixel rachis estimate wanders (zigzag shaft lines on the cards). A real shaft is a smooth, gently
    curved line: robust quadratic through the estimates, kept inside the vane (weighted towards its middle)."""
    h, w = alpha.shape
    ys = np.linspace(0.08, 0.92, 9)
    xs = np.asarray(rach, float) * (w - 1)
    mid = np.zeros(9)
    for k, yy in enumerate(ys):
        idx = np.nonzero(alpha[int(yy * (h - 1))] > 0.5)[0]
        mid[k] = 0.5 * (idx.min() + idx.max()) if len(idx) > 2 else xs[k]
    # blend the noisy estimate with the vane's middle (the shaft sits nearer the narrow vane, not at its edge)
    x = 0.45 * xs + 0.55 * mid
    keep = np.ones(9, bool)
    for _ in range(3):
        co = np.polyfit(ys[keep], x[keep], 2 if keep.sum() > 4 else 1)
        res = np.abs(np.polyval(co, ys) - x)
        keep = res < max(2.5, 1.5 * np.median(res))
        if keep.sum() < 4:
            keep[:] = True
            break
    sm = np.polyval(np.polyfit(ys[keep], x[keep], 2), ys)
    return list(np.clip(sm / max(w - 1, 1), 0.05, 0.95))


def _sprite(a, al, bg, x0, x1, y0, y1, clean_vane=False):
    """Cut one feather: returns rgba (top-down), plus base/tip info."""
    crop = a[y0:y1, x0:x1]
    alpha = al[y0:y1, x0:x1].copy()
    core = _largest(alpha > 0.5)
    alpha *= _dilate(core, 3)
    # white mounting tab / label residue: bright, unsaturated blobs at the very bottom
    v = crop.max(-1)
    s = (crop.max(-1) - crop.min(-1)) / (v + 1e-6)
    tab = (v > 0.74) & (s < 0.12)
    rows_tab = np.nonzero(tab.sum(1) > 4)[0]
    if len(rows_tab) and rows_tab.min() > 0.6 * (y1 - y0):
        alpha[rows_tab.min() - 1 :] = 0.0
    rows = np.nonzero((alpha > 0.5).sum(1) > 1)[0]
    cols = np.nonzero((alpha > 0.5).sum(0) > 1)[0]
    if len(rows) == 0:
        return None
    r0, r1 = max(rows.min() - 3, 0), min(rows.max() + 3, alpha.shape[0])
    c0, c1 = max(cols.min() - 3, 0), min(cols.max() + 3, alpha.shape[1])
    crop, alpha = crop[r0:r1, c0:c1], alpha[r0:r1, c0:c1]
    # remove grey card fringe from semi-transparent edge pixels
    aa = np.clip(alpha, 0.2, 1.0)[..., None]
    col = np.clip((crop - (1 - aa) * bg[None, None, :]) / aa, 0, 1)
    rgba = np.concatenate([col, alpha[..., None]], -1)
    # rachis line: brightest pixels of the middle third of each row
    rach = []
    for yy in np.linspace(0.08, 0.92, 9):
        r = int(yy * (rgba.shape[0] - 1))
        row_a = alpha[r] > 0.5
        idx = np.nonzero(row_a)[0]
        if len(idx) < 3:
            rach.append(0.5)
            continue
        lo, hi = idx.min(), idx.max()
        mid = slice(lo + (hi - lo) // 4, hi - (hi - lo) // 4 + 1)
        lum = crop[r, mid].mean(-1)
        rach.append((mid.start + int(np.argmax(lum))) / max(rgba.shape[1] - 1, 1))
    rach = _smooth_rachis(rach, alpha)
    left = (alpha[:, : int(np.median(rach) * alpha.shape[1])] > 0.5).sum()
    right = (alpha[:, int(np.median(rach) * alpha.shape[1]) :] > 0.5).sum()
    if clean_vane:
        rgba[..., 3] = _clean_vane(alpha, rach)
    return dict(rgba=rgba, rachis=rach, narrow="L" if left < right else "R",
                h_mm=rgba.shape[0] / PX_PER_MM, w_mm=rgba.shape[1] / PX_PER_MM)


def _row_feathers(spec, cache):
    a = cache.setdefault(spec["scan"], ts.load_scan(spec["scan"]))
    bg = ts.bg_color(a, 820, 880, 300, 2100)
    al = ts.feather_alpha(a, bg)
    runs = ts.column_runs(al, spec["y0"], spec["y1"], spec["x0"], spec["x1"], thr=0.5, min_gap=2, min_width=14)
    if len(runs) != len(spec["counts"]):
        raise RuntimeError("%s: expected %d runs, got %s" % (spec["scan"], len(spec["counts"]), runs))
    cols = []
    for (rx0, rx1), cnt in zip(runs, spec["counts"]):
        proj = (al[spec["y0"] : spec["y1"], rx0:rx1] > 0.5).sum(0).astype(float)
        cuts = [rx0] + [rx0 + c for c in _split(proj, cnt)] + [rx1]
        cols += list(zip(cuts[:-1], cuts[1:]))
    out = {}
    for name, (cx0, cx1) in zip(spec["names"], cols):
        sp = _sprite(a, al, bg, cx0, cx1, spec["y0"] - 5, spec["y1"] + 80, clean_vane=spec.get("clean", False))
        if sp:
            out[name] = sp
    return out


def _loose_feathers(cache):
    out = {}
    for prefix, scan, x0, x1, y0, y1, cnt in LOOSE:
        a = cache.setdefault(scan, ts.load_scan(scan))
        bg = ts.bg_color(a, y0 - 40, y0 - 10, x0, x1)
        al = ts.feather_alpha(a, bg)
        proj = (al[y0:y1, x0:x1] > 0.5).sum(0).astype(float)
        cuts = [x0] + [x0 + c for c in _split(proj, cnt, min_sep=30)] + [x1]
        for i, (cx0, cx1) in enumerate(zip(cuts[:-1], cuts[1:])):
            sp = _sprite(a, al, bg, cx0, cx1, y0, y1)
            if sp:
                out["%s%d" % (prefix, i + 1)] = sp
    return out


# ---------------------------------------------------------------- tree sparrow feather patterns
# The Hansen scans are bluethroat feathers (plain earth-brown). Each sprite keeps its own outline, barbs
# and shading (scan luminance) but gets the tree sparrow pattern of its feather group, painted by
# position on the vane: e = distance from the rachis (0) to the vane edge (1), t = 0 at the tip.
# Colours (sRGB) sampled on side_profile_halun.jpg / front34_halun.jpg and darkened to albedo.
PATTERNS = {
    # dark brown remiges / primary coverts with narrow buff edges
    "flight": dict(centre=(0.25, 0.20, 0.16), edge=(0.62, 0.48, 0.34), e_edge=0.84, tip=None, t_tip=0.0, shaft=(0.14, 0.11, 0.09)),
    # tertials: blackish centres, broad rufous-buff edges
    "tertial": dict(centre=(0.10, 0.08, 0.07), edge=(0.70, 0.50, 0.32), e_edge=0.52, tip=None, t_tip=0.0),
    # greater coverts: dark centre, rufous-buff edges, white-buff tip = lower wing bar
    "greater": dict(centre=(0.22, 0.165, 0.125), edge=(0.66, 0.45, 0.28), e_edge=0.50, tip=(0.82, 0.72, 0.54), t_tip=0.09),
    # median coverts: black centre, broad white tip = upper wing bar
    "median": dict(centre=(0.19, 0.14, 0.11), edge=(0.42, 0.28, 0.19), e_edge=0.62, tip=(0.90, 0.84, 0.72), t_tip=0.13),
    # rectrices: plain dark brown, paler buff-brown edges
    "tail": dict(centre=(0.45, 0.37, 0.30), edge=(0.71, 0.63, 0.52), e_edge=0.70, tip=(0.66, 0.59, 0.49), t_tip=0.035,
                 shaft=(0.27, 0.22, 0.18), barbs=0.10, translucent=0.78),  # side + flight_spread + ground_peck photos  # sampled on the photo's tail
    # scapulars / mantle: black shaft streak, rufous-buff vanes
    "scap": dict(centre=(0.07, 0.055, 0.045), edge=(0.60, 0.44, 0.30), e_edge=0.46, tip=None, t_tip=0.0),
    # plain warm brown (tail coverts, misc)
    "plain": dict(centre=(0.40, 0.34, 0.30), edge=(0.62, 0.55, 0.47), e_edge=0.80, tip=None, t_tip=0.0),  # uppertail coverts: dull brown, pale fringe
}


def _rachis_curve(rach, h, w):
    ys = np.linspace(0.08, 0.92, 9) * (h - 1)
    co = np.polyfit(ys, np.asarray(rach) * (w - 1), 2)
    return np.polyval(co, np.arange(h))


def _pattern(sp, kind):
    rgba = sp["rgba"].copy()
    P = PATTERNS[kind]
    h, w = rgba.shape[:2]
    al = rgba[..., 3]
    rx = _rachis_curve(sp["rachis"], h, w)
    e = np.zeros((h, w))
    cols = np.arange(w)
    for r in range(h):
        on = np.nonzero(al[r] > 0.3)[0]
        if len(on) < 2:
            continue
        lo, hi = on.min(), on.max()
        dx = cols - rx[r]
        e[r] = np.where(dx < 0, -dx / max(rx[r] - lo, 1.0), dx / max(hi - rx[r], 1.0))
    rows = np.nonzero((al > 0.3).any(1))[0]
    r0, r1 = (rows.min(), rows.max()) if len(rows) else (0, h - 1)
    t = np.clip((np.arange(h) - r0) / max(r1 - r0, 1), 0, 1)[:, None] * np.ones((1, w))
    lum = rgba[..., :3] @ np.array([0.30, 0.59, 0.11])
    mean = (lum * (al > 0.3)).sum() / max((al > 0.3).sum(), 1)
    detail = np.clip(lum / max(mean, 1e-3), 0.6, 1.5) ** 0.6  # keep barbs / rachis relief from the scan
    k = bt.smoothstep(P["e_edge"] - 0.12, P["e_edge"] + 0.08, np.clip(e, 0, 1.5))
    col = np.asarray(P["centre"])[None, None] * (1 - k[..., None]) + np.asarray(P["edge"])[None, None] * k[..., None]
    if P["tip"] is not None:
        # tip patch follows the feather outline (wider at the edges like real covert tips)
        kt = 1 - bt.smoothstep(P["t_tip"] - 0.05, P["t_tip"] + 0.04, t - 0.06 * np.clip(e, 0, 1))
        col = col * (1 - kt[..., None]) + np.asarray(P["tip"])[None, None] * kt[..., None]
    col = col * detail[..., None]  # atlas is stored as sRGB like the scans
    if P.get("barbs"):  # fine barbs leaving the shaft at ~40 deg towards the tip, as in the scans / photos
        dxs = np.arange(w)[None, :] - rx[:, None]
        ph = (np.arange(h)[:, None] + np.abs(dxs) * 0.85) * (2 * math.pi / 2.6)
        col = col * (1 + P["barbs"] * np.sin(ph)[..., None] * (np.abs(dxs) > 2)[..., None])
    if P.get("translucent"):  # thin vane edges and worn tip let light through
        a = rgba[..., 3]
        rim = bt.smoothstep(0.72, 1.0, np.clip(e, 0, 1.2)) + (1 - bt.smoothstep(0.0, 0.06, t))
        rgba[..., 3] = a * (1 - (1 - P["translucent"]) * np.clip(rim, 0, 1))
    if P.get("shaft") is not None:  # dark rachis line
        dxs = np.abs(np.arange(w)[None, :] - rx[:, None])
        wd = 0.55 + 0.9 * t  # shaft: hair-thin at the tip, stout at the base
        ks = (1 - bt.smoothstep(0.5 * wd, 1.4 * wd + 0.4, dxs)) * (t < 0.97)
        col = col * (1 - ks[..., None]) + np.asarray(P["shaft"])[None, None] * ks[..., None]
    rgba[..., :3] = np.clip(col, 0, 1)
    out = dict(sp)
    out["rgba"] = rgba
    return out


def sparrow_patterns(sprites):
    for name in list(sprites):
        if name.startswith("H"):
            sprites[name] = _pattern(sprites[name], "flight")
        elif name in ("A7", "A8", "A9"):
            sprites[name] = _pattern(sprites[name], "tertial")
        elif name.startswith("A"):
            sprites[name] = _pattern(sprites[name], "flight")
        elif name.startswith("S") and name[1:].isdigit():
            sprites[name] = _pattern(sprites[name], "tail")
        elif name.startswith("SCAP"):
            sprites[name] = _pattern(sprites[name], "scap")
    for src, n in (("GC01", 1), ("GC3", 2)):
        if src in sprites:
            sprites["GCs%d" % n] = _pattern(sprites[src], "greater")
            sprites["MCs%d" % n] = _pattern(sprites[src], "median")
            sprites[src] = _pattern(sprites[src], "plain")
    return sprites


# ---------------------------------------------------------------- generated contour feathers


def _contour_sprite(seed, w=112, h=144):
    """White body contour feather (tip at the top), built barb by barb.

    Barbs leave the rachis at ~40 deg towards the tip and end at individually varying lengths, so the
    outline is made of barb tips; a few barb clumps split apart; the proximal third is downy and
    fades out so cards blend into the plumage underneath.
    """
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    v = 1.0 - yy / (h - 1)  # 1 at the tip, 0 at the base
    u = (xx / (w - 1)) * 2 - 1
    lean = 0.08 * (rng.random() - 0.5)
    uu = u - lean * v * v  # slightly curved rachis
    au = np.abs(uu)
    side = np.sign(uu)
    vane = 0.78 + 0.14 * rng.random()
    asym = 1.0 + 0.10 * (rng.random() - 0.5) * side
    tip_v = 0.96
    # vane outline before barb raggedness: broad, with a rounded tip
    outline = vane * asym * np.where(
        v > 0.55, np.sqrt(np.clip(1 - ((v - 0.55) / (tip_v - 0.55)) ** 2, 0, 1)), 1.0 - 0.45 * (np.clip(0.55 - v, 0, None) / 0.55) ** 1.6
    )
    ang = math.radians(38 + 8 * rng.random())
    spacing = 2.2 + 0.6 * rng.random()  # px between barbs along the rachis
    barb_pos = (v * (h - 1) - au * (w / 2) / math.tan(ang)) / spacing  # barb index along the rachis
    bi = np.floor(barb_pos)
    frac = barb_pos - bi
    hsh = np.sin(bi * 12.9898 + side * 78.233 + seed) * 43758.5453
    rnd = hsh - np.floor(hsh)
    clump = np.sin(bi * 0.55 + rng.random() * 6) > 0.86  # barbs that separate into a notch
    reach = outline * (0.86 + 0.22 * rnd) - 0.12 * clump
    inside = au < reach
    barb_line = 0.5 + 0.5 * np.cos(2 * np.pi * frac)
    fringe = bt.smoothstep(0.0, 0.10, reach - au)  # 0 at the barb tips
    alpha = np.where(inside, 0.55 + 0.45 * np.maximum(fringe, barb_line), 0.0)
    down = 1 - bt.smoothstep(0.08, 0.40, v)  # downy base: fluffy, fading
    fluff = 0.5 + 0.5 * np.sin(barb_pos * 2.7 + au * 9.0)
    alpha = alpha * (1 - down * (0.75 + 0.25 * fluff))
    alpha *= bt.smoothstep(0.02, 0.10, v)
    rach = 1 - bt.smoothstep(0.010, 0.035, au)
    # nearly uniform brightness: on a live bird single body feathers barely read, only their edges do
    lum = 0.95 + 0.035 * v + 0.012 * (barb_line - 0.5) - 0.03 * down + 0.01 * rach
    lum *= 0.985 + 0.015 * fringe
    rgba = np.stack([lum, lum, lum, np.clip(alpha, 0, 1)], -1)
    return dict(rgba=rgba, rachis=[0.5] * 9, narrow="L", h_mm=0.0, w_mm=0.0)


def atlas_normals(atlas_bottom_up, strength=2.2):
    """Tangent-space normal map from feather luminance (rachis and barbs read as relief)."""
    rgb, a = atlas_bottom_up[..., :3], atlas_bottom_up[..., 3]
    hgt = (rgb @ np.array([0.30, 0.59, 0.11])) * (a > 0.05)
    for _ in range(1):
        hgt = (hgt + np.roll(hgt, 1, 0) + np.roll(hgt, -1, 0) + np.roll(hgt, 1, 1) + np.roll(hgt, -1, 1)) / 5.0
    gy, gx = np.gradient(hgt)
    n = np.stack([-gx * strength * 8, -gy * strength * 8, np.ones_like(gx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


# ---------------------------------------------------------------- packing


def pack(sprites):
    """Shelf packing at native scan scale (falls back to a uniform downscale if it overflows)."""
    order = sorted(sprites.items(), key=lambda kv: -kv[1]["rgba"].shape[0])
    for scale in (1.0, 0.9, 0.8, 0.7, 0.6):
        x = y = shelf = 0
        rects = {}
        ok = True
        for name, sp in order:
            h, w = (int(math.ceil(d * scale)) for d in sp["rgba"].shape[:2])
            if x + w + PAD > ATLAS:
                x, y, shelf = 0, y + shelf + PAD, 0
            if y + h + PAD > ATLAS:
                ok = False
                break
            rects[name] = (x, y, w, h)
            x += w + PAD
            shelf = max(shelf, h)
        if ok:
            return rects, scale
    raise RuntimeError("feathers do not fit the atlas")


def _resize(img, h, w):
    ys = np.linspace(0, img.shape[0] - 1, h)
    xs = np.linspace(0, img.shape[1] - 1, w)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    y1 = np.minimum(y0 + 1, img.shape[0] - 1)
    x1 = np.minimum(x0 + 1, img.shape[1] - 1)
    fy = (ys - y0)[:, None, None]
    fx = (xs - x0)[None, :, None]
    return (img[y0][:, x0] * (1 - fy) * (1 - fx) + img[y1][:, x0] * fy * (1 - fx) + img[y0][:, x1] * (1 - fy) * fx + img[y1][:, x1] * fy * fx)


def build():
    cache = {}
    sprites = {}
    sprites.update(_row_feathers(FLIGHT, cache))
    sprites.update(_row_feathers(TAIL, cache))
    sprites.update(_loose_feathers(cache))
    for i in range(CONTOUR_VARIANTS):
        sprites["C%d" % i] = _contour_sprite(100 + i)
    sparrow_patterns(sprites)
    rects, scale = pack(sprites)
    atlas = np.zeros((ATLAS, ATLAS, 4), np.float32)
    meta = {"atlas": ATLAS, "scale": scale, "px_per_mm": PX_PER_MM * scale, "feathers": {}}
    for name, (x, y, w, h) in rects.items():
        sp = sprites[name]
        img = _resize(sp["rgba"], h, w)
        # premultiply-free bleed: copy edge colours outwards so mip levels don't darken edges
        a = img[..., 3:4]
        col = img[..., :3]
        mean_col = (col * a).sum((0, 1)) / max(a.sum(), 1e-6)
        img[..., :3] = np.where(a > 0.02, col, mean_col)
        atlas[y : y + h, x : x + w] = img
        u0, u1 = x / ATLAS, (x + w) / ATLAS
        v_top, v_bot = 1 - y / ATLAS, 1 - (y + h) / ATLAS  # Blender UV (v up); sprite tip at top
        meta["feathers"][name] = {
            "uv": [u0, v_bot, u1, v_top],
            "h_mm": sp["h_mm"], "w_mm": sp["w_mm"],
            "rachis": sp["rachis"], "narrow": sp["narrow"],
        }
    # Blender images are bottom-up
    img = bt.np_image(atlas[::-1], "SP_Feather_Atlas", path=os.path.join(bt.TEX, "feather_atlas.png"))
    nrm = atlas_normals(atlas[::-1])
    bt.np_image(nrm, "SP_Feather_Atlas_Normal", path=os.path.join(bt.TEX, "feather_atlas_normal.png"), colorspace="Non-Color")
    with open(os.path.join(BUILD, "feather_atlas.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    return img, meta


def run():
    img, meta = build()
    names = sorted(meta["feathers"])
    return "atlas %dpx scale %.2f: %d feathers (%s)" % (ATLAS, meta["scale"], len(names), " ".join(names))
