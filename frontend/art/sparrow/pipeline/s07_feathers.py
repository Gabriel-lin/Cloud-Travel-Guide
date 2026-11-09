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

import splib as bt
import spshape as bs

MM = bt.MM
D4 = np.diag([-1.0, 1.0, 1.0, 1.0])  # mirror across the bird's midplane (applied as D @ F @ D)
BUILD = bt.BUILD
WING_JSON = os.path.join(BUILD, "wing_rest.json")

# Folded wing joints on the side photo (half-res px) and how far they sit inside the body surface (mm).
FOLD_PX = {"S": (308, 140), "E": (345, 198), "W": (265, 190), "T": (343, 224)}  # tree sparrow: carpal at the breast side, tip at mid-tail
INSET = {"S": 3.5, "E": 2.4, "W": 1.6, "T": 2.2}
# Fitted to Halun's side photo with tools/measure_side.py (bend -> tip, depth, primary projection).
WING_LEN_SCALE = 0.63
HAND_FRAC = 1.0  # fraction of the photo wrist->T distance that is hand bone
P_EXTRA = 1.0  # primaries lengthened by what the hand gave up (folded tip stays on the photo's)
EXTRA_LEN = {"S1": 0.84, "S2": 0.83, "S3": 0.81, "S4": 0.79, "S5": 0.77, "S6": 0.77, "S7": 1.05, "S8": 1.62, "S9": 1.6}  # tree sparrow tertials nearly cover the folded primaries
SEC_PHI_ADD = 8.0
# Coverts are not shortened as much as the remiges: on Halun's bird they cover the whole upper folded wing.
COVERT_W = 1.0  # extra width factor for the open wing's coverts
COVERT_EXTRA = {"GC": 1.15, "MC": 1.55, "LCf": 1.45, "LCh": 1.3, "PC": 1.15}
SPREAD_W = {"P": 2.0, "S": 2.1, "T": 1.45}  # open-wing vane widening per flight-feather bone (s09): real remiges are slender, their vanes overlap by the fan, not by a fat blade


def open_width_factor(bone):
    """Width factor the rig applies to a flight-feather bone when the wing opens (coverts ride on those bones)."""
    k = bone.split(".")[0]
    i = int(k[1:])
    if k[0] == "P":
        return SPREAD_W["P"] * (0.85 if i >= 8 else 1.0)
    return SPREAD_W["T"] if i >= 7 else SPREAD_W["S"]


PRIMARY_WIDTH = 0.84  # primary vane width factor (scan width x this)
P_PHI_ADD = 4.0  # primaries a little closer to the axis: rounded-pointed closed wing tip  # secondaries lie closer along the bend->tip axis (photo fit)
FOLD_YAW = 1.0  # tree sparrow body tapers fast behind the belly: yaw the closed wing inward
TAIL_LEN_SCALE = 0.715  # fitted: tail tip on the photo's tail tip
CLEAR = 0.7  # mm between body surface and the innermost feather
LAYER_FOLD, LAYER_SPREAD = 0.12, 0.14  # mm per stacking layer
ARM_BONES = (("humerus", "S", "E"), ("forearm", "E", "W"), ("hand", "W", "T"))
SPREAD_DIR = {"humerus": 8.0, "forearm": -8.0, "hand": 5.0}  # deg from lateral towards the tail

WHITE = (1.0, 1.0, 1.0)
WARM = (1.0, 1.0, 1.0)  # s06 bakes the tree sparrow pattern into every scanned sprite  # recolours the bluethroat scans to the tree sparrow's warmer dark brown with rufous edges
WING_BAR = (1.0, 0.99, 0.95)  # white tips of the median coverts (upper wing bar)
WING_BAR2 = (0.95, 0.88, 0.74)  # buff-white greater covert tips (lower wing bar)
CHESTNUT_LIN = None  # set below


def _rgb_lin(c):
    return tuple(float(v) for v in bt.srgb_to_linear(np.asarray(c)))


BROWN_LIN = _rgb_lin((0.42, 0.355, 0.29))
DARK_BROWN_LIN = _rgb_lin((0.36, 0.30, 0.245))
BUFF_LIN = _rgb_lin((0.76, 0.72, 0.65))  # undertail coverts, pale-fringed (photo)
CHESTNUT_LIN = _rgb_lin((0.52, 0.30, 0.19))


