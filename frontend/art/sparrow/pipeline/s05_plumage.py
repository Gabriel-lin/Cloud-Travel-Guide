"""Step 5: body plumage textures (base colour, normal, roughness) generated in UV space.

Every texel maps to an exact point of the traced side photo (the mesh was built from it), so:
1. Region map: tree sparrow head pattern measured on the photo (chestnut crown and nape, black lores,
   small black bib, white cheek with the black ear spot, white half-collar) plus anatomical rules
   where the photo can't help (streaked brown mantle and flank under the folded wing, belly, undertail).
2. Feathers: a quincunx lattice of overlapping contour feathers laid out in surface millimetres and
   warped so feather size grows from the face (~0.7 mm) to the flanks (~3.6 mm). Each texel shows the
   most forward feather covering it (shingle order). Colour is sampled at that feather's visible
   centre, so region borders follow feather edges like on a real bird.
3. Per feather: barbs, rachis, fringe, overlap shading, tint jitter, and a relief height for the
   normal map. Only my own palette goes into the texture; the photo only decides which region is where.
"""
import math
import os

import bpy
import numpy as np

import splib as bt
import spshape as bs
import s03_body as sb

TEX_W, TEX_H = 1024, 2048
DEBUG = bt.DEBUG

(UPPER, BLUE, SPOT, BLACK, WHITEBAND, RUFOUS, BELLY, FLANK, CROWN, SUPER, LORES, CHEEK, UNDERTAIL, GAPE) = range(14)
NCLS = 14

PALETTE = {  # sRGB albedo sampled on the reference photos (median of feather patches, exposure-normalised)
    UPPER: (0.66, 0.50, 0.36),  # warm brown mantle (black-streaked, see SPECKLE)
    BLUE: (0.80, 0.78, 0.72),  # unused class (kept so ids stay stable)
    SPOT: (0.07, 0.07, 0.08),  # black ear spot on the white cheek
    BLACK: (0.08, 0.085, 0.09),  # small black bib (chin / upper throat)
    WHITEBAND: (0.87, 0.87, 0.86),  # white half-collar behind the cheek
    RUFOUS: (0.80, 0.78, 0.72),  # unused
    BELLY: (0.83, 0.755, 0.65),  # dirty white belly
    FLANK: (0.73, 0.68, 0.59),  # buff-brown flanks
    CROWN: (0.50, 0.31, 0.23),  # sampled: head close-up / front34 / side photos  # chestnut crown and nape
    SUPER: (0.50, 0.31, 0.23),  # unused (crown colour)
    LORES: (0.07, 0.07, 0.08),  # black lores / eye surround
    CHEEK: (0.86, 0.865, 0.87),  # white cheek
    UNDERTAIL: (0.70, 0.66, 0.60),  # sampled under the tail base (photo)  # pale buff undertail coverts
    GAPE: (0.79, 0.76, 0.70),  # unused
}
# Small-passerine body feathers read as a near-continuous surface: outlines only show as faint
# scalloping (breast / belly fringes), so per-feather contrast stays low.
FRINGE = {UPPER: 0.06, CROWN: 0.05, FLANK: 0.008, BELLY: 0.006, BLACK: 0.05, LORES: 0.05, SPOT: 0.05, CHEEK: 0.02, WHITEBAND: 0.02}
ROUGH = {BLACK: 0.72, SPOT: 0.72, LORES: 0.70, CHEEK: 0.6, WHITEBAND: 0.6}
SHAFT_DARK = {CROWN: 0.10, UPPER: 0.25, FLANK: 0.06}
SCALE_CONTRAST = {UPPER: 0.04, CROWN: 0.07, BLACK: 0.12, LORES: 0.12, SPOT: 0.12, WHITEBAND: 0.07, CHEEK: 0.07, FLANK: 0.012, BELLY: 0.008, UNDERTAIL: 0.012}
DEFAULT_CONTRAST = 0.015
STREAK = {UPPER: 0.14, CROWN: 0.12, CHEEK: 0.04, FLANK: 0.11, BELLY: 0.10, UNDERTAIL: 0.06, BLACK: 0.06,
          WHITEBAND: 0.03, LORES: 0.05, SPOT: 0.05}
