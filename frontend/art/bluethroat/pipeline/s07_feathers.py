"""Step 7: wings, tail and body contour feathers, built from the feather atlas.

Wing kinematics (left wing; the right wing mirrors it):
  shoulder S -> humerus -> elbow E -> forearm -> wrist W -> hand -> hand tip T.
Folded joints come from the photo (side view) with depth from the body surface; spread joints are a
horizontal extended wing. Each feather sits at a fixed point on its bone (same offset in every pose) and
only its fan angle phi changes (folded vs spread), so every card stays rigidly attached to one bone.
phi is measured from the bone axis towards the trailing edge, in the wing plane (bone X/Y, Z = dorsal).

Stacking (body outwards when folded, dorsal when spread): primaries P9..P1, secondaries S1..S6,
tertials S7..S9, primary/greater/median/lesser coverts, alula.
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils import Vector

import btlib as bt
import btshape as bs

MM = bt.MM
D4 = np.diag([-1.0, 1.0, 1.0, 1.0])  # mirror across the bird's midplane (applied as D @ F @ D)
BUILD = bt.BUILD
WING_JSON = os.path.join(BUILD, "wing_rest.json")

# Folded wing joints on the side photo (half-res px) and how far they sit inside the body surface (mm).
FOLD_PX = {"S": (342, 162), "E": (368, 196), "W": (324, 186), "T": (356, 203)}
INSET = {"S": 3.5, "E": 2.0, "W": 1.2, "T": 1.0}
CLEAR = 0.7  # mm between body surface and the innermost feather
LAYER_FOLD, LAYER_SPREAD = 0.12, 0.06  # mm per stacking layer
ARM_BONES = (("humerus", "S", "E"), ("forearm", "E", "W"), ("hand", "W", "T"))
SPREAD_DIR = {"humerus": 8.0, "forearm": -8.0, "hand": 5.0}  # deg from lateral towards the tail

WHITE = (1.0, 1.0, 1.0)
WARM = (0.80, 0.70, 0.60)  # flat scanner light reads paler and cooler than the earth-brown wings in field photos


def _rgb_lin(c):
    return tuple(float(v) for v in bt.srgb_to_linear(np.asarray(c)))


BROWN_LIN = _rgb_lin((0.42, 0.355, 0.29))
DARK_BROWN_LIN = _rgb_lin((0.36, 0.30, 0.245))
BUFF_LIN = _rgb_lin((0.86, 0.81, 0.71))


def feather_specs():
    """Flight feathers and coverts of the left wing."""
    specs = []
    P_S = [0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84, 0.93, 1.0, 1.0]
    P_PHI_S = [92, 81, 70, 60, 50, 40, 31, 23, 16, 6]
    P_PHI_F = [8.5, 7.8, 7.0, 6.2, 5.4, 4.6, 3.8, 3.0, 2.2, 0.5]
    for i in range(10):
        specs.append(dict(name="P%d" % (i + 1), sprite="H%d" % (i + 1), parent="hand", s=P_S[i],
                          phi_f=P_PHI_F[i], phi_s=P_PHI_S[i], layer=(8 - i) if i < 9 else -1, lead=0.0,
                          bone="P%d" % (i + 1), tint=WHITE, flight=True))
    S_S = [0.94, 0.79, 0.64, 0.49, 0.34, 0.19]
    for i in range(6):
        specs.append(dict(name="S%d" % (i + 1), sprite="A%d" % (i + 1), parent="forearm", s=S_S[i],
                          phi_f=170.5 + i, phi_s=100.0 - 0.5 * i, layer=9 + i, lead=0.0,
                          bone="S%d" % (i + 1), tint=WHITE, flight=True))
    for name, sprite, parent, s, pf, ps, layer in (
        ("S7", "A7", "forearm", 0.06, 176.0, 101.0, 15),
        ("S8", "A8", "humerus", 0.93, 30.0, 112.0, 16),
        ("S9", "A9", "humerus", 0.82, 34.0, 120.0, 17),
    ):
        specs.append(dict(name=name, sprite=sprite, parent=parent, s=s, phi_f=pf, phi_s=ps, layer=layer,
                          lead=0.0, bone=name, tint=WHITE, flight=True))
    flights = {sp["name"]: sp for sp in specs}
    # primary coverts: one per primary, exactly following it
    for i in range(9):
        p = flights["P%d" % (i + 1)]
        specs.append(dict(name="PC%d" % (i + 1), sprite="HD%d" % (1 + i % 4), parent="hand", s=p["s"],
                          phi_f=p["phi_f"] - 0.5, phi_s=p["phi_s"] - 0.5, layer=18 + (8 - i) * 0.12, lead=0.6,
                          bone=p["bone"], tint=WHITE, length=15.5 - 0.4 * abs(i - 4), flight=False))
    # greater coverts: one per secondary / tertial, aligned with it, ~40% of its length
    for j, key in enumerate(["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]):
        f = flights[key]
        specs.append(dict(name="GC%d" % (j + 1), sprite=("GC01", "GC3")[j % 2], parent=f["parent"], s=f["s"],
                          phi_f=f["phi_f"] - 1.0, phi_s=f["phi_s"] - 1.0, layer=19.5 + j * 0.12, lead=0.45,
                          bone=f["bone"], tint=WHITE, length=17.5 if j < 6 else (15.5, 14.0, 12.5)[j - 6], flight=False))

    def sec_phi(s):
        f = np.clip((0.94 - s) / 0.75, 0.0, 1.0)
        return 170.5 + 5.0 * f, 100.0 - 2.5 * f

    # median coverts: a tidy row of real covert feathers above the greater coverts
    for k in range(8):
        s = 0.17 + 0.74 * k / 7
        pf, ps = sec_phi(s)
        specs.append(dict(name="MC%d" % (k + 1), sprite=("GC3", "GC01")[k % 2], parent="forearm", s=s,
                          phi_f=pf - 4.0, phi_s=ps - 6.0, layer=21.0 + k * 0.1, lead=2.9, bone="forearm",
                          tint=WHITE, length=10.5, flight=False))
    # lesser coverts: two short rows along the forearm's leading edge, one along the hand
    for row, (lead, ln, pf0, ps0) in enumerate(((4.6, 5.2, 150.0, 82.0), (6.0, 4.4, 142.0, 74.0))):
        for k in range(10):
            s = 0.06 + 0.88 * (k + 0.5 * row) / 10
            specs.append(dict(name="LCf%d_%d" % (row, k), sprite="C%d" % ((k + 3 * row) % 8), parent="forearm", s=s,
                              phi_f=pf0, phi_s=ps0, layer=22.2 + row * 0.5 + k * 0.03, lead=lead, bone="forearm",
                              tint=DARK_BROWN_LIN, length=ln, width=ln * 0.82, flight=False))
    for k in range(5):
        s = 0.08 + 0.7 * k / 4
        specs.append(dict(name="LCh%d" % (k + 1), sprite="C%d" % ((k + 5) % 8), parent="hand", s=s,
                          phi_f=10.0, phi_s=40.0, layer=22.4 + k * 0.05, lead=2.2, bone="hand",
                          tint=DARK_BROWN_LIN, length=5.0, width=4.0, flight=False))
    # alula: three small feathers at the wrist along the leading edge
    for k, ln in enumerate((8.0, 9.5, 11.0)):
        specs.append(dict(name="AL%d" % (k + 1), sprite="HD%d" % (k + 1), parent="hand", s=0.02 + 0.03 * k,
                          phi_f=-4.0 + k, phi_s=-8.0 + 2 * k, layer=23.4 + k * 0.1, lead=1.6,
                          bone="hand", tint=WHITE, length=ln, flight=False))
    return specs


# ---------------------------------------------------------------- geometry helpers


def _norm(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def frame(origin, y_axis, z_hint):
    y = _norm(y_axis)
    z = np.asarray(z_hint, float) - np.dot(z_hint, y) * y
    z = _norm(z)
    x = np.cross(y, z)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, origin
    return M


def _body_bvh():
    body = bpy.data.objects["BT_Body"]
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(body, dg, deform=False)  # rest shape: the body is skinned once s08 has run


def fold_joints():
    """Folded left-wing joint positions (m) and fold-plane normal from the body surface."""
    bvh = _body_bvh()
    pts, nrms = {}, []
    for key, (px, py) in FOLD_PX.items():
        y, z = bs.half_to_bl(px, py)
        hit, nrm, _i, _d = bvh.ray_cast(Vector((0.08, float(y), float(z))), Vector((-1, 0, 0)))
        if hit is None:
            raise RuntimeError("no body surface at wing joint %s" % key)
        pts[key] = np.array([hit.x - INSET[key] * MM, y, z])
        nrms.append(np.array(nrm))
    n_f = _norm(np.mean(nrms, axis=0))
    return pts, n_f


def arm_frames(pts, n_f):
    """Folded and spread 4x4 frames for humerus / forearm / hand (left wing)."""
    folded, spread = {}, {}
    lengths = {}
    for name, a, b in ARM_BONES:
        folded[name] = frame(pts[a], pts[b] - pts[a], n_f)
        lengths[name] = float(np.linalg.norm(pts[b] - pts[a]))
    start = pts["S"].copy()
    for name, _a, _b in ARM_BONES:
        ang = math.radians(SPREAD_DIR[name])
        d = np.array([math.cos(ang), math.sin(ang), 0.0])
        spread[name] = frame(start, d, (0, 0, 1))
        start = start + d * lengths[name]
    return folded, spread, lengths


def load_arm():
    """Folded / spread arm frames and bone lengths saved by build_wings (no raycasts)."""
    with open(WING_JSON, encoding="utf-8") as f:
        data = json.load(f)
    pts = {k: np.array(v) for k, v in data["joints"].items()}
    return arm_frames(pts, np.array(data["fold_normal"]))


def feather_length_mm(meta, spec):
    return spec.get("length") or meta["feathers"][spec["sprite"]]["h_mm"]


def _inset_along(spec, s):
    a, b = {"humerus": ("S", "E"), "forearm": ("E", "W"), "hand": ("W", "T")}[spec]
    return INSET[a] + (INSET[b] - INSET[a]) * s


def feather_frame(bone_frame, length, spec, state):
    """World frame of a feather (Y along the feather, Z dorsal) for a given parent bone frame."""
    return feather_frame_fan(bone_frame, length, spec, 0.0 if state == "folded" else 1.0)


def feather_frame_fan(bone_frame, length, spec, fan, extra_phi=0.0):
    """Feather frame for a fan factor between 0 (folded) and 1 (spread)."""
    phi = math.radians(spec["phi_f"] + (spec["phi_s"] - spec["phi_f"]) * fan + extra_phi)
    layer_mm = LAYER_FOLD + (LAYER_SPREAD - LAYER_FOLD) * fan
    z_fold = _inset_along(spec["parent"], spec["s"]) + CLEAR
    z0 = z_fold + (0.35 - z_fold) * fan
    off = np.array([spec["lead"] * MM, spec["s"] * length, (z0 + spec["layer"] * layer_mm) * MM, 1.0])
    R = bone_frame[:3, :3]
    origin = (bone_frame @ off)[:3]
    y = R @ np.array([-math.sin(phi), math.cos(phi), 0.0])
    z = R[:, 2]
    return frame(origin, y, z)


# ---------------------------------------------------------------- cards


def card_mesh(F, L, W, uv, mirror_u, segs_l=6, segs_w=2, camber=0.05, bend=0.025, lift=0.0):
    """Feather card in frame F: root at origin, along +Y, across X, normal +Z."""
    u0, v0, u1, v1 = uv
    verts, uvs = [], []
    for i in range(segs_l + 1):
        t = i / segs_l
        y = t * L
        zl = -bend * L * t * t + lift * L * t * (1 - 0.55 * t)
        for j in range(segs_w + 1):
            s = j / segs_w
            x = (s - 0.5) * W
            z = zl + camber * W * (1 - (2 * s - 1) ** 2)
            verts.append((F @ np.array([x, y, z, 1.0]))[:3])
            uu = u1 - (u1 - u0) * s if mirror_u else u0 + (u1 - u0) * s
            uvs.append((uu, v0 + (v1 - v0) * t))
    faces = []
    for i in range(segs_l):
        for j in range(segs_w):
            a = i * (segs_w + 1) + j
            faces.append((a, a + 1, a + segs_w + 2, a + segs_w + 1))
    return np.array(verts), faces, uvs


class CardBuilder:
    def __init__(self, meta):
        self.meta = meta
        self.V, self.F, self.UV, self.COL, self.GROUP = [], [], [], [], []
        self.n = 0

    def add(self, F, sprite, tint, bone, length=None, width=None, **kw):
        info = self.meta["feathers"][sprite]
        L = (length if length else info["h_mm"]) * MM
        if width:
            W = width * MM
        else:
            W = info["w_mm"] * MM * (L / (info["h_mm"] * MM) if length else 1.0)
        v, f, uv = card_mesh(F, L, W, info["uv"], mirror_u=(info["narrow"] == "L"), **kw)
        self.V.append(v)
        self.F.extend(tuple(i + self.n for i in face) for face in f)
        loops = [uv[i] for face in f for i in face]
        self.UV.extend(loops)
        self.COL.append(np.tile(np.array([*tint, 1.0]), (len(v), 1)))
        self.GROUP.extend([bone] * len(v))
        self.n += len(v)

    def build(self, name, material, mirror_x=False, rename=None):
        V = np.vstack(self.V)
        F = list(self.F)
        UV = list(self.UV)
        groups = list(self.GROUP)
        if mirror_x:
            V = V * np.array([-1.0, 1.0, 1.0])
            F = [tuple(reversed(face)) for face in F]
            # reversed faces need their loop UVs reversed too
            UV2, k = [], 0
            for face in self.F:
                loops = UV[k : k + len(face)]
                UV2.extend(reversed(loops))
                k += len(face)
            UV = UV2
        if rename:
            groups = [rename(g) for g in groups]
        ob = bt.mesh_object(name, V, F, uvs=np.array(UV))
        me = ob.data
        attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        attr.data.foreach_set("color", np.vstack(self.COL).astype(np.float32).ravel())
        me.color_attributes.active_color = attr
        for g in sorted(set(groups)):
            vg = ob.vertex_groups.new(name=g)
            idx = [i for i, gg in enumerate(groups) if gg == g]
            vg.add(idx, 1.0, "REPLACE")
        bt.assign(ob, material)
        return ob


# ---------------------------------------------------------------- wings


def build_wings(meta, material):
    pts, n_f = fold_joints()
    folded, spread, lengths = arm_frames(pts, n_f)
    specs = feather_specs()
    cb = CardBuilder(meta)
    for sp in specs:
        F = feather_frame(folded[sp["parent"]], lengths[sp["parent"]], sp, "folded")
        kw = dict(camber=0.05, bend=0.02) if sp["flight"] else dict(camber=0.05, bend=0.0, lift=0.0)
        tint = WARM if sp["tint"] == WHITE else sp["tint"]
        cb.add(F, sp["sprite"], tint, sp["bone"] + ".L", length=sp.get("length"), width=sp.get("width"), **kw)
    left = cb.build("BT_Wing_L", material)
    right = cb.build("BT_Wing_R", material, mirror_x=True, rename=lambda g: g[:-2] + ".R")
    with open(WING_JSON, "w", encoding="utf-8") as f:
        json.dump({"joints": {k: v.tolist() for k, v in pts.items()}, "fold_normal": n_f.tolist(),
                   "lengths": lengths}, f, indent=1)
    return left, right


# ---------------------------------------------------------------- tail

TAIL_BASE_PX = (452.0, 262.0)
TAIL_TIP_PX = (530.0, 328.0)
TAIL_RAISE_DEG = 12.0  # carry the tail a little higher than the upright photo


def tail_frame():
    """Tail base frame: Y along the tail, Z dorsal, X to the bird's left."""
    y0, z0 = bs.half_to_bl(*TAIL_BASE_PX)
    y1, z1 = bs.half_to_bl(*TAIL_TIP_PX)
    dy, dz = y1 - y0, z1 - z0
    a = math.radians(TAIL_RAISE_DEG)
    d = np.array([0.0, dy * math.cos(a) - dz * math.sin(a), dy * math.sin(a) + dz * math.cos(a)])
    up = np.array([0.0, -d[2], d[1]])
    return frame(np.array([0.0, y0, z0]), d, up)


