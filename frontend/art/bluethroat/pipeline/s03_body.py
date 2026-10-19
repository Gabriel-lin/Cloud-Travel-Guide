"""Step 3: head + body as one continuous mesh, inflated from the traced side silhouette.

Shape: along each slice (ventral point V -> dorsal point D on the outline) the half-width is
    hx(P) = Wt(P) * (1 - (1 - d(P)/dmax)^n)^(1/n)
where d is the distance from P to the smoothed outline curve (bill/tail cut segments excluded),
dmax the largest d on that slice, and Wt a smooth half-width field anchored at measured widths.
The side view therefore matches the photo exactly and every cross-section is rounded and smooth.

Topology: rings along the slices, cosine-spaced half rings. UVs mirrored left/right:
u = 0 ventral midline .. 1 dorsal midline, v = 0 bill end .. 1 tail end.
"""
import math
import os

import numpy as np

import btlib as bt
import btshape as bs
import photo_trace as tt

BUILD = bt.BUILD
DEBUG = bt.DEBUG

SEG = 32  # samples per half ring (k = 0 ventral .. SEG dorsal)
PROFILE_N = 2.2

BILL_CUT = ((257.0, 81.0), (249.0, 93.0))  # keeps a ~2 mm bill stub that the bill mesh covers
TAIL_CUT = ((462.0, 252.0), (442.0, 283.0))
CENTRE = (315.0, 165.0)

# Landmarks (half-res px). Pairs define slice orientation; first/last pairs come from the cut lines.
DORSAL = [
    None, (266, 82), (278, 80), (292, 80), (306, 82), (319, 89), (331, 101),
    (341, 127), (352, 152), (375, 172), (400, 198), (424, 222), (446, 243), None,
]
VENTRAL = [
    None, (250, 104), (250, 118), (250, 132), (251, 147), (253, 165), (257, 182),
    (264, 205), (282, 233), (312, 259), (345, 272), (378, 271), (412, 269), None,
]
RINGS_PER_GAP = [3, 4, 5, 5, 5, 5, 6, 6, 7, 7, 7, 6, 5]

# Per landmark ring: max half-width (mm), dorsal / ventral roundness exponents (lower = more tapered).
RING_WIDTH = [1.9, 4.8, 7.2, 8.6, 9.0, 9.2, 9.9, 11.0, 12.6, 13.6, 14.0, 13.0, 10.0, 6.0]
RING_ND = [2.0, 2.1, 2.1, 2.2, 2.2, 2.2, 2.2, 2.3, 2.3, 2.3, 2.3, 2.2, 2.1, 2.0]
RING_NV = [1.9, 1.85, 1.85, 1.85, 1.9, 1.95, 2.05, 2.2, 2.2, 2.2, 2.2, 2.1, 2.0, 2.0]
TMED_SMOOTH = 2.5  # rings: gaussian smoothing of each ring's widest-point position
DORSAL_SHRINK = 4.0
VENT_FILL = [(372, 273), (390, 272.5), (405, 271), (420, 272.5)]  # smooth belly->vent line over the leg notch


def _side(p, a, b):
    return (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])


def body_mask():
    a, m = tt.segment(bs.SIDE_PHOTO, min_sat=0.33, crop=(0, 352, 0, 640), seed=(220, 313))
    h, w = m.shape
    yy, xx = np.mgrid[0:h, 0:w]
    m &= ~((xx > 392) & (xx < 505) & (yy > 283 + (xx - 392) * 0.52))  # bokeh under the tail
    m &= ~((xx > 333) & (xx < 398) & (yy > 273))  # leg
    s_tip = np.sign(_side((238.0, 83.0), *BILL_CUT))
    m &= ~((np.sign(_side((xx, yy), *BILL_CUT)) == s_tip) & (xx < 262) & (yy < 100))
    s_tail = np.sign(_side((530.0, 328.0), *TAIL_CUT))
    m &= ~((np.sign(_side((xx, yy), *TAIL_CUT)) == s_tail) & (xx > 425))
    m = tt.largest_component(m, (220, 313))
    fx = np.array([p[0] for p in VENT_FILL], float)
    fy = np.array([p[1] for p in VENT_FILL], float)
    for x in range(int(fx[0]), int(fx[-1]) + 1):
        col = np.nonzero(m[:, x])[0]
        if len(col):
            m[col[-1] : int(round(np.interp(x, fx, fy))) + 1, x] = True
    for x in range(346, w):
        col = np.nonzero(m[:, x])[0]
        if len(col) == 0:
            continue
        k = int(round(DORSAL_SHRINK * min(1.0, (x - 345) / 25.0)))
        if k > 0 and len(col) > 2 * k + 4:
            m[col[0] : col[0] + k, x] = False
    return a, m


