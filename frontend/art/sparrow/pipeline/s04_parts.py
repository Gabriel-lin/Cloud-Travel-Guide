"""Step 4: bill (upper/lower mandible, mouth lining, tongue), eyes with eyelids, legs and feet.

Run after s03_body: the eyelids are shaped into the freshly built SP_Body.
Bill and eye positions come from the traced side photo (spshape), so they line up with the head.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import splib as bt
import spshape as bs

MM = bt.MM

# ---------------------------------------------------------------- bill profile (half-res photo px)
# Measured on Hałun's side photo (gridded 5x crop): the stout conical seed-eater's bill, ~10 mm exposed,
# ~7.5 mm deep and ~6.5 mm wide at the base. The culmen is gently convex, the commissure nearly straight
# and slightly down-curved at the tip; the gonys runs almost level to the chin feathers.
CULMEN = [(168.5, 120.6), (172, 116.0), (176, 111.5), (180, 107.5), (185, 104.0), (190, 100.6), (195, 97.8), (200, 95.5), (205, 94.0), (211, 93.0)]
GAPE = [(168.5, 121.0), (172, 118.6), (176, 116.6), (180, 115.0), (185, 113.5), (190, 112.5), (195, 111.8), (200, 111.2), (205, 110.6), (211, 110.0)]
LOWER = [(168.7, 121.4), (172, 122.6), (176, 123.6), (180, 124.3), (185, 125.0), (190, 125.3), (195, 125.4), (200, 125.5), (205, 125.4), (211, 125.0)]
HALFW_MM = [(168.5, 0.07), (171, 0.55), (174, 0.98), (178, 1.42), (182, 1.82), (186, 2.16), (190, 2.45), (195, 2.75), (200, 2.98), (205, 3.12), (211, 3.22)]
BILL_TIP_X, BILL_BASE_X = 168.5, 211.0
N_OUT, N_IN = 13, 14  # outer arc / mouth-lining points per bill section

NOSTRIL_PX = (192.0, 101.5)  # rounded nostril just in front of the forehead feathers
FACE_LINE_PX = 198.0  # forehead / chin feathers meet the bill here on the photo
BILL_BLACK = (0.050, 0.050, 0.055)  # adult in summer: black bill with a faint blue-grey sheen
GAPE_YELLOW = (0.13, 0.12, 0.12)  # rictus and cutting edges: dark horn (no yellow in adults)
RIM_HORN = 0.12  # lining depth (0 = cutting edge) below which the lining is horn-coloured tomium
MOUTH = (0.52, 0.25, 0.22)  # moist pink-flesh mouth lining (calling_open_bill_hedera / Luc Viatour open-beak photos)
TONGUE = (0.15, 0.075, 0.07)


def _f(tab, x):
    t = np.asarray(tab, float)
    return np.interp(x, t[:, 0], t[:, 1])


def _pt(x_px, y_px, lat_mm):
    y, z = bs.half_to_bl(x_px, y_px)
    return (lat_mm * MM, float(y), float(z))


def _upper_loop(x):
    w = _f(HALFW_MM, x) * 1.03 + 0.03
    cu, g = _f(CULMEN, x), _f(GAPE, x) + 0.12
    pts = []
    for k in range(N_OUT):
        phi = math.pi * k / (N_OUT - 1)
        c, s = math.cos(phi), math.sin(phi)
        lip = 1.0 - 0.10 * math.exp(-(min(phi, math.pi - phi) / 0.28) ** 2)  # thin cutting edge (tomium): the shell turns in
        pts.append(_pt(x, g - (g - cu) * s**1.05, -w * lip * math.copysign(abs(c) ** 0.85, c)))
    for k in range(1, N_IN + 1):
        lat = w * 0.94 * math.cos(math.pi * k / (N_IN + 1))  # cosine spacing: the lining meets the rim at a shallow angle
        pts.append(_pt(x, g - 0.45 * (g - cu) * max(1 - (lat / w) ** 2, 0.0) ** 0.6 - 0.04, lat))  # vaulted palate
    return pts


def _lower_loop(x):
    w = _f(HALFW_MM, x)
    lo, g = _f(LOWER, x), _f(GAPE, x)
    pts = []
    for k in range(N_OUT):
        psi = math.pi * k / (N_OUT - 1)
        c, s = math.cos(psi), math.sin(psi)
        lip = 1.0 - 0.10 * math.exp(-(min(psi, math.pi - psi) / 0.28) ** 2)
        pts.append(_pt(x, g + (lo - g) * s**0.9, w * lip * math.copysign(abs(c) ** 0.8, c)))
    for k in range(1, N_IN + 1):
        lat = -w * 0.94 * math.cos(math.pi * k / (N_IN + 1))
        pts.append(_pt(x, g + 0.62 * (lo - g) * max(1 - (lat / w) ** 2, 0.0) ** 0.6 + 0.04, lat))  # trough (deeper: holds the tongue)
    return pts


def _loft(loops, tip_pt, base_pt):
    S, L = len(loops), len(loops[0])
    verts = [p for lp in loops for p in lp]
    faces, mats, uvs = [], [], []
    mouth_from = N_OUT - 1
    for s in range(S - 1):
        for i in range(L):
            a, b = s * L + i, s * L + (i + 1) % L
            c, d = (s + 1) * L + (i + 1) % L, (s + 1) * L + i
            faces.append((a, b, c, d))
            mats.append(1 if i >= mouth_from else 0)
            u0, u1, v0, v1 = i / L, (i + 1) / L, s / (S - 1), (s + 1) / (S - 1)
            uvs += [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    ti = len(verts)
    verts += [tip_pt, base_pt]
    for i in range(L):
        faces.append((ti, (i + 1) % L, i))
        mats.append(1 if i >= mouth_from else 0)
        uvs += [(0.5, 0.0), ((i + 1) / L, 0.0), (i / L, 0.0)]
        # no cap at the bill base: it sits inside the head, and with the bill open its fan of facets showed
        # as radiating stripes inside the gape (the SP_Mouth cavity closes the opening instead)
    return np.array(verts), faces, mats, uvs


def _tongue():
    xs = np.linspace(BILL_TIP_X + 0.35 * (BILL_BASE_X - BILL_TIP_X), BILL_BASE_X - 4.5, 16)
    loops = []
    for x in xs:
        lo, g = _f(LOWER, x), _f(GAPE, x)
        floor = g + 0.32 * (lo - g)
        f = (x - xs[0]) / (xs[-1] - xs[0])
        hw = 0.15 + 0.62 * f**0.6
        top, bot = floor - 1.05, floor + 0.35
        lp = []
        for k in range(10):
            a = 2 * math.pi * k / 10
            lp.append(_pt(x, (top + bot) / 2 - (bot - top) / 2 * math.sin(a), hw * math.cos(a)))
        loops.append(lp)
    x0, x1 = xs[0] - 0.4, xs[-1] + 0.4
    v, f, m, u = _loft(loops, _pt(x0, _f(GAPE, x0) + 1.2, 0), _pt(x1, _f(GAPE, x1) + 2.0, 0))
    return v, f, [2] * len(f), u


def _orient_shell_outward(ob):
    """recalc_face_normals orients an OPEN shell (the bill, open at its root) by a global heuristic and can leave the whole
    outer skin facing inward - then every single-sided renderer (three.js, EEVEE) culls it and you look through the
    mandible into its lining (a hollow under the lower bill). Count the outer-skin faces that point away from their own
    cross-section's centre; if most point in, reverse the whole mesh (lining faces stay consistent with it)."""
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    ys = co[:, 1]
    out = tot = 0
    for p in me.polygons:
        if p.material_index != 0:
            continue
        c = np.array(p.center[:])
        sl = np.abs(ys - c[1]) < 0.0003
        if sl.sum() < 4:
            continue
        r = c - np.array([co[sl, 0].mean(), c[1], co[sl, 2].mean()])
        tot += 1
        out += int(np.dot(np.array(p.normal[:]), r) > 0)
    if tot and out < 0.5 * tot:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()
    return out, tot