def rectrix_frame(T, i, side, fan_deg_per=1.6, roll_deg_per=3.5):
    """Rectrix i (1 = central) on side (+1 left / -1 right) in tail frame T.

    Outer feathers sit lower and roll outward-down, giving the closed tail a shallow roof profile.
    """
    off = np.array([side * (0.35 + (i - 1) * 0.75) * MM, -1.5 * MM, -(i - 1) * 0.24 * MM, 1.0])
    ang = math.radians(side * (i - 1) * fan_deg_per)
    R = T[:3, :3]
    y = R @ np.array([math.sin(ang), math.cos(ang), 0.0])
    F = frame((T @ off)[:3], y, R[:, 2])
    rho = math.radians(side * (i - 1) * roll_deg_per)
    c, s = math.cos(rho), math.sin(rho)
    roll = np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1]])
    return F @ roll


UNDERTAIL_CARDS = True


def build_tail(meta, material):
    T = tail_frame()
    cb = CardBuilder(meta)
    for side, sfx in ((1, ".L"), (-1, ".R")):
        for i in range(1, 7):
            F = rectrix_frame(T, i, side)
            if side < 0:
                F = F @ np.diag([-1.0, 1.0, 1.0, 1.0])  # mirror the card so the outer vane faces outwards
            cb.add(F, "S%d" % i, WHITE, "R%d%s" % (i, sfx), camber=0.03, bend=-0.01)
    # coverts over and under the tail base: real scanned coverts on top (the generic contour sprite's barb
    # notches shred at this size), short buff undertail coverts kept in under the closed tail
    R = T[:3, :3]
    for k in range(7):
        x = (k - 3) * 1.7 * MM
        up = R[:, 2]
        F = frame((T @ np.array([x, -5.5 * MM, 1.1 * MM, 1.0]))[:3], R[:, 1] + up * 0.10 + R[:, 0] * x * 12, up)
        cb.add(F, ("GC01", "GC3")[k % 2], WARM, "tail", length=11.5 - abs(k - 3) * 0.7, width=6.2, camber=0.10, lift=0.03)
        if not UNDERTAIL_CARDS:
            continue
        xu = (k - 3) * 1.1 * MM
        F = frame((T @ np.array([xu, -6.5 * MM, -1.8 * MM, 1.0]))[:3], R[:, 1] - up * 0.18 + R[:, 0] * xu * 6, -up)
        cb.add(F, "C%d" % ((k + 4) % 8), BUFF_LIN, "tail", length=10.0 - abs(k - 3) * 0.7, width=6.0, camber=0.10, lift=0.05)
    return cb.build("BT_Tail", material), T


