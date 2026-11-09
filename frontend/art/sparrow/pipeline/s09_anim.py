"""Step 9: Call, HopForage and Fly animations.

Workflow (the usual control-rig + bake pipeline, expressed in code):
- Keyframed control curves with auto-clamped cubic interpolation (like Blender's Auto Clamped Bezier)
  drive the high-level controls: root path, body posture, head look target, jaw / throat, tail, wings.
- Per-frame solvers sit on top: two-bone leg IK with planted feet, a head look-at that keeps the head
  stable in space and spreads each turn over neck1 / neck2 / head, wing kinematics with a phase lag from
  arm to hand (overlapping action), and damped springs for follow-through on the tail.
- The solved pose of every bone is baked to keys on every frame; each clip is one NLA track.

Call (@ 30 fps, length set by the recorded call): alert look round, inhale with the throat filling, then
the recorded phrase of four "chip" calls (s00_song.py) - bill gape and throat follow its per-frame envelope,
head raised, tail flicked on every chip, wings slightly drooped - then settle. The call sits on the scene
sound track.
HopForage (96 f): the tree sparrow's two-footed hop: crouch, hop forward-left with a turn, peck twice at the
ground, hop back to the start with the opposite turn, peck once, settle (feet planted between hops).
Fly (80 f): in-place flap-bounding flight (4 wingbeats + a short glide with wings closed, twice), legs
folded back with the feet under the belly, body bobbing with the strokes, head held steady with two
deliberate look-and-tilt turns.
All clips start and end in the same pose so they loop.
"""
import json
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

import splib as bt
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


# Open-wing feather proportions from featherbase.info, Passer montanus (n = 21 / 22 specimens): 10 primaries,
# P10 rudimentary; longest P6-P7 54.5-63.5 mm; 9 secondaries, S1 longest 44.5-52 mm (S1/P7 ~ 0.81);
# outer vanes of P7-P8 emarginated, P9 fully. The rig's cards are bluethroat scans fitted to the folded
# photo; open, each flight-feather bone scales its card to these ratios.
P_RATIO = {1: 0.84, 2: 0.87, 3: 0.90, 4: 0.93, 5: 0.97, 6: 1.00, 7: 1.00, 8: 0.97, 9: 0.86, 10: 0.22}  # / P7
S_RATIO = {1: 0.89, 2: 0.88, 3: 0.87, 4: 0.85, 5: 0.83, 6: 0.81}  # / P7 (featherbase S1/P7)
P7_OPEN = 1.22  # P7 open length / its folded card
SPREAD_W = sf.SPREAD_W


def _card_mm(spec):
    meta = _atlas_meta()
    return sf.feather_length_mm(meta, spec)


_META = {}


def _atlas_meta():
    if not _META:
        with open(os.path.join(bt.BUILD, "feather_atlas.json"), encoding="utf-8") as f:
            _META.update(json.load(f))
    return _META