def _mesh_with_mats(name, verts, faces, mats, uvs, materials, coll=bt.COLL_BIRD):
    ob = bt.mesh_object(name, verts, faces, coll_name=coll, uvs=np.asarray(uvs))
    for m in materials:
        ob.data.materials.append(m)
    ob.data.polygons.foreach_set("material_index", np.asarray(mats, dtype=np.int32))
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    _orient_shell_outward(ob)
    for poly in ob.data.polygons:  # smooth lining inside the bill (flat facets read as wedges when open)
        poly.use_smooth = poly.material_index > 0 or poly.use_smooth
    ob.data.update()
    return ob


def _to_half_px(co):
    """Blender (Y, Z) -> half-resolution side-photo pixel (inverse of spshape.px_to_bl)."""
    a = math.radians(bs.TILT_DEG)
    ur = (co[:, 1] - bs.REF_BL[0]) / MM
    wr = (co[:, 2] - bs.REF_BL[1]) / MM
    u = ur * math.cos(a) + wr * math.sin(a)
    w = -ur * math.sin(a) + wr * math.cos(a)
    return (u / bs.PX_MM + bs.REF_PX[0]) / 2.0, (-w / bs.PX_MM + bs.REF_PX[1]) / 2.0


def _bill_colors(ob, lower):
    """Glossy black keratin (breeding adult), dark-horn cutting edges toward the base and a slightly
    paler base to the lower mandible - as on the side and head close-up photos.

    Stored per face corner: mouth / tongue faces stay white so three.js (which enables vertex colours
    for every primitive that has them) doesn't darken the mouth lining.
    """
    me = ob.data
    old = me.color_attributes.get("Col")
    if old:
        me.color_attributes.remove(old)
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    co = bt.object_verts(ob)
    cols = np.tile(np.array([*BILL_BLACK, 1.0]), (len(co), 1))
    px, py = _to_half_px(co)
    g = _f(GAPE, px)
    if lower:
        lo = _f(LOWER, px)
        depth = np.clip((py - g) / np.maximum(lo - g, 1e-6), 0, 1)
        L = BILL_BASE_X - BILL_TIP_X
        edge = bt.smoothstep(BILL_TIP_X + 0.6 * L, BILL_TIP_X + 0.85 * L, px) * (1 - bt.smoothstep(0.18, 0.55, depth))
        base = bt.smoothstep(FACE_LINE_PX - 1.0, BILL_BASE_X, px) * 0.60  # paler base of the lower mandible
        amt = np.maximum(edge, base)
    else:
        cu = _f(CULMEN, px)
        depth = np.clip((g - py) / np.maximum(g - cu, 1e-6), 0, 1)
        L = BILL_BASE_X - BILL_TIP_X
        amt = bt.smoothstep(BILL_TIP_X + 0.65 * L, BILL_TIP_X + 0.9 * L, px) * (1 - bt.smoothstep(0.0, 0.2, depth)) * 0.6
    cols[:, :3] = cols[:, :3] * (1 - amt[:, None]) + np.array(GAPE_YELLOW) * amt[:, None]
    if not lower:
        # oval nostril slit low on the side of the upper mandible, near its base
        nost = (((px - NOSTRIL_PX[0]) / 3.4) ** 2 + ((py - NOSTRIL_PX[1]) / 1.7) ** 2 < 1.0) & (np.abs(co[:, 0]) > 0.7 * MM)
        cols[nost, :3] = 0.002
    # the bill's root is shaded into the black feather margin that overlaps it (no hard seam against the face)
    root = bt.smoothstep(FACE_LINE_PX - 9.0, FACE_LINE_PX + 1.0, px)
    cols[:, :3] = cols[:, :3] * (1 - 0.65 * root[:, None]) + np.array([0.010, 0.010, 0.012]) * (0.65 * root[:, None])
    loop_vert = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loop_vert)
    loop_cols = cols[loop_vert]
    mat_idx = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("material_index", mat_idx)
    starts = np.empty(len(me.polygons), dtype=np.int32)
    totals = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_start", starts)
    me.polygons.foreach_get("loop_total", totals)
    along = bt.smoothstep(BILL_BASE_X, BILL_TIP_X + 0.1 * (BILL_BASE_X - BILL_TIP_X), px)  # 0 at the base, 1 at the tip
    rim_d = np.clip(depth, 0, 1)  # 0 at the cutting edge, 1 deep in the vault / trough
    shade = np.clip((0.62 + 0.38 * along) * (1.05 - 0.25 * rim_d), 0.0, 1.0)
    lining = np.stack([shade, shade * 0.97, shade * 0.97, np.ones_like(shade)], 1)[loop_vert]
    # the lining strip right at the cutting edge (tomium) is horn, not flesh: with the bill closed it is the only part
    # of the lining seen along the gape line, so it takes the bill material and the bill's own edge colour
    rim_face = np.zeros(len(mat_idx), bool)
    # the lining blends from the yellowish gape/tomium colour at the cutting edge into the pink flesh (no hard band)
    tint = (1.0 - bt.smoothstep(0.0, 0.45, rim_d))[loop_vert]
    yel = np.array([1.25, 1.05, 0.62, 1.0])
    lining = lining * (1.0 - tint[:, None]) + (lining * yel) * tint[:, None]
    lining = np.clip(lining, 0.0, 1.0)
    for i_, (s, t, m) in enumerate(zip(starts, totals, mat_idx)):
        if m != 0 and float(np.mean(rim_d[loop_vert[s:s + t]])) < RIM_HORN:
            rim_face[i_] = True
    for i_, (s, t, m) in enumerate(zip(starts, totals, mat_idx)):
        if m != 0 and not rim_face[i_]:
            loop_cols[s : s + t] = lining[s : s + t]
    if rim_face.any():
        mat_idx[rim_face] = 0
        me.polygons.foreach_set("material_index", mat_idx)
    attr.data.foreach_set("color", loop_cols.astype(np.float32).ravel())
    me.color_attributes.active_color = attr