def feather_specs():
    """Flight feathers and coverts of the left wing."""
    specs = []
    P_S = [0.12, 0.24, 0.36, 0.48, 0.60, 0.72, 0.84, 0.93, 1.0, 1.0]
    P_PHI_S = [98, 88, 78, 67, 56, 46, 36, 26, 17, 8]  # open hand: P1 continues the secondaries' trailing edge (no slot at the wrist), P9 near the leading edge
    P_PHI_F = [8.5, 7.8, 7.0, 6.2, 5.4, 4.6, 3.8, 3.0, 2.2, 0.5]
    for i in range(10):
        specs.append(dict(name="P%d" % (i + 1), sprite="H%d" % (i + 1), parent="hand", s=P_S[i],
                          phi_f=P_PHI_F[i] + P_PHI_ADD, phi_s=P_PHI_S[i], layer=(8 - i) if i < 9 else -1, lead=0.0,
                          bone="P%d" % (i + 1), tint=WHITE, flight=True))
    S_S = [0.94, 0.79, 0.64, 0.49, 0.34, 0.19]
    for i in range(6):
        specs.append(dict(name="S%d" % (i + 1), sprite="A%d" % (i + 1), parent="forearm", s=S_S[i],
                          phi_f=170.5 + i + SEC_PHI_ADD, phi_s=100.0 - 0.5 * i, layer=9 + i, lead=0.0,
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
        specs.append(dict(name="GC%d" % (j + 1), sprite=("GCs1", "GCs2")[j % 2], parent=f["parent"], s=f["s"],
                          phi_f=f["phi_f"] - 1.0, phi_s=f["phi_s"] - 1.0, layer=19.5 + j * 0.12, lead=0.45,
                          bone=f["bone"], tint=WHITE, length=17.5 if j < 6 else (15.5, 14.0, 12.5)[j - 6], flight=False))

    def sec_phi(s):
        f = np.clip((0.94 - s) / 0.75, 0.0, 1.0)
        return 170.5 + 5.0 * f, 100.0 - 2.5 * f

    # median coverts: a tidy row of real covert feathers above the greater coverts
    for k in range(8):
        s = 0.17 + 0.74 * k / 7
        pf, ps = sec_phi(s)
        specs.append(dict(name="MC%d" % (k + 1), sprite=("MCs2", "MCs1")[k % 2], parent="forearm", s=s,
                          phi_f=pf - 4.0, phi_s=ps - 6.0, layer=21.0 + k * 0.1, lead=3.4, bone="forearm",
                          tint=WHITE, length=10.5, flight=False))
    # lesser coverts: two short rows along the forearm's leading edge, one along the hand
    for row, (lead, ln, pf0, ps0) in enumerate(((4.0, 8.2, 150.0, 82.0), (5.4, 6.6, 142.0, 74.0))):
        for k in range(10):
            s = 0.06 + 0.88 * (k + 0.5 * row) / 10
            specs.append(dict(name="LCf%d_%d" % (row, k), sprite="C%d" % ((k + 3 * row) % 8), parent="forearm", s=s,
                              phi_f=pf0, phi_s=ps0, layer=22.2 + row * 0.5 + k * 0.03, lead=lead, bone="forearm",
                              tint=CHESTNUT_LIN, length=ln, width=ln * 0.82, flight=False))
    # second median row and a third (marginal) lesser row: the open wing's inner half reads full and dense
    # (flight_spread_mildeep, flight_pair_pavadk: covert rows overlap continuously over the forearm)
    for k in range(9):
        s = 0.12 + 0.80 * (k + 0.5) / 9
        pf, ps = sec_phi(s)
        specs.append(dict(name="MD%d" % (k + 1), sprite=("MCs1", "MCs2")[k % 2], parent="forearm", s=s,
                          phi_f=pf - 6.0, phi_s=ps - 8.0, layer=20.6 + k * 0.1, lead=2.6, bone="forearm",
                          tint=WHITE, length=12.5, flight=False))
    for k in range(12):
        s = 0.04 + 0.92 * k / 11
        specs.append(dict(name="LCm%d" % k, sprite="C%d" % ((k + 1) % 8), parent="forearm", s=s,
                          phi_f=156.0, phi_s=88.0, layer=22.0 + k * 0.03, lead=4.6, bone="forearm",
                          tint=CHESTNUT_LIN, length=7.4, width=6.4, flight=False))
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
    # coverts that used to sit rigidly on the forearm / hand bone kept their folded orientation when the wing opened and
    # hung off the arm: ride on the flight feather nearest along the bone instead (like the greater coverts), so
    # lesser / median coverts fan out with the remiges and stay on top of them
    sec = [s for s in specs if s["flight"] and s["parent"] == "forearm"]
    prim = [s for s in specs if s["flight"] and s["parent"] == "hand"]
    for sp in specs:
        if sp["flight"] or sp["bone"] not in ("forearm", "hand"):
            continue
        pool = sec if sp["bone"] == "forearm" else prim
        sp["bone"] = min(pool, key=lambda q: abs(q["s"] - sp["s"]))["bone"]
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
    body = bpy.data.objects["SP_Body"]
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
    # carpometacarpus + digits: the photo's 'T' point is where the visible hand feathers converge; the real
    # hand bone is much shorter (Passer: hand ~ 14 mm vs P9 ~ 50 mm) - shorten it, primaries take the rest
    pts["T"] = pts["W"] + HAND_FRAC * (pts["T"] - pts["W"])
    n_f = _norm(np.mean(nrms, axis=0))
    n_f = _norm(n_f + np.array([0.0, FOLD_YAW, 0.0]))  # fold plane follows the body narrowing to the tail
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
    group = next((k for k in COVERT_EXTRA if spec["name"].startswith(k)), None)
    extra = EXTRA_LEN.get(spec["name"], COVERT_EXTRA.get(group, 1.0))
    if spec["name"].startswith("P") and not spec["name"].startswith("PC"):
        extra *= P_EXTRA if spec["name"] != "P10" else 0.6  # P10 is vestigial in Passer: 9 visible primaries
    return (spec.get("length") or meta["feathers"][spec["sprite"]]["h_mm"]) * WING_LEN_SCALE * extra


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
        self.V, self.F, self.UV, self.COL, self.GROUP, self.REGION = [], [], [], [], [], []
        self.n = 0

    def add(self, F, sprite, tint, bone, length=None, width=None, region=0, **kw):
        info = self.meta["feathers"][sprite]
        L = (length if length else info["h_mm"]) * MM
        if width:
            W = width * MM
        else:
            W = info["w_mm"] * MM * (L / (info["h_mm"] * MM) if length else 1.0)
        v, f, uv = card_mesh(F, L, W, info["uv"], mirror_u=(info["narrow"] == "L"), **kw)
        self.V.append(v)
        self.F.extend(tuple(i + self.n for i in face) for face in f)
        self.REGION.extend([region] * len(f))
        self.CARD = getattr(self, "CARD", [])
        self.CARD.append((self.n, len(v), len(self.F) - len(f), len(f), v[len(v) // 2], v[-2] if len(v) > 2 else v[-1]))
        loops = [uv[i] for face in f for i in face]
        self.UV.extend(loops)
        self.COL.append(np.tile(np.array([*tint, 1.0]), (len(v), 1)))
        self.GROUP.extend([bone] * len(v))
        self.n += len(v)

    def trim_offbird(self):
        """Drop whole cards whose middle or tip projects onto the photo's background (never smear the
        bird-filled edge colours, never stick out past the photographed outline)."""
        cards = getattr(self, "CARD", [])
        if not cards:
            return 0
        keep_v = np.ones(self.n, bool)
        keep_f = np.ones(len(self.F), bool)
        drop = 0
        for v0, nv, f0, nf, mid, tip in cards:
            if mid[0] < 0:
                continue  # far side: judged by its mirror twin's position anyway
            q = _bl_to_half(np.array([mid, tip]))
            if on_background(q[0]) or on_background(q[1]):
                keep_v[v0 : v0 + nv] = False
                keep_f[f0 : f0 + nf] = False
                drop += 1
        # mirrored twins (x < 0) share y, z: drop them with their partner
        for v0, nv, f0, nf, mid, tip in cards:
            if mid[0] < 0:
                q = _bl_to_half(np.array([mid, tip]))
                if on_background(q[0]) or on_background(q[1]):
                    keep_v[v0 : v0 + nv] = False
                    keep_f[f0 : f0 + nf] = False
        remap = np.cumsum(keep_v) - 1
        V = [v for v in np.vstack(self.V)[keep_v]]
        loops, k = [], 0
        F2, UV2, R2 = [], [], []
        for fi, face in enumerate(self.F):
            if keep_f[fi]:
                F2.append(tuple(int(remap[i]) for i in face))
                UV2.extend(self.UV[k : k + len(face)])
                R2.append(self.REGION[fi])
            k += len(face)
        col = np.vstack(self.COL)[keep_v]
        self.GROUP = [g for g, kk in zip(self.GROUP, keep_v) if kk]
        self.V, self.F, self.UV, self.REGION, self.COL = [np.array(V)], F2, UV2, R2, [col]
        self.n = len(V)
        self.CARD = []
        return drop

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
        if any(self.REGION):  # feather group per face (tools/measure_side.py region overlap)
            ra = me.attributes.new("fregion", "INT", "FACE")
            ra.data.foreach_set("value", np.asarray(self.REGION, dtype=np.int32))
        bt.assign(ob, material)
        return ob


# ---------------------------------------------------------------- wings


WING_TUCK = 0.30  # |x| lost per metre behind the wrist: the closed wing hugs the tapering rear body
WING_TUCK_MIN = 0.0045  # but never closer than this to the midplane (m)
WING_STACK_MM = 2.2  # max clearance kept over the body after the tuck (feather stack depth)


def tuck_wing(ob, y_wrist):
    """Bend the closed wing in towards the midline behind the wrist (tree sparrow rear body is narrow),
    but never into the body: each vertex keeps at least the surface clearance it had before the tuck,
    so the feather stacking order survives and the wing stays on top of the flank plumage."""
    bvh = _body_bvh()
    co = np.array([v.co[:] for v in ob.data.vertices])

    def surface_x(points):
        """Body half-width at each point's (Y, Z), by a ray from the side (nan where the ray misses)."""
        out = np.full(len(points), np.nan)
        for i, q in enumerate(points):
            hit, _n, _i, _d = bvh.ray_cast(Vector((0.08, q[1], q[2])), Vector((-1, 0, 0)))
            if hit is not None:
                out[i] = hit.x
        return out

    sx = surface_x(co)
    ax = np.abs(co[:, 0])
    gap0 = np.where(np.isnan(sx), ax, ax - sx)  # clearance over the body before the tuck
    d = np.clip(co[:, 1] - y_wrist, 0.0, None)
    new = np.maximum(ax - WING_TUCK * d, np.minimum(ax, WING_TUCK_MIN))
    floor = np.where(np.isnan(sx), 0.0, sx + np.clip(gap0, CLEAR * MM, WING_STACK_MM * MM))
    co[:, 0] = np.sign(co[:, 0]) * np.maximum(new, floor)
    ob.data.vertices.foreach_set("co", co.ravel())
    ob.data.update()


# Feather groups (face attribute "fregion"), traced as regions on the side photo in tools/measure_side.py.
REGIONS = {1: "lesser coverts", 2: "median coverts", 3: "greater coverts", 4: "tertials", 5: "secondaries",
           6: "primaries", 7: "scapulars", 8: "primary coverts / alula"}


def wing_region(name):
    if name.startswith("LC"):
        return 1
    if name.startswith("MC"):
        return 2
    if name.startswith("GC"):
        return 3
    if name in ("S7", "S8", "S9"):
        return 4
    if name.startswith("S"):
        return 5
    if name.startswith("PC") or name.startswith("AL"):
        return 8
    if name.startswith("P"):
        return 6
    return 0


def build_wings(meta, material):
    pts, n_f = fold_joints()
    folded, spread, lengths = arm_frames(pts, n_f)
    specs = feather_specs()
    cb = CardBuilder(meta)
    for sp in specs:
        F = feather_frame(folded[sp["parent"]], lengths[sp["parent"]], sp, "folded")
        kw = dict(camber=0.05, bend=0.02) if sp["flight"] else dict(camber=0.05, bend=0.0, lift=0.0)
        tint = WARM if sp["tint"] == WHITE else (bt.srgb_to_linear(np.asarray(sp["tint"])).tolist() if sp["tint"] in (WING_BAR, WING_BAR2) and sp["sprite"].startswith("C") else sp["tint"])
        L = feather_length_mm(meta, sp)
        W = sp.get("width") * WING_LEN_SCALE if sp.get("width") else None
        if not sp["flight"]:  # coverts ride on a flight-feather bone that widens when the wing opens: build them narrower
            if W is None:
                _i = meta["feathers"][sp["sprite"]]
                W = _i["w_mm"] * (L / _i["h_mm"])
            W = W / open_width_factor(sp["bone"]) * COVERT_W
        if W is None and sp["name"][0] == "P" and sp["name"][1:].isdigit():  # finer primaries: real ones are slender with slots between
            _i = meta["feathers"][sp["sprite"]]
            W = _i["w_mm"] * (L / _i["h_mm"]) * PRIMARY_WIDTH
        cb.add(F, sp["sprite"], tint, sp["bone"] + ".L", length=L, width=W, region=wing_region(sp["name"]), **kw)
    left = cb.build("SP_Wing_L", material)
    right = cb.build("SP_Wing_R", material, mirror_x=True, rename=lambda g: g[:-2] + ".R")
    for ob in (left, right):
        tuck_wing(ob, pts["W"][1])
    with open(WING_JSON, "w", encoding="utf-8") as f:
        json.dump({"joints": {k: v.tolist() for k, v in pts.items()}, "fold_normal": n_f.tolist(),
                   "lengths": lengths}, f, indent=1)
    return left, right


# ---------------------------------------------------------------- tail

TAIL_BASE_PX = (464.0, 272.0)
TAIL_TIP_PX = (568.0, 380.0)
TAIL_RAISE_DEG = -8.0
TAIL_WIDTH = 1.02  # broader vanes: the photos show a thick, closed tail
TAIL_TINT = (0.62, 0.58, 0.55)  # photo colour x this: darker grey-brown rectrices (Halun, laitche, kiran)  # tail held in line with the body axis


def tail_frame():
    """Tail base frame: Y along the tail, Z dorsal, X to the bird's left."""
    y0, z0 = bs.half_to_bl(*TAIL_BASE_PX)
    y1, z1 = bs.half_to_bl(*TAIL_TIP_PX)
    dy, dz = y1 - y0, z1 - z0
    a = math.radians(TAIL_RAISE_DEG)
    d = np.array([0.0, dy * math.cos(a) - dz * math.sin(a), dy * math.sin(a) + dz * math.cos(a)])
    up = np.array([0.0, -d[2], d[1]])
    return frame(np.array([0.0, y0, z0]), d, up)


def rectrix_frame(T, i, side, fan_deg_per=3.0, roll_deg_per=5.6):
    """Rectrix i (1 = central) on side (+1 left / -1 right) in tail frame T.

    Outer feathers sit lower and roll outward-down, giving the closed tail a shallow roof profile.
    """
    off = np.array([side * (0.35 + (i - 1) * 0.75) * MM, -1.5 * MM, -(i - 1) * 0.36 * MM, 1.0])  # outer pairs lower: closed tail is a visible roof from the side
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
            Lr = meta["feathers"]["S%d" % i]["h_mm"] * TAIL_LEN_SCALE * (1.0 - 0.012 * (i - 1))
            Wr = meta["feathers"]["S%d" % i]["w_mm"] * TAIL_LEN_SCALE * TAIL_WIDTH
            cb.add(F, "S%d" % i, TAIL_TINT, "R%d%s" % (i, sfx), length=Lr, width=Wr, camber=0.08, bend=-0.035)
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
    return cb.build("SP_Tail", material), T


# ---------------------------------------------------------------- body contour feathers

CONTOUR_COUNT = 3600  # candidates; only those in the flank-over-wing and vent zones are kept
WING_NEAR_MM = 1.6
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


# Scapular / mantle tract: rows along the top edge of the folded wing on Halun's side photo (half-res px),
# from the nape (300, 112) to the tertials (430, 215); black-streaked rufous-buff feathers (SCAP sprites).
SCAP_PX = [(300 + 130 * f + 0.62 * off, 112 + 103 * f - 0.78 * off * -1)
           for off in (-12.0, -3.0, 6.0) for f in np.linspace(0.0, 0.9, 8)]


def build_scapulars(meta, material):
    """Soft brown scapulars on both shoulders, lying over the top edge of the folded wing."""
    bvh = _body_bvh()
    col_img = bt.image_np(bpy.data.images["SP_Body_Color"])[..., :3]
    cb = CardBuilder(meta)
    back = np.array([0.0, math.cos(math.radians(30)), -math.sin(math.radians(30))])
    rng = np.random.default_rng(5)
    brown = np.array(BROWN_LIN)
    for k, (px, py) in enumerate(SCAP_PX):
        if px < 322:
            continue  # cards rooted at the nape made a bump behind the crown
        y, z = bs.half_to_bl(px, py)
        hit, nrm, _i, _d = bvh.ray_cast(Vector((0.08, float(y), float(z))), Vector((-1, 0, 0)))
        if hit is None:
            continue
        p, n = np.array(hit), np.array(nrm)
        d = back - n * (back @ n)
        f = (k % 8) / 7.0
        L = 9.0 + 5.0 * math.sin(math.pi * min(f * 1.15, 1.0))
        F = frame(p + n * (0.3 + 0.15 * (2 - k // 8)) * MM, d, n)  # upper rows on top (shingled)
        tint = tuple(float(c) for c in np.array([1.0, 0.82, 0.62]) * (0.92 + 0.12 * rng.random()))
        for M in (F, D4 @ F @ D4):
            cb.add(M, "SCAP%d" % (3 + k % 2), tint, "chest", length=L, width=L * 0.62, segs_l=3, segs_w=2,
                   camber=0.08, bend=0.0, lift=0.03, region=7)
    cb.trim_offbird()
    ob = cb.build("SP_Scapulars", material)
    transfer_normals(ob, bpy.data.objects["SP_Body"])
    return ob


# ---------------------------------------------------------------- back, upper wing and wing bars (photo-placed)

# Measured on Halun's side photo (half-res px). Streaked mantle / scapular / rump feathers cover the
# region between the back outline and BACK_LOW, from the nape to the tail base.
BACK_LOW = [(292, 140), (300, 152), (330, 164), (360, 178), (395, 198), (430, 224), (458, 258), (470, 290)]
BACK_X = (312.0, 468.0)  # nape (x < 312) stays body texture: chestnut crown -> white collar
BACK_STEP = 9.0  # lattice spacing (half-res px ~ 2.1 mm)
BACK_LEN_MM = (6.5, 9.5)  # nape .. mid-back .. rump
# White wing bars: tips of the median coverts (upper) and greater coverts (lower), as measured lines.
BAR_UPPER = [(262, 186), (280, 191), (300, 197)]
BAR_LOWER = [(312, 206), (340, 213), (372, 222)]
BAR_CARDS = 7


def _photo_dir():
    """Unit 3D direction of 'down the back towards the tail' (photo (0.62, 0.78) in half-res px)."""
    y0, z0 = bs.half_to_bl(300.0, 150.0)
    y1, z1 = bs.half_to_bl(300.0 + 0.62 * 40, 150.0 + 0.78 * 40)
    return _norm(np.array([0.0, y1 - y0, z1 - z0]))


def _surface_stack(bvh, kd_wing, y, z, extra_mm):
    """Outermost surface (body or folded wing) at photo point (y, z), plus a normal."""
    hit, nrm, _i, _d = bvh.ray_cast(Vector((0.08, float(y), float(z))), Vector((-1, 0, 0)))
    if hit is None:
        return None, None
    x = hit.x
    near = kd_wing.find_range(Vector((0.0, float(y), float(z))), 1.6 * MM)
    if near:
        x = max(x, max(co.x for co, _j, _dd in near))
    return np.array([x + extra_mm * MM, y, z]), np.array(nrm)


def _wing_kd():
    from mathutils.kdtree import KDTree
    pts = bt.object_verts(bpy.data.objects["SP_Wing_L"])
    kd = KDTree(len(pts))
    for j, q in enumerate(pts):
        kd.insert(Vector((0.0, q[1], q[2])), j)  # indexed in the side-view plane ...
    kd.balance()

    class _K:  # ... but report the real x of each hit
        def find_range(self, v, r):
            return [(Vector(pts[j]), j, d) for _co, j, d in kd.find_range(v, r)]
    return _K()


def build_back(meta, material):
    """Streaked mantle, scapular and rump feathers laid in shingled rows over body and upper wing."""
    bvh = _body_bvh()
    kdw = _wing_kd()
    down = _photo_dir()
    cb = CardBuilder(meta)
    rng = np.random.default_rng(11)
    n = 0
    xs = np.arange(BACK_X[0], BACK_X[1], BACK_STEP)
    low = np.asarray(BACK_LOW, float)
    for ci, px in enumerate(xs):
        top = None
        for py in np.arange(60.0, 420.0, 1.0):  # top of the silhouette at this x: first body hit
            y, z = bs.half_to_bl(px, py)
            if bvh.ray_cast(Vector((0.08, float(y), float(z))), Vector((-1, 0, 0)))[0] is not None:
                top = py + 5.0
                break
        if top is None:
            continue
        bottom = float(np.interp(px, low[:, 0], low[:, 1]))
        rows = np.arange(top, bottom, BACK_STEP * 0.8)
        for ri, py in enumerate(rows):
            pxx = px + (BACK_STEP * 0.5 if ri % 2 else 0.0)
            y, z = bs.half_to_bl(pxx, py)
            # shingle: feathers nearer the head lie on top of the ones behind / below them
            order = 0.9 - 0.004 * (pxx - BACK_X[0]) - 0.02 * ri
            p, nrm = _surface_stack(bvh, kdw, y, z, 0.25 + max(order, 0.0))
            if p is None:
                continue
            tip_px = np.array([pxx, py]) + np.array([0.62, 0.78]) * (BACK_LEN_MM[1] * 0.8 / 0.23)
            if on_background((pxx, py)) or on_background(0.5 * (np.array([pxx, py]) + tip_px), 1) or on_background(tip_px):
                continue  # would stick out past the photo's back line (smeared projection, odd nape fan)
            d = down - nrm * (down @ nrm)
            f = (pxx - BACK_X[0]) / (BACK_X[1] - BACK_X[0])
            L = BACK_LEN_MM[0] + (BACK_LEN_MM[1] - BACK_LEN_MM[0]) * math.sin(math.pi * min(f * 1.3, 1.0)) * (0.9 + 0.2 * rng.random())
            F = frame(p, d, nrm)
            bone = "chest" if pxx < 420 else "body"
            tint = tuple(float(c) for c in np.array([1.0, 0.82, 0.62]) * (0.93 + 0.12 * rng.random()))
            for M in (F, D4 @ F @ D4):
                cb.add(M, "SCAP%d" % (3 + (ci + ri) % 2), tint, bone, length=L, width=L * 0.7, segs_l=3, segs_w=2,
                       camber=0.06, bend=0.0, lift=0.02, region=7)
            n += 1
    cb.trim_offbird()
    ob = cb.build("SP_Back", material)
    transfer_normals(ob, bpy.data.objects["SP_Body"])
    return ob, n


SPINE_PX = (345.0, 458.0)  # behind the nape .. rump (side-photo x, half-res); the nape stays chestnut/collar
# rows across the back, seen from above: narrow streaked mantle strip on the spine, then the scapulars of
# both folded wings closing in over it (rear34_laitche, front34_halun, ground_* photos: little back shows)
SPINE_ROWS = [  # (|x| mm, length mm, tint, outward splay deg)
    (0.0, 6.5, (0.70, 0.64, 0.58), 0.0),  # narrow buff-brown mantle strip with black streaks
    (1.6, 7.0, (0.70, 0.64, 0.58), 4.0),
    # scapulars + tertial bases closing in from both wings over the back (rear34_laitche): warm rufous-brown
    # with black centres, longer, laid back along the wing line
    (3.4, 10.0, (0.80, 0.62, 0.48), -4.0),
    (5.2, 11.0, (0.80, 0.62, 0.48), -6.0),
    (7.0, 11.5, (0.84, 0.62, 0.46), -8.0),
    (8.8, 11.5, (0.82, 0.62, 0.48), -10.0),
]
SPINE_STEP_MM = 1.6


def build_spine(meta):
    """Dorsal cover laid from above (the side-photo lattices only reach the flank side): SCAP scans,
    coloured by their baked tree-sparrow pattern (black centres, buff/rufous fringes) x sampled tints."""
    bvh = _body_bvh()
    cb = CardBuilder(meta)
    rng = np.random.default_rng(23)
    y0 = bs.half_to_bl(SPINE_PX[0], 200.0)[0]
    y1 = bs.half_to_bl(SPINE_PX[1], 260.0)[0]
    ys = np.arange(min(y0, y1), max(y0, y1), SPINE_STEP_MM * MM)
    n = 0
    for ri, y in enumerate(ys):
        f = (y - ys[0]) / max(ys[-1] - ys[0], 1e-6)
        for xi, (xm, L0, tint, splay) in enumerate(SPINE_ROWS):
            for side in ((1,) if xm == 0 else (1, -1)):
                x = side * (xm + rng.normal(0, 0.25)) * MM
                yy = y + (0.5 * SPINE_STEP_MM * MM if (ri + xi) % 2 else 0.0)
                hit, nrm, _i, _d = bvh.ray_cast(Vector((x, float(yy), 0.2)), Vector((0, 0, -1)))
                if hit is None or nrm.z < 0.25:
                    continue
                p, nr = np.array(hit), np.array(nrm)
                a = math.radians(side * splay + rng.normal(0, 2.5))
                tail = np.array([math.sin(a), math.cos(a), -0.25])
                d = tail - nr * (tail @ nr)
                lift = 0.5 + 0.12 * xm + 0.05 * rng.random()  # outer (scapular) rows lie over the mantle strip
                L = L0 * (0.85 + 0.3 * math.sin(math.pi * min(f * 1.2, 1.0))) * (0.92 + 0.16 * rng.random())
                g = 0.80 + 0.22 * rng.random()
                F = frame(p + nr * lift * MM, d, nr)
                cb.add(F, "SCAP%d" % (3 + (ri + xi) % 2), tuple(c * g for c in tint), "chest" if f < 0.55 else "body",
                       length=L, width=L * (0.46 if xm < 3 else 0.55), segs_l=3, segs_w=2, camber=0.06, bend=0.0, lift=0.02)
                n += 1
    ob = cb.build("SP_Spine", bpy.data.materials["SP_WingFold"])
    add_photo_uv(ob)
    return ob, n


def build_wing_bars(meta, material):
    """Two rows of covert tips laid on the measured bar lines, outermost on the folded wing."""
    bvh = _body_bvh()
    kdw = _wing_kd()
    down = _photo_dir()
    cb = CardBuilder(meta)
    for line, sprite, L, lift in ((BAR_LOWER, "GCs", 7.0, 1.0), (BAR_UPPER, "MCs", 5.5, 1.4)):
        pts = np.asarray(line, float)
        seg = np.cumsum(np.r_[0, np.linalg.norm(np.diff(pts, axis=0), axis=1)])
        for k in range(BAR_CARDS):
            s_ = seg[-1] * (k + 0.5) / BAR_CARDS
            tx, ty = np.interp(s_, seg, pts[:, 0]), np.interp(s_, seg, pts[:, 1])
            # the card's tip lands on the bar line: root sits up the feather
            ty0, tx0 = ty - 0.78 * L / 0.23 * 0.75, tx - 0.62 * L / 0.23 * 0.75
            y, z = bs.half_to_bl(tx0, ty0)
            p, nrm = _surface_stack(bvh, kdw, y, z, lift)
            if p is None:
                continue
            d = down - nrm * (down @ nrm)
            F = frame(p, d, nrm)
            for M in (F, D4 @ F @ D4):
                cb.add(M, "%s%d" % (sprite, 1 + k % 2), (1.0, 1.0, 1.0), "forearm.L" if M is F else "forearm.R",
                       length=L, width=L * 0.8, segs_l=3, segs_w=2, camber=0.05, bend=0.0, lift=0.0,
                       region=3 if sprite == "GCs" else 2)
    cb.trim_offbird()
    return cb.build("SP_WingBars", material)


def build_trousers(meta, material, per_leg=26):
    """Belly-coloured feathers clothing each feathered tibia."""
    import s04_parts as parts

    belly = np.array(_rgb_lin((0.80, 0.765, 0.70)))
    rng = np.random.default_rng(9)
    cb = CardBuilder(meta)
    for side, sfx in ((1, ".L"), (-1, ".R")):
        leg = bpy.data.objects["SP_Leg" + ("_L" if side > 0 else "_R")]
        co = bt.object_verts(leg)
        part = np.empty(len(co), dtype=np.int32)
        leg.data.attributes["sp_part"].data.foreach_get("value", part)
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
    return cb.build("SP_Trousers", material)


def build_contours(meta, material, rng_seed=7, head=None):
    """Loose contour feathers only where real ones break the surface: flank feathers tucked over the
    folded wing's lower edge and the fluffy undertail / vent. Everywhere else the texture reads better."""
    import s03_body as sb
    import s05_plumage as spl
    from mathutils.kdtree import KDTree

    body = bpy.data.objects["SP_Body"]
    cls_map = np.load(os.path.join(sb.BUILD, "plumage_cls.npy"))
    Hc, Wc = cls_map.shape
    wing_pts = np.vstack([bt.object_verts(bpy.data.objects[n]) for n in ("SP_Wing_L", "SP_Wing_R")])
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
    col_img = bt.image_np(bpy.data.images["SP_Body_Color"])[..., :3]  # row 0 = v 0
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
        if near_wing and p[2] > bs.REF_BL[1]:
            continue  # flank cards only tuck over the wing's lower edge; at the shoulder they poked out
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
    f_head0 = len(cb.F)
    n_head = 0
    if head is not None:
        n_head = add_head_cards(cb, body, head[0], "feather")
    ob = cb.build("SP_Contour", material)
    if head is not None and n_head:
        ob.data.materials.append(head[1])
        for poly in ob.data.polygons[f_head0:]:
            poly.material_index = 1
    transfer_normals(ob, body)
    return ob, placed + n_head


# ---------------------------------------------------------------- down

DOWN_TUFTS = 8
DOWN_MM = [1.0, 1.2, 1.4, 1.6, 1.9, 2.3, 2.8, 3.3, 3.8, 4.2, 4.6, 4.8, 4.4, 3.8]  # tuft length by landmark ring
DOWN_COUNT = 5600  # area-weighted candidates; those on the eyes, bill or under the wings are dropped


def down_atlas(size=256, seed=21):
    """Plumulaceous tufts: many fine, individually curved filaments rising from a soft base cloud, thinning and
    fading toward the tips. DOWN_TUFTS differently-shaped tufts (no repeated fan outline)."""
    import s05_plumage as spl

    W, H = size * DOWN_TUFTS, size
    acc = np.zeros((H, W), np.float32)
    rng = np.random.default_rng(seed)
    s = np.linspace(0.0, 1.0, 260)
    yy, xx = np.mgrid[0:H, 0:size]
    for k in range(DOWN_TUFTS):
        x0 = k * size + size / 2
        spread = rng.uniform(0.25, 0.60)  # fan width differs per tuft
        n_fil = int(rng.integers(90, 150))
        lean = rng.normal(0.0, 0.25)
        for _ in range(n_fil):
            L = size * rng.uniform(0.35, 0.98) ** 0.8
            th0 = lean + rng.normal(0.0, spread)
            curl = rng.normal(0.0, 1.1)
            theta = th0 + curl * s ** 1.6 + 0.10 * np.sin(s * rng.uniform(4, 11) + rng.uniform(0, 6.28))
            x = x0 + rng.normal(0.0, size * 0.05) + np.cumsum(np.sin(theta)) * L / len(s)
            y = rng.uniform(0.0, size * 0.05) + np.cumsum(np.cos(theta)) * L / len(s)
            xi = np.clip(np.round(x).astype(int), k * size + 1, (k + 1) * size - 2)
            yi = np.clip(np.round(y).astype(int), 0, H - 1)
            amp = rng.uniform(0.45, 0.95)
            np.maximum.at(acc, (yi, xi), amp * (1.0 - s ** 1.25))
        # soft base cloud: the fluffy root mass
        acc[:, k * size:(k + 1) * size] = np.maximum(acc[:, k * size:(k + 1) * size],
                                                     0.38 * np.exp(-(((xx - size / 2) / (size * 0.20)) ** 2 + (yy / (size * 0.16)) ** 2)))
    acc = spl.blur(acc, 1, 1, passes=1)
    rgba = np.ones((H, W, 4), np.float32)
    rgba[..., :3] *= (0.86 + 0.14 * np.arange(H) / H)[:, None, None]  # a little greyer toward the base
    rgba[..., 3] = np.clip(acc * 2.0, 0, 0.92)
    img = bt.np_image(rgba, "SP_Down_Atlas", path=os.path.join(bt.TEX, "down_atlas.png"))
    meta = {"feathers": {"D%d" % k: {"uv": (k / DOWN_TUFTS, 0.0, (k + 1) / DOWN_TUFTS, 1.0),
                                     "h_mm": 3.0, "w_mm": 2.4, "narrow": None} for k in range(DOWN_TUFTS)}}
    return img, meta


def down_material(img):
    return bt.material_textured(
        "SP_Down", img, roughness=0.8, vertex_color="Col", sheen=0.14, sheen_tint=(0.72, 0.69, 0.65),
        specular=0.2, double_sided=True, alpha_blend=True,
    )


def build_down(meta, material, rng_seed=17, head=None):
    """Down and loose barbs breaking the plumage surface: wispy tufts over head and body that soften the
    silhouette - fluffiest on belly, flanks and vent, short and fine on the head and back."""
    import s03_body as sb
    import s04_parts as parts
    from mathutils.kdtree import KDTree

    body = bpy.data.objects["SP_Body"]
    data = np.load(os.path.join(sb.BUILD, "body_field.npz"))
    seg, n = int(data["seg"]), int(data["rings"])
    loop = 2 * seg
    co = bt.object_verts(body)
    grid = np.stack([co[i * loop : (i + 1) * loop] for i in range(n)])
    sizes = sb.ring_values(DOWN_MM)
    col_img = bt.image_np(bpy.data.images["SP_Body_Color"])[..., :3]
    H, W = col_img.shape[:2]
    vcoord = data["vcoord"]
    eyes = [np.array(bpy.data.objects[e].matrix_world.translation) for e in ("SP_Eye_L", "SP_Eye_R")]
    cover = np.vstack([bt.object_verts(bpy.data.objects[nm]) for nm in ("SP_Wing_L", "SP_Wing_R", "SP_Scapulars")])
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
        jitter = math.radians(rng.normal(0, 34))
        t_axis = _norm(along)
        d = t_axis * math.cos(jitter) + np.cross(nrm, t_axis) * math.sin(jitter)
        F = frame(p - nrm * 0.12 * MM, d, nrm)
        v = float(np.interp(i + fi + 0.5 * L * MM / max(np.linalg.norm(along), 1e-9), np.arange(n), vcoord))
        px = bt.srgb_to_linear(col_img[min(int(v * H), H - 1), min(int(u * W), W - 1)])
        tint = tuple(float(x) for x in np.clip(px * (0.90 + 0.16 * rng.random()) * np.array([1.0 + 0.03 * rng.random(), 1.0, 1.0 - 0.04 * rng.random()]), 0, 1))
        k_d = rng.integers(0, DOWN_TUFTS)  # (same random stream as before: the body down is unchanged)
        w_d = 0.75 + 0.5 * rng.random()
        l_d = 0.55 + 0.5 * rng.random()
        if i < HEAD_DOWN_RINGS:
            continue  # the head has its own wispy tufts below, scaled and coloured for the head
        cb.add(F, "D%d" % k_d, tint, "body", length=L, width=L * w_d,
               segs_l=2, segs_w=1, camber=0.0, bend=0.0, lift=l_d)
        placed += 1
    f_head0 = len(cb.F)
    n_head = 0
    if head is not None:
        n_head = add_head_cards(cb, body, head[0], "tuft")
    ob = cb.build("SP_Down", material)
    if head is not None and n_head:
        ob.data.materials.append(head[1])
        for poly in ob.data.polygons[f_head0:]:
            poly.material_index = 1
    transfer_normals(ob, body)
    return ob, placed + n_head




# ---------------------------------------------------------------- head plumage (small layered contour feathers + wispy tufts)

HEAD_DOWN_RINGS = 28  # rings 0..27 (bill .. back of the crown): the head's own feathers and tufts below
HEAD_FEATHER_RINGS = 34  # collar / nape: feathers fade out here
HEAD_F_MM = [0.8, 0.9, 1.0, 1.1, 1.3, 1.4, 1.6, 1.8, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0]  # contour feather card length by landmark ring
HEAD_T_MM = [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.1, 2.3, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5]  # tuft length by landmark ring
HEAD_NF, HEAD_NT = 6, 6
HEAD_FOREHEAD_PX = 7.0  # head cards reach this many half-res px forward of the face line (forehead feathers meet the bill)
HEAD_CELL = 192
HEAD_F_COVER, HEAD_T_COVER = 3.4, 0.7  # cards per (visible feather area) / per tuft area


def _hh(a, seed):
    x = np.sin(a * 127.1 + seed * 74.7) * 43758.5453123
    return x - np.floor(x)


def _head_feather_cell(rng, S):
    """One small, narrow head contour feather: lanceolate vane of fine herringbone barbs with a soft, separated (hairy)
    margin, a plumulaceous base whose barbs part, and a faint rachis. Luminance only (vertex colour carries the plumage)."""
    import s05_plumage as spl
    yy, xx = np.mgrid[0:S, 0:S]
    y = (yy + 0.5) / S
    x = ((xx + 0.5) / S - 0.5) * 2.0
    xs = x - rng.normal(0.0, 0.12) * y ** 2  # slight sideways sweep
    wmax = rng.uniform(0.50, 0.70)
    ytip = rng.uniform(0.40, 0.55)
    pw = rng.uniform(1.15, 1.6)  # distal taper: pointed-oval tip
    prox = wmax * (0.38 + 0.62 * np.sin(np.clip((y - 0.04) / (ytip - 0.04), 0, 1) * np.pi / 2))
    dist = wmax * np.clip(1 - np.abs((y - ytip) / (1 - ytip)) ** pw, 0, 1) ** 0.75
    hw = np.where(y < ytip, prox, dist)
    nb = rng.uniform(38, 54)
    ang = rng.uniform(0.60, 0.95)
    warp = spl.blur(rng.random((S, S)), 7, 7, passes=2)
    warp = (warp - warp.mean()) / (warp.std() + 1e-9)
    p = nb * (y - np.abs(xs) * (ang + 0.12 * np.tanh(warp))) + 1.1 * warp
    bi = np.floor(p)
    amp = _hh(bi + np.sign(xs) * 17.0, rng.uniform(1, 99))
    amp2 = _hh(bi * 1.7 + 5.0, rng.uniform(1, 99))
    barb = (0.5 + 0.5 * np.cos(2 * np.pi * p)) ** 1.4
    # barbs end at individually different lengths -> feathery, hairy margin instead of a clean outline
    reach = hw * (1.0 + 0.30 * (amp - 0.5) * bt.smoothstep(0.25, 0.75, y) + 0.12 * (amp2 - 0.5))
    inside = reach - np.abs(xs)
    edge = bt.smoothstep(-0.10, 0.20, inside)
    a_vane = edge * (0.55 + 0.45 * barb)
    fl = bt.smoothstep(0.02, 0.38, y)
    a = a_vane * (fl + (1 - fl) * (0.10 + 0.55 * barb * (0.35 + 0.65 * amp)))
    rach = np.exp(-(xs / 0.016) ** 2) * bt.smoothstep(0.02, 0.15, y) * (1 - bt.smoothstep(0.70, 0.96, y))
    a = np.maximum(a, 0.80 * rach)
    lum = (0.80 + 0.20 * (0.25 + 0.75 * barb) * (0.65 + 0.35 * amp)) * (0.88 + 0.12 * bt.smoothstep(0.0, 0.5, y)) * (0.94 + 0.06 * np.tanh(warp))
    lum = np.clip(lum - 0.08 * rach, 0, 1)
    return lum, np.clip(a, 0, 0.95)


def _head_tuft_cell(rng, S):
    """Wispy tuft like the body's down (fine curved filaments over a soft root cloud), narrower and shorter."""
    acc = np.zeros((S, S), np.float32)
    yy, xx = np.mgrid[0:S, 0:S]
    s = np.linspace(0.0, 1.0, 200)
    x0 = S / 2
    spread = rng.uniform(0.16, 0.42)
    lean = rng.normal(0.0, 0.18)
    for _ in range(int(rng.integers(70, 120))):
        L = S * rng.uniform(0.35, 0.98) ** 0.8
        th0 = lean + rng.normal(0.0, spread)
        curl = rng.normal(0.0, 0.9)
        theta = th0 + curl * s ** 1.6 + 0.10 * np.sin(s * rng.uniform(4, 11) + rng.uniform(0, 6.28))
        x = x0 + rng.normal(0.0, S * 0.05) + np.cumsum(np.sin(theta)) * L / len(s)
        y = rng.uniform(0.0, S * 0.05) + np.cumsum(np.cos(theta)) * L / len(s)
        xi = np.clip(np.round(x).astype(int), 1, S - 2)
        yi = np.clip(np.round(y).astype(int), 0, S - 1)
        np.maximum.at(acc, (yi, xi), rng.uniform(0.45, 0.95) * (1.0 - s ** 1.25))
    acc = np.maximum(acc, 0.34 * np.exp(-(((xx - S / 2) / (S * 0.20)) ** 2 + (yy / (S * 0.15)) ** 2)))
    import s05_plumage as spl
    acc = spl.blur(acc, 1, 1, passes=1)
    lum = np.ones((S, S), np.float32) * (0.84 + 0.16 * (yy / S))
    return lum, np.clip(acc * 2.0, 0, 0.9)


def head_atlas(seed=35):
    S = HEAD_CELL
    rng = np.random.default_rng(seed)
    rgba = np.zeros((S, S * (HEAD_NF + HEAD_NT), 4), np.float32)
    for k in range(HEAD_NF + HEAD_NT):
        lum, a = (_head_feather_cell if k < HEAD_NF else _head_tuft_cell)(rng, S)
        sl = slice(k * S, (k + 1) * S)
        rgba[:, sl, 0] = rgba[:, sl, 1] = rgba[:, sl, 2] = lum
        rgba[:, sl, 3] = a
    img = bt.np_image(rgba, "SP_Head_Atlas", path=os.path.join(bt.TEX, "head_atlas.png"))
    n = HEAD_NF + HEAD_NT
    meta = {"feathers": {("HF%d" % k if k < HEAD_NF else "HT%d" % (k - HEAD_NF)):
                         {"uv": (k / n, 0.0, (k + 1) / n, 1.0), "h_mm": 3.0, "w_mm": 2.4, "narrow": None} for k in range(n)}}
    return img, meta


def head_material(img):
    return bt.material_textured(
        "SP_HeadPlumage", img, roughness=0.78, vertex_color="Col", sheen=0.03, sheen_tint=(0.6, 0.58, 0.55),
        specular=0.18, double_sided=True, alpha_clip=0.32,
    )  # cutout, not blended: blended head cards are unsorted inside one mesh in three.js, so their soft edges
    # write depth and punch dark see-through crescents (under the lower mandible, chin / throat) in views from below


def add_head_cards(cb, body, head_meta, kind, rng_seed=None):
    """Scatter small layered contour feathers (kind="feather") or wispy tufts (kind="tuft") over the head, face, cheek,
    crown and collar: flow follows the rings (bill -> nape), colour is read from the plumage texture under the root, and
    every card gets its own size, width, angle, lift and tint."""
    import s03_body as sb
    import s04_parts as parts

    rng = np.random.default_rng((43 if kind == "feather" else 59) if rng_seed is None else rng_seed)
    for k_, v_ in head_meta["feathers"].items():
        cb.meta["feathers"][k_] = v_
    data = np.load(os.path.join(sb.BUILD, "body_field.npz"))
    seg, n = int(data["seg"]), int(data["rings"])
    loop = 2 * seg
    co = bt.object_verts(body)
    grid = np.stack([co[i * loop : (i + 1) * loop] for i in range(n)])
    vcoord = data["vcoord"]
    col_img = bt.image_np(bpy.data.images["SP_Body_Color"])[..., :3]
    H, W = col_img.shape[:2]
    eyes = [np.array(bpy.data.objects[e].matrix_world.translation) for e in ("SP_Eye_L", "SP_Eye_R")]
    sizes = sb.ring_values(HEAD_F_MM if kind == "feather" else HEAD_T_MM)
    from mathutils.kdtree import KDTree
    n_r = min(n, HEAD_FEATHER_RINGS + 4)
    gk = np.arange(loop)
    g_u = np.where(gk <= seg, gk / seg, (loop - gk) / seg)
    kd = KDTree(n_r * loop)
    for i_ in range(n_r):
        for k_ in range(loop):
            kd.insert(Vector(grid[i_, k_]), i_ * loop + k_)
    kd.balance()

    def vertex_tint(Vq):
        out = np.zeros((len(Vq), 3))
        for j, q in enumerate(Vq):
            hits = kd.find_n(Vector(q), 4)
            wsum, uu, vv = 0.0, 0.0, 0.0
            for _c, id_, dist in hits:
                w_ = 1.0 / (dist + 1e-5)
                wsum += w_; uu += w_ * g_u[id_ % loop]; vv += w_ * vcoord[id_ // loop]
            uu, vv = uu / wsum, vv / wsum
            out[j] = bt.srgb_to_linear(col_img[min(int(vv * H), H - 1), min(int(uu * W), W - 1)])
        return out

    a = grid[:-1, :]
    b = np.roll(grid[:-1, :], -1, axis=1)
    c = np.roll(grid[1:, :], -1, axis=1)
    area = np.linalg.norm(np.cross(b - a, c - a), axis=2) / (MM * MM)  # mm^2
    Lr = np.interp(np.arange(n - 1) + 0.5, np.arange(n), sizes)
    cover = HEAD_F_COVER if kind == "feather" else HEAD_T_COVER
    vis_area = (0.30 * Lr) * (0.50 * Lr) if kind == "feather" else (0.5 * Lr) * (0.9 * Lr)
    fade = np.clip((HEAD_FEATHER_RINGS - np.arange(n - 1)) / 6.0, 0.0, 1.0)
    dens = cover / vis_area * fade
    dens[:3] = dens[3] * np.array([0.55, 0.85, 1.0]) if kind == "feather" else 0.0  # forehead feathers meet the bill base
    dens[HEAD_FEATHER_RINGS:] = 0.0
    wgt = area * dens[:, None]
    n_cards = int(round(wgt.sum()))
    picks = rng.choice(wgt.size, size=n_cards, p=(wgt / wgt.sum()).ravel(), replace=True)
    placed = 0
    _dbg = [0]
    _ringc = np.zeros(n, int)
    for idx in picks:
        i, k = divmod(int(idx), loop)
        fi, fk = rng.random(), rng.random()
        k2 = (k + 1) % loop
        p = (grid[i, k] * (1 - fi) * (1 - fk) + grid[i + 1, k] * fi * (1 - fk) + grid[i, k2] * (1 - fi) * fk + grid[i + 1, k2] * fi * fk)
        if min(np.linalg.norm(p - e) for e in eyes) < (2.45 if kind == "feather" else 2.9) * MM:
            continue
        if parts._to_half_px(p[None, :])[0][0] < parts.FACE_LINE_PX - HEAD_FOREHEAD_PX:
            _dbg[0] += 1
            continue
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
        ring_f = i + fi
        L = float(np.interp(ring_f, np.arange(n), sizes)) * (0.78 + 0.5 * rng.random())
        t_axis = _norm(along)
        jit = math.radians(rng.normal(0, 9 if kind == "feather" else 30))
        d = t_axis * math.cos(jit) + np.cross(nrm, t_axis) * math.sin(jit)
        warm = np.array([1.0 + 0.04 * rng.random(), 1.0, 1.0 - 0.05 * rng.random()])
        var = (0.93 + 0.14 * rng.random()) if kind == "feather" else (0.90 + 0.18 * rng.random())
        if kind == "feather":
            F = frame(p + nrm * (0.03 + 0.20 * rng.random()) * MM, d, nrm)
            cb.add(F, "HF%d" % rng.integers(0, HEAD_NF), (1.0, 1.0, 1.0), "body", length=L, width=L * (0.46 + 0.22 * rng.random()),
                   segs_l=3, segs_w=2, camber=0.10, bend=0.0, lift=0.04 + 0.13 * rng.random())
        else:
            F = frame(p - nrm * 0.10 * MM, d, nrm)
            cb.add(F, "HT%d" % rng.integers(0, HEAD_NT), (1.0, 1.0, 1.0), "body", length=L, width=L * (0.7 + 0.6 * rng.random()),
                   segs_l=2, segs_w=1, camber=0.0, bend=0.0, lift=0.35 + 0.55 * rng.random())
        cols = vertex_tint(cb.V[-1]) * (var * warm * 1.10)[None, :]  # colours follow the plumage texture across the card
        cb.COL[-1][:, :3] = np.clip(cols, 0, 1)
        placed += 1
        _ringc[i] += 1
    return placed


# ---------------------------------------------------------------- material and run


def feather_material(atlas_img, normal_img=None):
    return bt.material_textured(
        "SP_Feathers", atlas_img, normal_img=normal_img, normal_strength=0.6, roughness=0.62, alpha_clip=0.5,
        vertex_color="Col", sheen=0.05, sheen_tint=(0.6, 0.55, 0.5), specular=0.35, double_sided=True,
    )


def _image(name, file, non_color=False):
    img = bpy.data.images.get(name) or bt.load_image(os.path.join(bt.TEX, file), name)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img



# ---------------------------------------------------------------- photo-fitted folded wing
# The visible folded wing is laid group by group into the regions traced on the side photo
# (tools/measure_side.py PHOTO_REGIONS). Each card keeps the real Hansen scan's vane, barbs and alpha
# (plain GC sprites), and its colour/pattern is projected from the matching region of the real
# tree sparrow photo through a second UV map ("photo").
FOLD_GROUPS = {  # region: (feather axis in photo px, length mm, width/length, lift mm, lattice px, bone)
    7: ((0.62, 0.78), 8.5, 0.62, 2.4, 7.0, "chest"),
    1: ((0.80, 0.60), 4.0, 0.85, 2.1, 4.0, "forearm"),
    2: ((0.80, 0.60), 4.5, 0.85, 1.8, 4.0, "forearm"),
    3: ((0.85, 0.52), 6.5, 0.70, 1.5, 5.0, "forearm"),
    4: ((0.62, 0.78), 12.0, 0.55, 1.2, 6.0, "forearm"),
    5: ((0.92, 0.40), 13.0, 0.40, 0.8, 4.0, "forearm"),
    6: ((0.90, 0.44), 15.0, 0.38, 0.5, 4.0, "hand"),
}
FOLD_TIP_INSET = 0.06
FOLD_BAD = 1.5  # greedy fill: penalty per pixel spilled outside the region (and not hidden by an outer group)
FOLD_MIN_GAIN = 4.0
FOLD_BAD_OUT = 2.5
FOLD_NORMAL_BLEND = 0.75
FOLD_FORE = 1.12  # cards lie tilted over the curved wing: lengthen so the projected tip reaches its target
FOLD_SHIFT = {}  # region: (dx, dy) half-res px, from tools/fit_fold.py
FOLD_GAMMA = 1.5  # the photo already holds its own lighting: darken mids so the render matches it
FOLD_SAT = 1.12  # extra penalty off the wing altogether
FOLD_ROOT = 0.8  # root this many lengths behind the tip target ...
FOLD_FIT = {7: (1.4, 1.0, 3.0, 1.0, 1.0), 1: (1.28, 0.58, -3.0, 1.0, 1.0), 2: (0.8, 0.6, -1.0, 1.0, 1.0),
            3: (1.25, 0.9, 0.0, 1.0, 0.88), 4: (1.25, 0.9, 0.0, 1.0, 0.88), 5: (0.95, 0.7, -5.0, 1.0, 1.0),
            6: (0.95, 0.6, -1.0, 1.0, 1.0)}  # region: (overlen, root, perpendicular lattice shift px), fitted with tools/measure_side.region_iou
FOLD_OVERLEN = 1.25  # ... on a longer card: the scan's visible vane tip lands on the target  # tips this fraction of a card length inside the region edge
FOLD_PHOTO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sources", "photos", "side_profile_halun_birdfill.png")  # background pushed out from the bird edge (tools: see CREDITS)


def _in_poly(poly, x, y):
    poly = np.asarray(poly, float)
    inside, j = False, len(poly) - 1
    for i in range(len(poly)):
        (xi, yi), (xj, yj) = poly[i], poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _bl_to_half(co):
    co = np.atleast_2d(co)
    ur = (co[:, 1] - bs.REF_BL[0]) * 1000.0
    wr = (co[:, 2] - bs.REF_BL[1]) * 1000.0
    a = math.radians(bs.TILT_DEG)
    u = ur * math.cos(a) + wr * math.sin(a)
    w = -ur * math.sin(a) + wr * math.cos(a)
    return np.stack([(bs.REF_PX[0] + u / bs.PX_MM) / 2.0, (bs.REF_PX[1] - w / bs.PX_MM) / 2.0], 1)


def _stack_kd():
    from mathutils.kdtree import KDTree
    pts = np.vstack([bt.object_verts(bpy.data.objects[n]) for n in ("SP_Wing_L", "SP_Back", "SP_Scapulars", "SP_WingBars")
                     if n in bpy.data.objects])
    pts = pts[pts[:, 0] > 0]
    kd = KDTree(len(pts))
    for j, q in enumerate(pts):
        kd.insert(Vector((0.0, q[1], q[2])), j)
    kd.balance()

    class _K:
        def find_range(self, v, r):
            return [(Vector(pts[j]), j, d) for _co, j, d in kd.find_range(v, r)]
    return _K()


DORSAL_BROWN = (0.30, 0.15, 0.07)  # linear; ~sRGB (150,108,74) folded-wing top, rear34_laitche
DORSAL_OBJS = ("SP_WingFold", "SP_Wing_L", "SP_Wing_R", "SP_WingBars")


def fold_material(atlas_img):
    mat = bpy.data.materials.get("SP_WingFold") or bpy.data.materials.new("SP_WingFold")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.75
    for k in ("Specular IOR Level", "Specular"):
        if k in bsdf.inputs:
            bsdf.inputs[k].default_value = 0.2
    uv0 = nt.nodes.new("ShaderNodeUVMap"); uv0.uv_map = "UVMap"
    uv1 = nt.nodes.new("ShaderNodeUVMap"); uv1.uv_map = "photo"
    scan = nt.nodes.new("ShaderNodeTexImage"); scan.image = atlas_img
    ph = nt.nodes.new("ShaderNodeTexImage")
    im = bpy.data.images.get("SP_FoldPhoto") or bpy.data.images.load(FOLD_PHOTO)
    im.name = "SP_FoldPhoto"
    if os.path.normcase(os.path.abspath(bpy.path.abspath(im.filepath))) != os.path.normcase(os.path.abspath(FOLD_PHOTO)):
        im.filepath = FOLD_PHOTO  # never the raw photo: its green background would bleed onto edge cards
    im.reload()
    ph.image = im
    ph.extension = "EXTEND"
    nt.links.new(uv0.outputs[0], scan.inputs[0]); nt.links.new(uv1.outputs[0], ph.inputs[0])
    bw = nt.nodes.new("ShaderNodeRGBToBW"); nt.links.new(scan.outputs[0], bw.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")  # scan luminance -> barb/vane relief around 1.0
    mr.inputs[1].default_value, mr.inputs[2].default_value = 0.04, 0.30
    mr.inputs[3].default_value, mr.inputs[4].default_value = 0.70, 1.25
    nt.links.new(bw.outputs[0], mr.inputs[0])
    mul = nt.nodes.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    gm = nt.nodes.new("ShaderNodeGamma"); gm.inputs[1].default_value = FOLD_GAMMA
    hs = nt.nodes.new("ShaderNodeHueSaturation"); hs.inputs["Saturation"].default_value = FOLD_SAT
    nt.links.new(ph.outputs[0], gm.inputs[0]); nt.links.new(gm.outputs[0], hs.inputs["Color"])
    warm = nt.nodes.new("ShaderNodeMix"); warm.data_type = "RGBA"; warm.blend_type = "MULTIPLY"
    warm.inputs[0].default_value = 1.0; warm.inputs[7].default_value = (0.94, 0.80, 0.64, 1.0)  # photo whites -> buff, as the perched wing refs
    nt.links.new(hs.outputs[0], warm.inputs[6])
    nt.links.new(warm.outputs[2], mul.inputs[6]); nt.links.new(mr.outputs[0], mul.inputs[7])
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"  # per-card tint (tail darker etc.)
    mul2 = nt.nodes.new("ShaderNodeMix"); mul2.data_type = "RGBA"; mul2.blend_type = "MULTIPLY"
    mul2.inputs[0].default_value = 1.0
    nt.links.new(mul.outputs[2], mul2.inputs[6]); nt.links.new(vc.outputs[0], mul2.inputs[7])
    # surfaces facing up / back (|normal.x| small) cannot take the side photo (it smears): there use the
    # scan sprite's own baked tree-sparrow pattern (s06: streaked scapulars, plain dull rump coverts) x tint
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); nt.links.new(geo.outputs["Normal"], sep.inputs[0])
    ab = nt.nodes.new("ShaderNodeAttribute"); ab.attribute_type = "GEOMETRY"; ab.attribute_name = "rest_nx"
    fac = nt.nodes.new("ShaderNodeMapRange"); fac.inputs[1].default_value, fac.inputs[2].default_value = 0.35, 0.75
    nt.links.new(ab.outputs["Fac"], fac.inputs[0])
    dors = nt.nodes.new("ShaderNodeMix"); dors.data_type = "RGBA"; dors.blend_type = "MULTIPLY"
    dors.inputs[0].default_value = 1.0
    nt.links.new(scan.outputs[0], dors.inputs[6]); nt.links.new(vc.outputs[0], dors.inputs[7])
    # wing cards use plain (unpatterned) specimen scans: seen from above / behind they'd read pale grey-white,
    # while the folded tree-sparrow wing is warm rufous-brown (rear34_laitche) - there use relief x DORSAL_BROWN
    ob_flag = nt.nodes.new("ShaderNodeAttribute"); ob_flag.attribute_type = "OBJECT"; ob_flag.attribute_name = "sp_dorsal_brown"
    br = nt.nodes.new("ShaderNodeMix"); br.data_type = "RGBA"; br.blend_type = "MULTIPLY"; br.inputs[0].default_value = 1.0
    br.inputs[6].default_value = DORSAL_BROWN + (1.0,)
    nt.links.new(mr.outputs[0], br.inputs[7])
    br2 = nt.nodes.new("ShaderNodeMix"); br2.data_type = "RGBA"; br2.blend_type = "MULTIPLY"; br2.inputs[0].default_value = 1.0
    nt.links.new(br.outputs[2], br2.inputs[6]); nt.links.new(vc.outputs[0], br2.inputs[7])
    dsel = nt.nodes.new("ShaderNodeMix"); dsel.data_type = "RGBA"
    nt.links.new(ob_flag.outputs["Fac"], dsel.inputs[0]); nt.links.new(dors.outputs[2], dsel.inputs[6]); nt.links.new(br2.outputs[2], dsel.inputs[7])
    blend = nt.nodes.new("ShaderNodeMix"); blend.data_type = "RGBA"
    nt.links.new(fac.outputs[0], blend.inputs[0]); nt.links.new(dsel.outputs[2], blend.inputs[6]); nt.links.new(mul2.outputs[2], blend.inputs[7])
    nt.links.new(blend.outputs[2], bsdf.inputs["Base Color"])
    nt.links.new(scan.outputs[1], bsdf.inputs["Alpha"])
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    for attr, val in (("blend_method", "CLIP"), ("alpha_threshold", 0.5), ("use_backface_culling", False)):
        if hasattr(mat, attr):
            try:
                setattr(mat, attr, val)
            except Exception:
                pass
    return mat


def _fold_surface(bvh, kd, q, lift):
    """Surface under photo point q; past the body's dorsal edge (feathers stand proud of it) use the
    nearest surface down-and-forward of q, at q's own position."""
    y, z = bs.half_to_bl(*q)
    for k in range(0, 40, 2):
        yy, zz = bs.half_to_bl(q[0] - 0.7 * k, q[1] + 0.7 * k)
        p, nrm = _surface_stack(bvh, kd, yy, zz, lift)
        if p is not None:
            return np.array([p[0], y, z]), nrm
    return None, None


_BG = None


def photo_background():
    """Half-res bool mask of the side photo's background incl. the greenish fringe round the bird
    (sources/photos/side_profile_halun_bgmask.png, made with the bird-filled copy)."""
    global _BG
    if _BG is None:
        im = bpy.data.images.load(os.path.join(os.path.dirname(FOLD_PHOTO), "side_profile_halun_bgmask.png"), check_existing=True)
        w, h = im.size
        px = np.empty(w * h * 4, np.float32)
        im.pixels.foreach_get(px)
        _BG = px.reshape(h, w, 4)[::-1][::2, ::2, 0] > 0.5
    return _BG


def on_background(q, margin=0):
    bg = photo_background()
    x, y = int(q[0]), int(q[1])
    if not (0 <= x < bg.shape[1] and 0 <= y < bg.shape[0]):
        return True
    return bool(bg[max(y - margin, 0): y + margin + 1, max(x - margin, 0): x + margin + 1].all())


FOLD_EXTRA = None  # set by tools/fit_fold.py while fitting; else read from build/fold_extra.json


def _fold_extra():
    if FOLD_EXTRA is not None:
        return FOLD_EXTRA
    path = os.path.join(BUILD, "fold_extra.json")
    return json.load(open(path)) if os.path.exists(path) else {}


def _sprite_alpha(meta, img, name, res=64):
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    al = px.reshape(h, w, 4)[..., 3]
    u0, v0, u1, v1 = meta["feathers"][name]["uv"]
    tt = np.linspace(0, 1, res)
    ss = np.linspace(0, 1, res // 2)
    vv = v0 + (v1 - v0) * tt[:, None]
    uu = u0 + (u1 - u0) * ss[None, :]
    if meta["feathers"][name]["narrow"] == "L":
        uu = u1 - (u1 - u0) * ss[None, :]
    return al[np.clip((vv * h).astype(int), 0, h - 1), np.clip((uu * w).astype(int), 0, w - 1)] > 0.5


def build_wing_fold(meta, atlas_img):
    import importlib, sys
    tools = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools")
    if tools not in sys.path:
        sys.path.insert(0, tools)
    ms = importlib.import_module("measure_side")
    bvh = _body_bvh()
    kd = _stack_kd()
    cb = CardBuilder(meta)
    n = 0
    H, W = 426, 640
    sa = _sprite_alpha(meta, atlas_img, "GC01")  # (rows root->tip, cols across)
    yy, xx = np.mgrid[0:H, 0:W] + 0.5
    bgm = photo_background()
    masks = {r: ms._poly_mask(p) & ~bgm for r, p in ms.PHOTO_REGIONS.items()}
    anyreg = np.logical_or.reduce(list(masks.values()))
    shown = np.zeros((H, W), bool)  # predicted coverage of the outer groups placed so far
    for r, (axis, L, wr, lift, step, bone) in sorted(FOLD_GROUPS.items(), key=lambda kv: -kv[1][3]):
        poly = ms.PHOTO_REGIONS[r]
        ol_, fr_, dp_, ls_, ws_ = (tuple(FOLD_FIT.get(r, (FOLD_OVERLEN, FOLD_ROOT, 0.0))) + (1.0, 1.0))[:5]
        L, wr = L * ls_, wr * ws_
        a = np.asarray(axis, float); a /= np.linalg.norm(a)
        perp = np.array([-a[1], a[0]])
        Lpx = L / (bs.PX_MM * 2.0)
        hw2 = 0.5 * Lpx * wr
        mine = masks[r]
        higher = np.zeros_like(mine)
        for r2, g2 in FOLD_GROUPS.items():
            if g2[3] > lift:
                higher |= masks[r2]
        want = mine & ~shown  # pixels this group must show
        allowed = mine | shown  # pixels it may cover: its own, or hidden under an outer group already placed
        covered = np.zeros_like(mine)
        P = np.asarray(poly, float)
        lo, hi = P.min(0) - Lpx, P.max(0) + Lpx
        cands = []
        cs = max(1.5, Lpx * 0.07)
        for ty in np.arange(lo[1], hi[1], cs):
            for tx in np.arange(lo[0], hi[0], cs):
                tip = np.array([tx, ty])
                if not mine[min(max(int(ty - a[1] * 2), 0), H - 1), min(max(int(tx - a[0] * 2), 0), W - 1)]:
                    continue
                cands.append(tip)
        # visible footprint of a card = the real scan's alpha (GC01 sprite) laid root->tip in photo px
        def foot(tip):
            root = tip - a * Lpx
            ext = np.array([[*tip], [*root]])
            x0, x1 = int(max(ext[:, 0].min() - hw2 - 1, 0)), int(min(ext[:, 0].max() + hw2 + 2, W))
            y0, y1 = int(max(ext[:, 1].min() - hw2 - 1, 0)), int(min(ext[:, 1].max() + hw2 + 2, H))
            if x1 <= x0 or y1 <= y0:
                return None
            dx, dy = xx[y0:y1, x0:x1] - root[0], yy[y0:y1, x0:x1] - root[1]
            t = (dx * a[0] + dy * a[1]) / Lpx  # 0 root .. 1 tip
            sx = (dx * perp[0] + dy * perp[1]) / (2 * hw2) + 0.5
            ok = (t >= 0) & (t <= 1) & (sx >= 0) & (sx <= 1)
            ti = np.clip((t * (sa.shape[0] - 1)).astype(int), 0, sa.shape[0] - 1)
            si = np.clip((sx * (sa.shape[1] - 1)).astype(int), 0, sa.shape[1] - 1)
            return (y0, y1, x0, x1), ok & sa[ti, si]
        chosen = []
        feet = [(c, foot(c)) for c in cands]
        feet = [(c, f) for c, f in feet if f is not None]
        while True:
            best, bg = None, FOLD_MIN_GAIN
            for i, (c, (bb, fm)) in enumerate(feet):
                y0, y1, x0, x1 = bb
                newp = fm & want[y0:y1, x0:x1] & ~covered[y0:y1, x0:x1]
                bad = fm & ~allowed[y0:y1, x0:x1]
                outside = bad & ~anyreg[y0:y1, x0:x1]
                offbird = fm & bgm[y0:y1, x0:x1]
                g = newp.sum() - FOLD_BAD * bad.sum() - FOLD_BAD_OUT * outside.sum() - 8.0 * offbird.sum()
                if g > bg:
                    best, bg = i, g
            if best is None:
                break
            c, (bb, fm) = feet.pop(best)
            y0, y1, x0, x1 = bb
            covered[y0:y1, x0:x1] |= fm
            chosen.append(c)
        shown |= covered
        chosen += [np.asarray(t, float) for t in _fold_extra().get(str(r), [])]  # fill pass (tools/fit_fold.py)
        for tip in chosen:
            tip = tip + np.asarray(FOLD_SHIFT.get(r, (0.0, 0.0)))  # measured centroid correction (photo px)
            root = tip - a * Lpx
            y0, z0 = bs.half_to_bl(*root)
            y1, z1 = bs.half_to_bl(*tip)
            p, nrm = _fold_surface(bvh, kd, root, lift)
            pm, _ = _fold_surface(bvh, kd, 0.5 * (root + tip), lift)
            if p is None or pm is None:
                continue
            d = _norm(np.array([pm[0] - p[0], y1 - y0, z1 - z0]))
            # lie on the surface (not edge-on): near the back line the folded wing and scapulars then
            # close in over the dorsal curve towards the spine, as in the rear photos
            F = frame(p, d, _norm(FOLD_NORMAL_BLEND * np.asarray(nrm) + (1 - FOLD_NORMAL_BLEND) * np.array([1.0, 0.0, 0.0])))
            for M, sfx in ((F, ".L"), (D4 @ F @ D4, ".R")):
                bn = bone + (sfx if bone != "chest" else "")
                cb.add(M, "SCAP%d" % (3 + n % 2) if r == 7 else "GC01", (1.0, 1.0, 1.0), bn, length=L * FOLD_FORE, width=L * wr, segs_l=4, segs_w=2,
                       camber=0.04, bend=0.0, lift=0.0, region=r)
            n += 1
    ob = cb.build("SP_WingFold", fold_material(atlas_img))
    add_photo_uv(ob)
    return ob, n


UNDERWING_SRGB = (0.86, 0.84, 0.80)  # pale grey-buff underwing (flight_pair_pavadk, flight_lam, flight_hover_arquus)


def underwing_atlas(atlas_img):
    """Pale copy of the scan atlas for the underside of the flight feathers: scan luminance (vanes, barbs,
    rachis) x the underwing colour sampled from the flight photos; alpha unchanged."""
    w, h = atlas_img.size
    px = np.array(atlas_img.pixels[:], dtype=np.float32).reshape(-1, 4)
    lum = px[:, :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    rel = np.clip(0.88 + 1.2 * lum, 0.85, 1.12)  # dark scans -> pale vanes, rachis/barb texture kept
    base = bt.srgb_to_linear(np.asarray(UNDERWING_SRGB, np.float32))
    out = px.copy()
    out[:, :3] = np.clip(rel[:, None] * base[None, :], 0.0, 1.0)
    name = "SP_Feather_Atlas_Under"
    img = bpy.data.images.get(name)
    if img is None or tuple(img.size) != (w, h):
        if img:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels[:] = out.ravel()
    img.filepath_raw = os.path.join(bt.TEX, "feather_atlas_under.png")
    img.file_format = "PNG"
    img.save()
    return img


def two_sided_wing(ob, atlas_img, normal_img):
    """Upper side: the scan (dark primaries with buff edges, chestnut / black-and-white coverts baked in s06).
    Under side: duplicated, flipped faces with the pale underwing atlas. Both single-sided, so glTF keeps them."""
    import bmesh
    top = bpy.data.materials.get("SP_WingTop") or bt.material_textured(
        "SP_WingTop", atlas_img, normal_img=normal_img, normal_strength=0.6, roughness=0.62, alpha_clip=0.5,
        vertex_color="Col", sheen=0.05, sheen_tint=(0.6, 0.55, 0.5), specular=0.35, double_sided=False)
    under = bpy.data.materials.get("SP_WingUnder") or bt.material_textured(
        "SP_WingUnder", underwing_atlas(atlas_img), roughness=0.7, alpha_clip=0.5, sheen=0.1,
        sheen_tint=(0.8, 0.78, 0.75), specular=0.3, double_sided=False)
    me = ob.data
    me.materials.clear(); me.materials.append(top); me.materials.append(under)
    bm = bmesh.new(); bm.from_mesh(me)
    faces = list(bm.faces)
    for f in faces:
        f.material_index = 0
    dup = bmesh.ops.duplicate(bm, geom=faces + list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}))
    new_faces = [g for g in dup["geom"] if isinstance(g, bmesh.types.BMFace)]
    bmesh.ops.reverse_faces(bm, faces=new_faces)
    bm.normal_update()
    for v in {v for f in new_faces for v in f.verts}:  # 0.04 mm below the upper side: no z-fighting
        v.co += v.normal * 0.00004
    for f in new_faces:
        f.material_index = 1
    had_custom = me.has_custom_normals
    if had_custom:
        cn = np.array([c.vector[:] for c in me.corner_normals], np.float32)
    bm.to_mesh(me); bm.free()
    me.update()
    if had_custom:  # duplicated corners come after the originals: same normals, flipped for the underside
        n0 = len(cn)
        mi = np.empty(len(me.polygons), np.int32); me.polygons.foreach_get("material_index", mi)
        out = np.zeros((len(me.loops), 3), np.float32)
        out[:n0] = cn
        for poly in me.polygons:
            if poly.material_index == 1:
                for li in poly.loop_indices:
                    out[li] = poly.normal[:]
        me.normals_split_custom_set(out.tolist())


def add_photo_uv(ob):
    ob["sp_dorsal_brown"] = 1.0 if ob.name in DORSAL_OBJS else 0.0
    """Second UV map projecting every vertex orthographically into the side photo."""
    me = ob.data
    co = bt.object_verts(ob)
    hp = _bl_to_half(co)
    uvl = me.uv_layers.new(name="photo")
    lv = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", lv)
    uv = np.stack([hp[lv, 0] / 640.0, 1.0 - hp[lv, 1] / 426.0], 1).astype(np.float32)
    uvl.data.foreach_set("uv", uv.ravel())
    me.uv_layers.active = me.uv_layers["UVMap"] if "UVMap" in me.uv_layers else me.uv_layers[0]
    # rest-pose |normal.x| drives the photo/scan blend, so a wing keeps its photo pattern when the rig
    # spreads it (a posed normal would flip spread wings to the plain dorsal colour)
    nrm = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("normal", nrm)
    at = me.attributes.get("rest_nx") or me.attributes.new("rest_nx", "FLOAT", "POINT")
    at.data.foreach_set("value", np.abs(nrm.reshape(-1, 3)[:, 0]))


def run():
    meta = json.load(open(os.path.join(BUILD, "feather_atlas.json"), encoding="utf-8"))
    atlas = _image("SP_Feather_Atlas", "feather_atlas.png")
    atlas_n = _image("SP_Feather_Atlas_Normal", "feather_atlas_normal.png", non_color=True)
    mat = feather_material(atlas, atlas_n)
    left, right = build_wings(meta, mat)
    tail, _T = build_tail(meta, mat)
    scap = build_scapulars(meta, mat)
    _back, n_back = build_back(meta, mat)
    build_wing_bars(meta, mat)
    _fold, n_fold = build_wing_fold(meta, atlas)
    add_photo_uv(tail)  # rectrices: scan vanes/barbs + colour projected from the side photo's tail
    tail.data.materials.clear(); tail.data.materials.append(bpy.data.materials["SP_WingFold"])
    build_spine(meta)
    for nm in ("SP_WingTop", "SP_WingUnder"):
        if bpy.data.materials.get(nm):
            bpy.data.materials.remove(bpy.data.materials[nm])
    for ob in (left, right):  # real scan feathers: they show only when the wing opens (fold overlay hides them)
        two_sided_wing(ob, atlas, atlas_n)
    for ob in (_back, scap, bpy.data.objects["SP_WingBars"]):  # mantle / rump: colour from the photo too, so no buff seam against the wing
        add_photo_uv(ob)
        ob.data.materials.clear(); ob.data.materials.append(bpy.data.materials["SP_WingFold"])
    head_img, head_meta = head_atlas()
    head_mat = head_material(head_img)
    contour, placed = build_contours(meta, mat, head=(head_meta, head_mat))
    trousers = build_trousers(meta, mat)
    down_img, down_meta = down_atlas()
    _down, n_down = build_down(down_meta, down_material(down_img), head=(head_meta, head_mat))
    return "feathers: fold %d, wings %d+%d verts, tail %d, scapulars %d, back %d, contour cards %d, trousers %d, down tufts %d" % (
        n_fold, len(left.data.vertices), len(right.data.vertices), len(tail.data.vertices), len(scap.data.vertices) // 12, n_back,
        placed, len(trousers.data.vertices) // 12, n_down)