def radial_contour(mask, centre=CENTRE, n=3000, sigma=9.0):
    cx, cy = centre
    h, w = mask.shape
    rs = np.arange(0.0, 420.0, 0.2)
    pts = np.zeros((n, 2))
    for k in range(n):
        ang = 2 * math.pi * k / n
        xs = cx + rs * math.cos(ang)
        ys = cy + rs * math.sin(ang)
        ok = (xs >= 0) & (xs < w - 1) & (ys >= 0) & (ys < h - 1)
        inside = np.zeros_like(rs, dtype=bool)
        inside[ok] = mask[np.round(ys[ok]).astype(int), np.round(xs[ok]).astype(int)]
        idx = np.nonzero(inside)[0]
        r = rs[idx.max()] if len(idx) else 0.0
        pts[k] = (cx + r * math.cos(ang), cy + r * math.sin(ang))
    rad = int(3 * sigma)
    ks = np.arange(-rad, rad + 1)
    ker = np.exp(-0.5 * (ks / sigma) ** 2)
    ker /= ker.sum()
    sm = np.zeros_like(pts)
    for o, kw in zip(ks, ker):
        sm += np.roll(pts, o, axis=0) * kw
    return sm


def _closest_index(poly, p):
    return int(np.argmin(np.linalg.norm(poly - np.asarray(p, float), axis=1)))