def spread_scale(name):
    specs = {s["name"]: s for s in sf.feather_specs()}
    p7 = _card_mm(specs["P7"]) * P7_OPEN
    if name.startswith("P"):
        i = int(name[1:])
        sy = p7 * P_RATIO[i] / _card_mm(specs[name])
        sx = SPREAD_W["P"] * (0.85 if i >= 8 else 1.0)  # emarginated outer primaries: narrower tips
        return sx, sy
    if name in ("S7", "S8", "S9"):
        return SPREAD_W["T"] * 0.85, 0.8  # tertials: shorter and slimmer, they lie along the body in flight
    i = int(name[1:])
    return SPREAD_W["S"], p7 * S_RATIO[i] / _card_mm(specs[name])


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
        self.sscale = {s["name"]: spread_scale(s["name"]) for s in self.specs}
        self.chest_axis = self.rest["chest"][:3, 1].copy()
        self.S = self.folded["humerus"][:3, 3].copy()
        self.fold_local = self._arm_local(self.folded)
        self.T_rest = self.rest["tail"].copy()
        self.legs, self.tuck = {}, {}
        body = bpy.data.objects["SP_Body"]
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
        f = min(max(fan, 0.0), 1.0)
        for sp in self.specs:
            F = sf.feather_frame_fan(arm[sp["parent"]], self.lengths[sp["parent"]], sp, fan)
            # open wing: vanes spread flat and overlap (feather bones widen), primaries and secondaries reach
            # their real length relative to the arm (the folded fit hides part of each under the next)
            sx, sy = self.sscale[sp["name"]]
            out[sp["bone"] + ".L"] = F @ np.diag([1 + (sx - 1) * f, 1 + (sy - 1) * f, 1.0, 1.0])
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
                tf = min(max((st["tail_fan"] - 0.6) / 3.4, 0.0), 1.0)  # 0 perched .. 1 flapping: tail fans wide and its feathers reach out
                P["R%d%s" % (i, sfx)] = tail_delta @ sf.rectrix_frame(self.T_rest, i, side, fan_deg_per=1.6 + 1.3 * st["tail_fan"]) @ np.diag([1.0 + 0.12 * tf, 1.0 + 0.30 * tf, 1.0, 1.0])
        chest_delta = P["chest"] @ self.irest["chest"]
        # perched poses (peck, call): the folded wing lies along the back, which bends between chest and hips - let the
        # trailing part of the wing follow the hips partly, or the tips peel off the rump while the chest pitches
        wh = float(st.get("wing_hips", 0.0))
        hips_delta = P["hips"] @ self.irest["hips"]
        blend_cache = {}

        def delta_for(base):
            w = wh * WING_HIPS_W.get(base, 0.55)
            if w <= 1e-6:
                return chest_delta
            if w not in blend_cache:
                blend_cache[w] = np.array(Matrix(chest_delta.tolist()).lerp(Matrix(hips_delta.tolist()), w))
            return blend_cache[w]

        for k, F in self.wing_frames(st["arm"], st["fan"]).items():
            P[k] = delta_for(k[:-2]) @ F
        vis = max(float(st.get("fold_vis", 1.0)), 1e-3)
        for sfx in (".L", ".R"):
            fb = sr.FOLD_BONE + sfx
            if fb in R:
                h = "humerus" + sfx
                corr = delta_for(fb[:-2]) @ np.linalg.inv(chest_delta)
                P[fb] = corr @ P[h] @ self.irest[h] @ R[fb] @ np.diag([vis, vis, vis, 1.0])
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
        wing_hips=0.0, arm=rig.folded, fan=0.0, feet={sfx: rig.rest["foot" + sfx].copy() for sfx in (".L", ".R")},
    )


# ---------------------------------------------------------------- Call

WING_HIPS_W = {"humerus": 0.15, "forearm": 0.3, "hand": 0.5, "wingfold": 0.45}  # share of the hips' motion (rest: 0.55)
POSTURE_PITCH = -16.0  # perched posture: body leans forward (more horizontal, as the perched references)
POSTURE_LOOK = 0.0  # head stays level over the leaning body
SONG_START = 22  # frame of the first chip
JAW_MAX = 18.0  # bill gape (deg) at the loudest chip; quieter chips scale down (side-on calling tree sparrows: ~15-20 deg)
JAW_LEAD = 1.5  # frames the bill opens ahead of the sound
SONG_CUES = os.path.join(bt.BUILD, "song_cues.json")
CLIP_CUES = os.path.join(bt.BUILD, "clip_cues.json")
SONG_WAV = bt.SONG_WAV