def build_bill(mats):
    xs = BILL_TIP_X + (BILL_BASE_X - BILL_TIP_X) * np.linspace(0, 1, 26) ** 1.35
    g_tip = _f(GAPE, BILL_TIP_X + 0.5)
    tip_u = _pt(BILL_TIP_X + 0.1, g_tip - 0.1, 0)
    tip_l = _pt(BILL_TIP_X + 0.2, g_tip + 0.2, 0)
    xb = BILL_BASE_X
    base_u = _pt(xb + 0.6, (_f(CULMEN, xb) + _f(GAPE, xb)) / 2, 0)
    base_l = _pt(xb + 0.6, (_f(GAPE, xb) + _f(LOWER, xb)) / 2, 0)
    v, f, m, u = _loft([_upper_loop(x) for x in xs], tip_u, base_u)
    up = _mesh_with_mats("SP_Bill_Upper", v, f, m, u, [mats["bill"], mats["mouth"]])
    _bill_colors(up, lower=False)
    v, f, m, u = _loft([_lower_loop(x) for x in xs], tip_l, base_l)
    lo = _mesh_with_mats("SP_Bill_Lower", v, f, m, u, [mats["bill"], mats["mouth"]])  # tongue: SP_Mouth
    _bill_colors(lo, lower=True)
    return up, lo


