"""Measuring aid (inside Blender): project the folded wing and tail into the side photo's pixel frame.

Returns the same measurements that were read off sources/photos/side_profile_halun.jpg (half-res px,
see PHOTO below) so model vs photo can be compared number by number:
    import runpy; m = runpy.run_path(r"<repo>/frontend/art/sparrow/tools/measure_side.py")["measure"]()
"""
import math
import os
import sys

import bpy
import numpy as np

_PIPELINE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline")
if _PIPELINE not in sys.path:
    sys.path.insert(0, _PIPELINE)
import spshape as bs  # noqa: E402

# Read off the photo (half-res px, 640x426 frame) on a 10 px grid.
PHOTO = {
    "bend": (265.0, 190.0),  # carpal / front of the folded wing
    "wing_tip": (470.0, 275.0),
    "wing_len": 222.0,  # bend -> tip
    "wing_depth": 74.0,  # widest extent across the bend->tip axis (lesser coverts .. lower edge, mid-wing)
    "primary_proj": 16.0,  # longest tertial tip -> wing tip, along the axis
    "tail_tip": (560.0, 390.0),
    "tail_beyond_wing": 146.0,  # wing tip -> tail tip
    "tail_depth": 20.0,  # side-view thickness of the closed tail, mid-length
    "tail_angle": 51.0,  # deg below horizontal (image frame)
    "undertail_x": 495.0,  # rear end of the pale undertail coverts
}


def to_half_px(co):
    """Blender (.., Y, Z) metres -> half-res photo px (inverse of spshape.px_to_bl)."""
    co = np.asarray(co, float)
    ur = (co[:, 1] - bs.REF_BL[0]) * 1000.0
    wr = (co[:, 2] - bs.REF_BL[1]) * 1000.0
    a = math.radians(bs.TILT_DEG)
    u = ur * math.cos(a) + wr * math.sin(a)
    w = -ur * math.sin(a) + wr * math.cos(a)
    return np.stack([(bs.REF_PX[0] + u / bs.PX_MM) / 2.0, (bs.REF_PX[1] - w / bs.PX_MM) / 2.0], 1)


def _verts(name, groups=None):
    ob = bpy.data.objects[name]
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    M = np.array(ob.matrix_world)
    co = np.array([v.co[:] for v in me.vertices])
    co = co @ M[:3, :3].T + M[:3, 3]
    if groups is not None:
        idx = {ob.vertex_groups[g].index for g in groups if g in ob.vertex_groups}
        keep = [i for i, v in enumerate(ob.data.vertices) if any(e.group in idx and e.weight > 0.5 for e in v.groups)]
        co = co[keep]
    ob.evaluated_get(dg).to_mesh_clear()
    return co


def measure():
    wing = to_half_px(_verts("SP_Wing_L"))
    bend = wing[np.argmin(wing[:, 0])]
    d = np.linalg.norm(wing - bend, axis=1)
    tip = wing[np.argmax(d)]
    ax = (tip - bend) / np.linalg.norm(tip - bend)
    perp = np.array([-ax[1], ax[0]])
    depth = float(np.ptp(wing @ perp))
    ter = to_half_px(_verts("SP_Wing_L", ["S7.L", "S8.L", "S9.L"]))
    proj = float((tip - bend) @ ax - ((ter - bend) @ ax).max()) if len(ter) else float("nan")
    tail = to_half_px(_verts("SP_Tail", ["R%d.%s" % (i, s) for i in range(1, 7) for s in "LR"]))
    ttip = tail[np.argmax(tail @ np.array([0.62, 0.78]))]
    c = tail - tail.mean(0)
    _u, _s, vt = np.linalg.svd(c, full_matrices=False)
    tdir = vt[0] if vt[0] @ np.array([0.62, 0.78]) > 0 else -vt[0]
    tperp = np.array([-tdir[1], tdir[0]])
    along = c @ tdir
    mid = np.abs(along - np.percentile(along, 50)) < 0.1 * np.ptp(along)
    tdepth = float(np.ptp(c[mid] @ tperp))
    angle = math.degrees(math.atan2(tdir[1], tdir[0]))
    model = {
        "bend": tuple(np.round(bend, 1)), "wing_tip": tuple(np.round(tip, 1)),
        "wing_len": float(np.linalg.norm(tip - bend)), "wing_depth": depth, "primary_proj": proj,
        "tail_tip": tuple(np.round(ttip, 1)), "tail_beyond_wing": float(np.linalg.norm(ttip - tip)),
        "tail_depth": tdepth, "tail_angle": angle,
    }
    lines = []
    for k, pv in PHOTO.items():
        mv = model.get(k)
        if mv is None:
            continue
        if isinstance(pv, tuple):
            err = float(np.hypot(pv[0] - mv[0], pv[1] - mv[1]))
            lines.append("%-17s photo %-14s model %-14s off %.1f px" % (k, pv, mv, err))
        else:
            lines.append("%-17s photo %6.1f  model %6.1f  %+5.1f%%" % (k, pv, mv, 100.0 * (mv - pv) / pv))
    return "\n".join(lines)


# ---------------------------------------------------------------- feather-group regions (IoU)

