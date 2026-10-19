"""Step 9: WalkSing and Fly animations.

Workflow (the usual control-rig + bake pipeline, expressed in code):
- Keyframed control curves with auto-clamped cubic interpolation (like Blender's Auto Clamped Bezier)
  drive the high-level controls: root path, body posture, head look target, jaw / throat, tail, wings.
- Per-frame solvers sit on top: two-bone leg IK with planted feet, a head look-at that keeps the head
  stable in space and spreads each turn over neck1 / neck2 / head, wing kinematics with a phase lag from
  arm to hand (overlapping action), and damped springs for follow-through on the tail.
- The solved pose of every bone is baked to keys on every frame; each clip is one NLA track.

WalkSing (@ 30 fps, length set by the recorded phrase): look along the branch, shuffle three steps to the
bird's left with weight shift and planted feet, stop with a curious head tilt, inhale, then sing a real
recorded phrase (s00_song.py) - bill gape and throat follow its per-frame envelope - head up / tail
cocked and fanned / wings drooped, then walk back and settle. The phrase sits on the scene sound track.
Fly (80 f): in-place flap-bounding flight (4 wingbeats + a short glide with wings closed, twice), legs
folded back with the feet under the belly, body bobbing with the strokes, head held steady with two
deliberate look-and-tilt turns.
Both clips start and end in the same pose so they loop.
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

import btlib as bt
import s07_feathers as sf
import s08_rig as sr

FPS = 30
MM = bt.MM
D4 = np.diag([-1.0, 1.0, 1.0, 1.0])
TUCK_BACK_MM = 17.0  # flight: tucked foot this far behind the hip joint
TUCK_PITCH = 160.0  # foot turned so the toes trail backward along the belly


# ---------------------------------------------------------------- curves and helpers


class Curve:
    """Keyframed scalar: cubic Hermite with auto-clamped tangents (flat at extremes, no overshoot there)."""

    def __init__(self, keys):
        keys = sorted(keys)
        self.t = np.array([k[0] for k in keys], float)
        self.v = np.array([k[1] for k in keys], float)
        n = len(self.t)
        self.m = np.zeros(n)
        for i in range(1, n - 1):
            a, b = self.v[i] - self.v[i - 1], self.v[i + 1] - self.v[i]
            if a * b > 0:
                self.m[i] = (self.v[i + 1] - self.v[i - 1]) / (self.t[i + 1] - self.t[i - 1])

    def __call__(self, f):
        t, v, m = self.t, self.v, self.m
        if f <= t[0]:
            return float(v[0])
        if f >= t[-1]:
            return float(v[-1])
        i = int(np.searchsorted(t, f, side="right")) - 1
        h = t[i + 1] - t[i]
        s = (f - t[i]) / h
        s2, s3 = s * s, s * s * s
        return float((2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1])


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def bump(f, centre, width):
    return math.exp(-0.5 * ((f - centre) / width) ** 2)


def spring_follow(target, stiffness=0.25, damping=0.55, passes=3):
    """Damped spring chasing a target signal (unit time step = one frame). Extra passes make it loop."""
    x, v = float(target[0]), 0.0
    out = np.zeros(len(target))
    for _ in range(passes):
        for i, tgt in enumerate(target):
            v += stiffness * (tgt - x) - damping * v
            x += v
            out[i] = x
    return out


def rot3(axis, deg):
    return np.array(Matrix.Rotation(math.radians(deg), 3, Vector(np.asarray(axis, float))))


def rot4(axis, deg):
    return np.array(Matrix.Rotation(math.radians(deg), 4, Vector(np.asarray(axis, float))))


def trans(v):
    M = np.eye(4)
    M[:3, 3] = v
    return M


def rot_about(X, point, axis, deg):
    return trans(point) @ rot4(axis, deg) @ trans(-np.asarray(point)) @ X


def loc_rot(pitch=0.0, yaw=0.0, roll=0.0):
    """Local rotation in a bone frame (X lateral, Y along the bone, Z dorsal): pitch X, yaw Z, roll Y."""
    return rot4((1, 0, 0), pitch) @ rot4((0, 0, 1), yaw) @ rot4((0, 1, 0), roll)


def swing(a, b):
    return np.array(Vector(a).rotation_difference(Vector(b)).to_matrix())


def mat_slerp(A, B, t):
    qa = Matrix(A.tolist()).to_quaternion()
    qb = Matrix(B.tolist()).to_quaternion()
    M = np.array(qa.slerp(qb, t).to_matrix().to_4x4())
    M[:3, 3] = A[:3, 3] * (1 - t) + B[:3, 3] * t
    return M


def catmull_cyclic(keys, phase):
    ts = [k[0] for k in keys]
    vs = [np.asarray(k[1], float) for k in keys]
    n = len(keys)
    phase = phase % 1.0
    i = max(j for j in range(n) if ts[j] <= phase)
    t0, t1 = ts[i], (ts[i + 1] if i + 1 < n else 1.0)
    u = (phase - t0) / max(t1 - t0, 1e-9)
    p0, p1, p2, p3 = vs[(i - 1) % n], vs[i], vs[(i + 1) % n], vs[(i + 2) % n]
    return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u**3)


# ---------------------------------------------------------------- rig solver


class Rig:
    def __init__(self):
        self.ob = bpy.data.objects[sr.RIG]
        bones = self.ob.data.bones
        self.rest = {b.name: np.array(b.matrix_local) for b in bones}
        self.irest = {k: np.linalg.inv(v) for k, v in self.rest.items()}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.order = [b.name for b in bones]
        self.folded, self.spread, self.lengths = sf.load_arm()
        self.specs = [s for s in sf.feather_specs() if s["flight"]]
        self.chest_axis = self.rest["chest"][:3, 1].copy()
        self.S = self.folded["humerus"][:3, 3].copy()
        self.fold_local = self._arm_local(self.folded)
        self.T_rest = self.rest["tail"].copy()
        self.legs, self.tuck = {}, {}
        body = bpy.data.objects["BT_Body"]
        belly = BVHTree.FromPolygons([Vector(c) for c in bt.object_verts(body)], [tuple(p.vertices) for p in body.data.polygons])
        for side, sfx in ((1, ".L"), (-1, ".R")):
            K = self.rest["tibia" + sfx][:3, 3]
            H = self.rest["tarsus" + sfx][:3, 3]
            F = self.rest["foot" + sfx][:3, 3]
            u = (F - K) / np.linalg.norm(F - K)
            pole = (H - K) - ((H - K) @ u) * u
            pole /= np.linalg.norm(pole)
            tuck_pole = np.array([0.0, -0.3, 0.95])
            self.legs[sfx] = dict(L1=float(np.linalg.norm(H - K)), L2=float(np.linalg.norm(F - H)), pole=pole, tuck_pole=tuck_pole / np.linalg.norm(tuck_pole))
            # In flight the legs fold back: heel up inside the body, foot just under the belly feathers behind
            # the hip, toes trailing backward (soles toward the body). The long tarsus keeps it >= L2 - L1 away.
            y_t = K[1] + TUCK_BACK_MM * MM
            hit = belly.ray_cast(Vector((K[0], y_t, 0.0)), Vector((0.0, 0.0, 1.0)))[0]
            z_t = (hit.z if hit is not None else K[2] - 5.0 * MM) - 0.5 * MM  # toes just showing under the vent
            tuck = self.rest["foot" + sfx] @ loc_rot(pitch=TUCK_PITCH)
            tuck[:3, 3] = (K[0], y_t, z_t)
            self.tuck[sfx] = tuck

    # -- wings
    def spread_pose(self, elev, sweep, twist, elbow, wrist, pitch=0.0):
        H, F, M = (self.spread[n].copy() for n in ("humerus", "forearm", "hand"))
        n = H[:3, 2].copy()
        S, E, W = H[:3, 3].copy(), F[:3, 3].copy(), M[:3, 3].copy()
        M = rot_about(M, W, n, wrist)
        F = rot_about(F, E, n, elbow)
        M = rot_about(M, E, n, elbow)
        axis_h = H[:3, 1].copy()
        out = []
        for X in (H, F, M):
            X = rot_about(X, S, axis_h, twist)
            X = rot_about(X, S, (0, 0, 1), sweep)
            X = rot_about(X, S, (1, 0, 0), pitch)
            X = rot_about(X, S, self.chest_axis, elev)
            out.append(X)
        return dict(zip(("humerus", "forearm", "hand"), out))

    def _arm_local(self, arm):
        C = self.rest["chest"]
        return {
            "humerus": np.linalg.inv(C) @ arm["humerus"],
            "forearm": np.linalg.inv(arm["humerus"]) @ arm["forearm"],
            "hand": np.linalg.inv(arm["forearm"]) @ arm["hand"],
        }

    def _arm_fk(self, local):
        H = self.rest["chest"] @ local["humerus"]
        F = H @ local["forearm"]
        return {"humerus": H, "forearm": F, "hand": F @ local["hand"]}

    def blend_arm(self, A, B, t):
        la, lb = self._arm_local(A), self._arm_local(B)
        return self._arm_fk({k: mat_slerp(la[k], lb[k], t) for k in la})

    def drooped(self, deg, out_deg=0.0):
        return {k: rot_about(rot_about(v, self.S, self.chest_axis, -deg), self.S, (0, 0, 1), out_deg) for k, v in self.folded.items()}

    def wing_frames(self, arm, fan):
        out = {k + ".L": v for k, v in arm.items()}
        for sp in self.specs:
            out[sp["bone"] + ".L"] = sf.feather_frame_fan(arm[sp["parent"]], self.lengths[sp["parent"]], sp, fan)
        for k in list(out):
            out[k[:-2] + ".R"] = D4 @ out[k] @ D4
        return out

    # -- solvers
    def _look(self, P, root_m, look):
        yaw, pitch, roll = look
        R = self.rest
        Rh = R["head"][:3, :3]
        target = root_m[:3, :3] @ rot3((0, 0, 1), yaw) @ Rh @ rot3((1, 0, 0), pitch) @ rot3((0, 1, 0), roll)
        chest_rot = P["chest"][:3, :3] @ R["chest"][:3, :3].T
        q = Matrix((target @ (chest_rot @ Rh).T).tolist()).to_quaternion()
        prev_name, prev = "chest", P["chest"]
        for name, frac in (("neck1", 0.25), ("neck2", 0.6), ("head", 1.0)):
            M = prev @ self.irest[prev_name] @ R[name]
            M[:3, :3] = np.array(Quaternion().slerp(q, frac).to_matrix()) @ chest_rot @ R[name][:3, :3]
            P[name] = M
            prev_name, prev = name, M

    def _leg(self, P, sfx, target):
        R = self.rest
        hips_delta = P["hips"] @ self.irest["hips"]
        leg = self.legs[sfx]
        pole = hips_delta[:3, :3] @ (leg["pole"] if target is not None else leg["tuck_pole"])
        if target is None:
            target = hips_delta @ self.tuck[sfx]
        tib = hips_delta @ R["tibia" + sfx]
        K = tib[:3, 3]
        Fp = target[:3, 3]
        dv = Fp - K
        u = dv / np.linalg.norm(dv)
        L1, L2 = leg["L1"], leg["L2"]
        d = min(max(np.linalg.norm(dv), abs(L1 - L2) + 1e-6), L1 + L2 - 1e-6)
        w = pole - (pole @ u) * u
        w /= np.linalg.norm(w)
        a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
        Hp = K + u * a + w * math.sqrt(max(L1 * L1 - a * a, 0.0))
        tib[:3, :3] = swing(tib[:3, 1], (Hp - K) / np.linalg.norm(Hp - K)) @ tib[:3, :3]
        P["tibia" + sfx] = tib
        tar = tib @ self.irest["tibia" + sfx] @ R["tarsus" + sfx]
        tar[:3, 3] = Hp
        y2 = (Fp - Hp) / np.linalg.norm(Fp - Hp)
        tar[:3, :3] = swing(tar[:3, 1], y2) @ tar[:3, :3]
        P["tarsus" + sfx] = tar
        foot = target.copy()
        foot[:3, 3] = Hp + y2 * L2
        P["foot" + sfx] = foot

    def pose(self, st):
        R, P = self.rest, {}
        root_m = trans(st["root_pos"]) @ rot4((0, 0, 1), st.get("root_yaw", 0.0))
        P["root"] = root_m @ R["root"]
        P["hips"] = root_m @ trans(st["hips_off"]) @ R["hips"] @ loc_rot(*st["hips_rot"])
        P["chest"] = P["hips"] @ self.irest["hips"] @ R["chest"] @ loc_rot(*st["chest_rot"])
        self._look(P, root_m, st["look"])
        P["bill_upper"] = P["head"] @ self.irest["head"] @ R["bill_upper"] @ loc_rot(pitch=st["bill"])
        P["jaw"] = P["head"] @ self.irest["head"] @ R["jaw"] @ loc_rot(pitch=-st["jaw"])
        s = st["throat"]
        P["throat"] = P["neck2"] @ self.irest["neck2"] @ R["throat"] @ np.diag([s, s, s, 1.0])
        P["tail"] = P["hips"] @ self.irest["hips"] @ R["tail"] @ loc_rot(*st["tail_rot"])
        tail_delta = P["tail"] @ self.irest["tail"]
        for side, sfx in ((1, ".L"), (-1, ".R")):
            for i in range(1, 7):
                P["R%d%s" % (i, sfx)] = tail_delta @ sf.rectrix_frame(self.T_rest, i, side, fan_deg_per=1.6 + st["tail_fan"])
        chest_delta = P["chest"] @ self.irest["chest"]
        for k, F in self.wing_frames(st["arm"], st["fan"]).items():
            P[k] = chest_delta @ F
        for sfx in (".L", ".R"):
            self._leg(P, sfx, st["feet"][sfx] if st["feet"] else None)
        return P

    def basis(self, P):
        out = {}
        for name in self.order:
            p = self.parent[name]
            if p is None:
                out[name] = self.irest[name] @ P[name]
            else:
                rel_rest = self.irest[p] @ self.rest[name]
                out[name] = np.linalg.inv(rel_rest) @ np.linalg.inv(P[p]) @ P[name]
        return out


def base_state(rig):
    return dict(
        root_pos=np.zeros(3), root_yaw=0.0, hips_off=np.zeros(3), hips_rot=(0.0, 0.0, 0.0), chest_rot=(0.0, 0.0, 0.0),
        look=(0.0, 0.0, 0.0), bill=0.0, jaw=0.0, throat=1.0, tail_rot=(0.0, 0.0, 0.0), tail_fan=0.0,
        arm=rig.folded, fan=0.0, feet={sfx: rig.rest["foot" + sfx].copy() for sfx in (".L", ".R")},
    )


# ---------------------------------------------------------------- WalkSing

STEP = 12  # frames per step cycle (lead foot, body, trailing foot)
STRIDE = 11.0 * MM
N_STEPS = 3
WALK1, SONG_START = 8, 76  # first step; frame of the first sung note
JAW_MAX = 30.0  # bill gape (deg) at the loudest notes
SONG_CUES = os.path.join(bt.BUILD, "song_cues.json")
CLIP_CUES = os.path.join(bt.BUILD, "clip_cues.json")
SONG_WAV = bt.SONG_WAV


def load_song():
    """Per-frame bill / throat envelopes of the recorded phrase (s00_song.py) and the WalkSing timeline."""
    with open(SONG_CUES, encoding="utf-8") as f:
        song = json.load(f)
    n_song = len(song["jaw"])
    sing_end = SONG_START + n_song  # first frame after the last note
    walk2 = sing_end + 4
    song["timeline"] = dict(start=SONG_START, end=sing_end, walk2=walk2, frames=walk2 + N_STEPS * STEP + 10)
    return song


def walk_offsets(f, start, direction):
    """Body / foot travel along the branch for a shuffle of N_STEPS cycles starting at `start`."""
    lead = ".L" if direction > 0 else ".R"
    trail = ".R" if direction > 0 else ".L"
    foot = {lead: 0.0, trail: 0.0}
    lift = {lead: 0.0, trail: 0.0}
    body, sway, bob, pulse = 0.0, 0.0, 0.0, 0.0
    tau_all = f - start
    if tau_all < 0:
        return body, foot, lift, sway, bob, pulse
    c = min(int(tau_all // STEP), N_STEPS)
    if c >= N_STEPS:
        return N_STEPS * STRIDE, {lead: N_STEPS * STRIDE, trail: N_STEPS * STRIDE}, lift, 0.0, 0.0, 0.0
    tau = tau_all - c * STEP
    foot[lead] = (c + ease(tau / 5.0)) * STRIDE
    lift[lead] = 3.2 * MM * math.sin(math.pi * min(tau / 5.0, 1.0))
    foot[trail] = (c + ease((tau - 6.0) / 5.0)) * STRIDE
    lift[trail] = 2.8 * MM * math.sin(math.pi * min(max((tau - 6.0) / 5.0, 0.0), 1.0))
    body = (c + ease((tau - 1.0) / 10.0)) * STRIDE
    sway = -0.75 * math.sin(math.pi * min(tau / 6.0, 1.0)) if tau < 6 else 0.75 * math.sin(math.pi * min((tau - 6.0) / 6.0, 1.0))
    bob = 0.45 * MM * math.sin(math.pi * (tau % 6.0) / 6.0)
    pulse = bump(tau, 1.5, 1.2)
    sign = 1.0 if direction > 0 else -1.0
    return sign * body, {k: sign * v for k, v in foot.items()}, lift, sign * sway * MM, bob, pulse


def walksing_states(rig, song):
    tl = song["timeline"]
    n, s0, s1, w2 = tl["frames"], tl["start"], tl["end"], tl["walk2"]
    chest_pitch = Curve([(1, 0), (56, 0), (61, -2.2), (70, 10.0), (s1 - 2, 10.0), (s1 + 7, 0), (n, 0)])
    hips_dz = Curve([(1, 0), (56, 0), (61, -0.6), (70, 0.35), (s1 - 2, 0.35), (s1 + 7, 0), (n, 0)])
    look_yaw = Curve([(1, 0), (3, 0), (7, 34), (43, 34), (49, 0), (w2 + 1, 0), (w2 + 5, -34), (n - 9, -34), (n - 3, 0), (n, 0)])
    look_pitch = Curve([(1, 0), (8, -5), (43, -5), (47, 0), (62, 0), (72, 20), (s1 - 2, 20), (s1 + 6, 0),
                        (w2 + 5, -5), (n - 9, -5), (n - 3, 0), (n, 0)])
    look_roll = Curve([(1, 0), (44, 0), (47, 12), (52, 12), (56, 0), (n, 0)])
    tail_pitch = Curve([(1, 0), (62, 0), (72, 22), (s1 - 2, 22), (s1 + 8, 0), (n, 0)])
    tail_fan = Curve([(1, 0), (62, 0), (72, 5.0), (s1 - 2, 5.0), (s1 + 8, 0), (n, 0)])
    throat = Curve([(1, 1.0), (60, 1.0), (72, 1.12), (s1 - 2, 1.12), (s1 + 6, 1.0), (n, 1.0)])
    droop = Curve([(1, 0), (62, 0), (72, 5.0), (s1 - 2, 5.0), (s1 + 6, 0), (n, 0)])
    jaw_env, throat_env = song["jaw"], song["throat"]

    raw = []
    for f in range(1, n + 1):
        st = base_state(rig)
        b1, ft1, lf1, sw1, bob1, pu1 = walk_offsets(f, WALK1, +1)
        b2, ft2, lf2, sw2, bob2, pu2 = walk_offsets(f, w2, -1)
        body_x = b1 + b2
        st["root_pos"] = np.array([body_x, 0.0, 0.0])
        sway = sw1 + sw2
        st["hips_off"] = np.array([sway, 0.0, bob1 + bob2 + hips_dz(f) * MM])
        roll = -(sway / MM) * 3.0
        st["hips_rot"] = (0.0, 0.0, roll)
        st["chest_rot"] = (chest_pitch(f), 0.0, -roll * 0.4)
        k = f - s0
        jaw = JAW_MAX * jaw_env[k] if 0 <= k < len(jaw_env) else 0.0
        st["jaw"] = jaw
        st["bill"] = 0.2 * jaw
        st["throat"] = throat(f) + (0.09 * throat_env[k] if 0 <= k < len(throat_env) else 0.0)
        st["look"] = (look_yaw(f), look_pitch(f) + 0.12 * jaw, look_roll(f))
        st["tail_fan"] = tail_fan(f)
        st["arm"] = rig.drooped(droop(f), out_deg=0.25 * droop(f)) if droop(f) > 1e-3 else rig.folded
        st["fan"] = 0.03 * droop(f) / 5.0 + 0.05 * (pu1 + pu2)
        for sfx in (".L", ".R"):
            F = rig.rest["foot" + sfx].copy()
            F[:3, 3] += np.array([ft1[sfx] + ft2[sfx], 0.0, lf1[sfx] + lf2[sfx]])
            st["feet"][sfx] = F
        raw.append((st, roll, bob1 + bob2, pu1 + pu2, tail_pitch(f), f))
    # follow-through: tail answers the body's roll and each footfall with a lagging spring
    roll_drive = np.array([-r * 1.4 for _s, r, *_ in raw])
    flick_drive = np.array([6.0 * p for *_x, p, _tp, _f in raw])
    tail_roll = spring_follow(roll_drive, 0.22, 0.5)
    tail_flick = spring_follow(flick_drive, 0.3, 0.55)
    states = []
    for (st, _r, _b, _p, tp, f), tr, tfl in zip(raw, tail_roll, tail_flick):
        quiver = 2.5 * math.sin(f * 2 * math.pi / 6.0) if s0 - 2 < f < s1 - 4 else 0.0
        st["tail_rot"] = (tp + tfl, 0.0, tr + quiver)
        states.append(st)
    return states


# ---------------------------------------------------------------- Fly

FLY_FRAMES, CYCLE, BURST, BEAT = 80, 40, 28, 7
WING_PITCH = 34.0  # tilts the wing plane level while the body is pitched forward in flight
FLY_KEYS = [  # phase -> (elevation, sweep, twist, elbow, wrist, fan)
    (0.0, (72.0, 18.0, -10.0, -40.0, 36.0, 0.55)),
    (0.25, (10.0, -6.0, 8.0, -4.0, 3.0, 1.00)),
    (0.5, (-50.0, -12.0, 12.0, -10.0, 6.0, 0.92)),
    (0.78, (-5.0, 30.0, -28.0, -78.0, 70.0, 0.28)),
]
HAND_LAG = 0.08  # outer wing trails the inner wing by 8 % of a beat


def beat_wing(rig, phase):
    p0 = catmull_cyclic(FLY_KEYS, phase)
    p1 = catmull_cyclic(FLY_KEYS, phase - HAND_LAG * 0.5)
    p2 = catmull_cyclic(FLY_KEYS, phase - HAND_LAG)
    arm = rig.spread_pose(p0[0], p0[1], p0[2], p1[3], p2[4], pitch=WING_PITCH)
    return arm, float(p2[5])


def fly_states(rig):
    n = FLY_FRAMES
    look_yaw = Curve([(0, 0), (11, 0), (15, 48), (21, 43), (27, 46), (33, 0), (49, 0), (53, -44), (59, -39), (64, -42), (70, 0), (n, 0)])
    look_roll = Curve([(0, 0), (11, 0), (15, 24), (27, 21), (33, 0), (49, 0), (53, -20), (64, -18), (70, 0), (n, 0)])
    look_pitch = Curve([(0, 0), (11, 0), (15, -8), (27, -7), (33, 0), (49, 0), (53, -14), (64, -12), (70, 0), (n, 0)])
    raw = []
    for f in range(n):
        st = base_state(rig)
        c = f % CYCLE
        phase = c / BEAT
        fold_start, fold_end = BURST - 4, BURST + 2  # the stroke runs on while the wings close
        if c < fold_end:
            arm, fan = beat_wing(rig, phase)
            if c < 3:
                t = ease(c / 3.0)
                arm, fan = rig.blend_arm(rig.folded, arm, t), fan * t
            elif c >= fold_start:
                t = ease((c - fold_start) / (fold_end - fold_start))
                arm, fan = rig.blend_arm(arm, rig.folded, t), fan * (1 - t)
        else:
            arm, fan = rig.folded, 0.0
        st["arm"], st["fan"] = arm, fan
        flapping = c < BURST
        stroke = math.sin(2 * math.pi * (phase - 0.1)) if flapping else 0.0
        climb = 1.6 * math.sin(2 * math.pi * c / CYCLE - 0.6)
        st["root_pos"] = np.array([0.0, 0.0, 18.0 * MM])
        st["hips_off"] = np.array([0.0, 0.0, (0.7 * stroke + climb) * MM])
        glide = math.sin(math.pi * (c - BURST) / (CYCLE - BURST)) if not flapping else 0.0
        st["hips_rot"] = (-36.0 + 3.0 * glide + 1.2 * stroke, 0.0, 0.0)
        st["chest_rot"] = (0.8 * stroke, 0.0, 0.0)
        saccade = 1.2 * math.sin(2 * math.pi * 11 * f / n) * (1 - bump(f, 22, 8)) * (1 - bump(f, 59, 8))
        st["look"] = (look_yaw(f) + saccade, look_pitch(f), look_roll(f))
        st["tail_fan"] = 4.0 if flapping else 0.5
        st["feet"] = None  # tucked
        raw.append((st, stroke, glide))
    vert = np.array([0.7 * s for _st, s, _g in raw])
    accel = np.gradient(np.gradient(vert))
    tail_pitch = spring_follow(-accel * 40.0 + 4.0, 0.25, 0.5)
    fan_s = spring_follow(np.array([st["tail_fan"] for st, *_ in raw]), 0.2, 0.6)
    states = []
    for (st, _s, g), tp, fs in zip(raw, tail_pitch, fan_s):
        st["tail_rot"] = (tp + 2.0 * g, 0.0, 0.0)
        st["tail_fan"] = float(fs)
        states.append(st)
    return states


# ---------------------------------------------------------------- baking


def bake(rig, name, states, frame_offset=1):
    ob = rig.ob
    ob.animation_data_create()
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ob.animation_data.action = act
    prev_q = {}
    for i, st in enumerate(states):
        f = i + frame_offset
        B = rig.basis(rig.pose(st))
        for bone in rig.order:
            pb = ob.pose.bones[bone]
            loc, q, sc = Matrix(B[bone].tolist()).decompose()
            if bone in prev_q and prev_q[bone].dot(q) < 0:
                q = Quaternion((-q.w, -q.x, -q.y, -q.z))
            prev_q[bone] = q
            pb.location = loc
            pb.rotation_quaternion = q
            pb.scale = sc
            pb.keyframe_insert("location", frame=f, group=bone)
            pb.keyframe_insert("rotation_quaternion", frame=f, group=bone)
            pb.keyframe_insert("scale", frame=f, group=bone)
    ad = ob.animation_data
    for tr in list(ad.nla_tracks):
        if tr.name == name:
            ad.nla_tracks.remove(tr)
    track = ad.nla_tracks.new()
    track.name = name
    track.strips.new(name, frame_offset, act)
    ad.action = None
    return act


def reset_pose(ob):
    for pb in ob.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)


def add_song_strip(rig_ob, song):
    """The recorded phrase on the scene's sound track, first note on SONG_START, playing only while the
    WalkSing track is the one being evaluated (driver on the strip's mute)."""
    sc = bpy.context.scene
    se = sc.sequence_editor or sc.sequence_editor_create()
    strips = se.strips if hasattr(se, "strips") else se.sequences
    old = strips.get("BT_Song")
    if old:
        strips.remove(old)
    start = SONG_START - int(round(song["onset"] * FPS))
    strip = strips.new_sound("BT_Song", SONG_WAV, 1, start)
    path = strip.path_from_id("mute")
    sc.driver_remove(path)
    drv = sc.driver_add(path).driver
    drv.type = "SCRIPTED"
    for name, prop in (("ws_off", 'animation_data.nla_tracks["WalkSing"].mute'), ("fly_solo", 'animation_data.nla_tracks["Fly"].is_solo')):
        var = drv.variables.new()
        var.name, var.type = name, "SINGLE_PROP"
        var.targets[0].id_type = "OBJECT"
        var.targets[0].id = rig_ob
        var.targets[0].data_path = prop
    drv.expression = "max(ws_off, fly_solo)"
    sc.sync_mode = "AUDIO_SYNC"
    return start


def write_clip_cues(song):
    """Clip metadata for the GLB (s10 injects it as animation extras) and the TypeScript controller."""
    tl = song["timeline"]
    at = (tl["start"] - 1) / FPS - song["onset"]
    cues = {
        "WalkSing": {
            "loop": True,
            "cues": [{"type": "audio", "id": "song", "src": song["src"], "at": round(at, 4), "duration": song["duration"]}],
            "markers": {"walkEnd": round((WALK1 + N_STEPS * STEP - 1) / FPS, 4), "songStart": round((tl["start"] - 1) / FPS, 4),
                        "songEnd": round((tl["end"] - 1) / FPS, 4), "walkBack": round((tl["walk2"] - 1) / FPS, 4)},
            "audio": {"recordist": song["recordist"], "license": song["license"], "sourceUrl": song["sourceUrl"], "xcId": song["xcId"]},
        },
        "Fly": {"loop": True, "cues": [], "markers": {"glide": round((BURST - 1) / FPS, 4), "glide2": round((CYCLE + BURST - 1) / FPS, 4)}},
    }
    with open(CLIP_CUES, "w", encoding="utf-8") as f:
        json.dump(cues, f, ensure_ascii=False, indent=1)
    return cues


def run():
    rig = Rig()
    song = load_song()
    ad = rig.ob.animation_data
    if ad:
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
    for old in ("Flap", "Sing"):
        if bpy.data.actions.get(old):
            bpy.data.actions.remove(bpy.data.actions[old])
    bake(rig, "WalkSing", walksing_states(rig, song))
    bake(rig, "Fly", fly_states(rig))
    reset_pose(rig.ob)
    n = song["timeline"]["frames"]
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, n
    strip_at = add_song_strip(rig.ob, song)
    write_clip_cues(song)
    return "actions: WalkSing %d frames (song frames %d-%d, strip at %d), Fly %d frames" % (
        n, song["timeline"]["start"], song["timeline"]["end"] - 1, strip_at, FLY_FRAMES)