# ---------------------------------------------------------------- body contour feathers

CONTOUR_COUNT = 3600  # candidates; only those in the flank-over-wing and vent zones are kept
WING_NEAR_MM = 4.0
FACE_RINGS, HEAD_RINGS = 20, 30
CONTOUR_MM = [1.1, 1.3, 1.5, 1.6, 1.8, 2.2, 2.8, 3.8, 4.8, 5.6, 6.2, 6.4, 5.8, 5.2]  # length by landmark ring


def transfer_normals(ob, source, k=4, only=None):
    """Give cards the smooth normals of the surface they lie on, so they shade as plumage, not plates."""
    from mathutils.kdtree import KDTree

    src = bt.object_verts(source)
    sn = np.empty(len(source.data.vertices) * 3, np.float32)
    source.data.vertices.foreach_get("normal", sn)
    sn = sn.reshape(-1, 3).astype(np.float64)
    idx_ok = np.arange(len(src)) if only is None else np.nonzero(only)[0]
    kd = KDTree(len(idx_ok))
    for j, i in enumerate(idx_ok):
        kd.insert(src[i], j)
    kd.balance()
    co = bt.object_verts(ob)
    out = np.zeros_like(co)
    for vi, p in enumerate(co):
        acc = np.zeros(3)
        for _c, j, dist in kd.find_n(p, k):
            acc += sn[idx_ok[j]] / (dist + 1e-5)
        out[vi] = acc / np.linalg.norm(acc)
    ob.data.normals_split_custom_set_from_vertices([tuple(n) for n in out])