def retract_face(body, reach_px=5.0):
    """The traced head silhouette runs over the bill base; pull the skin hugging the bill in front of the
    feather line onto (just inside) the bill so the exposed bill and nostril match the photo. Only skin
    within reach_px of the bill outline moves, fading with distance, so forehead and chin slope onto it."""
    co = bt.object_verts(body)
    px, py = _to_half_px(co)
    zone = (px < FACE_LINE_PX + 8.0) & (px > BILL_TIP_X)
    if not zone.any():
        return 0
    x = np.clip(px[zone], BILL_TIP_X, BILL_BASE_X)
    cu, lo = _f(CULMEN, x), _f(LOWER, x)
    yc, h = (cu + lo) / 2.0, np.maximum((lo - cu) / 2.0, 0.05)  # half-res px
    hw = np.maximum(_f(HALFW_MM, x), 0.05) * MM
    dy, dx = py[zone] - yc, co[zone, 0]
    rho = np.sqrt((dy / h) ** 2 + (dx / hw) ** 2)
    k = np.where(rho > 0.9, 0.9 / np.maximum(rho, 1e-6), 1.0)
    off = np.maximum(np.maximum(cu - py[zone], py[zone] - lo), 0.0)  # px above the culmen / below the lower edge
    w = (1.0 - bt.smoothstep(FACE_LINE_PX - 2.0, FACE_LINE_PX + 8.0, px[zone])) * (1.0 - bt.smoothstep(0.0, reach_px, off))
    k = 1.0 + (k - 1.0) * w
    ny, nz = bs.half_to_bl(px[zone], yc + dy * k)
    co[zone, 0] = dx * k
    co[zone, 1], co[zone, 2] = ny, nz
    bt.set_object_verts(body, co)
    return int((w > 0.5).sum())


# ---------------------------------------------------------------- eyes


def _eye_axis(side):
    e = np.array([side * 1.0, -0.26, 0.07])
    return e / np.linalg.norm(e)


EYE_PROUD_MM = 1.15  # eyeball cap above the head surface: ~4.2 mm across with the lids, as on the photo


def eye_centres(body):
    """Eyeball centres so EYE_PROUD_MM of the 2.6 mm eyeball sits proud of the head surface."""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(body, dg, deform=False)
    y, z = bs.half_to_bl(*bs.EYE_PX)
    out = {}
    for side in (-1, 1):
        hit, _n, _i, _d = bvh.ray_cast(Vector((side * 0.05, float(y), float(z))), Vector((-side, 0, 0)))
        x_surf = hit.x
        out[side] = np.array([x_surf - side * (bs.EYEBALL_R_MM - EYE_PROUD_MM) * MM, y, z])
    return out


