"""Step 8: armature and skin weights. The rest pose is the modelled pose (wings folded, tail closed).

Bones
  root (feet) > hips > chest > neck1 > neck2 > head > bill_upper / jaw;  neck2 > throat (puff, scaled)
  hips > tail > R1..R6 .L/.R;  root > leg.L/R (static tarsus + toes);  hips > thigh.L/R (feathered tibia)
  chest > humerus > forearm > hand, with one bone per flight feather (P1-P10, S1-S9) .L/.R
Coverts were already grouped to the flight feather or arm bone they follow (s07).
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

import splib as bt
import spshape as bs
import s04_parts as parts
import s07_feathers as sf

RIG = "SP_Rig"
MM = bt.MM
D4 = np.diag([-1.0, 1.0, 1.0, 1.0])

# Body chain pivots on the side photo (half-res px).
BODY_PX = {
    "hips": (384, 238),
    "chest": (338, 198),
    "neck1": (318, 158),
    "neck2": (311, 130),
    "head": (316, 107),
    "head_tip": (268, 90),
    "bill_upper": (211, 93),  # upper-mandible hinge: culmen base at the forehead (s04 CULMEN end)
    "bill_tip": (168.5, 121),  # s04 bill tip; jaw pivot JAW_PX = gape corner (s04 GAPE end), near the eye line
    "throat": (277, 130),
    "throat_tip": (262, 152),
}
JAW_PX = (213.5, 109.5)  # commissure corner (rictus) of the s04 bill
BODY_CHAIN = ["hips", "chest", "neck1", "neck2", "head", "tail"]


def P(name):
    y, z = bs.half_to_bl(*(JAW_PX if name == "jaw" else BODY_PX[name]))
    return np.array([0.0, float(y), float(z)])


def dorsal(y_axis):
    """Unit vector perpendicular to y_axis in the sagittal plane, pointing up (local X becomes lateral)."""
    y = np.asarray(y_axis, float)
    z = np.array([0.0, -y[2], y[1]])
    if z[2] < 0 or (abs(z[2]) < 1e-9 and z[1] > 0):
        z = -z
    return z / np.linalg.norm(z)


def bone_specs():
    """(name, head, tail, z_axis, parent) for every bone, in armature (= world) space."""
    specs = [("root", np.zeros(3), np.array([0.0, 0.0, 0.012]), np.array([0.0, -1.0, 0.0]), None)]

    def body(name, a, b, parent):
        h, t = P(a), P(b)
        specs.append((name, h, t, dorsal(t - h), parent))

    body("hips", "hips", "chest", "root")
    body("chest", "chest", "neck1", "hips")
    body("neck1", "neck1", "neck2", "chest")
    body("neck2", "neck2", "head", "neck1")
    body("head", "head", "head_tip", "neck2")
    body("bill_upper", "bill_upper", "bill_tip", "head")
    body("jaw", "jaw", "bill_tip", "head")
    body("throat", "throat", "throat_tip", "neck2")

    T = sf.tail_frame()
    specs.append(("tail", T[:3, 3], T[:3, 3] + T[:3, 1] * 8 * MM, T[:3, 2], "hips"))
    meta = json.load(open(os.path.join(sf.BUILD, "feather_atlas.json"), encoding="utf-8"))
    for side, sfx in ((1, ".L"), (-1, ".R")):
        for i in range(1, 7):
            F = sf.rectrix_frame(T, i, side)
            L = meta["feathers"]["S%d" % i]["h_mm"] * MM
            specs.append(("R%d%s" % (i, sfx), F[:3, 3], F[:3, 3] + F[:3, 1] * L, F[:3, 2], "tail"))

    for side, sfx in ((1, ".L"), (-1, ".R")):
        heel = np.array([side * parts.HEEL[0], parts.HEEL[1], parts.HEEL[2]]) * MM
        foot = np.array([side * parts.FOOT[0], parts.FOOT[1], parts.FOOT[2]]) * MM
        hip = np.array([side * parts.HIP[0], parts.HIP[1], parts.HIP[2]]) * MM
        lat = np.array([side * 1.0, 0.0, 0.0])
        specs.append(("tibia" + sfx, hip, heel, lat, "hips"))
        specs.append(("tarsus" + sfx, heel, foot, lat, "tibia" + sfx))
        specs.append(("foot" + sfx, foot, foot + np.array([0.0, -6.0, -0.4]) * MM, np.array([0.0, 0.0, 1.0]), "tarsus" + sfx))

    folded, _spread, lengths = sf.load_arm()
    wing = []
    for name, _a, _b in sf.ARM_BONES:
        F = folded[name]
        parent = {"humerus": "chest", "forearm": "humerus", "hand": "forearm"}[name]
        wing.append((name, F, lengths[name], parent))
    for sp in sf.feather_specs():
        if not sp["flight"]:
            continue
        F = sf.feather_frame(folded[sp["parent"]], lengths[sp["parent"]], sp, "folded")
        wing.append((sp["bone"], F, sf.feather_length_mm(meta, sp) * MM, sp["parent"]))
    for name, F, L, parent in wing:
        for sfx, M in ((".L", F), (".R", D4 @ F @ D4)):
            par = parent if parent == "chest" else parent + sfx
            specs.append((name + sfx, M[:3, 3], M[:3, 3] + M[:3, 1] * L, M[:3, 2], par))
    # photo-fitted folded-wing overlay (SP_WingFold): rides on the humerus, scaled away while the wing is open
    F = folded["humerus"]
    for sfx, M in ((".L", F), (".R", D4 @ F @ D4)):
        specs.append((FOLD_BONE + sfx, M[:3, 3], M[:3, 3] + M[:3, 1] * lengths["humerus"] * 0.8, M[:3, 2], "humerus" + sfx))
    return specs


FOLD_BONE = "wingfold"


def fold_weights(ob):
    """Every SP_WingFold card rigid on its side's wingfold bone."""
    side = {}
    for vg in ob.vertex_groups:
        side[vg.index] = ".R" if vg.name.endswith(".R") else ".L"
    sfx_of = []
    for v in ob.data.vertices:
        g = max(v.groups, key=lambda e: e.weight, default=None)
        sfx_of.append(side.get(g.group, ".L") if g is not None else (".L" if v.co.x >= 0 else ".R"))
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    for sfx in (".L", ".R"):
        vg = ob.vertex_groups.new(name=FOLD_BONE + sfx)
        idx = [i for i, s in enumerate(sfx_of) if s == sfx]
        if idx:
            vg.add(idx, 1.0, "REPLACE")


def build_armature():
    bt.remove_object(RIG)
    arm = bpy.data.armatures.new(RIG)
    arm.display_type = "STICK"
    ob = bpy.data.objects.new(RIG, arm)
    bt.collection(bt.COLL_BIRD).objects.link(ob)
    ob.show_in_front = True
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.edit_bones
    for name, head, tail, z, parent in bone_specs():
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        b.align_roll(Vector(z))
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.bones["root"].use_deform = False
    for pb in ob.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ob


# ---------------------------------------------------------------- weights


def _seg_dist(p, a, b):
    e = b - a
    t = np.clip(((p - a) @ e) / (e @ e), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * e), axis=1)


def _set_groups(ob, weights):
    """weights: dict group -> (N,) array."""
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    for g, w in weights.items():
        vg = ob.vertex_groups.new(name=g)
        idx = np.nonzero(w > 1e-4)[0]
        for i in idx:
            vg.add([int(i)], float(w[i]), "REPLACE")


def body_weights(rig, ob):
    bones = rig.data.bones
    co = bt.object_verts(ob, world=True)
    seg = {n: (np.array(bones[n].head_local), np.array(bones[n].tail_local)) for n in BODY_CHAIN + ["throat", "jaw"]}
    eps = (2.0 * MM) ** 2
    W = {}
    for n in BODY_CHAIN:
        d = _seg_dist(co, *seg[n])
        W[n] = 1.0 / (d * d + eps) ** 2
    tot = sum(W.values())
    for n in W:
        W[n] = W[n] / tot
    # keep the 3 strongest influences per vertex
    stack = np.stack([W[n] for n in BODY_CHAIN], 1)
    order = np.argsort(-stack, axis=1)
    keep = np.zeros_like(stack, dtype=bool)
    rows = np.arange(len(co))[:, None]
    keep[rows, order[:, :3]] = True
    stack = np.where(keep, stack, 0.0)
    stack /= stack.sum(1, keepdims=True)
    W = {n: stack[:, i] for i, n in enumerate(BODY_CHAIN)}
    # throat puff bone and chin following the lower mandible
    d_t = _seg_dist(co, *seg["throat"])
    w_t = 0.75 * bt.smoothstep(8.5 * MM, 2.5 * MM, d_t)
    jh, jt = seg["jaw"]
    jz = np.array(bones["jaw"].matrix_local)[:3, 2]
    below = ((co - jh) @ jz) < 0
    d_j = _seg_dist(co, jh, jt)
    w_j = 0.8 * bt.smoothstep(4.0 * MM, 1.0 * MM, d_j) * below
    rest = 1.0 - np.clip(w_t + w_j, 0, 0.95)
    for n in BODY_CHAIN:
        W[n] = W[n] * rest
    W["throat"] = w_t * (1 - w_j)
    W["jaw"] = w_j
    _set_groups(ob, W)
    return W