SCAP_PX = [(340, 156), (351, 162), (362, 168), (373, 176), (385, 186), (397, 196)]


def build_scapulars(meta, material):
    """Soft brown scapulars on both shoulders, lying over the top edge of the folded wing."""
    bvh = _body_bvh()
    col_img = bt.image_np(bpy.data.images["BT_Body_Color"])[..., :3]
    cb = CardBuilder(meta)
    back = np.array([0.0, math.cos(math.radians(30)), -math.sin(math.radians(30))])
    rng = np.random.default_rng(5)
    brown = np.array(BROWN_LIN)
    for k, (px, py) in enumerate(SCAP_PX):
        y, z = bs.half_to_bl(px, py)
        hit, nrm, _i, _d = bvh.ray_cast(Vector((0.08, float(y), float(z))), Vector((-1, 0, 0)))
        if hit is None:
            continue
        p, n = np.array(hit), np.array(nrm)
        d = back - n * (back @ n)
        L = (9.5, 11.0, 12.0, 12.0, 11.0, 9.5)[k]
        F = frame(p + n * 0.3 * MM, d, n)
        tint = tuple(float(c) for c in brown * (0.94 + 0.1 * rng.random()))
        for M in (F, D4 @ F @ D4):
            cb.add(M, "C%d" % ((k * 3) % 8), tint, "chest", length=L, width=L * 0.82, segs_l=3, segs_w=2,
                   camber=0.08, bend=0.0, lift=0.03)
    ob = cb.build("BT_Scapulars", material)
    transfer_normals(ob, bpy.data.objects["BT_Body"])
    return ob