HEAD_DMM = (1.9, 2.5)  # feather size (mm): the head / collar / throat patterns use feather-shaped borders below this
DEFAULT_STREAK = 0.07
PALE_STRANDS = {CROWN: 0.05, UPPER: 0.06, BLACK: 0.05, FLANK: 0.04, BELLY: 0.04}
FRAY_MM = 0.32
# Flecks / streaks on a jittered grid in surface mm: black mantle streaks, buff flecks in the brown,
# faint grey fringe flecks at the bib's lower edge.
SPECKLE = {
    UPPER: (0.70, (0.10, 0.075, 0.06), 1.5, 4.2, (0.22, 0.42)),  # soft mantle streaks under the photo-coloured cards (no black specks in card gaps)
    CROWN: (0.10, (0.36, 0.17, 0.10), 0.5, 2.0),
    FLANK: (0.10, (0.62, 0.52, 0.40), 0.8, 2.6),
    BLACK: (0.0, (0.30, 0.28, 0.27), 0.45, 1.5),  # plain velvety black bib: no grey dots
}
RUMP_PLAIN_X = 440.0  # behind this (half-res px) the rump / tail base has no streaks or flecks
SPECKLE_R_MM = (0.08, 0.20)  # fleck edge (soft) radius
SOFT_CLASSES = (UPPER, FLANK, BELLY, UNDERTAIL)
SOFT_MM = 2.4  # blur radius of the soft colour transitions

# Folded wing outline on the photo (half-res px): body under it is flank / back, not wing-brown.
WING_POLY = [
    (300, 112), (272, 140), (258, 165), (258, 195), (290, 222), (350, 250), (410, 268), (465, 287),
    (480, 284), (455, 252), (420, 210), (385, 165), (350, 128), (325, 108),
]
# Head pattern measured on Halun's side photo (half-res px). Curves are y(x) polylines.
CROWN_BOT = [(196, 93.0), (212, 87.0), (226, 84.0), (246, 84.5), (262, 89.0), (285, 93.0), (305, 99.0), (325, 106.0), (345, 112.0)]
LORES_POLY = [(196, 93), (212, 86), (232, 82), (248, 86), (252, 96), (244, 104), (226, 104), (210, 106), (198, 104)]
BIB_POLY = [(198, 104), (212, 106), (226, 106), (232, 118), (234, 135), (232, 152), (226, 163), (218, 160), (212, 140), (206, 122), (200, 112)]
EARSPOT = ((266.0, 113.0), (16.5, 9.0))  # black ear spot centre, radii (x, y)
NAPE_X = (316.0, 342.0)  # half-res px: hind-crown end .. collar end over the nape
COLLAR = ((290.0, 104.0, 345.0, 124.0))  # white half-collar band (x0, y0 .. x1, y1) under the nape
EYELID_R = 5.6
U_SAMPLE_MIN, U_SAMPLE_MAX = 0.22, 0.86

# Feather size (mm) at the body landmark rings (bill .. tail base).
FEATHER_MM = [0.7, 0.9, 1.1, 1.3, 1.5, 1.8, 2.1, 2.5, 2.9, 3.2, 3.4, 3.3, 3.0, 2.6]
F_LEN, F_HALFW = 1.75, 0.70  # feather length (lattice rows) / half width (lattice columns)


# ---------------------------------------------------------------- geometry of the UV grid


def body_grid():
    ob = bpy.data.objects["SP_Body"]
    data = np.load(os.path.join(sb.BUILD, "body_field.npz"))
    seg, n = int(data["seg"]), int(data["rings"])
    loop = 2 * seg
    co = bt.object_verts(ob) / bt.MM  # mm
    P3 = np.stack([co[i * loop : i * loop + seg + 1] for i in range(n)])  # (n, seg+1, 3) right half
    sl = data["slices"]
    t = (1 - np.cos(np.pi * np.arange(seg + 1) / seg)) / 2
    Ppx = sl[:, 0][:, None, :] + (sl[:, 1] - sl[:, 0])[:, None, :] * t[None, :, None]
    return P3, Ppx, data["vcoord"], seg, n