def _seg_dist(points, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    e = b - a
    t = np.clip(((points - a) @ e) / (e @ e), 0, 1)
    return np.linalg.norm(points - (a + t[:, None] * e), axis=1)


def outline_parts(contour):
    """Split the closed contour into dorsal rail, ventral rail and the 'real' outline (no cut parts)."""
    near_bill = _seg_dist(contour, *BILL_CUT) < 1.6
    near_tail = _seg_dist(contour, *TAIL_CUT) < 1.6
    real = contour[~(near_bill | near_tail)]
    n = len(contour)
    # cut corners: contour points nearest to each cut line end
    b_top, b_bot = _closest_index(contour, BILL_CUT[0]), _closest_index(contour, BILL_CUT[1])
    t_top, t_bot = _closest_index(contour, TAIL_CUT[0]), _closest_index(contour, TAIL_CUT[1])
    crown = _closest_index(contour, (292, 80))
    belly = _closest_index(contour, (345, 272))

    def path(i0, i1, via):
        fwd = [(i0 + k) % n for k in range(((i1 - i0) % n) + 1)]
        if via in fwd:
            return fwd
        return [(i0 - k) % n for k in range(((i0 - i1) % n) + 1)]

    dors = smooth_rail(contour[path(b_top, t_top, crown)])
    vent = smooth_rail(contour[path(b_bot, t_bot, belly)])
    return dors, vent, np.vstack([dors, vent])


RAIL_SIGMA_PX = 6.0  # ~2 mm: removes segmentation steps at the breast colour bands


def smooth_rail(rail, sigma=RAIL_SIGMA_PX):
    """Gaussian-smooth an open polyline at 1 px spacing, keeping both end points fixed."""
    r = bt.resample(rail, max(int(bt.arclength(rail)[-1]), 8))
    rad = int(3 * sigma)
    pad = np.vstack([2 * r[0] - r[rad:0:-1], r, 2 * r[-1] - r[-2 : -rad - 2 : -1]])
    ks = np.arange(-rad, rad + 1)
    ker = np.exp(-0.5 * (ks / sigma) ** 2)
    ker /= ker.sum()
    out = np.stack([np.convolve(pad[:, k], ker, mode="valid") for k in range(2)], 1)
    out[0], out[-1] = r[0], r[-1]
    return out


def _rail_params(rail, landmarks):
    """Arc-length fraction of each landmark projected onto the rail (None -> rail end)."""
    s = bt.arclength(rail)
    out = []
    for i, p in enumerate(landmarks):
        if p is None:
            out.append(0.0 if i == 0 else 1.0)
        else:
            out.append(s[_closest_index(rail, p)] / s[-1])
    return np.array(out)


def slices(dors, vent):
    """Ring end points: landmark rail positions interpolated smoothly (C1) over the ring index."""
    pd = _rail_params(dors, DORSAL)
    pv = _rail_params(vent, VENTRAL)
    D = bt.sample_at(dors, np.clip(ring_values(pd), 0, 1))
    V = bt.sample_at(vent, np.clip(ring_values(pv), 0, 1))
    return np.stack([V, D], 1)


def ring_values(values):
    """Landmark values -> one value per ring, Catmull-Rom over the landmark index (no flat spots)."""
    lm = np.concatenate([[0], np.cumsum(RINGS_PER_GAP)]).astype(float)
    pts = np.stack([lm, np.asarray(values, float)], 1)
    curve = bt.catmull_rom(pts, samples_per_seg=200)
    ring_idx = np.arange(int(lm[-1]) + 1, dtype=float)
    return np.interp(ring_idx, curve[:, 0], curve[:, 1])


def dist_to_outline(P, real):
    out = np.empty(len(P))
    for s in range(0, len(P), 2000):
        q = P[s : s + 2000]
        out[s : s + 2000] = np.sqrt(((q[:, None, :] - real[None, :, :]) ** 2).sum(-1)).min(1)
    return out


def medial_positions(sl, real):
    """Per slice: fraction along V->D of the point farthest from the outline (centroid of the top band)."""
    dense_t = np.linspace(0, 1, 241)
    out = []
    for V, D in sl:
        Pd = V[None] + (D - V)[None] * dense_t[:, None]
        dd = dist_to_outline(Pd, real)
        wgt = np.clip(dd - 0.9 * dd.max(), 0, None)
        out.append(float((dense_t * wgt).sum() / max(wgt.sum(), 1e-9)))
    out = np.array(out)
    ks = np.arange(-8, 9)
    ker = np.exp(-0.5 * (ks / TMED_SMOOTH) ** 2)
    pad = np.concatenate([np.full(8, out[0]), out, np.full(8, out[-1])])
    return np.convolve(pad, ker / ker.sum(), mode="valid")


def ring_halfwidths(t, t_med, width, nd, nv):
    """Piecewise superellipse across the slice: ventral side (t < t_med) and dorsal side."""
    lo = np.clip((t_med - t) / max(t_med, 1e-6), 0, 1)
    hi = np.clip((t - t_med) / max(1 - t_med, 1e-6), 0, 1)
    pv = (1.0 - lo**nv) ** (1.0 / nv)
    pd = (1.0 - hi**nd) ** (1.0 / nd)
    return width * np.where(t < t_med, pv, pd)


def debug_plot(photo, mask, contour, sl, name="body_slices.png"):
    img = photo.copy()
    img[~mask] *= 0.45

    def dot(x, y, col):
        xi, yi = int(round(x)), int(round(y))
        if 0 <= yi < img.shape[0] and 0 <= xi < img.shape[1]:
            img[yi, xi] = col

    for p in contour:
        dot(p[0], p[1], (0.1, 1.0, 0.2))
    for V, D in sl:
        for f in np.linspace(0, 1, 120):
            q = V + (D - V) * f
            dot(q[0], q[1], (1.0, 0.15, 0.1))
    big = np.repeat(np.repeat(img, 2, 0), 2, 1)
    bt.np_image(big[::-1], "dbg_body_slices", path=os.path.join(DEBUG, name))


def build():
    photo, mask = body_mask()
    contour = radial_contour(mask)
    dors, vent, real = outline_parts(contour)
    sl = slices(dors, vent)
    debug_plot(photo, mask, contour, sl)
    n = len(sl)
    t = (1 - np.cos(np.pi * np.arange(SEG + 1) / SEG)) / 2
    widths, nds, nvs = ring_values(RING_WIDTH), ring_values(RING_ND), ring_values(RING_NV)
    tmed = medial_positions(sl, real)
    rings = []
    for i in range(n):
        V, D = sl[i]
        P = V[None] + (D - V)[None] * t[:, None]
        w_mm = ring_halfwidths(t, tmed[i], widths[i], nds[i], nvs[i])
        w_mm[0] = w_mm[-1] = 0.0
        y, z = bs.half_to_bl(P[:, 0], P[:, 1])
        rings.append(np.stack([-w_mm * bt.MM, y, z], 1))

    loop = 2 * SEG
    verts, uv_u = [], []
    for r in rings:
        left = r[1:SEG][::-1].copy()
        left[:, 0] *= -1
        verts.append(np.vstack([r, left]))
        uv_u.append(np.concatenate([np.arange(SEG + 1) / SEG, np.arange(SEG - 1, 0, -1) / SEG]))
    verts = np.vstack(verts)
    centres = np.array([(r[0] + r[SEG]) / 2 for r in rings])
    sv = bt.arclength(centres)
    vcoord = 0.004 + 0.992 * sv / sv[-1]

    faces, uvs = [], []
    for i in range(n - 1):
        for k in range(loop):
            a = i * loop + k
            b = i * loop + (k + 1) % loop
            c = (i + 1) * loop + (k + 1) % loop
            dd = (i + 1) * loop + k
            faces.append((a, b, c, dd))
            ua, ub = uv_u[i][k], uv_u[i][(k + 1) % loop]
            uvs += [(ua, vcoord[i]), (ub, vcoord[i]), (ub, vcoord[i + 1]), (ua, vcoord[i + 1])]

    cap_verts = []

    def cap(ring_idx, outward, dome_mm, flip):
        base = ring_idx * loop
        c = verts[base : base + loop].mean(0) + outward * dome_mm * bt.MM
        ci = len(verts) + len(cap_verts)
        cap_verts.append(c)
        vc = 0.0 if ring_idx == 0 else 1.0
        vr = vcoord[ring_idx]
        for k in range(loop):
            a, b = base + k, base + (k + 1) % loop
            ua, ub = uv_u[ring_idx][k], uv_u[ring_idx][(k + 1) % loop]
            if flip:
                faces.append((ci, b, a))
                uvs.extend([(0.5, vc), (ub, vr), (ua, vr)])
            else:
                faces.append((ci, a, b))
                uvs.extend([(0.5, vc), (ua, vr), (ub, vr)])

    fwd = centres[0] - centres[1]
    fwd /= np.linalg.norm(fwd)
    back = centres[-1] - centres[-2]
    back /= np.linalg.norm(back)
    cap(0, fwd, 0.5, True)
    cap(n - 1, back, 1.0, False)
    verts = np.vstack([verts, np.array(cap_verts)])

    ob = bt.mesh_object("BT_Body", verts, faces, uvs=np.array(uvs))
    np.savez(os.path.join(BUILD, "body_field.npz"), mask=mask, contour=contour, slices=sl, vcoord=vcoord, seg=SEG, rings=n)
    return ob


def run():
    ob = build()
    bt.assign(ob, bt.material_flat("BT_Body_Clay", (0.48, 0.40, 0.33), roughness=0.75))
    me = ob.data
    return "BT_Body: %d verts, %d faces, size (mm) %s" % (
        len(me.vertices), len(me.polygons), tuple(round(v * 1000, 1) for v in ob.dimensions)
    )
