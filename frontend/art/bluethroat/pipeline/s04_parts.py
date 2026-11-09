"""Step 4: bill (upper/lower mandible, mouth lining, tongue), eyes with eyelids, legs and feet.

Run after s03_body: the eyelids are shaped into the freshly built BT_Body.
Bill and eye positions come from the traced side photo (btshape), so they line up with the head.
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import btlib as bt
import btshape as bs

MM = bt.MM

# ---------------------------------------------------------------- bill profile (half-res photo px)
# Re-measured on the full-resolution photo: the culmen falls steadily from the tip to the forehead
# feathers (the bill points slightly up there), and the gape is the straight yellow commissure running
# from the tip back under the lores to the mouth corner below the front of the eye (~281, 101).
CULMEN = [(235.5, 81.3), (240, 81.5), (245, 82.0), (250, 82.6), (255, 83.3), (260, 84.1), (265, 84.9), (270, 85.6), (275, 86.2), (280, 86.8)]
GAPE = [(235.5, 81.6), (242, 84.4), (248, 86.9), (254, 89.5), (260, 92.1), (266, 94.6), (272, 97.2), (278, 99.7), (280, 100.5)]
LOWER = [(235.7, 81.9), (240, 84.3), (245, 87.1), (250, 89.9), (255, 92.6), (260, 95.3), (265, 97.4), (270, 99.2), (275, 100.6), (280, 101.8)]
HALFW_MM = [(235.5, 0.07), (238, 0.27), (241, 0.52), (244, 0.78), (248, 1.10), (252, 1.38), (256, 1.64), (261, 1.89), (266, 2.08), (272, 2.27), (280, 2.40)]
BILL_TIP_X, BILL_BASE_X = 235.5, 280.0
N_OUT, N_IN = 13, 6  # outer arc / mouth-lining points per bill section

NOSTRIL_PX = (258.5, 85.7)
FACE_LINE_PX = 262.0  # forehead / chin feathers meet the bill here on the photo (nostril left bare)
BILL_BLACK = (0.011, 0.010, 0.011)
GAPE_YELLOW = (0.70, 0.42, 0.03)
MOUTH = (0.80, 0.37, 0.06)
TONGUE = (0.85, 0.45, 0.22)


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
        pts.append(_pt(x, g - (g - cu) * s**1.05, -w * math.copysign(abs(c) ** 0.85, c)))
    for k in range(1, N_IN + 1):
        lat = w * (1 - 2 * k / (N_IN + 1))
        pts.append(_pt(x, g - 0.28 * (g - cu) * (1 - (lat / w) ** 2), lat))
    return pts


def _lower_loop(x):
    w = _f(HALFW_MM, x)
    lo, g = _f(LOWER, x), _f(GAPE, x)
    pts = []
    for k in range(N_OUT):
        psi = math.pi * k / (N_OUT - 1)
        c, s = math.cos(psi), math.sin(psi)
        pts.append(_pt(x, g + (lo - g) * s**0.9, w * math.copysign(abs(c) ** 0.8, c)))
    for k in range(1, N_IN + 1):
        lat = -w * (1 - 2 * k / (N_IN + 1))
        pts.append(_pt(x, g + 0.32 * (lo - g) * (1 - (lat / w) ** 2), lat))
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
        last = (S - 1) * L
        faces.append((ti + 1, last + i, last + (i + 1) % L))
        mats.append(0)
        uvs += [(0.5, 1.0), (i / L, 1.0), ((i + 1) / L, 1.0)]
    return np.array(verts), faces, mats, uvs


def _tongue():
    xs = np.linspace(251.0, 274.0, 16)
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
    v, f, m, u = _loft(loops, _pt(250.6, _f(GAPE, 250.6) + 1.2, 0), _pt(274.4, _f(GAPE, 274) + 2.0, 0))
    return v, f, [2] * len(f), u


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
    ob.data.update()
    return ob


def _to_half_px(co):
    """Blender (Y, Z) -> half-resolution side-photo pixel (inverse of btshape.px_to_bl)."""
    a = math.radians(bs.TILT_DEG)
    ur = (co[:, 1] - bs.REF_BL[0]) / MM
    wr = (co[:, 2] - bs.REF_BL[1]) / MM
    u = ur * math.cos(a) + wr * math.sin(a)
    w = -ur * math.sin(a) + wr * math.cos(a)
    return (u / bs.PX_MM + bs.REF_PX[0]) / 2.0, (-w / bs.PX_MM + bs.REF_PX[1]) / 2.0


def _bill_colors(ob, lower):
    """Glossy black keratin; yellow cutting edges toward the base (both mandibles), a horn-yellow
    base to the lower mandible, and the rictus - as on the side and head close-up photos.

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
        edge = bt.smoothstep(243.0, 256.0, px) * (1 - bt.smoothstep(0.18, 0.55, depth))
        base = bt.smoothstep(262.0, 272.0, px) * 0.75
        amt = np.maximum(edge, base)
    else:
        cu = _f(CULMEN, px)
        depth = np.clip((g - py) / np.maximum(g - cu, 1e-6), 0, 1)
        amt = bt.smoothstep(246.0, 257.0, px) * (1 - bt.smoothstep(0.0, 0.2, depth)) * 0.92
    cols[:, :3] = cols[:, :3] * (1 - amt[:, None]) + np.array(GAPE_YELLOW) * amt[:, None]
    if not lower:
        # oval nostril slit low on the side of the upper mandible, near its base
        nost = (((px - NOSTRIL_PX[0]) / 2.4) ** 2 + ((py - NOSTRIL_PX[1]) / 0.8) ** 2 < 1.0) & (np.abs(co[:, 0]) > 0.55 * MM)
        cols[nost, :3] = 0.002
    loop_vert = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", loop_vert)
    loop_cols = cols[loop_vert]
    mat_idx = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("material_index", mat_idx)
    starts = np.empty(len(me.polygons), dtype=np.int32)
    totals = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get("loop_start", starts)
    me.polygons.foreach_get("loop_total", totals)
    for s, t, m in zip(starts, totals, mat_idx):
        if m != 0:
            loop_cols[s : s + t] = (1.0, 1.0, 1.0, 1.0)
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
    up = _mesh_with_mats("BT_Bill_Upper", v, f, m, u, [mats["bill"], mats["mouth"]])
    _bill_colors(up, lower=False)
    v, f, m, u = _loft([_lower_loop(x) for x in xs], tip_l, base_l)
    tv, tf, tm, tu = _tongue()
    V, F, U = bt.merge_parts([(v, f, u), (tv, tf, tu)])
    lo = _mesh_with_mats("BT_Bill_Lower", V, F, list(m) + tm, U, [mats["bill"], mats["mouth"], mats["tongue"]])
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