def lattice(P3, n, seg):
    d_ring = sb.ring_values(FEATHER_MM)
    k = np.arange(seg + 1)
    d = d_ring[:, None] * (1 + 0.15 * np.sin(np.pi * k / seg)[None, :] ** 2)
    dv = np.linalg.norm(np.diff(P3, axis=0), axis=2)
    du = np.linalg.norm(np.diff(P3, axis=1), axis=2)
    dmid_v = (d[1:] + d[:-1]) / 2
    dmid_u = (d[:, 1:] + d[:, :-1]) / 2
    qv = np.vstack([np.zeros((1, seg + 1)), np.cumsum(dv / dmid_v, axis=0)])
    qu = np.hstack([np.zeros((n, 1)), np.cumsum(du / dmid_u, axis=1)])
    sv = np.vstack([np.zeros((1, seg + 1)), np.cumsum(dv, axis=0)])
    su = np.hstack([np.zeros((n, 1)), np.cumsum(du, axis=1)])
    return qu, qv, su, sv, d


def texel_coords(vcoord, n, seg):
    v = (np.arange(TEX_H) + 0.5) / TEX_H
    u = (np.arange(TEX_W) + 0.5) / TEX_W
    i_f = np.interp(v, vcoord, np.arange(n, dtype=float))
    k_f = u * seg
    return np.meshgrid(k_f, i_f)  # (H, W) each: k_f, i_f


def sample_grid(G, i_f, k_f):
    n, m = G.shape[:2]
    i0 = np.clip(np.floor(i_f).astype(int), 0, n - 2)
    k0 = np.clip(np.floor(k_f).astype(int), 0, m - 2)
    fi = np.clip(i_f - i0, 0, 1)
    fk = np.clip(k_f - k0, 0, 1)
    if G.ndim == 3:
        fi, fk = fi[..., None], fk[..., None]
    return (
        G[i0, k0] * (1 - fi) * (1 - fk)
        + G[i0 + 1, k0] * fi * (1 - fk)
        + G[i0, k0 + 1] * (1 - fi) * fk
        + G[i0 + 1, k0 + 1] * fi * fk
    )


# ---------------------------------------------------------------- region map


def _in_poly(x, y, poly):
    poly = np.asarray(poly, float)
    inside = np.zeros(x.shape, dtype=bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cross = ((yi > y) != (yj > y)) & (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi)
        inside ^= cross
        j = i
    return inside


def photo_hsv(Px, Py):
    img = bt.load_image(os.path.join(bt.PHOTOS, bs.SIDE_PHOTO))
    a = bt.image_np(img)[::-1, :, :3].astype(np.float64)
    # light blur (feather noise) by 3x3 box twice
    for _ in range(2):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0)) / 3
        a = (a + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 3
    x, y = Px * 2.0, Py * 2.0
    h, w = a.shape[:2]
    x = np.clip(x, 0, w - 1.001)
    y = np.clip(y, 0, h - 1.001)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    fx, fy = (x - x0)[..., None], (y - y0)[..., None]
    rgb = (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x0 + 1] * fx * (1 - fy) + a[y0 + 1, x0] * (1 - fx) * fy + a[y0 + 1, x0 + 1] * fx * fy)
    mx, mn = rgb.max(-1), rgb.min(-1)
    dd = mx - mn + 1e-9
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4)) * 60.0
    sat = np.where(mx > 0, dd / (mx + 1e-9), 0)
    return hue, sat, mx, rgb


def _curve(x, pts):
    p = np.asarray(pts, float)
    return np.interp(x, p[:, 0], p[:, 1])


def _in_stripe(Px, Py, pts):
    """Inside a variable-width stripe given as (x, y, half-width) polyline."""
    p = np.asarray(pts, float)
    best = np.full(Px.shape, np.inf)
    hw = np.zeros(Px.shape)
    for (x0, y0, w0), (x1, y1, w1) in zip(p[:-1], p[1:]):
        ex, ey = x1 - x0, y1 - y0
        t = np.clip(((Px - x0) * ex + (Py - y0) * ey) / (ex * ex + ey * ey), 0, 1)
        dist = np.hypot(Px - (x0 + t * ex), Py - (y0 + t * ey))
        closer = dist < best
        best = np.where(closer, dist, best)
        hw = np.where(closer, w0 + (w1 - w0) * t, hw)
    return best < hw