def build_trousers(meta, material, per_leg=26):
    """Belly-coloured feathers clothing each feathered tibia."""
    import s04_parts as parts

    belly = np.array(_rgb_lin((0.80, 0.765, 0.70)))
    rng = np.random.default_rng(9)
    cb = CardBuilder(meta)
    for side, sfx in ((1, ".L"), (-1, ".R")):
        leg = bpy.data.objects["BT_Leg" + ("_L" if side > 0 else "_R")]
        co = bt.object_verts(leg)
        part = np.empty(len(co), dtype=np.int32)
        leg.data.attributes["bt_part"].data.foreach_get("value", part)
        tib = np.nonzero(part == parts.PART_TIBIA)[0]
        hip = np.array([side * parts.HIP[0], parts.HIP[1], parts.HIP[2]]) * MM
        heel = np.array([side * parts.HEEL[0], parts.HEEL[1], parts.HEEL[2]]) * MM
        axis = _norm(heel - hip)
        for vi in rng.choice(tib, size=per_leg, replace=False):
            p = co[vi]
            t = (p - hip) @ axis
            radial = p - (hip + axis * t)
            if np.linalg.norm(radial) < 1e-9:
                continue
            n = _norm(radial)
            F = frame(p + n * 0.08 * MM, axis + n * 0.05, n)
            L = 2.8 + 1.1 * rng.random()
            tint = tuple(float(c) for c in belly * (0.95 + 0.08 * rng.random()))
            cb.add(F, "C%d" % rng.integers(0, 8), tint, "tibia" + sfx, length=L, width=L * 0.8, segs_l=3, segs_w=2,
                   camber=0.10, bend=0.0, lift=0.0)
    return cb.build("BT_Trousers", material)


