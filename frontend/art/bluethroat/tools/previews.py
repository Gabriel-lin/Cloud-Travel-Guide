"""Check (inside Blender): render the standard preview stills of a finished build into build/previews/.

    head.png      rest pose, three-quarter head (bill, eye, face pattern vs the photos)
    sing.png      WalkSing at the widest bill gape of the recorded phrase
    fly.png       Fly mid-downstroke, wings and tail spread
    fly_feet.png  Fly glide from the side: feet folded back into the belly feathers

    import previews; previews.run()          # or: build.py -- --previews
"""
import json
import os
import sys

import bpy
from mathutils import Vector

_PIPELINE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline")
if _PIPELINE not in sys.path:
    sys.path.insert(0, _PIPELINE)
import btlib as bt  # noqa: E402

OUT = os.path.join(bt.BUILD, "previews")

# name, clip (None = rest pose), frame, camera position, target, lens
SHOTS = [
    ("head", None, None, (-0.16, -0.17, 0.115), (-0.002, -0.022, 0.082), 100),
    ("sing", "WalkSing", "loudest", (0.30, -0.33, 0.12), (0.03, 0.0, 0.06), 85),
    ("fly", "Fly", 6, (0.36, -0.42, 0.26), (0.0, 0.01, 0.07), 85),
    ("fly_feet", "Fly", 34, (0.42, 0.05, 0.02), (0.0, 0.02, 0.065), 85),
]


def _loudest_frame():
    from s09_anim import SONG_START

    with open(os.path.join(bt.BUILD, "song_cues.json"), encoding="utf-8") as f:
        jaw = json.load(f)["jaw"]
    return SONG_START + max(range(len(jaw)), key=jaw.__getitem__)


def run(size=(1000, 760)):
    os.makedirs(OUT, exist_ok=True)
    sc = bpy.context.scene
    rig = bpy.data.objects["BT_Rig"]
    arm = rig.data
    tracks = rig.animation_data.nla_tracks
    keep = dict(engine=sc.render.engine, cam=sc.camera, res=(sc.render.resolution_x, sc.render.resolution_y),
                fp=sc.render.filepath, pose=arm.pose_position, frame=sc.frame_current,
                mute={t.name: t.mute for t in tracks})
    hidden = [o for o in sc.objects if o.name.startswith(("BT_Ref", "BT_Gallery")) and not o.hide_render]
    data = bpy.data.cameras.new("BT_PreviewCam")
    cam = bpy.data.objects.new("BT_PreviewCam", data)
    sc.collection.objects.link(cam)
    written = []
    try:
        for o in hidden:
            o.hide_render = True
        sc.camera = cam
        sc.render.engine = "BLENDER_EEVEE"
        sc.render.resolution_x, sc.render.resolution_y = size
        for name, clip, frame, pos, target, lens in SHOTS:
            data.lens = lens
            if clip is None:
                arm.pose_position = "REST"
            else:
                arm.pose_position = "POSE"
                for t in tracks:
                    t.mute = t.name != clip
                sc.frame_set(_loudest_frame() if frame == "loudest" else frame)
            cam.location = Vector(pos)
            cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(OUT, name + ".png")
            bpy.ops.render.render(write_still=True)
            written.append(name)
    finally:
        for o in hidden:
            o.hide_render = False
        arm.pose_position = keep["pose"]
        for t in tracks:
            t.mute = keep["mute"].get(t.name, t.mute)
        sc.camera, sc.render.engine = keep["cam"], keep["engine"]
        sc.render.resolution_x, sc.render.resolution_y = keep["res"]
        sc.render.filepath = keep["fp"]
        sc.frame_set(keep["frame"])
        bpy.data.objects.remove(cam)
        bpy.data.cameras.remove(data)
    return "previews -> %s: %s" % (OUT, ", ".join(written))