EYE_PROUD_MM = 1.35  # eyeball cap above the head surface: ~3.4 mm visible eye, as measured on the photo


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
        rim = 0.18 * MM * np.exp(-(((rho - 2.4 * MM) / (0.45 * MM)) ** 2))
        new_h = h + rim
        inside = rho < 2.15 * MM
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
        name = "BT_Eye_%s" % ("L" if side > 0 else "R")
        v, f, uv = _uv_sphere(bs.EYEBALL_R_MM * MM)
        ob = bt.mesh_object(name, v, f, coll_name=bt.COLL_BIRD, uvs=uv)
        me = ob.data
        q = Vector(_eye_axis(side)).to_track_quat("Z", "Y")
        ob.matrix_world = Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4()
        if iris_mat is None:
            iris_mat = bt.material_textured("BT_Eye", eye_texture(me), roughness=0.06, specular=0.6, coat=0.85, double_sided=False)
        bt.assign(ob, iris_mat)
        obs.append(ob)
    carve_eyelids(body, centres)
    return obs


# ---------------------------------------------------------------- legs and feet

# (name, angular direction (+1 forward / -1 back), splay deg (+ = outward), length mm, claw mm, claw curl)
TOES = [
    ("III", 1, 0.0, 11.5, 3.6, 1.35),
    ("II", 1, -20.0, 8.0, 3.0, 1.35),
    ("IV", 1, 24.0, 8.5, 3.0, 1.35),
    ("I", -1, -10.0, 7.5, 5.2, 1.10),
]
HEEL = (4.6, 12.5, 25.0)
FOOT = (4.4, 1.0, 1.15)
HIP = (4.0, 7.0, 34.0)