def wav_envelope(n, onset, path=None):
    """Per-frame gape and throat drive straight from the call waveform: RMS in a 1-frame window, gated
    between a noise floor and the loud-chip level so the bill shuts between chips, shifted JAW_LEAD frames
    early (birds open before the sound leaves), fast attack / slower release."""
    import wave
    with wave.open(path or SONG_WAV, "rb") as w:
        rate, ch, sw = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    x = np.frombuffer(raw, dtype={1: np.int8, 2: np.int16, 4: np.int32}[sw]).astype(np.float64)
    x = x.reshape(-1, ch).mean(1)
    win = rate // FPS
    t = np.arange(n) / FPS + onset + JAW_LEAD / FPS
    rms = np.array([np.sqrt(np.mean(x[max(0, int(c * rate) - win // 2): int(c * rate) + win // 2 + 1] ** 2) + 1e-12) for c in t])
    db = 20 * np.log10(rms / rms.max())
    gate = np.clip((db + 24.0) / 18.0, 0.0, 1.0)  # < -24 dB: closed, > -6 dB: wide open
    jaw, a = np.zeros(n), 0.0
    for i, g in enumerate(gate):
        a = a + (g - a) * (0.85 if g > a else 0.55)
        jaw[i] = a
    throat = np.convolve(jaw, np.ones(3) / 3, mode="same")
    return jaw.tolist(), throat.tolist()


def load_song():
    """Per-frame bill / throat envelopes of the recorded call (s00_song.py) and the Call timeline."""
    with open(SONG_CUES, encoding="utf-8") as f:
        song = json.load(f)
    song["jaw"], song["throat"] = wav_envelope(len(song["jaw"]), song["onset"])
    n_song = len(song["jaw"])
    end = SONG_START + n_song
    song["timeline"] = dict(start=SONG_START, end=end, frames=end + 18)
    return song


def call_states(rig, song):
    tl = song["timeline"]
    n, s0, s1 = tl["frames"], tl["start"], tl["end"]
    chest_pitch = Curve([(1, 0), (10, 0), (16, -2.0), (s0, 9.0), (s1 - 2, 9.0), (s1 + 8, 0), (n, 0)])
    hips_dz = Curve([(1, 0), (12, 0), (16, -0.5), (s0, 0.3), (s1 - 2, 0.3), (s1 + 8, 0), (n, 0)])
    look_yaw = Curve([(1, 0), (4, 0), (8, 26), (13, 26), (17, 0), (s1 + 2, 0), (s1 + 6, -18), (n - 4, -18), (n, 0)])
    look_pitch = Curve([(1, 0), (14, 0), (s0, 16), (s1 - 2, 16), (s1 + 7, 0), (n, 0)])
    look_roll = Curve([(1, 0), (8, 0), (11, 10), (14, 10), (17, 0), (n, 0)])
    tail_pitch = Curve([(1, 0), (14, 0), (s0, 10), (s1 - 2, 10), (s1 + 8, 0), (n, 0)])
    throat = Curve([(1, 1.0), (13, 1.0), (s0, 1.10), (s1 - 2, 1.10), (s1 + 6, 1.0), (n, 1.0)])
    droop = Curve([(1, 0), (14, 0), (s0, 4.0), (s1 - 2, 4.0), (s1 + 6, 0), (n, 0)])
    body_turn = Curve([(1, 0), (5, 0), (11, 9.0), (18, 9.0), (24, 0), (s1 + 2, 0), (s1 + 8, -7.0), (n - 3, -7.0), (n, 0)])
    jaw_env, throat_env = song["jaw"], song["throat"]
    flick = np.zeros(n)
    states = []
    for f in range(1, n + 1):
        st = base_state(rig)
        st["hips_off"] = np.array([0.0, 0.0, hips_dz(f) * MM])
        st["wing_hips"] = 1.0
        st["chest_rot"] = (chest_pitch(f), 0.0, 0.0)
        k = f - s0
        env = jaw_env[k] if 0 <= k < len(jaw_env) else 0.0
        st["jaw"] = JAW_MAX * env
        st["bill"] = 0.25 * st["jaw"]  # cranial kinesis: upper mandible lifts ~1/4 as much
        st["throat"] = throat(f) + (0.16 * throat_env[k] if 0 <= k < len(throat_env) else 0.0)
        st["look"] = (look_yaw(f), look_pitch(f) + 0.12 * st["jaw"], look_roll(f))
        st["arm"] = rig.drooped(droop(f), out_deg=0.25 * droop(f)) if droop(f) > 1e-3 else rig.folded
        st["fan"] = 0.03 * droop(f) / 4.0
        flick[f - 1] = 9.0 * env
        # whole-body: breathing, a bob with every chip, a weight shift and turn toward the look, wing flicks
        breath = 0.25 * math.sin(2 * math.pi * f / 22.0)
        st["hips_off"] = st["hips_off"] + np.array([0.0, 0.0, (breath - 0.9 * env) * MM])
        turn = body_turn(f)
        st["hips_rot"] = (-3.0 * env + 1.5 * breath + POSTURE_PITCH, 0.0, turn)
        st["chest_rot"] = (st["chest_rot"][0] + 6.0 * env, 0.0, 0.5 * turn)
        st["look"] = (st["look"][0] - 1.5 * turn, st["look"][1] + POSTURE_LOOK, st["look"][2])
        flick_w = 7.0 * env
        if flick_w + droop(f) > 1e-3:
            st["arm"] = rig.drooped(droop(f) + flick_w, out_deg=0.25 * droop(f) + 0.6 * flick_w)
        states.append(st)
    tail_flick = spring_follow(flick, 0.35, 0.5)
    fan = spring_follow(flick * 0.5, 0.3, 0.55)
    for f, (st, tf, tfa) in enumerate(zip(states, tail_flick, fan), start=1):
        st["tail_rot"] = (tail_pitch(f) + tf, 0.0, 0.0)
        st["tail_fan"] = float(tfa)
    return states


# ---------------------------------------------------------------- HopForage

HOP_FRAMES = 96
HOP_AIR = 7  # frames airborne per hop
HOP_H = 6.0 * MM  # hop apex height
HOPS = [  # (take-off frame, dx m, dy m, yaw after the hop deg)
    (6, 8.0 * MM, 0.0, 0.0),  # shuffle-hops sideways along the twig (the feet stay on the stem)
    (58, -8.0 * MM, 0.0, 0.0),
]
PECKS = [24, 38, 74]  # contact frames
PECK_HIPS, PECK_CHEST, PECK_LOOK, PECK_DROP, PECK_TAIL = 14.0, 34.0, 50.0, 1.8, 18.0  # peck bow: pitch of hips / chest / neck-head (deg), body drop (mm), tail lift (deg)


def hop_states(rig):
    n = HOP_FRAMES
    pos = np.zeros((n + 1, 3))
    yaw = np.zeros(n + 1)
    crouch = np.zeros(n + 1)
    air = np.zeros(n + 1)
    p0, y0 = np.zeros(3), 0.0
    for f in range(1, n + 1):
        p, yw, cr, a = p0.copy(), y0, 0.0, 0.0
        for t0, dx, dy, yaw1 in HOPS:
            ybefore = y0 if t0 == HOPS[0][0] else HOPS[0][3]
            pbefore = np.zeros(3) if t0 == HOPS[0][0] else np.array([HOPS[0][1], HOPS[0][2], 0.0])
            if f >= t0 - 4:
                cr = max(cr, bump(f, t0 - 1, 1.6) + bump(f, t0 + HOP_AIR + 1, 1.6))
            if f >= t0:
                u = min((f - t0) / HOP_AIR, 1.0)
                p = pbefore + np.array([dx, dy, 0.0]) * ease(u)
                yw = ybefore + (yaw1 - ybefore) * ease(u)
                if u < 1.0:
                    a = math.sin(math.pi * u)
        pos[f], yaw[f], crouch[f], air[f] = p, yw, cr, a
    states = []
    for f in range(1, n + 1):
        st = base_state(rig)
        st["root_pos"] = pos[f] + np.array([0.0, 0.0, HOP_H * air[f]])
        st["root_yaw"] = yaw[f]
        pk = sum(bump(f, c, 3.0) for c in PECKS)
        st["hips_off"] = np.array([0.0, 0.0, -1.6 * MM * crouch[f] - PECK_DROP * MM * pk])
        st["wing_hips"] = 1.0
        st["hips_rot"] = (-PECK_HIPS * pk + 6.0 * air[f] + POSTURE_PITCH, 0.0, 0.0)
        st["chest_rot"] = (-PECK_CHEST * pk, 0.0, 0.0)
        look_scan = 10.0 * math.sin(2 * math.pi * f / 30.0) * (1 - min(pk * 2, 1.0))
        st["look"] = (look_scan, -PECK_LOOK * pk + POSTURE_LOOK, 0.0)
        contact = sum(bump(f, c, 1.0) for c in PECKS)
        st["jaw"] = 14.0 * contact
        st["bill"] = 0.25 * st["jaw"]  # cranial kinesis: upper mandible lifts ~1/4 as much
        st["tail_rot"] = (PECK_TAIL * pk + 10.0 * air[f] - 6.0 * crouch[f], 0.0, 0.0)
        st["tail_fan"] = 2.0 * air[f]
        st["arm"] = rig.drooped(5.0 * air[f], out_deg=2.0 * air[f]) if air[f] > 1e-3 else rig.folded
        st["fan"] = 0.08 * air[f]
        R = rot4((0, 0, 1), yaw[f])
        for sfx in (".L", ".R"):
            F = R @ rig.rest["foot" + sfx].copy()
            F[:3, 3] += pos[f] + np.array([0.0, 0.0, HOP_H * air[f] * 0.85])
            st["feet"][sfx] = F
        states.append(st)
    return states


# ---------------------------------------------------------------- Fly

# Kinematics from flap-bounding passerine studies (see sources/CREDITS.md, "Flight kinematics"):
# - wingbeat ~20-24 Hz in take-off for Passer (Ornithology 2025, ukaf046: 22.4 Hz house sparrow), lower in
#   cruise; at 30 fps a true 20 Hz beat is below one frame, so the clip runs a 10 Hz beat (3 frames, half
#   real rate - the fastest that still reads without strobing; the real rate can't be sampled at 30 fps);
# - stroke amplitude ~105-120 deg, downstroke ~55 % of the beat, wings fully spread only mid-downstroke;
# - upstroke with wrist and elbow strongly flexed, primaries folded ("feathered" tip-reversal upstroke);
# - flap-bounding: bursts of a few beats, then a bound with wings flexed tight against the body
#   (Tobalske 2001; Tobalske, Peacock & Dial 1999 zebra finch); body ~15-25 deg nose-up at cruise speed.
FLY_FRAMES, CYCLE, BURST, BEAT = 80, 20, 15, 3
WING_PITCH = 20.0  # tilts the wing plane level while the body is pitched forward in flight
FLY_KEYS = [  # phase -> (elevation, sweep, twist, elbow, wrist, fan)
    # flight_spread_mildeep / flight_pair_pavadk / flight_hover_arquus: in the downstroke the arm is fully
    # extended (humerus out, elbow and wrist open), the inner wing long and continuous with the hand
    (0.0, (58.0, 8.0, -8.0, -18.0, 14.0, 0.80)),  # top of stroke, wing nearly open
    (0.27, (8.0, 4.0, 6.0, 4.0, -4.0, 1.00)),  # mid-downstroke: fully extended, remiges fanned
    (0.55, (-44.0, -4.0, 10.0, -6.0, 6.0, 0.92)),  # bottom
    (0.80, (2.0, 26.0, -24.0, -80.0, 72.0, 0.22)),  # upstroke: wrist flexed, hand folded back
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
        fold_start, fold_end = BURST - 1, BURST + 2  # the last upstroke runs straight into the tuck
        if c < fold_end:
            arm, fan = beat_wing(rig, phase)
            if c < 2:
                t = ease(c / 2.0)
                arm, fan = rig.blend_arm(rig.folded, arm, t), fan * t
            elif c >= fold_start:
                t = ease((c - fold_start) / (fold_end - fold_start))
                arm, fan = rig.blend_arm(arm, rig.folded, t), fan * (1 - t)
        else:
            arm, fan = rig.folded, 0.0
        st["arm"], st["fan"] = arm, fan
        st["fold_vis"] = 1.0 if (c >= fold_end or c == 0) else 0.0  # photo overlay only on the closed wing
        flapping = c < BURST
        stroke = math.sin(2 * math.pi * (phase - 0.1)) if flapping else 0.0
        climb = 1.2 * math.sin(2 * math.pi * c / CYCLE - 0.6)  # rise while flapping, sink in the bound
        st["root_pos"] = np.array([0.0, 0.0, 18.0 * MM])
        st["hips_off"] = np.array([0.0, 0.0, (0.35 * stroke + climb) * MM])
        glide = math.sin(math.pi * (c - BURST) / (CYCLE - BURST)) if not flapping else 0.0
        st["hips_rot"] = (-20.0 + 3.0 * glide + 1.0 * stroke, 0.0, 0.0)
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


SCALED = ("throat", "wingfold.L", "wingfold.R")  # plus the flight-feather bones (open-wing vane scale)
WING_FEATHER_BONES = {sp["bone"] for sp in sf.feather_specs() if sp["flight"]}


MOUTH_BONES = ("jaw", "bill_upper", "throat")  # keyed only by Call / CallBill so the mouth layers over any clip


def bake(rig, name, states, frame_offset=1, skip=(), only=None):
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
            if bone in skip or (only is not None and bone not in only):
                continue
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
            if bone in SCALED or bone[:-2] in WING_FEATHER_BONES:
                pb.keyframe_insert("scale", frame=f, group=bone)
            pb.keyframe_insert("scale", frame=f, group=bone)
    wing_keys = []
    for wn in ("SP_Wing_L", "SP_Wing_R"):
        wo = bpy.data.objects.get(wn)
        ks = wo.data.shape_keys if wo is not None else None
        if ks is not None and "Spread" in ks.key_blocks:
            wing_keys.append(ks)
    for ks in wing_keys:  # unroll the folded-wing roll while the wing opens (see s08.roll_wings_over_back)
        ks.animation_data_create()
        old_k = bpy.data.actions.get(name + "_" + ks.name)
        if old_k:
            bpy.data.actions.remove(old_k)
        ka = bpy.data.actions.new(name + "_" + ks.name)
        ka.use_fake_user = True
        ks.animation_data.action = ka
        for i, st in enumerate(states):
            ks.key_blocks["Spread"].value = float(min(max(st["fan"], 0.0), 1.0))
            ks.key_blocks["Spread"].keyframe_insert("value", frame=i + frame_offset)
        for tr in list(ks.animation_data.nla_tracks):
            if tr.name == name:
                ks.animation_data.nla_tracks.remove(tr)
        ktr = ks.animation_data.nla_tracks.new()
        ktr.name = name
        ktr.strips.new(name, frame_offset, ka)
        ks.animation_data.action = None
        ks.key_blocks["Spread"].value = 0.0
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
    Call track is the one being evaluated (driver on the strip's mute)."""
    sc = bpy.context.scene
    se = sc.sequence_editor or sc.sequence_editor_create()
    strips = se.strips if hasattr(se, "strips") else se.sequences
    old = strips.get("SP_Song")
    if old:
        strips.remove(old)
    start = SONG_START - int(round(song["onset"] * FPS))
    strip = strips.new_sound("SP_Song", SONG_WAV, 1, start)
    path = strip.path_from_id("mute")
    sc.driver_remove(path)
    drv = sc.driver_add(path).driver
    drv.type = "SCRIPTED"
    for name, prop in (("ws_off", 'animation_data.nla_tracks["Call"].mute'), ("fly_solo", 'animation_data.nla_tracks["Fly"].is_solo')):
        var = drv.variables.new()
        var.name, var.type = name, "SINGLE_PROP"
        var.targets[0].id_type = "OBJECT"
        var.targets[0].id = rig_ob
        var.targets[0].data_path = prop
    drv.expression = "max(ws_off, fly_solo)"
    sc.sync_mode = "AUDIO_SYNC"
    return start


def hide_rig(ob):
    """Bones stay out of the viewport and renders; the armature still deforms the bird and is exported."""
    ob.hide_render = True
    ob.hide_viewport = True  # monitor icon: the armature still deforms the meshes
    ob.show_in_front = False
    ob.data.display_type = "WIRE"
    for c in ob.data.collections_all if hasattr(ob.data, "collections_all") else []:
        c.is_visible = False
    try:
        ob.hide_set(True)
    except RuntimeError:
        pass


def write_clip_cues(song):
    """Clip metadata for the GLB (s10 injects it as animation extras) and the TypeScript controller."""
    tl = song["timeline"]
    at = (tl["start"] - 1) / FPS - song["onset"]
    cues = {
        "Call": {
            "loop": True,
            "cues": [{"type": "audio", "id": "call", "src": song["src"], "at": round(at, 4), "duration": song["duration"]}],
            "markers": {"callStart": round((tl["start"] - 1) / FPS, 4), "callEnd": round((tl["end"] - 1) / FPS, 4)},
            "audio": {"recordist": song["recordist"], "license": song["license"], "sourceUrl": song["sourceUrl"], "xcId": song["xcId"]},
        },
        "HopForage": {"loop": True, "cues": [], "markers": {"hop%d" % (i + 1): round((h[0] - 1) / FPS, 4) for i, h in enumerate(HOPS)}
                      | {"peck%d" % (i + 1): round((c - 1) / FPS, 4) for i, c in enumerate(PECKS)}},
        "Fly": {"loop": True, "cues": [], "markers": {"glide": round((BURST - 1) / FPS, 4), "glide2": round((CYCLE + BURST - 1) / FPS, 4), "glide3": round((2 * CYCLE + BURST - 1) / FPS, 4), "glide4": round((3 * CYCLE + BURST - 1) / FPS, 4)}},
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
    for wn in ("SP_Wing_L", "SP_Wing_R"):
        wo = bpy.data.objects.get(wn)
        ks = wo.data.shape_keys if wo is not None else None
        if ks is not None and ks.animation_data:
            for tr in list(ks.animation_data.nla_tracks):
                ks.animation_data.nla_tracks.remove(tr)
    for old in ("Flap", "Sing", "WalkSing", "CallBill"):
        if bpy.data.actions.get(old):
            bpy.data.actions.remove(bpy.data.actions[old])
    bake(rig, "Call", call_states(rig, song))
    bake(rig, "HopForage", hop_states(rig), skip=MOUTH_BONES)
    bake(rig, "Fly", fly_states(rig), skip=MOUTH_BONES)
    reset_pose(rig.ob)
    n = song["timeline"]["frames"]
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, n
    strip_at = add_song_strip(rig.ob, song)
    write_clip_cues(song)
    hide_rig(rig.ob)
    return "actions: Call %d frames (call frames %d-%d, strip at %d), HopForage %d frames, Fly %d frames" % (
        n, song["timeline"]["start"], song["timeline"]["end"] - 1, strip_at, HOP_FRAMES, FLY_FRAMES)