def region_map(Px, Py, U):
    """Plumage regions from the measured photo geometry (no photo pixels are used)."""
    cls = np.full(Px.shape, BELLY, dtype=np.int32)
    cls[U > 0.55] = FLANK
    cls[(U > 0.72) & (Px > 300)] = UPPER
    head = (Px < 350) & (Py < 170) & ~((Px > 290) & (U > 0.7) & (Py > _curve(Px, CROWN_BOT) + 22))
    cls[head & (Py < 165)] = CHEEK
    x0, y0, x1, y1 = COLLAR
    collar = (Px > x0) & (Px < x1) & (Py > _curve(Px, CROWN_BOT)) & (Py < y1 + 0.25 * (Px - x0)) & (U < 0.97)
    cls[collar] = WHITEBAND
    cls[head & (Px > 305) & ~collar] = FLANK  # breast side behind the cheek
    cls[(Px < 350) & (Py <= _curve(Px, CROWN_BOT))] = CROWN
    # crown ends at the hind-crown; the white collar crosses the nape (rear34_laitche, front34_halun: an
    # almost complete white ring between the chestnut crown and the streaked mantle)
    cls[(Px >= NAPE_X[0]) & (Px < NAPE_X[1]) & (U > 0.78) & (Py < 140)] = WHITEBAND
    cls[_in_poly(Px, Py, LORES_POLY) & (U < 0.95)] = LORES
    # forehead / lores right up to the bill base (the rows in front of the face line are the bill-base cap: no white there)
    cls[(Px < 204) & (Py > _curve(Px, CROWN_BOT)) & (Py <= 106) & (U < 0.95)] = LORES
    cls[(Px < 200) & (Py > 104) & (Py < 132) & (U < 0.95)] = BLACK
    cls[(Px < 204) & (Py <= 106) & (U >= 0.95)] = CROWN  # forehead midline: chestnut right down to the bill
    ex, ey = bs.EYE_PX
    cls[np.hypot(Px - ex, Py - ey) < EYELID_R] = LORES
    (sx, sy), (rx, ry) = EARSPOT
    cls[(((Px - sx) / rx) ** 2 + ((Py - sy) / ry) ** 2 < 1.0) & (U > 0.15)] = SPOT
    cls[_in_poly(Px, Py, BIB_POLY) & (U < 0.5)] = BLACK
    cls[(U < 0.12) & (Px < 232) & (Py > 104) & (Py < 160)] = BLACK  # bib meets in the midline
    cls[(Px < 201) & (Py > 104) & (Py < 132) & (U < 0.5)] = BLACK  # chin skin under the lower-bill base: black bib up to the bill
    under_wing = _in_poly(Px, Py, WING_POLY)
    cls[under_wing & (U < 0.62) & (cls != BLACK)] = FLANK
    cls[under_wing & (U >= 0.62)] = UPPER
    cls[(Px > 410) & (U < 0.45)] = UNDERTAIL
    cls[(U > 0.9) & (Px > 340)] = UPPER
    return cls, photo_hsv(Px, Py)[3]


def _box(a, r, axis):
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    cs = np.cumsum(np.pad(a, pad, mode="reflect"), axis=axis)
    n = a.shape[axis]
    return (np.take(cs, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis) - np.take(cs, np.arange(n), axis=axis)) / (2 * r + 1)


def blur(a, r_rows, r_cols, passes=3):
    """Near-Gaussian blur (sigma ~ r); reflect padding is right at both midlines of the mirrored UVs."""
    for _ in range(passes):
        a = _box(_box(a, r_rows, 0), r_cols, 1)
    return a