def build_contours(meta, material, rng_seed=7):
    """Loose contour feathers only where real ones break the surface: flank feathers tucked over the
    folded wing's lower edge and the fluffy undertail / vent. Everywhere else the texture reads better."""
    import s03_body as sb
    import s05_plumage as spl
    from mathutils.kdtree import KDTree

    body = bpy.data.objects["BT_Body"]
    cls_map = np.load(os.path.join(sb.BUILD, "plumage_cls.npy"))
    Hc, Wc = cls_map.shape
    wing_pts = np.vstack([bt.object_verts(bpy.data.objects[n]) for n in ("BT_Wing_L", "BT_Wing_R")])
    kd = KDTree(len(wing_pts))
    for j, q in enumerate(wing_pts):
        kd.insert(Vector(q), j)
    kd.balance()
    data = np.load(os.path.join(sb.BUILD, "body_field.npz"))
    seg, n = int(data["seg"]), int(data["rings"])
    loop = 2 * seg
    co = bt.object_verts(body)
    grid = np.stack([co[i * loop : (i + 1) * loop] for i in range(n)])  # (n, loop, 3) full rings
    sizes = sb.ring_values(CONTOUR_MM)
    col_img = bt.image_np(bpy.data.images["BT_Body_Color"])[..., :3]  # row 0 = v 0
    H, W = col_img.shape[:2]
    vcoord = data["vcoord"]
    eye_y, eye_z = bs.half_to_bl(*bs.EYE_PX)
    rng = np.random.default_rng(rng_seed)
    # area weights per quad
    a = grid[:-1, :]
    b = np.roll(grid[:-1, :], -1, axis=1)
    c = np.roll(grid[1:, :], -1, axis=1)
    area = np.linalg.norm(np.cross(b - a, c - a), axis=2)
    ring_mid = np.arange(n - 1) + 0.5
    dens = 1.0 / np.maximum(np.interp(ring_mid, np.arange(n), sizes), 1.0) ** 1.6
    wgt = area * dens[:, None]
    wgt[: 3] = 0.0  # no cards on the bill stub
    flat = wgt.ravel() / wgt.sum()
    picks = rng.choice(len(flat), size=CONTOUR_COUNT, p=flat, replace=True)
    cb = CardBuilder(meta)
    placed = 0
    for idx in picks:
        i, k = divmod(int(idx), loop)
        if i < FACE_RINGS or (i < HEAD_RINGS and rng.random() < 0.5):
            continue  # head, face and upper bib stay texture-only (finest feathers); the neck gets few cards
        fi, fk = rng.random(), rng.random()
        k2 = (k + 1) % loop
        p = (grid[i, k] * (1 - fi) * (1 - fk) + grid[i + 1, k] * fi * (1 - fk) + grid[i, k2] * (1 - fi) * fk + grid[i + 1, k2] * fi * fk)
        if np.hypot(p[1] - eye_y, p[2] - eye_z) < 3.6 * MM and abs(abs(p[0]) - 0.008) < 0.006:
            continue
        v_root = float(np.interp(i + fi, np.arange(n), vcoord))
        u_root = min(max((k + fk) / seg if k < seg else (loop - (k + fk)) / seg, 0.0), 1.0)
        c = cls_map[min(int(v_root * Hc), Hc - 1), min(int(u_root * Wc), Wc - 1)]
        near_wing = kd.find(Vector(p))[2] < WING_NEAR_MM * MM
        if not (c == spl.UNDERTAIL or (c in (spl.FLANK, spl.BELLY) and near_wing)):
            continue
        along = (grid[i + 1, k] + grid[i + 1, k2]) / 2 - (grid[i, k] + grid[i, k2]) / 2
        around = (grid[i, k2] + grid[i + 1, k2]) / 2 - (grid[i, k] + grid[i + 1, k]) / 2
        nrm = np.cross(around, along)
        if np.linalg.norm(nrm) < 1e-12:
            continue
        nrm = _norm(nrm)
        if np.dot(nrm, p - np.array([0.0, p[1], p[2]])) < 0 and abs(p[0]) > 0.002:
            nrm = -nrm
        ring_f = i + fi
        L = float(np.interp(ring_f, np.arange(n), sizes)) * (0.85 + 0.3 * rng.random())
        jitter = math.radians(rng.normal(0, 7))
        t_axis = _norm(along)
        side_axis = np.cross(nrm, t_axis)
        d = t_axis * math.cos(jitter) + side_axis * math.sin(jitter)
        F = frame(p + nrm * (0.10 + 0.08 * rng.random()) * MM, d, nrm)
        # colour from the plumage texture a little behind the root (where the visible tip lies)
        v = float(np.interp(ring_f + 0.55 * L * MM / max(np.linalg.norm(along), 1e-9), np.arange(n), vcoord))
        u = (k + fk) / seg if k < seg else (loop - (k + fk)) / seg
        u = min(max(u, 0.0), 1.0)
        px = bt.srgb_to_linear(col_img[min(int(v * H), H - 1), min(int(u * W), W - 1)])
        tint = tuple(float(x) for x in px * (0.98 + 0.04 * rng.random()))
        cb.add(F, "C%d" % rng.integers(0, 8), tint, "body", length=L, width=L * 0.78,
               segs_l=3, segs_w=2, camber=0.08, bend=0.0, lift=0.02 + 0.04 * rng.random())
        placed += 1
    ob = cb.build("BT_Contour", material)
    transfer_normals(ob, body)
    return ob, placed


