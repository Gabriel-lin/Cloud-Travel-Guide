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

import btlib as bt
import btshape as bs
import s04_parts as parts
import s07_feathers as sf

RIG = "BT_Rig"
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
    "bill_upper": (265, 84),
    "bill_tip": (238, 83.5),
    "throat": (277, 130),
    "throat_tip": (262, 152),
}
BODY_CHAIN = ["hips", "chest", "neck1", "neck2", "head", "tail"]


def P(name):
    y, z = bs.half_to_bl(*(bs.JAW_HINGE_PX if name == "jaw" else BODY_PX[name]))
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
    return specs


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


def rigid(ob, group):
    _set_groups(ob, {group: np.ones(len(ob.data.vertices))})


def leg_weights(rig, ob, sfx):
    """Tibia / tarsus / foot from the 'bt_part' labels, blended across the heel and the foot joint."""
    co = bt.object_verts(ob, world=True)
    part = np.empty(len(co), dtype=np.int32)
    ob.data.attributes["bt_part"].data.foreach_get("value", part)
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


def run():
    rig = build_armature()
    body = bpy.data.objects["BT_Body"]
    body_w = body_weights(rig, body)
    rigid(bpy.data.objects["BT_Bill_Upper"], "bill_upper")
    rigid(bpy.data.objects["BT_Bill_Lower"], "jaw")
    for e in ("BT_Eye_L", "BT_Eye_R"):
        rigid(bpy.data.objects[e], "head")
    leg_weights(rig, bpy.data.objects["BT_Leg_L"], ".L")
    leg_weights(rig, bpy.data.objects["BT_Leg_R"], ".R")
    contour_weights(bpy.data.objects["BT_Contour"], body, body_w)
    contour_weights(bpy.data.objects["BT_Down"], body, body_w, per_card=6)
    names = ["BT_Body", "BT_Bill_Upper", "BT_Bill_Lower", "BT_Eye_L", "BT_Eye_R", "BT_Leg_L", "BT_Leg_R",
             "BT_Wing_L", "BT_Wing_R", "BT_Tail", "BT_Contour", "BT_Scapulars", "BT_Trousers", "BT_Down"]
    for n in names:
        bind(rig, bpy.data.objects[n])
    missing = []
    for n in names:
        ob = bpy.data.objects[n]
        for vg in ob.vertex_groups:
            if vg.name not in rig.data.bones:
                missing.append("%s:%s" % (n, vg.name))
    return "rig: %d bones; groups without bone: %s" % (len(rig.data.bones), missing or "none")