def flow_noise(shape, along, across, seed):
    """Unit-variance noise smeared `along` texels down the rows (the feather flow): barb strands."""
    rng = np.random.default_rng(seed)
    n = blur(rng.random(shape), along, across, passes=2)
    return (n - n.mean()) / (n.std() + 1e-9)


def majority(cls, radius):
    """Box-window mode filter over class ids."""
    best = np.zeros(cls.shape, dtype=np.float32)
    out = cls.copy()
    k = 2 * radius + 1
    for c in range(NCLS):
        m = (cls == c).astype(np.float32)
        cs = np.cumsum(np.cumsum(np.pad(m, ((radius + 1, radius), (radius + 1, radius)), mode="edge"), 0), 1)
        cnt = cs[k:, k:] - cs[:-k, k:] - cs[k:, :-k] + cs[:-k, :-k]
        better = cnt > best
        out[better] = c
        best = np.maximum(best, cnt)
    return out


# ---------------------------------------------------------------- feathers


def _hash(r, c, seed):
    x = np.sin(r * 127.1 + c * 311.7 + seed * 74.7) * 43758.5453123
    return x - np.floor(x)


def _profile(a):
    a = np.clip(a, 0, 1)
    rise = 0.45 + 0.55 * np.sin(np.minimum(a / 0.55, 1.0) * np.pi / 2)
    tip = np.sqrt(np.clip(1 - ((a - 0.55) / 0.45) ** 2, 0, 1))
    return np.where(a <= 0.55, rise, tip)


def visible_feather(qu, qv):
    """Most forward feather covering each texel: returns root (ru, rv), local a, b, ids, size."""
    H, W = qu.shape
    found = np.zeros((H, W), dtype=bool)
    out = {k: np.zeros((H, W), np.float64) for k in ("ru", "rv", "a", "b", "s", "r", "c")}
    base_r = np.floor(qv)
    for dr in (-2, -1, 0):
        r = base_r + dr
        off = 0.5 * np.mod(r, 2)
        for dc in (0, 1):
            c = np.floor(qu - off) + dc
            ju = (_hash(r, c, 1) - 0.5) * 0.36
            jv = (_hash(r, c, 2) - 0.5) * 0.30
            s = 0.9 + 0.2 * _hash(r, c, 3)
            ru, rv = c + off + ju, r + jv
            a = (qv - rv) / (F_LEN * s)
            b = (qu - ru) / (F_HALFW * s)
            cov = (a >= 0) & (a <= 1) & (np.abs(b) <= _profile(a)) & ~found
            for k, val in (("ru", ru), ("rv", rv), ("a", a), ("b", b), ("s", s), ("r", r), ("c", c)):
                out[k][cov] = val[cov]
            found |= cov
    # rare gaps: treat as the base of the current row's feather
    gap = ~found
    if gap.any():
        r = base_r[gap]
        off = 0.5 * np.mod(r, 2)
        c = np.round(qu[gap] - off)
        out["ru"][gap], out["rv"][gap] = c + off, r
        out["a"][gap] = np.clip(qv[gap] - r, 0, 1) * 0.3
        out["b"][gap] = 0.0
        out["s"][gap] = 1.0
        out["r"][gap], out["c"][gap] = r, c
    return out, float(gap.mean())