# ---------------------------------------------------------------- down

DOWN_TUFTS = 4
DOWN_MM = [1.0, 1.2, 1.4, 1.6, 1.9, 2.3, 2.8, 3.3, 3.8, 4.2, 4.6, 4.8, 4.4, 3.8]  # tuft length by landmark ring
DOWN_COUNT = 4400  # area-weighted candidates; those on the eyes, bill or under the wings are dropped


def down_atlas(size=256, seed=21):
    """Plumulaceous tufts: fine curving filaments fanning from a base (v = 0), fading to the tips."""
    import s05_plumage as spl

    W, H = size * DOWN_TUFTS, size
    acc = np.zeros((H, W), np.float32)
    rng = np.random.default_rng(seed)
    s = np.linspace(0.0, 1.0, 220)
    for k in range(DOWN_TUFTS):
        x0 = k * size + size / 2
        for _ in range(70):
            L = size * rng.uniform(0.5, 0.97)
            theta = rng.normal(0.0, 0.30) + rng.normal(0.0, 0.8) * s * s
            x = x0 + rng.normal(0.0, size * 0.035) + np.cumsum(np.sin(theta)) * L / len(s)
            y = rng.uniform(0.0, size * 0.06) + np.cumsum(np.cos(theta)) * L / len(s)
            xi = np.clip(np.round(x).astype(int), k * size + 1, (k + 1) * size - 2)
            yi = np.clip(np.round(y).astype(int), 0, H - 1)
            np.maximum.at(acc, (yi, xi), 0.95 * (1.0 - s ** 1.4))
    acc = spl.blur(acc, 1, 1, passes=1)
    rgba = np.ones((H, W, 4), np.float32)
    rgba[..., :3] *= (0.82 + 0.18 * np.arange(H) / H)[:, None, None]  # greyer toward the base
    rgba[..., 3] = np.clip(acc * 2.2, 0, 1)
    img = bt.np_image(rgba, "BT_Down_Atlas", path=os.path.join(bt.TEX, "down_atlas.png"))
    meta = {"feathers": {"D%d" % k: {"uv": (k / DOWN_TUFTS, 0.0, (k + 1) / DOWN_TUFTS, 1.0),
                                     "h_mm": 3.0, "w_mm": 2.4, "narrow": None} for k in range(DOWN_TUFTS)}}
    return img, meta


def down_material(img):
    return bt.material_textured(
        "BT_Down", img, roughness=0.8, vertex_color="Col", sheen=0.14, sheen_tint=(0.72, 0.69, 0.65),
        specular=0.2, double_sided=True, alpha_blend=True,
    )