def carve_eyelids(body, centres):
    """Raise a soft eyelid rim around each eye and tuck the skin under the eyeball."""
    co = bt.object_verts(body)
    R = bs.EYEBALL_R_MM * MM
    for side, c in centres.items():
        e = _eye_axis(side)
        d = co - c
        h = d @ e
        rho = np.linalg.norm(d - np.outer(h, e), axis=1)
        zone = (h > -0.4 * R) & (rho < R + 2.0 * MM)
        sphere_h = np.sqrt(np.clip(R * R - rho * rho, 0, None))
        rim = 0.18 * MM * np.exp(-(((rho - 2.3 * MM) / (0.45 * MM)) ** 2))
        new_h = h + rim
        inside = rho < 2.05 * MM
        new_h = np.where(inside, np.minimum(new_h, sphere_h - 0.15 * MM), new_h)
        co[zone] += np.outer(new_h[zone] - h[zone], e)
    bt.set_object_verts(body, co)


def _uv_sphere(radius, u_seg=48, v_seg=24):
    """UV sphere with a fixed element order, poles on local Z, v = 0 south pole .. 1 north pole.
    (bmesh.ops.create_uvsphere orders its face corners differently from run to run, which made
    otherwise identical builds export different GLB bytes.)"""
    verts = [(0.0, 0.0, -radius)]
    for j in range(1, v_seg):
        lat = math.pi * j / v_seg - math.pi / 2
        for i in range(u_seg):
            lon = 2 * math.pi * i / u_seg
            verts.append((radius * math.cos(lat) * math.cos(lon), radius * math.cos(lat) * math.sin(lon), radius * math.sin(lat)))
    north = len(verts)
    verts.append((0.0, 0.0, radius))

    def ring(j, i):
        return 1 + (j - 1) * u_seg + i % u_seg

    faces, uvs = [], []
    for i in range(u_seg):  # counter-clockwise seen from outside
        u0, u1 = i / u_seg, (i + 1) / u_seg
        faces.append((0, ring(1, i + 1), ring(1, i)))
        uvs += [((u0 + u1) / 2, 0.0), (u1, 1 / v_seg), (u0, 1 / v_seg)]
        for j in range(1, v_seg - 1):
            v0, v1 = j / v_seg, (j + 1) / v_seg
            faces.append((ring(j, i), ring(j, i + 1), ring(j + 1, i + 1), ring(j + 1, i)))
            uvs += [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
        faces.append((ring(v_seg - 1, i), ring(v_seg - 1, i + 1), north))
        uvs += [(u0, 1 - 1 / v_seg), (u1, 1 - 1 / v_seg), ((u0 + u1) / 2, 1.0)]
    return np.array(verts), faces, np.array(uvs)


def build_eyes(body, mat):
    centres = eye_centres(body)
    obs = []
    iris_mat = None
    for side, c in centres.items():
        name = "SP_Eye_%s" % ("L" if side > 0 else "R")
        v, f, uv = _uv_sphere(bs.EYEBALL_R_MM * MM)
        ob = bt.mesh_object(name, v, f, coll_name=bt.COLL_BIRD, uvs=uv)
        me = ob.data
        q = Vector(_eye_axis(side)).to_track_quat("Z", "Y")
        ob.matrix_world = Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4()
        if iris_mat is None:
            iris_mat = bt.material_textured("SP_Eye", eye_texture(me), roughness=0.06, specular=0.6, coat=0.85, double_sided=False)
        bt.assign(ob, iris_mat)
        obs.append(ob)
    carve_eyelids(body, centres)
    return obs


# ---------------------------------------------------------------- legs and feet

# (name, direction (+1 forward / -1 back), splay deg (+ = outward), length mm, claw mm, claw curl)
# Tree sparrow: tarsus ~17.5 mm, middle toe ~13 mm with claw, hind claw short and well curved.
TOES = [
    ("III", 1, 0.0, 10.0, 3.2, 1.0),
    ("II", 1, -22.0, 7.0, 2.6, 1.0),
    ("IV", 1, 25.0, 7.4, 2.6, 1.0),
    ("I", -1, -8.0, 6.0, 4.0, 1.25),
]
HEEL = (4.3, 8.0, 15.5)
FOOT = (4.2, -2.0, 1.15)
HIP = (3.8, 1.6, 24.0)


def _toe(side, foot, spec, n=34):
    """Toe gripping the perch: the toe's centre line wraps round the twig (radius bs.PERCH_R, axis along X through
    y = foot y, top at z = 0) - nearly straight over the top at the base, then curling with the twig's curvature
    down the far side and under it; the claw hooks on round, its tip touching the bark. Front toes (II-IV) wrap
    forward, the hallux backward, so the tips meet underneath like a real perching passerine's."""
    _name, direc, splay, length, claw, curl = spec
    ang = math.radians(abs(splay))
    out = side * math.copysign(1.0, splay) if splay else 0.0  # + splay points to the bird's outside
    R = bs.PERCH_R
    yc, zc = float(foot[1]), -R
    r_toe0, r_toe1 = 0.62 * MM, 0.44 * MM
    total = (length + claw) * MM
    ds = total / (n - 1)
    pts, radii = [], []
    phi = 0.0
    for k in range(n):
        s = k * ds
        in_claw = s > length * MM
        f_toe = min(s / (length * MM), 1.0)
        if in_claw:
            fc = min((s - length * MM) / (claw * MM), 1.0)
            r = 0.42 * MM * max(1 - fc, 0.0) ** 0.9 + 0.03 * MM
            rc = R + max(r * 0.55, 0.05 * MM)  # the hooked claw closes in on the bark
        else:
            joints = 0.05 * MM * math.cos(math.pi * f_toe * 3.0) ** 2
            r = r_toe0 + (r_toe1 - r_toe0) * f_toe + joints
            rc = R + r
        if k:
            ramp = 0.30 + 0.70 * float(bt.smoothstep(0.0, 0.32, s / (length * MM)))  # flat over the knuckle, then gripping
            if in_claw:
                ramp = 1.0 + 0.25 * (curl - 1.0) + 0.15
            phi += ds * math.cos(ang) * ramp / rc
        y = yc - float(direc) * rc * math.sin(phi)
        z = zc + rc * math.cos(phi)
        x = foot[0] + out * math.sin(ang) * s
        pts.append((x, y, z))
        radii.append(r)
    return np.array(pts), np.array(radii)


PART_TIBIA, PART_TARSUS, PART_FOOT = 0, 1, 2


def build_leg(side, mats):
    """Leg mesh; integer point attribute 'sp_part' marks tibia / tarsus / foot for skinning (s08)."""
    s = side
    hip = np.array([s * HIP[0], HIP[1], HIP[2]]) * MM
    heel = np.array([s * HEEL[0], HEEL[1], HEEL[2]]) * MM
    foot = np.array([s * FOOT[0], FOOT[1], FOOT[2]]) * MM
    parts, mat_ids, labels = [], [], []

    def add(vfu, mat, part):
        parts.append(vfu)
        mat_ids.extend([mat] * len(vfu[1]))
        labels.extend([part] * len(vfu[0]))

    tib_end = heel + (hip - heel) / np.linalg.norm(hip - heel) * 2.2 * MM
    tib = bt.catmull_rom([hip, (hip + tib_end) / 2 + np.array([0, -0.8, 0]) * MM, tib_end], samples_per_seg=6)
    ft = np.linspace(0, 1, len(tib))
    tr = (2.1 - 0.75 * ft - 0.35 * ft**4) * MM
    add(bt.tube(tib, tr, segs=12), 2, PART_TIBIA)

    tar = np.linspace(0, 1, 22)
    path = heel[None] + (foot - heel)[None] * tar[:, None]
    rad = (1.02 - 0.12 * tar + 0.28 * np.exp(-((tar - 0.03) / 0.07) ** 2)) * MM
    add(bt.tube(path, rad, segs=14, squash=(0.82, 1.0), up=(1, 0, 0)), 0, PART_TARSUS)

    pad_path = np.array([foot + np.array([0, 0.9, 0.25]) * MM, foot, foot + np.array([0, -1.0, -0.15]) * MM])
    pad_r = np.array([0.7, 1.05, 1.1, 1.05, 0.9, 0.85, 0.8, 0.75, 0.7]) * MM
    add(bt.tube(bt.catmull_rom(pad_path, 4), pad_r, segs=12, squash=(0.8, 1.15), up=(0, 0, 1)), 0, PART_FOOT)

    for spec in TOES:
        pts, radii = _toe(side, foot, spec)
        n_toe = int(round(len(pts) * spec[3] / (spec[3] + spec[4])))
        tv, tf, tu = bt.tube(pts[: n_toe + 1], radii[: n_toe + 1], segs=10, squash=(1.0, 0.9))
        tu = [(uu, vv * TOE_TILE) for uu, vv in tu]  # finer transverse scutes on the toes
        add((tv, tf, tu), 0, PART_FOOT)
        add(bt.tube(pts[n_toe:], radii[n_toe:], segs=8, squash=(0.72, 1.0)), 1, PART_FOOT)

    V, F, U = bt.merge_parts(parts)
    name = "SP_Leg_%s" % ("L" if side > 0 else "R")
    ob = _mesh_with_mats(name, V, F, mat_ids, U, [mats["leg"], mats["claw"], mats["tibia"]])
    attr = ob.data.attributes.new("sp_part", "INT", "POINT")
    attr.data.foreach_set("value", np.asarray(labels, dtype=np.int32))
    return ob


# ---------------------------------------------------------------- textures for legs and eyes


LEG_RINGS = 12  # transverse scutes along the front of the (scutellate) tarsus; toes tile the texture TOE_TILE times
TOE_TILE = 3.4


def leg_textures(size_u=128, size_v=512, rings=LEG_RINGS):
    """Scutellate tarsus: pinkish-brown horny scales with clear divisions and fine grain."""
    rng = np.random.default_rng(3)
    v = (np.arange(size_v) + 0.5) / size_v
    u = (np.arange(size_u) + 0.5) / size_u
    U, Vv = np.meshgrid(u, v)
    phase = Vv * rings + 0.12 * np.sin(U * 2 * np.pi)  # scute rows bow slightly around the leg
    cell = phase - np.floor(phase)
    groove = np.exp(-((cell - 0.0) / 0.025) ** 2) + np.exp(-((cell - 1.0) / 0.025) ** 2)
    grain = rng.normal(0, 1, (size_v, size_u))
    for _ in range(6):
        grain = (grain + np.roll(grain, 1, 0) * 2 + np.roll(grain, -1, 0) * 2) / 5  # streaks along the leg
    grain /= max(np.abs(grain).max(), 1e-6)
    height = 0.45 * (1 - groove) + 0.08 * grain  # scute seams show
    base = np.array([0.66, 0.48, 0.41])  # pinkish-brown, as on the photos
    col = base[None, None, :] * (0.86 + 0.16 * height[..., None]) * (1 + 0.04 * grain[..., None])
    gy, gx = np.gradient(height * 0.6)
    nrm = np.stack([-gx * 5, -gy * 5, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    c = bt.np_image(np.clip(col, 0, 1), "SP_Leg_Color", path=os.path.join(bt.TEX, "leg_color.png"))
    n = bt.np_image(nrm * 0.5 + 0.5, "SP_Leg_Normal", path=os.path.join(bt.TEX, "leg_normal.png"), colorspace="Non-Color")
    return c, n


def eye_texture(me, size_u=128, size_v=128):
    """Iris + pupil by polar angle from the eye axis (+Z local), mapped through the sphere's own UVs."""
    co = np.array([v.co[:] for v in me.vertices])
    r = np.linalg.norm(co, axis=1).max()
    loops_v = np.array([l.vertex_index for l in me.loops])
    uv = np.array([d.uv[:] for d in me.uv_layers.active.data])
    z = co[loops_v, 2] / r
    up_is_v1 = np.corrcoef(z, uv[:, 1])[0, 1] > 0
    rows = (np.arange(size_v) + 0.5) / size_v
    theta = np.degrees((1 - rows) * np.pi if up_is_v1 else rows * np.pi)  # 0 deg = front of the eye
    cols = (np.arange(size_u) + 0.5) / size_u
    T, A = np.meshgrid(theta, cols * 360.0, indexing="ij")
    rng = np.random.default_rng(11)
    streak = np.sin(np.radians(A) * 37 + rng.random() * 6) * 0.5 + np.sin(np.radians(A) * 91) * 0.3
    pupil = np.array([0.006, 0.006, 0.008])
    iris = np.array([0.09, 0.055, 0.035])  # dark brown iris, reads dark-eyed like the photos
    rim = np.array([0.03, 0.022, 0.018])
    col = np.where((T < 21)[..., None], pupil, iris * (1 + 0.18 * streak[..., None]))
    ring = bt.smoothstep(40, 47, T)[..., None]
    col = col * (1 - ring) + rim * ring
    return bt.np_image(np.clip(col, 0, 1), "SP_Eye_Iris", path=os.path.join(bt.TEX, "eye_iris.png"))


# ---------------------------------------------------------------- materials



def lining_material(name, rgb, vertex_color="Col"):
    """Moist pink-flesh lining: slightly glossy, faint subsurface, darkened toward the throat by the vertex colour."""
    m = bt.material_flat(name, rgb, roughness=0.8, specular=0.05, double_sided=True)
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    try:
        bt.sock(bsdf, "Subsurface Weight").default_value = 0.25
        bt.sock(bsdf, "Subsurface Radius").default_value = (0.9, 0.25, 0.15)
        bt.sock(bsdf, "Subsurface Scale").default_value = 0.0008
    except Exception:
        pass
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = vertex_color
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[6].default_value = (*rgb, 1)
    nt.links.new(vc.outputs["Color"], mix.inputs[7]); nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return m


def bill_textures(size_u=256, size_v=256):
    """Keratin: fine longitudinal ridges (the rhamphotheca grows in strips), soft blotchy tone variation and a few
    pale growth lines across the bill; neutral grey-black, the vertex colour supplies the horn-brown edges."""
    rng = np.random.default_rng(11)
    u = (np.arange(size_u) + 0.5) / size_u
    v = (np.arange(size_v) + 0.5) / size_v
    U, Vv = np.meshgrid(u, v)
    ridge = rng.normal(0, 1, (size_v, size_u))
    for _ in range(10):
        ridge = (ridge + np.roll(ridge, 1, 0) * 2 + np.roll(ridge, -1, 0) * 2) / 5  # streaks along v (the bill length)
    ridge = (ridge + np.roll(ridge, 1, 1)) / 2
    ridge /= max(np.abs(ridge).max(), 1e-6)
    blot = rng.normal(0, 1, (size_v // 8, size_u // 8))
    for _ in range(3):
        blot = (blot + np.roll(blot, 1, 0) + np.roll(blot, -1, 0) + np.roll(blot, 1, 1) + np.roll(blot, -1, 1)) / 5
    blot = np.kron(blot, np.ones((8, 8)))
    blot /= max(np.abs(blot).max(), 1e-6)
    growth = 0.5 + 0.5 * np.sin(Vv * 2 * np.pi * 9 + 2.5 * blot)
    lum = 0.85 + 0.05 * ridge + 0.035 * blot + 0.012 * growth
    tint = np.stack([1.0 + 0.05 * blot, 1.0 + 0.0 * blot, 1.0 - 0.06 * blot], -1)  # warm/cool drift
    col = np.clip(lum[..., None] * tint, 0, 1)
    gy, gx = np.gradient(0.5 * ridge + 0.25 * growth)
    nrm = np.stack([-gx * 5, -gy * 5, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    c = bt.np_image(col, "SP_Bill_Color", path=os.path.join(bt.TEX, "bill_color.png"))
    n = bt.np_image(nrm * 0.5 + 0.5, "SP_Bill_Normal", path=os.path.join(bt.TEX, "bill_normal.png"), colorspace="Non-Color")
    return c, n


def materials():
    mats = {}
    hc, hn = bill_textures()
    m = bt.material_textured("SP_Bill", hc, normal_img=hn, roughness=0.42, normal_strength=0.16, vertex_color="Col", coat=0.0, specular=0.3, double_sided=False)
    bt.sock(next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), "Coat Roughness").default_value = 0.22
    mats["bill"] = m
    mats["mouth"] = lining_material("SP_Mouth", MOUTH)
    mats["tongue"] = bt.material_flat("SP_Tongue", TONGUE, roughness=0.38, specular=0.6)
    mats["eye"] = None  # built with the iris texture in build_eyes
    leg_c, leg_n = leg_textures()
    mats["leg"] = bt.material_textured("SP_LegSkin", leg_c, normal_img=leg_n, roughness=0.5, normal_strength=0.8, double_sided=False)
    mats["claw"] = bt.material_flat("SP_Claw", (0.075, 0.055, 0.045), roughness=0.32, coat=0.2)
    mats["tibia"] = bt.material_flat("SP_Tibia", (0.70, 0.64, 0.55), roughness=0.85, specular=0.3)
    return mats


def run():
    body = bpy.data.objects["SP_Body"]
    mats = materials()
    up, lo = build_bill(mats)
    retract_face(body)
    eyes = build_eyes(body, mats["eye"])
    legs = [build_leg(s, mats) for s in (1, -1)]
    return "parts: %s" % ", ".join(o.name for o in [up, lo, *eyes, *legs])