def build_textures():
    P3, Ppx, vcoord, seg, n = body_grid()
    qu_g, qv_g, su_g, sv_g, d_g = lattice(P3, n, seg)
    k_f, i_f = texel_coords(vcoord, n, seg)
    U = k_f / seg
    Px = sample_grid(Ppx[..., 0], i_f, k_f)
    Py = sample_grid(Ppx[..., 1], i_f, k_f)
    qu = sample_grid(qu_g, i_f, k_f)
    qv = sample_grid(qv_g, i_f, k_f)
    su = sample_grid(su_g, i_f, k_f)
    sv = sample_grid(sv_g, i_f, k_f)
    dmm = sample_grid(d_g, i_f, k_f)

    cls_px, photo_rgb = region_map(Px, Py, U)

    fv, gap = visible_feather(qu, qv)
    a, b, s = fv["a"], fv["b"], fv["s"]
    # Barb strands: noise drawn out along the feather flow (texture rows), short on the face, long on
    # the body. Region borders fray the same way: each texel looks its class up a strand-dependent
    # distance up/down the flow, so edges come out fibrous like real plumage (no per-feather steps).
    mm_row = np.abs(np.gradient(sv, axis=0)) + 1e-6
    mm_col = np.abs(np.gradient(su, axis=1)) + 1e-6
    wc = bt.smoothstep(0.9, 2.8, dmm)
    strand = flow_noise((TEX_H, TEX_W), 9, 0, 31) * (1 - wc) + flow_noise((TEX_H, TEX_W), 26, 1, 32) * wc
    fray = FRAY_MM * dmm
    rows = np.clip(np.arange(TEX_H)[:, None] + np.tanh(flow_noise((TEX_H, TEX_W), 20, 1, 33)) * fray / mm_row, 0, TEX_H - 1)
    cols = np.clip(np.arange(TEX_W)[None, :] + np.tanh(flow_noise((TEX_H, TEX_W), 14, 2, 34)) * 0.35 * fray / mm_col, 0, TEX_W - 1)
    ri, ci = np.round(rows).astype(int), np.round(cols).astype(int)
    cls = cls_px[ri, ci]
    # head / collar: each feather wears the class found at its own visible centre, so the borders of the white cheek,
    # collar, black bib and chestnut crown are scalloped by individual feather tips (not brush-like streaks)
    head_w = 1.0 - bt.smoothstep(HEAD_DMM[0], HEAD_DMM[1], dmm)
    gq_c = np.gradient(qu, axis=1); gq_r = np.gradient(qv, axis=0)
    gq_c = np.where(np.abs(gq_c) < 1e-4, 1e-4, gq_c); gq_r = np.where(np.abs(gq_r) < 1e-4, 1e-4, gq_r)
    d_col = 0.4 * np.clip((fv["ru"] - qu) / gq_c, -14, 14)
    d_row = 0.4 * np.clip((fv["rv"] + 0.62 * F_LEN * s - qv) / gq_r, -22, 22)
    fray_h = 0.10 * dmm
    jr = np.tanh(flow_noise((TEX_H, TEX_W), 3, 2, 35)) * fray_h / mm_row
    jc = np.tanh(flow_noise((TEX_H, TEX_W), 2, 3, 36)) * fray_h / mm_col
    ri_h = np.clip(np.round(np.arange(TEX_H)[:, None] + d_row + jr), 0, TEX_H - 1).astype(int)
    ci_h = np.clip(np.round(np.arange(TEX_W)[None, :] + d_col + jc), 0, TEX_W - 1).astype(int)
    cls_h = cls_px[ri_h, ci_h]
    use_h = head_w > 0.5
    # eye ring / black ear spot / lores keep their measured outlines
    cls = np.where(use_h, cls_h, cls)
    ri = np.where(use_h, ri_h, ri); ci = np.where(use_h, ci_h, ci)

    pal = np.array([PALETTE[c] for c in range(NCLS)])
    # belly -> flank -> upperparts grade into each other; the throat bands and head marks stay crisp
    soft_cls = np.isin(np.arange(NCLS), SOFT_CLASSES)
    m = soft_cls[cls_px].astype(np.float64)
    r_rows, r_cols = int(SOFT_MM / 0.065), int(SOFT_MM / 0.045)
    soft = blur(pal[cls_px] * m[..., None], r_rows, r_cols) / np.maximum(blur(m, r_rows, r_cols), 1e-6)[..., None]
    base = np.where(soft_cls[cls][..., None], soft[ri, ci], pal[cls])
    fid_r, fid_c = fv["r"], fv["c"]
    kvar = np.where(np.isin(cls, (FLANK, BELLY, UNDERTAIL)), 0.25, 1.0)  # body: soft down, not visible per-feather patches
    kvar = kvar * (1.0 + 0.7 * head_w)  # head: individually different feathers
    tint = 1.0 + 0.05 * kvar * (_hash(fid_r, fid_c, 7) - 0.5)
    warm = 0.02 * kvar * (_hash(fid_r, fid_c, 8) - 0.5) * (1.0 - 0.7 * head_w)
    col = base * tint[..., None]
    col += (0.008 * head_w * (_hash(fid_r, fid_c, 11) - 0.5))[..., None]  # dark feathers differ in absolute terms too
    col[..., 0] += warm
    col[..., 2] -= warm

    # local feather frame in mm
    x_b = b * F_HALFW * s * dmm  # lateral, from rachis
    prof = _profile(a)
    margin = (prof - np.abs(b)) * F_HALFW * s * dmm  # mm to the side edge
    tipd = (1 - a) * F_LEN * s * dmm  # mm to the tip
    edge = np.minimum(margin, tipd * 0.6)

    vis = bt.smoothstep(0.22, 0.8, a)
    contrast = np.array([SCALE_CONTRAST.get(c, DEFAULT_CONTRAST) for c in range(NCLS)])[cls]
    shade = 1.0 - contrast * (1.0 - vis)
    fr = np.array([FRINGE.get(c, 0.0) for c in range(NCLS)])[cls]
    fringe = (1 - bt.smoothstep(0.02, 0.22 + 0.05 * dmm, edge)) * fr
    col = col * shade[..., None] + fringe[..., None] * (1 - col) * 0.9

    strand_h = flow_noise((TEX_H, TEX_W), 4, 1, 37)  # short wispy barbs on the head (no long parallel hair lines)
    strand = strand * (1 - head_w) + strand_h * head_w
    st = np.tanh(strand)
    k_st = np.array([STREAK.get(c, DEFAULT_STREAK) for c in range(NCLS)])[cls]
    col *= (1 + k_st * st)[..., None]
    k_pale = np.array([PALE_STRANDS.get(c, 0.0) for c in range(NCLS)])[cls]
    col += (k_pale * bt.smoothstep(0.9, 2.1, strand))[..., None] * (1 - col)
    spec = [SPECKLE.get(c, (0.0, (0.0, 0.0, 0.0), 1.0, 1.0)) for c in range(NCLS)]
    r_in = np.array([(s_[4] if len(s_) > 4 else SPECKLE_R_MM)[0] for s_ in spec])[cls]
    r_out = np.array([(s_[4] if len(s_) > 4 else SPECKLE_R_MM)[1] for s_ in spec])[cls]
    sp_p = np.array([s_[0] for s_ in spec])[cls]
    sp_c = np.array([s_[1] for s_ in spec])[cls]
    cell = np.array([s_[2] for s_ in spec])[cls]
    stretch = np.array([s_[3] for s_ in spec])[cls]
    cu, cv = su / cell, sv / (cell * stretch)
    iu, iv = np.floor(cu), np.floor(cv)
    du = cu - iu - (0.2 + 0.6 * _hash(iu, iv, 21))
    dv = cv - iv - (0.2 + 0.6 * _hash(iu, iv, 22))
    d_mm = np.hypot(du * cell, dv * cell)
    spot = (1 - np.clip((d_mm - r_in) / np.maximum(r_out - r_in, 1e-6), 0, 1)) * (_hash(iu, iv, 23) < sp_p)
    spot = spot * (1 - (cls == UPPER) * bt.smoothstep(RUMP_PLAIN_X - 25.0, RUMP_PLAIN_X, Px))  # rump: plain grey-brown
    col = col * (1 - spot[..., None]) + sp_c * spot[..., None]
    shaft_w = 0.03 + 0.015 * dmm
    sd = np.array([SHAFT_DARK.get(c, 0.0) for c in range(NCLS)])[cls]
    shaft = (1 - bt.smoothstep(shaft_w * 0.5, shaft_w * 2.2, np.abs(x_b))) * vis
    col *= (1 - shaft * (0.06 + sd))[..., None]
    col = np.clip(col, 0, 1)

    # height (mm) and normals
    dome = np.sqrt(np.clip(1 - (b / np.maximum(prof, 1e-3)) ** 2, 0, 1))
    tip_roll = 1.0 - 0.6 * bt.smoothstep(0.72, 1.0, a)  # tips lie down onto the feather below
    kh = np.where(np.isin(cls, (FLANK, BELLY, UNDERTAIL)), 0.3, 1.0) * (1.0 + 1.5 * head_w)  # soft down: no per-feather relief shading on the belly/flank
    Hmm = 0.045 * dmm / 3.0 * kh * bt.smoothstep(0.15, 1.0, a) * tip_roll * (0.55 + 0.45 * dome) + 0.010 * st * (0.4 + 0.2 * dmm) * (1.0 - 0.75 * head_w)
    dsu = np.gradient(su, axis=1)
    dsv = np.gradient(sv, axis=0)
    dHu = np.gradient(Hmm, axis=1) / np.where(np.abs(dsu) < 1e-6, 1e-6, dsu)
    dHv = np.gradient(Hmm, axis=0) / np.where(np.abs(dsv) < 1e-6, 1e-6, dsv)
    nrm = np.stack([-dHu, -dHv, np.ones_like(dHu)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)

    rough = np.array([ROUGH.get(c, 0.66) for c in range(NCLS)])[cls]
    rough = np.clip(rough + 0.08 * fringe + 0.04 * (_hash(fid_r, fid_c, 9) - 0.5), 0.3, 0.9)

    return {
        "color": col.astype(np.float32),
        "normal": (nrm * 0.5 + 0.5).astype(np.float32),
        "rough": rough.astype(np.float32),
        "cls_px": cls_px,
        "cls": cls,
        "photo": photo_rgb.astype(np.float32),
        "gap": gap,
    }


def save_textures(tx):
    col = bt.np_image(tx["color"], "SP_Body_Color", path=os.path.join(bt.TEX, "body_color.png"))
    nrm = bt.np_image(tx["normal"], "SP_Body_Normal", path=os.path.join(bt.TEX, "body_normal.png"), colorspace="Non-Color")
    r = tx["rough"]
    orm = np.stack([np.ones_like(r), r, np.zeros_like(r)], -1)
    rgh = bt.np_image(orm, "SP_Body_ORM", path=os.path.join(bt.TEX, "body_orm.png"), colorspace="Non-Color")
    # debug: class map + photo sample side by side (half size)
    pal = np.array([PALETTE[c] for c in range(NCLS)])
    dbg = np.concatenate([pal[tx["cls_px"]][::2, ::2], tx["photo"][::2, ::2], tx["color"][::2, ::2]], axis=1)
    bt.np_image(dbg, "dbg_body_regions", path=os.path.join(DEBUG, "body_regions.png"))
    return col, nrm, rgh


def body_material(col, nrm, orm):
    mat, nt, bsdf = bt.new_material("SP_Body_Plumage")
    c = bt.tex_node(nt, col, (-700, 250))
    nt.links.new(c.outputs["Color"], bt.sock(bsdf, "Base Color"))
    o = bt.tex_node(nt, orm, (-700, -50), non_color=True)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-400, -50)
    nt.links.new(o.outputs["Color"], sep.inputs[0])
    nt.links.new(sep.outputs[1], bt.sock(bsdf, "Roughness"))
    n = bt.tex_node(nt, nrm, (-700, -350), non_color=True)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.location = (-400, -350)
    nm.inputs["Strength"].default_value = 1.0
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bt.sock(bsdf, "Normal"))
    bt.sock(bsdf, "Specular IOR Level").default_value = 0.22  # higher reads as grey frosting at grazing angles
    bt.sock(bsdf, "Sheen Weight").default_value = 0.07
    bt.sock(bsdf, "Sheen Roughness").default_value = 0.5
    bt.sock(bsdf, "Sheen Tint").default_value = (0.62, 0.57, 0.52, 1)
    mat.use_backface_culling = True
    return mat


def run():
    tx = build_textures()
    col, nrm, orm = save_textures(tx)
    mat = body_material(col, nrm, orm)
    bt.assign(bpy.data.objects["SP_Body"], mat)
    np.save(os.path.join(sb.BUILD, "plumage_cls.npy"), tx["cls"].astype(np.uint8))  # row 0 = v 0
    return "plumage textures %dx%d written, lattice gaps %.4f" % (TEX_W, TEX_H, tx["gap"])