def _toe(side, foot, spec, n=26):
    _name, direc, splay, length, claw, curl = spec
    Rp = bs.PERCH_R
    lat_sign = side * math.copysign(1.0, splay) if splay else 0.0
    sp = math.radians(abs(splay))
    r_toe0, r_toe1 = 0.74 * MM, 0.52 * MM
    theta = math.atan2(-foot[1], foot[2] + Rp)
    x = foot[0]
    total = (length + claw) * MM
    ds = total / (n - 1)
    pts, radii = [], []
    for k in range(n):
        s = k * ds
        in_claw = s > length * MM
        f_toe = min(s / (length * MM), 1.0)
        if in_claw:
            fc = (s - length * MM) / (claw * MM)
            r = 0.50 * MM * max(1 - fc, 0.0) ** 0.9 + 0.03 * MM  # fc can overshoot 1 by rounding
            rho = Rp + (r_toe1 + 0.05 * MM) * (1 - fc) + 0.08 * MM
        else:
            joints = 0.05 * MM * math.cos(math.pi * f_toe * 3.0) ** 2
            r = r_toe0 + (r_toe1 - r_toe0) * f_toe + joints
            rho = Rp + r + 0.05 * MM
        pts.append((x, -rho * math.sin(theta), -Rp + rho * math.cos(theta)))
        radii.append(r)
        rate = curl if in_claw else 1.0
        theta += direc * math.cos(sp) * ds / rho * rate
        x += lat_sign * math.sin(sp) * ds
    return np.array(pts), np.array(radii)


PART_TIBIA, PART_TARSUS, PART_FOOT = 0, 1, 2


def build_leg(side, mats):
    """Leg mesh; integer point attribute 'bt_part' marks tibia / tarsus / foot for skinning (s08)."""
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
    name = "BT_Leg_%s" % ("L" if side > 0 else "R")
    ob = _mesh_with_mats(name, V, F, mat_ids, U, [mats["leg"], mats["claw"], mats["tibia"]])
    attr = ob.data.attributes.new("bt_part", "INT", "POINT")
    attr.data.foreach_set("value", np.asarray(labels, dtype=np.int32))
    return ob


# ---------------------------------------------------------------- textures for legs and eyes


LEG_RINGS = 9  # faint scute divisions along the 'booted' tarsus; toes tile the texture TOE_TILE times
TOE_TILE = 3.4


def leg_textures(size_u=128, size_v=512, rings=LEG_RINGS):
    """Booted tarsus: smooth horny sheath with faint scute divisions and fine longitudinal grain."""
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
    height = 0.2 * (1 - groove) + 0.1 * grain  # booted: scute seams barely show
    base = np.array([0.205, 0.180, 0.162])
    col = base[None, None, :] * (0.86 + 0.16 * height[..., None]) * (1 + 0.04 * grain[..., None])
    gy, gx = np.gradient(height * 0.6)
    nrm = np.stack([-gx * 5, -gy * 5, np.ones_like(gx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    c = bt.np_image(np.clip(col, 0, 1), "BT_Leg_Color", path=os.path.join(bt.TEX, "leg_color.png"))
    n = bt.np_image(nrm * 0.5 + 0.5, "BT_Leg_Normal", path=os.path.join(bt.TEX, "leg_normal.png"), colorspace="Non-Color")
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
    iris = np.array([0.07, 0.045, 0.03])  # very dark brown: reads black-eyed like the photos
    rim = np.array([0.03, 0.022, 0.018])
    col = np.where((T < 21)[..., None], pupil, iris * (1 + 0.18 * streak[..., None]))
    ring = bt.smoothstep(40, 47, T)[..., None]
    col = col * (1 - ring) + rim * ring
    return bt.np_image(np.clip(col, 0, 1), "BT_Eye_Iris", path=os.path.join(bt.TEX, "eye_iris.png"))


# ---------------------------------------------------------------- materials


def materials():
    mats = {}
    m = bt.material_textured("BT_Bill", bt.white_image(), roughness=0.3, vertex_color="Col", coat=0.35, specular=0.4, double_sided=False)
    bt.sock(next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), "Coat Roughness").default_value = 0.22
    mats["bill"] = m
    mats["mouth"] = bt.material_flat("BT_Mouth", MOUTH, roughness=0.32, specular=0.6)
    mats["tongue"] = bt.material_flat("BT_Tongue", TONGUE, roughness=0.38, specular=0.6)
    mats["eye"] = None  # built with the iris texture in build_eyes
    leg_c, leg_n = leg_textures()
    mats["leg"] = bt.material_textured("BT_LegSkin", leg_c, normal_img=leg_n, roughness=0.5, normal_strength=0.8, double_sided=False)
    mats["claw"] = bt.material_flat("BT_Claw", (0.030, 0.026, 0.024), roughness=0.3, coat=0.2)
    mats["tibia"] = bt.material_flat("BT_Tibia", (0.70, 0.64, 0.55), roughness=0.85, specular=0.3)
    return mats


def run():
    body = bpy.data.objects["BT_Body"]
    mats = materials()
    up, lo = build_bill(mats)
    retract_face(body)
    eyes = build_eyes(body, mats["eye"])
    legs = [build_leg(s, mats) for s in (1, -1)]
    return "parts: %s" % ", ".join(o.name for o in [up, lo, *eyes, *legs])
