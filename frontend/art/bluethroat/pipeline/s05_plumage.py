"""Step 5: body plumage textures (base colour, normal, roughness) generated in UV space.

Every texel maps to an exact point of the traced side photo (the mesh was built from it), so:
1. Region map: photo colour classes at that point (blue bib, red spot, black / white / rufous
   necklace, supercilium, lores, crown, cheek) plus anatomical rules where the photo can't help
   (flank under the folded wing, shaded belly, undertail).
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

import btlib as bt
import btshape as bs
import s03_body as sb

TEX_W, TEX_H = 1024, 2048
DEBUG = bt.DEBUG

(UPPER, BLUE, SPOT, BLACK, WHITEBAND, RUFOUS, BELLY, FLANK, CROWN, SUPER, LORES, CHEEK, UNDERTAIL, GAPE) = range(14)
NCLS = 14

PALETTE = {  # sRGB albedo
    UPPER: (0.43, 0.365, 0.30),
    BLUE: (0.15, 0.37, 0.86),
    SPOT: (0.79, 0.37, 0.13),
    BLACK: (0.065, 0.06, 0.07),
    WHITEBAND: (0.91, 0.90, 0.86),
    RUFOUS: (0.77, 0.41, 0.16),
    BELLY: (0.91, 0.885, 0.83),
    FLANK: (0.79, 0.72, 0.61),
    CROWN: (0.27, 0.215, 0.15),
    SUPER: (0.81, 0.73, 0.57),
    LORES: (0.11, 0.095, 0.08),
    CHEEK: (0.42, 0.32, 0.21),
    UNDERTAIL: (0.89, 0.85, 0.76),
    GAPE: (0.86, 0.66, 0.16),
}
# Small-passerine body feathers read as a near-continuous surface: outlines only show as faint
# scalloping (breast / belly fringes), so per-feather contrast stays low.
FRINGE = {UPPER: 0.035, CROWN: 0.02, CHEEK: 0.03, FLANK: 0.015, BLUE: 0.015, RUFOUS: 0.02, SPOT: 0.01}
ROUGH = {BLUE: 0.42, BLACK: 0.72, SPOT: 0.6, RUFOUS: 0.62, LORES: 0.68, GAPE: 0.4}
SHAFT_DARK = {CROWN: 0.30, CHEEK: 0.10, UPPER: 0.05}
SCALE_CONTRAST = {UPPER: 0.03, CROWN: 0.025, CHEEK: 0.02, FLANK: 0.015, RUFOUS: 0.015, SPOT: 0.012, BLUE: 0.015, BELLY: 0.012, UNDERTAIL: 0.01}
DEFAULT_CONTRAST = 0.015
# Silky barb strands along the feather flow (multiplicative +/-) and pale strands (feather bases /
# barb tips catching light), as seen on the head close-up photo.
STREAK = {UPPER: 0.10, CROWN: 0.24, CHEEK: 0.20, FLANK: 0.09, BELLY: 0.06, UNDERTAIL: 0.06, BLUE: 0.12,
          SPOT: 0.10, RUFOUS: 0.12, BLACK: 0.10, WHITEBAND: 0.05, SUPER: 0.07, LORES: 0.08}
DEFAULT_STREAK = 0.08
PALE_STRANDS = {BLUE: 0.10, RUFOUS: 0.07, SPOT: 0.06, CHEEK: 0.16, CROWN: 0.10, UPPER: 0.04, BLACK: 0.05}
FRAY_MM = 0.32  # how far (x feather size) region borders fray along the flow
# Fine flecks from barb tips, scattered on a jittered grid in surface mm (they are far smaller than the
# face feathers): (probability per cell, sRGB colour, cell mm, stretch along the feather flow).
# Pale-flecked lores, dark-flecked supercilium, buff-streaked crown and ear coverts, pale-based blue.
SPECKLE = {
    LORES: (0.55, (0.74, 0.70, 0.60), 0.36, 1.0),
    SUPER: (0.42, (0.38, 0.32, 0.24), 0.42, 1.0),
    CROWN: (0.45, (0.56, 0.48, 0.36), 0.40, 2.4),
    CHEEK: (0.40, (0.66, 0.56, 0.42), 0.42, 2.2),
    BLUE: (0.06, (0.42, 0.60, 0.95), 0.46, 3.0),
}
SPECKLE_R_MM = (0.05, 0.10)  # fleck edge (soft) radius
SOFT_CLASSES = (UPPER, FLANK, BELLY, UNDERTAIL)
SOFT_MM = 2.4  # blur radius of the soft colour transitions

# Folded wing outline on the photo (half-res px): body under it is flank / back, not wing-brown.
WING_POLY = [
    (338, 152), (326, 163), (318, 178), (322, 194), (340, 205), (365, 216), (400, 232), (425, 243),
    (448, 252), (470, 262), (482, 267), (476, 255), (452, 240), (425, 220), (398, 196), (372, 170), (352, 150),
]

# Plumage geometry measured on the side photo (half-res px). Curves are y(x) polylines.
BIB_TOP = [(248, 93.0), (262, 95.0), (283, 101.6), (293, 108.0), (300, 118.0), (303, 130.0)]  # bill / cheek edge
BIB_REAR = [(95, 286), (110, 296), (125, 301), (145, 303), (160, 297), (172, 301), (186, 310), (200, 314), (212, 306), (222, 294)]  # x(y)
SPOT_SHAPE = ((262.0, 144.5), (13.5, 8.6))  # red spot centre, radii (x, y)
BLACK_TOP = [(248, 158.5), (268, 157.5), (280, 151.5), (292, 151.5), (300, 153.0)]
BLACK_BOT = [(248, 167.0), (268, 165.0), (280, 160.5), (292, 158.5), (300, 158.0)]
WHITE_BOT = [(248, 172.0), (268, 170.5), (280, 167.5), (292, 166.5), (302, 167.0), (312, 168.0)]
RUF_BOT = [(248, 207.0), (268, 207.0), (280, 205.0), (292, 203.0), (304, 200.0), (310, 196.0), (316, 188.0)]
# Head stripes: (x, y, half width) polylines.
SUPERCILIUM = [(263, 83.6, 1.5), (275, 85.0, 2.2), (288, 86.9, 2.7), (300, 88.2, 2.9), (312, 89.6, 3.1), (324, 91.6, 2.9), (336, 94.2, 2.3)]
EYESTRIPE = [(262, 88.0, 2.0), (275, 91.2, 2.7), (291, 95.0, 2.8), (301.5, 98.25, 3.0), (311, 97.2, 1.9), (322, 98.6, 2.0), (335, 100.8, 1.7)]
GAPE_LINE = [(259, 91.9, 1.1), (266, 94.6, 1.3), (272, 97.2, 1.3), (278, 99.8, 1.1), (283, 101.5, 0.8)]  # yellow rictus under the lores
SUPER_U_MAX = 0.9  # keeps a dark crown strip between the two supercilia over the forehead
EYE_CRESCENT = (6.1, 0.5)  # pale crescent under the eye: radius, half width (half-res px)
EYELID_R = 5.6  # dark bare eyelid rim out to this radius (visible eye ~4.9 px)
U_SAMPLE_MIN, U_SAMPLE_MAX = 0.22, 0.86  # midlines sit on the photo outline: sample slightly inside

# Feather size (mm) at the body landmark rings (bill .. tail base).
FEATHER_MM = [0.7, 0.9, 1.1, 1.3, 1.5, 1.8, 2.1, 2.5, 2.9, 3.2, 3.4, 3.3, 3.0, 2.6]
F_LEN, F_HALFW = 1.75, 0.70  # feather length (lattice rows) / half width (lattice columns)


# ---------------------------------------------------------------- geometry of the UV grid


def body_grid():
    ob = bpy.data.objects["BT_Body"]
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
    cls = np.full(Px.shape, UPPER, dtype=np.int32)

    below_band = Py > _curve(Px, RUF_BOT)
    cls[below_band & (U < 0.6)] = FLANK
    cls[below_band & (U < 0.32)] = BELLY

    bib = (Py > _curve(Px, BIB_TOP)) & (Px < _curve(Py, [(y, x) for y, x in BIB_REAR])) & ~below_band
    band = np.full(Px.shape, BLUE, dtype=np.int32)
    band[Py > _curve(Px, BLACK_TOP)] = BLACK
    band[Py > _curve(Px, BLACK_BOT)] = WHITEBAND
    band[Py > _curve(Px, WHITE_BOT)] = RUFOUS
    (sx, sy), (rx, ry) = SPOT_SHAPE
    band[((Px - sx) / rx) ** 2 + ((Py - sy) / ry) ** 2 < 1.0] = SPOT
    cls[bib] = band[bib]

    head = (Py <= _curve(Px, BIB_TOP)) & (Px < 342) & (Py < 132)
    cls[head] = CHEEK
    sup_c = _curve(Px, [(x, y) for x, y, _w in SUPERCILIUM])
    cls[head & ((Py < sup_c) | (U > 0.86))] = CROWN
    cls[head & _in_stripe(Px, Py, SUPERCILIUM) & (U < SUPER_U_MAX)] = SUPER
    ex, ey = bs.EYE_PX
    r_c, w_c = EYE_CRESCENT
    ang = np.degrees(np.arctan2(Py - ey, Px - ex)) % 360
    rr = np.hypot(Px - ex, Py - ey)
    lo, hi = 20.0, 160.0  # below the eye (image y points down)
    cls[head & (np.abs(rr - r_c) < w_c) & (ang > lo) & (ang < hi)] = SUPER
    cls[head & _in_stripe(Px, Py, EYESTRIPE)] = LORES
    lores = head & (Px < 294) & (Py > sup_c + 2.0) & (Py < _curve(Px, BIB_TOP)) & ~_in_stripe(Px, Py, SUPERCILIUM)
    cls[lores] = LORES  # dark lores from the eye down to the gape
    cls[head & (rr < EYELID_R)] = LORES
    cls[_in_stripe(Px, Py, GAPE_LINE) & (Px > 257) & (U < 0.75)] = GAPE  # straddles the bib's top edge

    under_wing = _in_poly(Px, Py, WING_POLY)
    cls[under_wing & (U < 0.62)] = FLANK
    cls[under_wing & (U >= 0.62)] = UPPER
    cls[(Px > 405) & (U < 0.45)] = UNDERTAIL
    cls[(U > 0.9) & ~head] = UPPER
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

    pal = np.array([PALETTE[c] for c in range(NCLS)])
    # belly -> flank -> upperparts grade into each other; the throat bands and head marks stay crisp
    soft_cls = np.isin(np.arange(NCLS), SOFT_CLASSES)
    m = soft_cls[cls_px].astype(np.float64)
    r_rows, r_cols = int(SOFT_MM / 0.065), int(SOFT_MM / 0.045)
    soft = blur(pal[cls_px] * m[..., None], r_rows, r_cols) / np.maximum(blur(m, r_rows, r_cols), 1e-6)[..., None]
    base = np.where(soft_cls[cls][..., None], soft[ri, ci], pal[cls])
    fid_r, fid_c = fv["r"], fv["c"]
    tint = 1.0 + 0.05 * (_hash(fid_r, fid_c, 7) - 0.5)
    warm = 0.02 * (_hash(fid_r, fid_c, 8) - 0.5)
    col = base * tint[..., None]
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

    st = np.tanh(strand)
    k_st = np.array([STREAK.get(c, DEFAULT_STREAK) for c in range(NCLS)])[cls]
    col *= (1 + k_st * st)[..., None]
    k_pale = np.array([PALE_STRANDS.get(c, 0.0) for c in range(NCLS)])[cls]
    col += (k_pale * bt.smoothstep(0.9, 2.1, strand))[..., None] * (1 - col)
    spec = [SPECKLE.get(c, (0.0, (0.0, 0.0, 0.0), 1.0, 1.0)) for c in range(NCLS)]
    sp_p = np.array([s_[0] for s_ in spec])[cls]
    sp_c = np.array([s_[1] for s_ in spec])[cls]
    cell = np.array([s_[2] for s_ in spec])[cls]
    stretch = np.array([s_[3] for s_ in spec])[cls]
    cu, cv = su / cell, sv / (cell * stretch)
    iu, iv = np.floor(cu), np.floor(cv)
    du = cu - iu - (0.2 + 0.6 * _hash(iu, iv, 21))
    dv = cv - iv - (0.2 + 0.6 * _hash(iu, iv, 22))
    d_mm = np.hypot(du * cell, dv * cell)
    spot = (1 - bt.smoothstep(*SPECKLE_R_MM, d_mm)) * (_hash(iu, iv, 23) < sp_p)
    col = col * (1 - spot[..., None]) + sp_c * spot[..., None]
    shaft_w = 0.03 + 0.015 * dmm
    sd = np.array([SHAFT_DARK.get(c, 0.0) for c in range(NCLS)])[cls]
    shaft = (1 - bt.smoothstep(shaft_w * 0.5, shaft_w * 2.2, np.abs(x_b))) * vis
    col *= (1 - shaft * (0.06 + sd))[..., None]
    col = np.clip(col, 0, 1)

    # height (mm) and normals
    dome = np.sqrt(np.clip(1 - (b / np.maximum(prof, 1e-3)) ** 2, 0, 1))
    tip_roll = 1.0 - 0.6 * bt.smoothstep(0.72, 1.0, a)  # tips lie down onto the feather below
    Hmm = 0.045 * dmm / 3.0 * bt.smoothstep(0.15, 1.0, a) * tip_roll * (0.55 + 0.45 * dome) + 0.010 * st * (0.4 + 0.2 * dmm)
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
    col = bt.np_image(tx["color"], "BT_Body_Color", path=os.path.join(bt.TEX, "body_color.png"))
    nrm = bt.np_image(tx["normal"], "BT_Body_Normal", path=os.path.join(bt.TEX, "body_normal.png"), colorspace="Non-Color")
    r = tx["rough"]
    orm = np.stack([np.ones_like(r), r, np.zeros_like(r)], -1)
    rgh = bt.np_image(orm, "BT_Body_ORM", path=os.path.join(bt.TEX, "body_orm.png"), colorspace="Non-Color")
    # debug: class map + photo sample side by side (half size)
    pal = np.array([PALETTE[c] for c in range(NCLS)])
    dbg = np.concatenate([pal[tx["cls_px"]][::2, ::2], tx["photo"][::2, ::2], tx["color"][::2, ::2]], axis=1)
    bt.np_image(dbg, "dbg_body_regions", path=os.path.join(DEBUG, "body_regions.png"))
    return col, nrm, rgh


def body_material(col, nrm, orm):
    mat, nt, bsdf = bt.new_material("BT_Body_Plumage")
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
    bt.assign(bpy.data.objects["BT_Body"], mat)
    np.save(os.path.join(sb.BUILD, "plumage_cls.npy"), tx["cls"].astype(np.uint8))  # row 0 = v 0
    return "plumage textures %dx%d written, lattice gaps %.4f" % (TEX_W, TEX_H, tx["gap"])