# Folded-wing feather groups traced on side_profile_halun.jpg (half-res px, 4x gridded crop).
PHOTO_REGIONS = {  # traced on a 4x gridded crop (x 250-490, y 95-295); scapulars clipped at y 120 (REGION_TOP)
    1: [(258, 160), (290, 163), (300, 175), (298, 181), (258, 179)],  # lesser coverts (chestnut)
    2: [(258, 179), (298, 181), (306, 194), (300, 200), (262, 198), (256, 188)],  # median coverts + upper bar
    3: [(262, 198), (300, 200), (340, 203), (372, 205), (378, 222), (340, 230), (300, 226), (266, 214)],
    4: [(372, 192), (410, 196), (440, 210), (462, 235), (470, 262), (455, 262), (430, 245), (400, 232), (378, 222)],
    5: [(300, 226), (340, 230), (378, 222), (400, 232), (430, 245), (440, 256), (400, 250), (350, 246), (305, 236)],
    6: [(400, 250), (440, 256), (455, 262), (470, 262), (482, 278), (470, 282), (430, 272), (395, 258)],
    7: [(275, 120), (382, 120), (400, 135), (420, 150), (440, 175), (462, 205), (470, 235), (462, 235), (440, 210),
        (410, 196), (372, 192), (340, 195), (306, 194), (298, 181), (290, 163), (258, 160), (262, 145)],
}
REGION_TOP = 120
REGION_NAMES = {1: "lesser coverts", 2: "median coverts", 3: "greater coverts", 4: "tertials", 5: "secondaries",
                6: "primaries", 7: "scapulars", 8: "primary coverts / alula"}
GRID = (426, 640)  # half-res photo frame


def _poly_mask(poly):
    h, w = GRID
    yy, xx = np.mgrid[0:h, 0:w] + 0.5
    poly = np.asarray(poly, float)
    inside = np.zeros((h, w), bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        inside ^= ((yi > yy) != (yj > yy)) & (xx < (xj - xi) * (yy - yi) / (yj - yi + 1e-12) + xi)
        j = i
    return inside


def _atlas_alpha():
    img = bpy.data.images.get("SP_Feather_Atlas")
    if img is None:
        return None
    w, h = img.size
    a = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[..., 3]


def region_map():
    """Visible feather group per half-res photo pixel (z-buffer on world X, camera on the +X side)."""
    h, w = GRID
    zbuf = np.full((h, w), -np.inf)
    reg = np.zeros((h, w), np.int32)
    alpha = _atlas_alpha()
    names = ["SP_Body", "SP_Contour", "SP_Tail", "SP_Wing_L", "SP_Back", "SP_Scapulars", "SP_WingBars", "SP_WingFold"]
    for name in names:
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        me = ob.data
        M = np.array(ob.matrix_world)
        co = np.array([v.co[:] for v in me.vertices]) @ M[:3, :3].T + M[:3, 3]
        px = to_half_px(co)
        fr = me.attributes.get("fregion")
        uv_layer = me.uv_layers.active if name != "SP_Body" else None
        for poly in me.polygons:
            vids = list(poly.vertices)
            if min(co[vids, 0]) < 0.0:
                continue  # far side
            r = fr.data[poly.index].value if fr else 0
            loops = list(poly.loop_indices)
            for t in range(1, len(vids) - 1):
                tri = [0, t, t + 1]
                P = px[[vids[k] for k in tri]]
                Z = co[[vids[k] for k in tri], 0]
                x0, x1 = int(max(P[:, 0].min(), 0)), int(min(P[:, 0].max() + 1, w - 1))
                y0, y1 = int(max(P[:, 1].min(), 0)), int(min(P[:, 1].max() + 1, h - 1))
                if x1 < x0 or y1 < y0:
                    continue
                yy, xx = np.mgrid[y0 : y1 + 1, x0 : x1 + 1] + 0.5
                (ax, ay), (bx, by), (cx, cy) = P
                den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                if abs(den) < 1e-9:
                    continue
                l1 = ((by - cy) * (xx - cx) + (cx - bx) * (yy - cy)) / den
                l2 = ((cy - ay) * (xx - cx) + (ax - cx) * (yy - cy)) / den
                l3 = 1 - l1 - l2
                inside = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
                if not inside.any():
                    continue
                z = l1 * Z[0] + l2 * Z[1] + l3 * Z[2]
                if uv_layer is not None and alpha is not None:
                    U = np.array([uv_layer.data[loops[k]].uv[:] for k in tri])
                    u = l1 * U[0, 0] + l2 * U[1, 0] + l3 * U[2, 0]
                    v = l1 * U[0, 1] + l2 * U[1, 1] + l3 * U[2, 1]
                    ah, aw = alpha.shape
                    a = alpha[np.clip((v * ah).astype(int), 0, ah - 1), np.clip((u * aw).astype(int), 0, aw - 1)]
                    inside &= a > 0.35
                sub = zbuf[y0 : y1 + 1, x0 : x1 + 1]
                win = inside & (z > sub)
                sub[win] = z[win]
                reg[y0 : y1 + 1, x0 : x1 + 1][win] = r
    return reg


def region_iou(save=None):
    reg = region_map()
    reg[:REGION_TOP] = 0
    import s07_feathers as sf
    bg = sf.photo_background()
    lines = ["%-26s %6s %6s %6s" % ("region", "photo", "model", "IoU")]
    for r, poly in PHOTO_REGIONS.items():
        pm = _poly_mask(poly) & ~bg  # traced outline, cut to the bird's own silhouette in the photo
        pm[:REGION_TOP] = False
        mm = reg == r
        inter, uni = (pm & mm).sum(), (pm | mm).sum()
        lines.append("%-26s %6d %6d %6.2f" % (REGION_NAMES[r], pm.sum(), mm.sum(), inter / max(uni, 1)))
    if save:
        np.save(save, reg)
    return "\n".join(lines)