MOUTH_GAPE_PX, MOUTH_TIP_PX = (219.0, 105.0), (184.0, 113.0)
MOUTH_ROWS = 7
MOUTH_BACK = 4.0  # mm the cavity reaches behind the gape


MOUTH_RGB, TONGUE_RGB = (0.47, 0.21, 0.18), (0.68, 0.32, 0.29)  # adult: dark pinkish-grey, near-black deep in  # dark pinkish-grey lining, muted rose tongue


MOUTH_RING = 20  # points around each cavity cross-section (upper half: palate, lower half: floor)
FLANGE_RGB = (0.40, 0.31, 0.19)  # pale yellowish gape flange / tomia at the commissure
THROAT_RGB = (0.035, 0.02, 0.02)  # the cavity darkens toward the throat
CHOANA_RGB = (0.17, 0.065, 0.055)
CORNER_CUT_X = 4.8  # mm: feather cards crossing the gape line out to here are dropped
BRIDGE_KEEP_X = 99.0  # mm: bridging (upper-lower) skin faces wider than this are kept as the rictal web
GAPE_KEEP_X = 99.0  # mm: head-skin gape faces wider than this stay (commissure skin)
RICTAL_RGB = (0.56, 0.43, 0.30)  # pale yellowish-flesh gape skin (rictal flange) at the mouth corners  # choanal slit along the palate midline


def _mouth_hh(t, L):
    """Cavity half height: 0.9 mm at the gape, tapering to the tip, deepening behind the gape (throat)."""
    if t >= 0:
        return (1.1 * (1 - t) + 0.15 * t) * MM
    return (1.1 + 0.5 * min(-t * L / (MOUTH_BACK * MM), 1.0)) * MM


MOUTH_HW = 4.4  # half width of the cavity at the commissure (mm): wider than the cut skin, so the corners are closed


def _ring(n, hw, hh, zc, y, floor=0.4):
    """Elliptical cross-section ring (x, y, z) with a slightly shallower floor; returns verts and sin(angle)."""
    out, sn = [], []
    for k in range(n):
        a_ = 2 * math.pi * k / n
        c, s_ = math.cos(a_), math.sin(a_)
        out.append((hw * c, y, zc + hh * s_ * (1.0 if s_ >= 0 else floor)))
        sn.append(s_)
    return out, sn


def _lining_material(name, rgb, rough=0.85, spec=0.04):
    """Moist pink flesh: faintly glossy, subtle subsurface, darkened toward the throat by the 'Col' vertex colour."""
    m = bt.material_flat(name, rgb, roughness=rough, specular=spec, double_sided=True)
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    try:
        bt.sock(bsdf, "Subsurface Weight").default_value = 0.25
        bt.sock(bsdf, "Subsurface Radius").default_value = (0.9, 0.25, 0.15)
        bt.sock(bsdf, "Subsurface Scale").default_value = 0.0008
    except Exception:
        pass
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    mix.inputs[6].default_value = (*rgb, 1)
    nt.links.new(vc.outputs["Color"], mix.inputs[7]); nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    return m


def _arc(world, base, kind):
    """16 points of one mandible's cross-section at slice s of the bill loft: rim, 14 lining points, rim."""
    L_ = 27
    out_k, in_k = 13, 14
    seg = world[base:base + L_]
    lin = [seg[out_k + i] for i in range(in_k)]  # lining points
    if kind == "up":  # +x rim -> lining (+x .. -x) -> -x rim
        return [seg[out_k - 1]] + lin + [seg[0]]
    return [seg[out_k - 1]] + lin + [seg[0]]  # lower loop: outer k=12 is -x, k=0 is +x, lining runs -x .. +x