def build_down(meta, material, rng_seed=17):
    """Down and loose barbs breaking the plumage surface: wispy tufts over head and body that soften the
    silhouette - fluffiest on belly, flanks and vent, short and fine on the head and back."""
    import s03_body as sb
    import s04_parts as parts
    from mathutils.kdtree import KDTree

    body = bpy.data.objects["BT_Body"]
    data = np.load(os.path.join(sb.BUILD, "body_field.npz"))
    seg, n = int(data["seg"]), int(data["rings"])
    loop = 2 * seg
    co = bt.object_verts(body)
    grid = np.stack([co[i * loop : (i + 1) * loop] for i in range(n)])
    sizes = sb.ring_values(DOWN_MM)
    col_img = bt.image_np(bpy.data.images["BT_Body_Color"])[..., :3]
    H, W = col_img.shape[:2]
    vcoord = data["vcoord"]
    eyes = [np.array(bpy.data.objects[e].matrix_world.translation) for e in ("BT_Eye_L", "BT_Eye_R")]
    cover = np.vstack([bt.object_verts(bpy.data.objects[nm]) for nm in ("BT_Wing_L", "BT_Wing_R", "BT_Scapulars")])
    kd = KDTree(len(cover))
    for j, q in enumerate(cover):
        kd.insert(Vector(q), j)
    kd.balance()
    rng = np.random.default_rng(rng_seed)
    a = grid[:-1, :]
    b = np.roll(grid[:-1, :], -1, axis=1)
    c = np.roll(grid[1:, :], -1, axis=1)
    area = np.linalg.norm(np.cross(b - a, c - a), axis=2)
    area[:2] = 0.0
    picks = rng.choice(area.size, size=DOWN_COUNT, p=(area / area.sum()).ravel(), replace=True)
    cb = CardBuilder(meta)
    placed = 0
    for idx in picks:
        i, k = divmod(int(idx), loop)
        fi, fk = rng.random(), rng.random()
        k2 = (k + 1) % loop
        p = (grid[i, k] * (1 - fi) * (1 - fk) + grid[i + 1, k] * fi * (1 - fk) + grid[i, k2] * (1 - fi) * fk + grid[i + 1, k2] * fi * fk)
        if min(np.linalg.norm(p - e) for e in eyes) < 2.9 * MM:
            continue
        if parts._to_half_px(p[None, :])[0][0] < parts.FACE_LINE_PX + 1.0:
            continue  # on / in front of the bill base
        if kd.find(Vector(p))[2] < 2.2 * MM:
            continue  # under the folded wing or scapulars
        along = (grid[i + 1, k] + grid[i + 1, k2]) / 2 - (grid[i, k] + grid[i, k2]) / 2
        around = (grid[i, k2] + grid[i + 1, k2]) / 2 - (grid[i, k] + grid[i + 1, k]) / 2
        nrm = np.cross(around, along)
        if np.linalg.norm(nrm) < 1e-12:
            continue
        nrm = _norm(nrm)
        if np.dot(nrm, p - np.array([0.0, p[1], p[2]])) < 0 and abs(p[0]) > 0.002:
            nrm = -nrm
        u = (k + fk) / seg if k < seg else (loop - (k + fk)) / seg
        u = min(max(u, 0.0), 1.0)
        L = float(np.interp(i + fi, np.arange(n), sizes)) * (0.7 + 0.6 * rng.random()) * (1.15 - 0.45 * u)
        jitter = math.radians(rng.normal(0, 22))
        t_axis = _norm(along)
        d = t_axis * math.cos(jitter) + np.cross(nrm, t_axis) * math.sin(jitter)
        F = frame(p - nrm * 0.12 * MM, d, nrm)
        v = float(np.interp(i + fi + 0.5 * L * MM / max(np.linalg.norm(along), 1e-9), np.arange(n), vcoord))
        px = bt.srgb_to_linear(col_img[min(int(v * H), H - 1), min(int(u * W), W - 1)])
        tint = tuple(float(x) for x in np.clip(px * (0.96 + 0.08 * rng.random()), 0, 1))
        cb.add(F, "D%d" % rng.integers(0, DOWN_TUFTS), tint, "body", length=L, width=L * 0.8,
               segs_l=2, segs_w=1, camber=0.0, bend=0.0, lift=0.55 + 0.5 * rng.random())
        placed += 1
    ob = cb.build("BT_Down", material)
    transfer_normals(ob, body)
    return ob, placed


# ---------------------------------------------------------------- material and run


def feather_material(atlas_img, normal_img=None):
    return bt.material_textured(
        "BT_Feathers", atlas_img, normal_img=normal_img, normal_strength=0.6, roughness=0.62, alpha_clip=0.5,
        vertex_color="Col", sheen=0.05, sheen_tint=(0.6, 0.55, 0.5), specular=0.35, double_sided=True,
    )


def _image(name, file, non_color=False):
    img = bpy.data.images.get(name) or bt.load_image(os.path.join(bt.TEX, file), name)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def run():
    meta = json.load(open(os.path.join(BUILD, "feather_atlas.json"), encoding="utf-8"))
    atlas = _image("BT_Feather_Atlas", "feather_atlas.png")
    atlas_n = _image("BT_Feather_Atlas_Normal", "feather_atlas_normal.png", non_color=True)
    mat = feather_material(atlas, atlas_n)
    left, right = build_wings(meta, mat)
    tail, _T = build_tail(meta, mat)
    scap = build_scapulars(meta, mat)
    contour, placed = build_contours(meta, mat)
    trousers = build_trousers(meta, mat)
    down_img, down_meta = down_atlas()
    _down, n_down = build_down(down_meta, down_material(down_img))
    return "feathers: wings %d+%d verts, tail %d, scapulars %d, contour cards %d, trousers %d, down tufts %d" % (
        len(left.data.vertices), len(right.data.vertices), len(tail.data.vertices), len(scap.data.vertices) // 12,
        placed, len(trousers.data.vertices) // 12, n_down)