def build_mouth():  # noqa: C901
    """Oral cavity rebuilt from open-beak passerine photos and the house-sparrow oropharynx anatomy:
    - a smooth pharynx (hemispherical throat) whose front ring IS the bill-base cross-section, so it joins the two
      lined mandibles with no gap; side walls form a rounded rictal skin fold that stretches with the gape;
    - the upper bill lining is the palate: two lateral palatal ridges, a median ridge and the choanal slit;
    - the lower bill lining is a trough holding a narrow arrow-shaped tongue with a median groove;
    - moist pink-flesh lining, darker toward the throat."""
    import bmesh
    bt.remove_object("SP_Mouth")
    up_ob, lo_ob = bpy.data.objects["SP_Bill_Upper"], bpy.data.objects["SP_Bill_Lower"]
    uw, lw = bt.object_verts(up_ob, world=True), bt.object_verts(lo_ob, world=True)
    G = np.array(bs.half_to_bl(*MOUTH_GAPE_PX)); T = np.array(bs.half_to_bl(*MOUTH_TIP_PX))
    L = np.linalg.norm(T - G)
    dback = (T - G) / L
    perp = np.array([-dback[1], dback[0]])
    if perp[1] < 0:
        perp = -perp
    LS, S_BASE = 27, 25

    def slice_pts(world, s_):
        return world[s_ * LS:(s_ + 1) * LS]

    def tpar(p):
        return float((np.array(p[1:]) - G) @ dback / L)

    def hpar(p):
        return float((np.array(p[1:]) - G) @ perp / MM)

    # ---- front ring = bill base cross-section (upper arc +x -> -x, lower arc -x -> +x), plus rounded wall points
    ua = _arc(uw, S_BASE * LS, "up")
    la = _arc(lw, S_BASE * LS, "lo")
    ring = []   # (point, weight_upper, wall_kind)
    for p in ua:
        ring.append((np.array(p), 1.0, 0))
    wallL = [(2.0 / 3.0), (1.0 / 3.0)]
    pa, pb = np.array(ua[-1]), np.array(la[0])  # -x rim: upper end -> lower start
    for f_, wt in zip((1 / 3, 2 / 3), wallL):
        q = pa * (1 - f_) + pb * f_
        q[0] *= 1.00
        ring.append((q, wt, 1))
    for p in la:
        ring.append((np.array(p), 0.0, 0))
    pa, pb = np.array(la[-1]), np.array(ua[0])  # +x rim: lower end -> upper start
    for f_, wt in zip((1 / 3, 2 / 3), (1.0 / 3.0, 2.0 / 3.0)):
        q = pa * (1 - f_) + pb * f_
        q[0] *= 1.00
        ring.append((q, wt, 1))
    NR_ = len(ring)
    cen = np.mean([r[0] for r in ring], axis=0)
    cen[0] = 0.0
    t_f = tpar(cen)
    t_p = -MOUTH_BACK * MM / L
    D = (t_f - t_p) * L
    verts, faces, wu, mat, shade = [], [], [], [], []
    rows = []
    NROW = 11
    for j in range(NROW):
        u = j / float(NROW)  # 0 = bill base ring ... 1 = pole
        sx = 1.0 + 0.15 * float(bt.smoothstep(0.15, 0.55, u))
        sh = 1.0 + 0.85 * float(bt.smoothstep(0.20, 0.75, u))
        clo = math.sqrt(max(1.0 - max((u - 0.50) / 0.50, 0.0) ** 2, 0.0))  # hemispherical closure
        dist = D * (u ** 1.1)
        base = len(verts)
        for (p, w_, wk) in ring:
            dx = p[0] * sx * clo
            dyz = np.array(p[1:]) - np.array(cen[1:])
            a_ = dyz @ dback
            h_ = dyz @ perp
            q = np.array(cen[1:]) + dback * a_ - dback * dist + perp * h_ * sh * clo
            verts.append((dx, float(q[0]), float(q[1])))
            _m = float(bt.smoothstep(0.15, 0.85, u))
            wu.append(w_ * (1.0 - _m) + 0.5 * _m)  # back wall moves as one with the gape: no shear creases at the pole
            sdm = 1.0 - 0.62 * float(bt.smoothstep(0.0, 1.0, u))
            gl_ = abs(float((q - G) @ perp)) / MM  # distance from the closed gape line
            dk_ = 1.0 - (1.0 - float(bt.smoothstep(0.0, 0.7, gl_))) * (1.0 - float(bt.smoothstep(0.0, 0.35, u))) * 0.75
            shade.append(sdm * dk_ * (0.82 if wk else 1.0))  # the slit between shut mandibles reads dark, not red
        rows.append(base)
    pole = len(verts)
    pp = np.array(cen[1:]) - dback * D
    verts.append((0.0, float(pp[0]), float(pp[1]))); wu.append(0.5); shade.append(0.30)
    for r in range(len(rows) - 1):
        for k in range(NR_):
            a0, a1 = rows[r] + k, rows[r] + (k + 1) % NR_
            faces.append((a0, a1, rows[r + 1] + (k + 1) % NR_, rows[r + 1] + k)); mat.append(0)
    for k in range(NR_):
        faces.append((rows[-1] + k, rows[-1] + (k + 1) % NR_, pole)); mat.append(0)

    # ---- rictal flaps: the gape skin that webs the upper and lower cutting edges at the commissure. It is attached
    # along both tomia for the last few mm of the bill and stretches with the jaw (weights fade upper -> lower), so the
    # open corners read as a closed, slightly bulging skin fold and fold flat (zero area) when the bill shuts.
    NWS, NWV = 9, 11
    def _rim(world, sf, kind, side):
        s0 = int(math.floor(sf)); s1 = min(s0 + 1, S_BASE); a = sf - s0
        r0 = _arc(world, s0 * LS, kind); r1 = _arc(world, s1 * LS, kind)
        if kind == "up":
            i_ = 0 if side > 0 else -1
        else:
            i_ = -1 if side > 0 else 0
        return np.array(r0[i_]) * (1 - a) + np.array(r1[i_]) * a
    NBK = 5  # rows behind the bill base: the fold rolls back into the face skin at the commissure
    THK = 0.32 * MM  # membrane thickness at its middle: a soft, fleshy fold, not a sheet
    for sg in (1, -1):
        outer, inner = [], []
        for i in range(-NBK, NWS + 1):
            ro, ri = [], []
            fr_ = max(i, 0) / float(NWS)  # 0 at the base ... 1 at the free (forward) edge
            for jv in range(NWV):
                v = jv / (NWV - 1.0)
                bul = math.sin(math.pi * v)
                if i >= 0:
                    sf = S_BASE - i * 0.85 * (1.0 - 0.6 * bul ** 1.5)  # concave free edge: deepest at mid-gape
                    U = _rim(uw, sf, "up", sg); Lw = _rim(lw, sf, "lo", sg)
                    vv = v + 0.10 * math.sin(2.0 * math.pi * v) * (1.0 - fr_)  # soft S-fold
                    P = U * (1 - vv) + Lw * vv
                    k_ = 0.0
                else:
                    k_ = -i / float(NBK)
                    U = _rim(uw, S_BASE, "up", sg); Lw = _rim(lw, S_BASE, "lo", sg)
                    P = U * (1 - v) + Lw * v
                    P[1:] = P[1:] - dback * (math.sin(0.5 * math.pi * k_) * 2.6 * MM)
                ox = abs(P[0])
                bo = 0.06 * bul * (1.0 - 0.6 * fr_) + 0.40 * k_ ** 1.5
                po = P.copy(); po[0] = sg * ox * (1.0 + bo)  # outer skin bulges gently outward
                th = THK * bul * (0.55 + 0.45 * (1.0 - fr_)) * (1.0 + 0.4 * k_)
                pi_ = P.copy(); pi_[0] = sg * max(ox * (1.0 + bo) - th, 0.2 * MM)
                w_ = float(1.0 - bt.smoothstep(0.0, 1.0, v))
                for arr, q, sh_ in ((ro, po, 0.88 + 0.12 * (1.0 - bul)), (ri, pi_, 0.62 + 0.30 * (1.0 - bul))):
                    arr.append(len(verts)); verts.append((float(q[0]), float(q[1]), float(q[2])))
                    wu.append(w_); shade.append(sh_)
            outer.append(ro); inner.append(ri)
        nI = len(outer)
        for i in range(nI - 1):
            for jv in range(NWV - 1):
                o0, o1, o2, o3 = outer[i][jv], outer[i][jv + 1], outer[i + 1][jv + 1], outer[i + 1][jv]
                kk_ = (NBK - i) / float(NBK)
                faces.append((o0, o1, o2, o3) if sg > 0 else (o3, o2, o1, o0)); mat.append(4)
                n0, n1, n2, n3 = inner[i][jv], inner[i][jv + 1], inner[i + 1][jv + 1], inner[i + 1][jv]
                ifr = (i - NBK) / float(NWS)
                faces.append((n3, n2, n1, n0) if sg > 0 else (n0, n1, n2, n3)); mat.append(4 if ifr > 0.55 else 0)
        last = nI - 1  # rounded free lip joins outer and inner skins
        for jv in range(NWV - 1):
            a0, a1, b1, b0 = outer[last][jv], outer[last][jv + 1], inner[last][jv + 1], inner[last][jv]
            faces.append((a0, b0, b1, a1) if sg > 0 else (a1, b1, b0, a0)); mat.append(4)

    # ---- palate: ridges, median ridge and choanal slit sitting on the upper bill lining
    def lining_h(world, s_, x_mm):
        pts = slice_pts(world, s_)[13:27]  # lining points, +x .. -x
        xs_ = np.array([q[0] / MM for q in pts]); ys_ = np.array([q[1] for q in pts]); zs_ = np.array([q[2] for q in pts])
        o = np.argsort(xs_)
        return float(np.interp(x_mm, xs_[o], ys_[o])), float(np.interp(x_mm, xs_[o], zs_[o]))

    def ribbon(world, s_list, xf, wf, hf, m_idx, shd, wu_v, invert=False):
        """Strip of 3-point cross-sections (edge, crest, edge) following the lining; crest protrudes into the mouth."""
        base0 = len(verts)
        NP = 9  # rounded cross-section: flat flank -> smooth crest -> flat flank
        for s_ in s_list:
            f = (S_BASE - s_) / float(S_BASE - s_list[-1])
            xc, wd, ht = xf(f), wf(f), hf(f)
            hw_ = abs(float(_arc(world, s_ * LS, 'up')[0][0])) / MM  # half-width of the bill here
            xc = max(-0.50 * hw_, min(0.50 * hw_, xc)); wd = min(wd, 0.22 * hw_); ht = min(ht, 0.12 * hw_)  # tucked in the vault
            for k_ in range(NP):
                u_ = -1.0 + 2.0 * k_ / (NP - 1)
                tw_ = float(bt.smoothstep(0.0, 0.22, f)) * float(bt.smoothstep(1.0, 0.80, f)) if ht > 0 else 1.0
                dx_ = wd * u_ * (0.55 + 0.45 * tw_)
                tap = tw_
                lift = ht * max(tap, 0.0) * math.cos(0.5 * math.pi * u_) ** 1.6
                y_, z_ = lining_h(world, s_, xc + dx_)
                nrm_ = np.array([perp[0], perp[1]])
                off = (-lift if not invert else lift) * MM * nrm_
                verts.append(((xc + dx_) * MM, y_ + float(off[0]), z_ + float(off[1])))
                wu.append(wu_v); shade.append(shd * (0.70 + 0.30 * math.cos(0.5 * math.pi * u_) ** 1.5))
        n_ = len(s_list)
        for i in range(n_ - 1):
            for c in range(NP - 1):
                a0 = base0 + i * NP + c
                faces.append((a0, a0 + 1, a0 + NP + 1, a0 + NP)); mat.append(m_idx)

    sl = list(range(S_BASE, 3, -1))
    for sg in (-1, 1):  # lateral palatal ridges: long, converging forward
        ribbon(uw, sl[:17], lambda f, sg=sg: sg * (1.65 - 0.75 * f), lambda f: 0.30 - 0.10 * f, lambda f: 0.24 * (1 - 0.40 * f), 2, 1.0, 1.0)
    ribbon(uw, sl[7:16], lambda f: 0.0, lambda f: 0.18, lambda f: 0.16, 2, 1.0, 1.0)  # median ridge in front of the choana
    ribbon(uw, sl[0:8], lambda f: 0.0, lambda f: 0.13 * math.sin(math.pi * min(f / 0.34, 1.0)) ** 0.6 + 0.015,
           lambda f: 0.0, 3, 0.35, 1.0)  # choanal slit: dark, flush with the roof
    # ---- lower trough centre line (for the tongue and the larynx)
    cl_t, cl_h, cl_w = [], [], []
    for s_ in range(S_BASE, 1, -1):
        y_, z_ = lining_h(lw, s_, 0.0)
        cl_t.append(tpar((0, y_, z_))); cl_h.append(hpar((0, y_, z_)))
        cl_w.append(abs(float(_arc(lw, s_ * LS, 'lo')[0][0])) / MM)
    cl_t, cl_h, cl_w = np.array(cl_t), np.array(cl_h), np.array(cl_w)

    def trough_w(t):
        return float(np.interp(t, cl_t, cl_w)) if t >= cl_t[0] else float(cl_w[0])

    def trough_h(t):
        return float(np.interp(t, cl_t, cl_h)) if t >= cl_t[0] else float(cl_h[0]) - 0.35 * (cl_t[0] - t) * L / MM * 0.5

    def at_(t, xm, hm):
        y_, z_ = G + t * (T - G) + perp * hm * MM
        return (xm * MM, float(y_), float(z_))

    # ---- tongue: narrow, arrow-shaped, pointed, median groove, lying in the trough
    NT, NRT = 22, 18
    t0, t1 = 0.00, 1.02
    WMAX, HMAX = 1.20, 0.62
    tong = []
    for j in range(NT):
        f = j / (NT - 1)
        t = t0 + f * (t1 - t0)
        w = WMAX * ((f / 0.30) ** 0.55 if f < 0.30 else (1 - (f - 0.30) / 0.70) ** 1.10) + 0.035
        h = HMAX * (1 - f ** 1.7) + 0.10
        base = trough_h(t) + 0.22 + 0.18 * f ** 1.4
        w = min(w, 0.62 * trough_w(t) + 0.02)  # stays inside the lower mandible's trough
        base = min(base, -0.22 - 1.30 * h)  # the whole tongue stays below the gape line: hidden when the bill shuts
        ring_ = []
        for k in range(NRT):
            a_ = 2 * math.pi * k / NRT
            c, s_ = math.cos(a_), math.sin(a_)
            x_ = w * c
            if s_ >= 0:
                groove = 0.40 * h * math.exp(-(x_ / (0.22 * w + 0.05)) ** 2) * (1 - f ** 3)
                z_ = base + 0.30 * h + h * s_ - groove
            else:
                z_ = base + 0.30 * h + 0.45 * h * s_
            ring_.append(at_(t, x_, z_))
        tong.append(len(verts))
        verts.extend(ring_); wu.extend([0.0] * NRT)
        shade.extend([0.45 + 0.55 * f ** 0.8] * NRT)
    tp0 = len(verts); verts.append(at_(t0 - 0.03, 0.0, trough_h(t0) + 0.04 + 0.2)); wu.append(0.0); shade.append(0.4)
    tp1 = len(verts); verts.append(at_(t1 + 0.02, 0.0, trough_h(t1) + 0.22 + 0.18 + 0.30 * 0.10 + 0.02)); wu.append(0.0); shade.append(1.0)  # closes the last ring at its own height (no spike)
    for k in range(NRT):
        faces.append((tp0, tong[0] + (k + 1) % NRT, tong[0] + k)); mat.append(1)
    for j in range(NT - 1):
        for k in range(NRT):
            a0, a1 = tong[j] + k, tong[j] + (k + 1) % NRT
            faces.append((a0, a1, tong[j + 1] + (k + 1) % NRT, tong[j + 1] + k)); mat.append(1)
    for k in range(NRT):
        faces.append((tong[-1] + k, tong[-1] + (k + 1) % NRT, tp1)); mat.append(1)
    # ---- laryngeal mound with its glottal slit at the tongue root
    lm = []
    for j in range(7):
        f = j / 6.0
        t = -0.20 + 0.20 * f
        w = 0.80 * math.sin(math.pi * (0.15 + 0.85 * f) * 0.5) ** 0.8
        h = 0.55 * math.sin(math.pi * f) ** 0.7 + 0.05
        ring_ = []
        for k in range(10):
            a_ = math.pi * k / 9.0
            ring_.append(at_(t, w * math.cos(a_), trough_h(0.26) - 0.1 + h * math.sin(a_)))
        lm.append(len(verts)); verts.extend(ring_); wu.extend([0.0] * 10); shade.extend([0.35] * 10)
    for j in range(6):
        for k in range(9):
            a0 = lm[j] + k
            faces.append((a0, a0 + 1, lm[j + 1] + k + 1, lm[j + 1] + k)); mat.append(1)
    gl0 = len(verts)
    for j in range(5):
        f = j / 4.0
        t = -0.17 + 0.14 * f
        w = 0.10 * math.sin(math.pi * f) ** 0.7 + 0.01
        zc = trough_h(0.26) - 0.1 + 0.55 * math.sin(math.pi * (j / 4.0)) ** 0.7 + 0.07
        for xs_ in (-w, 0.0, w):
            verts.append(at_(t, xs_, zc)); wu.append(0.0); shade.append(0.30)
    for j in range(4):
        for c in range(2):
            a0 = gl0 + j * 3 + c
            faces.append((a0, a0 + 1, a0 + 4, a0 + 3)); mat.append(3)

    bm = bmesh.new()
    bv = [bm.verts.new(v) for v in verts]
    for f_, m_ in zip(faces, mat):
        try:
            face = bm.faces.new([bv[i] for i in f_]); face.material_index = m_; face.smooth = True
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    me = bpy.data.meshes.new("SP_Mouth")
    bm.to_mesh(me); bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    mats = [_lining_material("SP_MouthCavity", MOUTH_RGB),
            _lining_material("SP_TongueCavity", TONGUE_RGB, rough=0.75, spec=0.08),
            _lining_material("SP_PalateRidge", (0.60, 0.33, 0.29), rough=0.75, spec=0.08),
            _lining_material("SP_Choana", CHOANA_RGB, rough=0.5, spec=0.3),
            _lining_material("SP_RictalSkin", RICTAL_RGB, rough=0.7, spec=0.12),
            _lining_material("SP_CheekSkin", (0.026, 0.023, 0.021), rough=0.95, spec=0.02)]
    for m_ in mats:
        me.materials.append(m_)
    ca = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    lv = np.empty(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", lv)
    sh_ = np.array(shade)
    # vertices dropped by the bmesh build (degenerate faces) keep the order; guard the length
    sh_ = sh_[:len(me.vertices)] if len(sh_) >= len(me.vertices) else np.pad(sh_, (0, len(me.vertices) - len(sh_)), constant_values=1.0)
    sh = sh_[lv]
    # soft vascular mottling: smooth positional noise tints the flesh between rosy and warm (colour only, no new geometry)
    pv = np.array([v.co[:] for v in me.vertices], np.float64)[lv] / MM
    def _n(k):
        return (np.sin(pv[:, 0] * (1.7 + k) + pv[:, 1] * (0.9 * k + 0.4) + k) * np.sin(pv[:, 1] * (1.3 + 0.6 * k) - pv[:, 2] * (1.1 + k) + 2 * k)
                + np.sin(pv[:, 2] * (2.3 + k) + pv[:, 0] * 0.8 - k)) * 0.5
    n1, n2 = _n(1.0), _n(2.3)
    cr = np.clip(sh * (1.0 + 0.05 * n1), 0, 1)
    cg = np.clip(sh * (1.0 + 0.22 * n1 - 0.10 * n2), 0, 1)
    cb = np.clip(sh * (1.0 + 0.20 * n2 - 0.08 * n1), 0, 1)
    ca.data.foreach_set("color", np.stack([cr, cg, cb, np.ones_like(sh)], 1).astype(np.float32).ravel())
    ob = bpy.data.objects.new("SP_Mouth", me)
    bt.collection(bt.COLL_BIRD).objects.link(ob)
    wu_a = np.array(wu)[:len(me.vertices)] if len(wu) >= len(me.vertices) else np.pad(np.array(wu), (0, len(me.vertices) - len(wu)), constant_values=0.5)
    _set_groups(ob, {"bill_upper": wu_a, "jaw": 1.0 - wu_a})
    return ob


CHEEK_T = (0.0, 0.45, 0.75, 1.0)
CHEEK_DARK, CHEEK_LIN, CHEEK_ZR = 0.10, 0.62, 1.8
CHEEK_XIN = 2.6


def add_cheek_collar(body, mouth, reach=1.7, back=0.9):
    """Closes the see-through gap at both sides of the bill base: the head skin's opening around the bill is wider than
    the bill at the gape line, so the open (and slightly open) mouth showed the background past the commissure. A dark
    skin collar runs from every free edge of that opening inward under the bill base; its vertices carry the exact
    skin-vertex weights of the edge they hang from, so it follows the head, bill and jaw without tearing."""
    import bmesh
    G = np.array(bs.half_to_bl(*MOUTH_GAPE_PX)); T = np.array(bs.half_to_bl(*MOUTH_TIP_PX))
    dback = (T - G) / np.linalg.norm(T - G)
    mw = body.matrix_world
    me_b = body.data
    bmb = bmesh.new(); bmb.from_mesh(me_b)
    edges = []
    for e in bmb.edges:
        if not e.is_boundary:
            continue
        c = (mw @ ((e.verts[0].co + e.verts[1].co) / 2))
        if abs(c.x) < 1.2 * MM or abs(c.x) > 7.0 * MM or np.linalg.norm(np.array(c[1:]) - G) > 7.0 * MM:
            continue
        edges.append((e.verts[0].index, e.verts[1].index))
    bmb.free()
    if not edges:
        return 0
    gname = {g.index: g.name for g in body.vertex_groups}
    mi = mouth.matrix_world.inverted()
    bm = bmesh.new(); bm.from_mesh(mouth.data)
    col = bm.loops.layers.color.get("Col")
    k_m = [m.name for m in mouth.data.materials].index("SP_CheekSkin")
    made = {}
    k_cav = [m.name for m in mouth.data.materials].index("SP_MouthCavity")
    base_n = len(bm.verts)
    srcs = []  # body vertex index per new vertex
    jg = body.vertex_groups.get("jaw")
    def _jw(vi):
        if jg is None:
            return 0.0
        for g in me_b.vertices[vi].groups:
            if g.group == jg.index:
                return g.weight
        return 0.0
    # z of the jaw weight step on each side: around it the collar is the corner of the mouth (seen from inside)
    zmid = {}
    for v0, v1 in edges:
        if abs(_jw(v0) - _jw(v1)) > 0.5:
            p0 = mw @ me_b.vertices[v0].co; p1 = mw @ me_b.vertices[v1].co
            zmid[1 if p0.x > 0 else -1] = 0.5 * (p0.z + p1.z)
    def _g(w):
        zm = zmid.get(1 if w[0] > 0 else -1)
        if zm is None:
            return 0.0
        u = min(abs(w[2] - zm) / (CHEEK_ZR * MM), 1.0)
        return 1.0 - u * u * (3 - 2 * u)
    def _ss(x):
        x = min(max(x, 0.0), 1.0)
        return x * x * (3 - 2 * x)
    def _chain(vi):
        if vi in made:
            return made[vi]
        w = np.array((mw @ me_b.vertices[vi].co)[:])
        sx = 1.0 if w[0] > 0 else -1.0
        c = w.copy(); c[0] = sx * max(abs(w[0]) - reach * MM, min(abs(w[0]), CHEEK_XIN * MM))  # never inside the lining
        c[1:] = c[1:] - dback * (back * MM)
        g = _g(w)
        ch = []
        for t in CHEEK_T:
            p = w + (c - w) * t
            v = bm.verts.new(mi @ Vector(p.tolist()))
            v_col = CHEEK_DARK + g * (CHEEK_LIN - CHEEK_DARK) * _ss((t - 0.40) / 0.60)
            ch.append((v, v_col))
            srcs.append(vi)
        made[vi] = ch
        return ch
    nf = 0
    for v0, v1 in edges:
        c0 = _chain(v0); c1 = _chain(v1)
        for r in range(len(CHEEK_T) - 1):
            try:
                f = bm.faces.new((c0[r][0], c1[r][0], c1[r + 1][0], c0[r + 1][0]))
            except ValueError:
                continue
            nf += 1
            f.material_index = k_cav
            for l, cc in zip(f.loops, (c0[r][1], c1[r][1], c1[r + 1][1], c0[r + 1][1])):
                l[col] = (cc, cc, cc, 1.0)
    bm.to_mesh(mouth.data); bm.free()
    for vi_new, vi in enumerate(srcs):
        idx = base_n + vi_new
        for g in me_b.vertices[vi].groups:
            nm = gname[g.group]
            vg = mouth.vertex_groups.get(nm) or mouth.vertex_groups.new(name=nm)
            vg.add([idx], g.weight, "REPLACE")
    return nf


_CHIN_PATCH = []


_CAP_FIT, _S_CUT = None, 0.0


def _fit_cap_uv(bm, co, s_, below, s_cut):
    """Linear (|x|, s) -> UV fit on the black bib just behind the cap; returns f(x_mm, s_mm) -> (u, v) that is
    clamped / folded so the cap and the mouth-corner skin only sample genuine black-bib texels."""
    uvl = bm.loops.layers.uv.active
    if uvl is None:
        return None
    lum_at = _body_lum_sampler_bm()
    acc = {}
    for f in bm.faces:
        for l in f.loops:
            acc.setdefault(l.vert.index, []).append(l[uvl].uv[:])
    ref = []
    for i, uvs in acc.items():
        x, sv, bl = abs(co[i, 0]) / MM, s_[i] / MM, below[i] / MM
        if x < 2.2 and 3.0 < bl < 8.0 and -4.0 < sv < s_cut:
            u = np.mean(uvs, axis=0)
            if lum_at(u) < 0.25:
                ref.append((x, sv, u[0], u[1]))
    if len(ref) < 8:
        print("CHIN cap fit: too few black bib vertices", len(ref))
        return None
    R = np.array(ref)
    A = np.c_[np.ones(len(R)), R[:, 0], R[:, 1]]
    coef, *_ = np.linalg.lstsq(A, R[:, 2:4], rcond=None)
    xr, slo, shi = float(R[:, 0].max()), float(R[:, 1].min()), float(R[:, 1].max())
    span = max(shi - slo, 1e-3)

    def f(x, sv):
        x = min(abs(x), xr)
        t = sv - s_cut
        if t > 0:
            m = t % (2 * span)
            sv = shi - m if m <= span else slo + (m - span)
        else:
            sv = min(max(sv, slo), shi)
        u, v = np.array([1.0, x, sv]) @ coef
        return (float(u), float(v))
    return f


_LUM_IMG = {}


def _body_lum_sampler_bm():
    return _body_lum_sampler(bpy.data.objects["SP_Body"])


def chin_to_jaw(ob, back=MOUTH_BACK, half_w=4.5, split=False, cut=False, chin=3.0, assign=True):
    """Contour / down vertices on the chin and gape corner, below the bill line and forward of
    MOUTH_BACK behind the gape, ride rigidly on the jaw (they would otherwise stay put and show white
    through the opened gape)."""
    G = np.array(bs.half_to_bl(*MOUTH_GAPE_PX)); T = np.array(bs.half_to_bl(*MOUTH_TIP_PX))
    d = (T - G) / np.linalg.norm(T - G)
    nrm = np.array([0.0, -d[1], d[0]])  # perpendicular in the y-z plane
    if nrm[2] > 0:
        nrm = -nrm  # pointing down
    co = bt.object_verts(ob, world=True)
    rel = co[:, 1:] - G
    s_ = rel @ d
    below = rel @ nrm[1:]
    near = (s_ > -back * MM) & (below > -3.0 * MM) & (below < chin * MM) & (np.abs(co[:, 0]) < half_w * MM)
    lo = np.where(near & (below > -0.1 * MM))[0]  # chin side of the gape line -> jaw
    up = np.where(near & (below <= -0.1 * MM))[0]  # lore / gape-flange side -> upper mandible
    sel = np.concatenate([lo, up])
    if len(sel) == 0:
        return 0
    if assign:
        for vg in ob.vertex_groups:
            vg.remove(sel.tolist())
        for name, idx in (("jaw", lo), ("bill_upper", up)):
            if len(idx):
                g = ob.vertex_groups.get(name) or ob.vertex_groups.new(name=name)
                g.add(idx.tolist(), 1.0, "REPLACE")
    if cut:
        # feather cards reaching into the gape (would show as slats inside the open mouth): drop them
        import bmesh
        inside = np.zeros(len(co), bool)  # only cards rooted in the gape opening itself (as the upper bill: cards overlap the base)
        inside[np.where((s_ > -back * MM) & (np.abs(below) < 1.4 * MM) & (np.abs(co[:, 0]) < 2.8 * MM))[0]] = True
        # and the cards lying across the gape line at the commissure itself: with the bill open their inner side shows
        # as a brown wedge in the mouth corners
        inside[np.where((s_ > -1.8 * MM) & (s_ < 2.5 * MM) & (np.abs(below) < 0.9 * MM) & (np.abs(co[:, 0]) < CORNER_CUT_X * MM))[0]] = True
        bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
        seen, kill = set(), []
        for v in bm.verts:
            if inside[v.index] and v.index not in seen:
                stack = [v]
                while stack:  # whole card island
                    u = stack.pop()
                    if u.index in seen:
                        continue
                    seen.add(u.index); kill.append(u)
                    stack += [e.other_vert(u) for e in u.link_edges]
        bmesh.ops.delete(bm, geom=kill, context="VERTS")  # whole islands: no loose edges left
        bm.to_mesh(ob.data); bm.free()
    if split:
        # faces bridging the two mandibles would stretch into a white wall across the open gape: cut them
        # so the skin splits along the commissure and the mouth cavity behind shows
        import bmesh
        side = np.zeros(len(co), np.int8); side[lo] = 1; side[up] = 2
        bm = bmesh.new(); bm.from_mesh(ob.data)
        lip = (below < 2.2 * MM) & (below > -1.1 * MM)  # thin skin strip lining the closed gape line: inside the cavity
        zone = (s_ > -back * MM) & lip & (np.abs(co[:, 0]) < half_w * MM)

        def inside_gape(f):
            idx = [v.index for v in f.verts]
            return bool(zone[idx].mean() >= 0.5)  # face centred in the gape: head skin seen inside the mouth

        # head mesh's front cap tucked inside the lower mandible shell (bounded: never reaches the chin / throat)
        nose = (s_ > 2.0 * MM) & (below > -0.5 * MM) & (below < 2.5 * MM) & (np.abs(co[:, 0]) < 2.5 * MM)

        def in_bill(f):
            return all(nose[v.index] for v in f.verts)

        bad = [f for f in bm.faces if {side[v.index] for v in f.verts} >= {1, 2}]
        # head skin seen through the open gape (inside the mandibles): keep it (no holes) but shade it as
        # the dark mouth lining
        badset = set(bad)
        shallow = zone & (below < 1.2 * MM)
        dark_f = [f for f in bm.faces if f not in badset and (in_bill(f) or all(shallow[v.index] for v in f.verts))]
        global _CHIN_PATCH
        _CHIN_PATCH = []  # (polygon corner coords, mean 'below' in mm) of the skin seen under / in the lower bill base
        dark_in = set()
        for f in dark_f:
            pc_ = co[[v.index for v in f.verts]]
            bl_ = float(np.mean(below[[v.index for v in f.verts]])) / MM
            uv_l = bm.loops.layers.uv.active
            uv_ = np.mean([l[uv_l].uv[:] for l in f.loops], axis=0) if uv_l is not None else None
            _CHIN_PATCH.append((pc_, bl_, uv_))
            if bl_ < 0.9:
                dark_in.add(f)  # only skin inside the gape reads as dark lining; the rest keeps the plumage texture
        dark_f = [f for f in dark_f if f in dark_in]
        extra = [f for f in bm.faces if f not in badset and f not in dark_in and (in_bill(f) or inside_gape(f))
                 and (in_bill(f) or float(np.mean(below[[v.index for v in f.verts]])) / MM < 1.7)
                 and float(np.mean(np.abs(co[[v.index for v in f.verts], 0]))) / MM < 2.0]
        dark_f = dark_f + extra
        # head cap in front of the feather line: the UV rings converge there (radial 'chevron' striping and a pale
        # band). Remap its UVs planar onto the black-bib texture just behind it, so the striation runs front-to-back.
        s_cut = float((np.array(bs.half_to_bl(201.0, 112.0)) - G) @ d) / MM
        cap_fit = _fit_cap_uv(bm, co, s_, below, s_cut)
        flat_f = []
        if cap_fit is not None:
            for f in bm.faces:
                if f in badset or f in dark_in:
                    continue
                ix_ = [v.index for v in f.verts]
                if float(np.mean(np.abs(co[ix_, 0]))) / MM < 2.7 and float(np.mean(s_[ix_])) / MM > s_cut and float(np.mean(below[ix_])) / MM > -0.8:
                    flat_f.append(f)
            uvl = bm.loops.layers.uv.active
            for f in flat_f:
                for l in f.loops:
                    cc = co[l.vert.index]
                    l[uvl].uv = cap_fit(abs(cc[0]) / MM, float((cc[1:] - G) @ d) / MM)
        global _CAP_FIT, _S_CUT
        _CAP_FIT, _S_CUT = cap_fit, s_cut
        flat_f = []  # UVs already written
        # the pharynx tube / bill lining now close the gape from inside: the head-skin faces left in it would only
        # hide the throat and the tongue as dark facets, so they go too
        # inner gape faces (in front of the pharynx) go; the ones at the commissure stay as gape skin so the corners
        # never open onto the head interior
        def _mx(f):
            return float(np.mean(np.abs(co[[v.index for v in f.verts], 0]))) / MM
        kill_f = [f for f in dark_f if _mx(f) < GAPE_KEEP_X]
        keep_f = [f for f in dark_f if _mx(f) >= GAPE_KEEP_X]
        # faces bridging the mandibles at the commissure are the rictal skin itself: they stay (gape-skin material)
        # and stretch with the jaw, closing the corner; only the ones across the open gape in front of the throat go
        bad_keep = [f for f in bad if _mx(f) >= BRIDGE_KEEP_X]
        bad_kill = [f for f in bad if _mx(f) < BRIDGE_KEEP_X]
        # head-skin faces lying in the gape slit forward of the commissure sit between the mandibles: with the bill
        # open they float inside the mouth as dark chips, so they go as well
        slit = (s_ > 0.3 * MM) & (below > -0.9 * MM) & (below < 2.0 * MM) & (np.abs(co[:, 0]) < 3.4 * MM)
        slit_f = [f for f in bm.faces if np.mean([slit[v.index] for v in f.verts]) >= 0.5]
        bmesh.ops.delete(bm, geom=list(set(bad_kill) | set(kill_f) | set(slit_f)), context="FACES")  # drops the edges / verts left loose too
        bm.faces.index_update()
        dark = [f.index for f in keep_f + bad_keep if f.is_valid]
        bm.to_mesh(ob.data); bm.free()
        mskin = bt.material_flat("SP_MouthSkin", (0.12, 0.09, 0.08), roughness=0.7, specular=0.12,
                                 double_sided=True)
        ob.data.materials.append(mskin)
        k_m = len(ob.data.materials) - 1
        for i_ in dark:
            ob.data.polygons[i_].material_index = k_m
    return len(sel)


def _body_lum_sampler(body):
    """Mean plumage-texture luminance at a UV (to match cloned cards to the black bib / white malar skin)."""
    img = None
    for m in body.data.materials:
        if m and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image is not None:
                    img = n.image; break
        if img is not None:
            break
    if img is None or img.size[0] == 0:
        return lambda uv: 0.5
    w, h = img.size
    px = np.empty(w * h * 4, np.float32); img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[..., :3].mean(axis=-1)
    def f(uv):
        if uv is None:
            return 0.5
        return float(px[int(np.clip(uv[1] * h, 0, h - 1)), int(np.clip(uv[0] * w, 0, w - 1))])
    return f


def texture_flaps(mouth, body):
    """Mouth-corner skin flaps wear exactly the plumage texture of the skin next to them: every flap corner takes the
    UV of the nearest head-skin vertex, so black bib / white malar / streak direction continue across the flap."""
    if not body.data.materials:
        return 0
    me = mouth.data
    if len(me.materials) < 3:
        return 0
    bme = body.data
    buv = bme.uv_layers.active
    if buv is None:
        return 0
    acc = {}
    for p in bme.polygons:
        if bme.materials[p.material_index].name == "SP_MouthSkin":
            continue
        for li in p.loop_indices:
            acc.setdefault(bme.loops[li].vertex_index, []).append(tuple(buv.data[li].uv))
    bco = bt.object_verts(body, world=True)
    ids = list(acc.keys())
    kd = KDTree(len(ids))
    for j, i in enumerate(ids):
        kd.insert(Vector(bco[i]), j)
    kd.balance()
    fm = bpy.data.materials.get("SP_FlapSkin")
    if fm is None:  # the head plumage material, darkened to the neighbours' feather-shadow level
        fm = body.data.materials[0].copy(); fm.name = "SP_FlapSkin"
        nt = fm.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        lk = next((l for l in nt.links if l.to_node == bsdf and l.to_socket.name == "Base Color"), None)
        if lk is not None:
            src = lk.from_socket
            mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"
            mx.inputs[0].default_value = 1.0; mx.inputs[7].default_value = (0.11, 0.10, 0.10, 1.0)
            nt.links.new(src, mx.inputs[6]); nt.links.new(mx.outputs[2], bsdf.inputs["Base Color"])
    me.materials[2] = fm
    uvl = me.uv_layers.active or me.uv_layers.new(name="UVMap")
    co = bt.object_verts(mouth, world=True)
    n = 0
    for p in me.polygons:
        if p.material_index != 2:
            continue
        for li in p.loop_indices:
            _c, j, _d = kd.find(Vector(co[me.loops[li].vertex_index]))
            uvl.data[li].uv = tuple(np.mean(acc[ids[j]], axis=0))
        n += 1
    return n


def regrow_chin_cards(ob, body, per_card, step=0.42, min_below=0.2, seed=7, zone_x=5.5, zone_b=4.5):
    """Feather the bare chin skin under the lower bill: clone neighbouring bib cards (same material, UVs,
    weights) onto sample points of the exposed skin patch, so the black bib is feathered right up to the
    mandible and no skin plate / stepped edge shows. Clones keep the card block layout (per_card verts)."""
    import bmesh
    G = np.array(bs.half_to_bl(*MOUTH_GAPE_PX)); T = np.array(bs.half_to_bl(*MOUTH_TIP_PX))
    d_ = (T - G) / np.linalg.norm(T - G)
    nrm = np.array([0.0, -d_[1], d_[0]])
    if nrm[2] > 0:
        nrm = -nrm
    rng = np.random.default_rng(seed)
    pts = []
    lum_at = _body_lum_sampler(body)
    pt_lum = []
    for v, bl, uv in _CHIN_PATCH:
        continue  # the cap skin keeps its (remapped) bib texture: no cards over it
        if bl < min_below:
            continue
        area = 0.0
        for i in range(1, len(v) - 1):
            area += 0.5 * np.linalg.norm(np.cross(v[i] - v[0], v[i + 1] - v[0]))
        n = max(1, int(round(area / MM**2 / step**2)))
        for _ in range(n):
            w = rng.dirichlet(np.ones(len(v)))
            if lum_at(uv) < 0.3 or abs(float(w @ v[:, 0])) < 2.4 * MM:
                continue  # black bib skin keeps its dark plumage texture (no white cards over it)
            pts.append(w @ v); pt_lum.append(lum_at(uv))
    co = bt.object_verts(ob, world=True)
    nb = len(co) // per_card
    roots = co[1::per_card][:nb]
    # skin beside / behind the patch where cards were cut away (dark notches next to the white malar):
    # sample it too, but only where no card is rooted nearby
    kd_all = KDTree(len(roots))
    for i, c in enumerate(roots):
        kd_all.insert(c, i)
    kd_all.balance()
    mk = {i for i, m in enumerate(body.data.materials) if m and m.name == "SP_MouthSkin"}
    bco_ = bt.object_verts(body, world=True)
    uvl = body.data.uv_layers.active.data if body.data.uv_layers.active else None
    for p in body.data.polygons:
        if p.material_index in mk:
            continue
        v = bco_[list(p.vertices)]
        c = v.mean(axis=0)
        r_ = (c[1:] - G) / MM
        bl, ss = float(r_ @ nrm[1:]), float(r_ @ d_)
        if not (abs(c[0]) < zone_x * MM and -2.0 < ss < 8.5 and 0.3 < bl < zone_b):
            continue
        area = 0.0
        for i in range(1, len(v) - 1):
            area += 0.5 * np.linalg.norm(np.cross(v[i] - v[0], v[i + 1] - v[0]))
        uv_z = np.mean([uvl[l].uv[:] for l in p.loop_indices], axis=0) if uvl is not None else None
        for _ in range(max(1, int(round(area / MM**2 / step**2)))):
            q = rng.dirichlet(np.ones(len(v))) @ v
            if lum_at(uv_z) >= 0.3 and abs(q[0]) >= 2.4 * MM and not kd_all.find_range(Vector(q), 0.40 * MM):
                pts.append(q); pt_lum.append(lum_at(uv_z))
    if not pts:
        return 0
    # templates: bib cards of the chin right behind / beside the patch, never deleted-gape ones
    P = np.array(pts)
    rel_b = ((roots[:, 1:] - G) @ nrm[1:]) / MM
    ok = np.where((rel_b > 0.8) & (rel_b < 9.0) & (np.abs(roots[:, 0]) < 8 * MM))[0]
    if len(ok) == 0:
        return 0
    me_ = ob.data
    vl = np.zeros(len(me_.vertices)); vc = np.zeros(len(me_.vertices))
    ca = me_.color_attributes["Col"]
    carr = np.empty(len(ca.data) * 4, np.float32); ca.data.foreach_get("color", carr); carr = carr.reshape(-1, 4)[:, :3].mean(axis=1)
    if ca.domain == "POINT":
        vl = carr.astype(float)
    else:
        lv = np.empty(len(me_.loops), np.int32); me_.loops.foreach_get("vertex_index", lv)
        np.add.at(vl, lv, carr); np.add.at(vc, lv, 1.0); vl = vl / np.maximum(vc, 1)
    card_lum = vl[: nb * per_card].reshape(nb, per_card).mean(axis=1)
    kd = KDTree(len(ok))
    for j, i in enumerate(ok):
        kd.insert(roots[i] * np.array([4.0, 1.0, 1.0]), j)  # match the lateral position: black bib vs white malar
    kd.balance()
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
    me = ob.data
    vidx_faces = {}
    for f in bm.faces:
        vidx_faces.setdefault(f.verts[0].index // per_card, []).append(f)
    n0 = len(bm.verts); added = 0; pi = 0
    for pt in P:
        near = kd.find_n(Vector(pt * np.array([4.0, 1.0, 1.0])), 24)
        L_ = pt_lum[pi]; pi += 1
        lums = np.array([card_lum[int(ok[n_[1]])] for n_ in near])
        if L_ < 0.3:  # black bib skin: black bib cards
            pick = np.argsort(lums)[: 4]
        elif L_ > 0.5:  # white malar skin: pale cards
            pick = np.argsort(-lums)[: 4]
        else:
            pick = np.arange(min(4, len(near)))
        _c, j, _d = near[int(rng.choice(pick))]
        b = int(ok[j])
        src = [bm.verts[b * per_card + q] for q in range(per_card)]
        sset = set(src)
        geom = list(src) + list({e for v in src for e in v.link_edges}) + [f for f in vidx_faces.get(b, [])]
        r = bmesh.ops.duplicate(bm, geom=geom)
        vm = r["vert_map"]
        new = [vm[v] for v in src]
        delta = Vector(pt) - Vector(roots[b]) + Vector(rng.normal(0, 0.05 * MM, 3))
        bmesh.ops.translate(bm, vec=delta, verts=new)
        bm.verts.ensure_lookup_table()
        if [v.index for v in new] != list(range(n0 + added * per_card, n0 + (added + 1) * per_card)):
            raise RuntimeError("card clone broke the per-card vertex order")
        added += 1
    bm.to_mesh(me); bm.free()
    return added


def soft_follow(ob, bill, group, side, r0=1.9, r1=6.5, per_card=None):
    """The skin / feathers hugging a mandible base follow that mandible, blended smoothly with distance (the
    same treatment for the upper and the lower bill base). side: 'up' = above the gape line, 'lo' = below it.
    per_card: cards take the weight of their root vertex so they never shear."""
    G = np.array(bs.half_to_bl(*MOUTH_GAPE_PX)); T = np.array(bs.half_to_bl(*MOUTH_TIP_PX))
    d_ = (T - G) / np.linalg.norm(T - G)
    nrm = np.array([0.0, -d_[1], d_[0]])
    if nrm[2] > 0:
        nrm = -nrm
    bco = bt.object_verts(bill, world=True)
    kd = KDTree(len(bco))
    for i, c in enumerate(bco):
        kd.insert(c, i)
    kd.balance()
    co = bt.object_verts(ob, world=True)
    n = len(co)
    if per_card is None:
        ref = co
    else:
        ref = np.repeat(co[1::per_card], per_card, axis=0)[:n]
    d = np.array([kd.find(c)[2] for c in ref])
    below = (ref[:, 1:] - G) @ nrm[1:]
    s_ = (ref[:, 1:] - G) @ d_
    mask = (below > -0.1 * MM) if side == "lo" else (below <= -0.1 * MM)
    mask = mask * bt.smoothstep(-(MOUTH_BACK + 2.0) * MM, -(MOUTH_BACK - 1.0) * MM, s_)  # no hard edge behind the commissure
    w = bt.smoothstep(r1 * MM, r0 * MM, d) * mask
    W = {vg.name: np.zeros(n) for vg in ob.vertex_groups}
    for v in ob.data.vertices:
        for g in v.groups:
            W[ob.vertex_groups[g.group].name][v.index] = g.weight
    for k in W:
        W[k] = W[k] * (1 - w)
    W[group] = W.get(group, np.zeros(n)) + w
    _set_groups(ob, W)
    return int((w > 0.01).sum())


def rigid(ob, group):
    _set_groups(ob, {group: np.ones(len(ob.data.vertices))})


def leg_weights(rig, ob, sfx):
    """Tibia / tarsus / foot from the 'sp_part' labels, blended across the heel and the foot joint."""
    co = bt.object_verts(ob, world=True)
    part = np.empty(len(co), dtype=np.int32)
    ob.data.attributes["sp_part"].data.foreach_get("value", part)
    bones = rig.data.bones
    heel = np.array(bones["tarsus" + sfx].head_local)
    foot = np.array(bones["foot" + sfx].head_local)
    w_tib = (part == parts.PART_TIBIA).astype(float)
    w_tar = (part == parts.PART_TARSUS).astype(float)
    w_foot = (part == parts.PART_FOOT).astype(float)
    near_heel = (part == parts.PART_TARSUS) * bt.smoothstep(2.6 * MM, 0.4 * MM, np.linalg.norm(co - heel, axis=1)) * 0.5
    w_tib += near_heel
    w_tar -= near_heel
    near_foot = (part == parts.PART_TARSUS) * bt.smoothstep(1.6 * MM, 0.2 * MM, np.linalg.norm(co - foot, axis=1)) * 0.5
    w_foot += near_foot
    w_tar -= near_foot
    _set_groups(ob, {"tibia" + sfx: w_tib, "tarsus" + sfx: w_tar, "foot" + sfx: w_foot})


def contour_weights(ob, body, body_w, per_card=12):
    """Each card (per_card vertices, root row first) copies the body weights at its root."""
    bco = bt.object_verts(body, world=True)
    kd = KDTree(len(bco))
    for i, c in enumerate(bco):
        kd.insert(c, i)
    kd.balance()
    co = bt.object_verts(ob, world=True)
    names = list(body_w.keys())
    W = {n: np.zeros(len(co)) for n in names}
    for c0 in range(0, len(co), per_card):
        _p, idx, _d = kd.find(co[c0 + 1])
        for n in names:
            W[n][c0 : c0 + per_card] = body_w[n][idx]
    _set_groups(ob, W)


def bind(rig, ob):
    for m in list(ob.modifiers):
        if m.type == "ARMATURE":
            ob.modifiers.remove(m)
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    ob.parent = None  # skinned meshes as glTF scene roots (validator-clean); the modifier does the binding


WING_ROLL_DEG = 54.0  # folded wings are laid further over the back toward the midline (rump), smoothly and layer-preserving


def roll_wings_over_back(theta_deg=WING_ROLL_DEG):
    """Lay the folded wing over the back like a perched sparrow's. Each wing vertex is moved around the body's long axis
    toward the dorsal ridge by an angle that grows smoothly from the wrist to the hand tip and from the flank up to the
    upper edge (so the lower primaries keep hugging the flank). Its clearance above the body surface is preserved
    (measured with rays from the axis), so the covert / tertial / primary layering stays intact."""
    body = bpy.data.objects["SP_Body"]
    bvh = sf._body_bvh()
    cb = bt.object_verts(body, world=True)
    bins = np.round(cb[:, 1] / (0.5 * MM)).astype(int)
    ky = np.arange(bins.min(), bins.max() + 1)
    zc = {}
    for b in np.unique(bins):
        zz = cb[bins == b, 2]
        zc[b] = 0.5 * (zz.max() + zz.min())
    kb = np.array(sorted(zc)); vb = np.array([zc[k] for k in kb])
    zc_of = lambda yy: np.interp(np.round(yy / (0.5 * MM)), kb, vb)
    angs = np.radians(np.arange(-30, 91, 3.0))  # surface radius table: y bins x angles
    ybin = np.arange(kb.min(), kb.max() + 1, 2)  # every 1 mm
    tab = np.zeros((len(ybin), len(angs)))
    for i, b in enumerate(ybin):
        y0 = b * 0.5 * MM; z0 = float(zc_of(y0))
        for j, a in enumerate(angs):
            hit, _n, _i, _d = bvh.ray_cast(Vector((0.0, y0, z0)) + Vector((math.cos(a), 0.0, math.sin(a))) * 0.05,
                                           -Vector((math.cos(a), 0.0, math.sin(a))))
            tab[i, j] = (Vector((hit.x, hit.y, hit.z)) - Vector((0.0, y0, z0))).length if hit is not None else np.nan
    # fill gaps with the nearest valid value along the angle
    for i in range(len(ybin)):
        row = tab[i]; ok = ~np.isnan(row)
        if ok.any():
            tab[i] = np.interp(angs, angs[ok], row[ok])
        else:
            tab[i] = 0.008

    i0 = int(np.argmin(np.abs(angs)))
    tab = np.minimum(tab, 1.2 * tab[:, i0:i0 + 1])  # the head / nape bulge above the shoulders is not torso surface

    def Rb(yy, ph):
        yi = np.clip((np.round(yy / (0.5 * MM)) - ybin[0]) / 2.0, 0, len(ybin) - 1)
        y_lo = np.floor(yi).astype(int); y_hi = np.minimum(y_lo + 1, len(ybin) - 1); wy = yi - y_lo
        ai = np.clip((ph - angs[0]) / np.radians(3.0), 0, len(angs) - 1.001)
        a_lo = np.floor(ai).astype(int); wa = ai - a_lo
        g = lambda yy_, aa_: tab[yy_, aa_]
        return ((g(y_lo, a_lo) * (1 - wa) + g(y_lo, a_lo + 1) * wa) * (1 - wy) + (g(y_hi, a_lo) * (1 - wa) + g(y_hi, a_lo + 1) * wa) * wy)

    yW = bs.half_to_bl(265.0, 190.0)[0]; yE = bs.half_to_bl(*FOLD_T_PX)[0]
    n = 0
    for name in ("SP_Wing_L", "SP_Wing_R", "SP_WingFold", "SP_WingBars"):
        ob = bpy.data.objects.get(name)
        if ob is None:
            continue
        co = bt.object_verts(ob, world=True)
        z0 = zc_of(co[:, 1])
        ax = np.abs(co[:, 0]); dz = co[:, 2] - z0
        r = np.hypot(ax, dz); ph = np.arctan2(dz, ax)
        t = np.clip((co[:, 1] - yW) / (yE - yW), 0.0, 1.0)
        S = bt.smoothstep(0.0, 0.85, t)
        G = bt.smoothstep(np.radians(0.0), np.radians(40.0), ph)
        th = np.radians(theta_deg) * S * G
        ph2 = np.clip(ph + th, angs[0], np.radians(80.0)); ph2 = np.maximum(ph2, ph)
        clear = r - Rb(co[:, 1], np.clip(ph, angs[0], angs[-1]))
        r2 = Rb(co[:, 1], np.clip(ph2, angs[0], angs[-1])) + clear
        new = co.copy()
        new[:, 0] = np.sign(co[:, 0]) * r2 * np.cos(ph2)
        new[:, 2] = z0 + r2 * np.sin(ph2)
        inv = np.array(ob.matrix_world.inverted())
        loc = (inv[:3, :3] @ new.T).T + inv[:3, 3]
        if name in ("SP_Wing_L", "SP_Wing_R"):
            # the feather bones are fitted to the UNROLLED folded wing, so the open wing (Fly) must be that unrolled
            # geometry: the roll lives in the basis (rest / perched poses) and the "Spread" key (value = wing fan)
            # undoes it, otherwise the cards fan out tilted by up to the roll angle and stand up as ragged sheets
            if ob.data.shape_keys is not None:
                ob.shape_key_clear()
            k_basis = ob.shape_key_add(name="Basis", from_mix=False)
            ks = ob.shape_key_add(name="Spread", from_mix=False)
            ks.relative_key = k_basis
            k_basis.data.foreach_set("co", loc.astype(np.float32).ravel())
            ks.value = 0.0
        ob.data.vertices.foreach_set("co", loc.astype(np.float32).ravel())
        ob.data.update()
        n += len(co)
    return n


FOLD_S_PX, FOLD_T_PX = (308, 140), (343, 224)


def run():
    rig = build_armature()
    roll_wings_over_back()
    body = bpy.data.objects["SP_Body"]
    body_w = body_weights(rig, body)
    rigid(bpy.data.objects["SP_Bill_Upper"], "bill_upper")
    rigid(bpy.data.objects["SP_Bill_Lower"], "jaw")
    build_mouth()  # solid cavity behind / between the mandibles
    import bmesh
    for n_ in ("SP_Bill_Upper", "SP_Bill_Lower", "SP_Mouth"):  # no stray verts / edges drawn as black lines
        me_ = bpy.data.objects[n_].data; bm_ = bmesh.new(); bm_.from_mesh(me_)
        bmesh.ops.delete(bm_, geom=[v for v in bm_.verts if not v.link_faces], context="VERTS")
        bmesh.ops.delete(bm_, geom=[e for e in bm_.edges if not e.link_faces], context="EDGES")
        bm_.to_mesh(me_); bm_.free()
    mt_ = bpy.data.materials.get("SP_Body_Plumage")  # clamp: no wrap-around sampling at the ventral seam (pale/orange chin line)
    if mt_ and mt_.node_tree:
        for nd in mt_.node_tree.nodes:
            if nd.type == "TEX_IMAGE":
                nd.extension = "EXTEND"
    for e in ("SP_Eye_L", "SP_Eye_R"):
        rigid(bpy.data.objects[e], "head")
    leg_weights(rig, bpy.data.objects["SP_Leg_L"], ".L")
    leg_weights(rig, bpy.data.objects["SP_Leg_R"], ".R")
    contour_weights(bpy.data.objects["SP_Contour"], body, body_w)
    contour_weights(bpy.data.objects["SP_Down"], body, body_w, per_card=6)
    up_b, lo_b = bpy.data.objects["SP_Bill_Upper"], bpy.data.objects["SP_Bill_Lower"]
    chin_to_jaw(body, back=2.5, half_w=2.8, split=True, assign=False)  # cut only inside the cavity: no holes to the background
    for n, pc in (("SP_Contour", 12), ("SP_Down", 6)):
        ob_ = bpy.data.objects[n]
        chin_to_jaw(ob_, cut=True, assign=False)  # only cards rooted inside the gape opening are dropped
        if n == "SP_Down":
            pass  # (cloned malar cards no longer needed: the cap skin is textured, not a dark plate)
        soft_follow(ob_, lo_b, "jaw", "lo", per_card=pc)  # lower bill base: same soft treatment as the upper
        soft_follow(ob_, up_b, "bill_upper", "up", per_card=pc)
    soft_follow(body, lo_b, "jaw", "lo")
    soft_follow(body, up_b, "bill_upper", "up")
    add_cheek_collar(body, bpy.data.objects["SP_Mouth"])
    names = ["SP_Body", "SP_Bill_Upper", "SP_Bill_Lower", "SP_Eye_L", "SP_Eye_R", "SP_Leg_L", "SP_Leg_R",
             "SP_Wing_L", "SP_Wing_R", "SP_Tail", "SP_Contour", "SP_Scapulars", "SP_Trousers", "SP_Down",
             "SP_Back", "SP_Spine", "SP_WingBars", "SP_WingFold", "SP_Mouth"]
    names = [n for n in names if n in bpy.data.objects]
    for n in ("SP_Back", "SP_Spine", "SP_Scapulars"):
        ob = bpy.data.objects.get(n)
        if ob is None:
            continue
        # card builders label rump cards "body": the armature calls that bone "hips"
        vg = ob.vertex_groups.get("body")
        if vg is not None:
            if "hips" in ob.vertex_groups:
                h = ob.vertex_groups["hips"]
                for v in ob.data.vertices:
                    for g in v.groups:
                        if g.group == vg.index:
                            h.add([v.index], g.weight, "ADD")
                ob.vertex_groups.remove(vg)
            else:
                vg.name = "hips"
    for n in ("SP_WingFold", "SP_WingBars"):  # folded-wing-only overlays (photo-fitted): hidden in flight
        if n in bpy.data.objects:
            fold_weights(bpy.data.objects[n])
    for n in names:
        bind(rig, bpy.data.objects[n])
    missing = []
    for n in names:
        ob = bpy.data.objects[n]
        for vg in ob.vertex_groups:
            if vg.name not in rig.data.bones:
                missing.append("%s:%s" % (n, vg.name))
    return "rig: %d bones; groups without bone: %s" % (len(rig.data.bones), missing or "none")
