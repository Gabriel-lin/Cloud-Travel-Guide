"""Check (inside Blender): render the model through the side reference photo's own camera.

The body was traced from sources/photos/side_upright_veronesi.jpg via spshape.px_to_bl, so an
orthographic camera built from that mapping lines the render up with the photo pixel for pixel.
Writes build/debug/photomatch_<name>.png: photo crop | render crop | render over photo | ghost.

    import photomatch; photomatch.run("head", crop=(430, 100, 750, 330), scale=2)
    import photomatch; photomatch.run("billeye", crop=(462, 140, 642, 222), scale=4)
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix

_PIPELINE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline")
if _PIPELINE not in sys.path:
    sys.path.insert(0, _PIPELINE)
import splib as bt  # noqa: E402
import spshape as bs  # noqa: E402

DEBUG = bt.DEBUG


def _camera():
    W, H = bs.SIDE_SIZE
    cy, cz = bs.px_to_bl(W / 2.0, H / 2.0)
    a = math.radians(bs.TILT_DEG)
    x_cam = np.array([0.0, math.cos(a), math.sin(a)])  # image right: photo +x
    y_cam = np.array([0.0, -math.sin(a), math.cos(a)])  # image up: photo -y
    z_cam = np.cross(x_cam, y_cam)  # looks along -X, from the bird's left side
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2] = x_cam, y_cam, z_cam
    m[:3, 3] = (0.6, float(cy), float(cz))
    data = bpy.data.cameras.new("SP_MatchCam")
    data.type = "ORTHO"
    data.ortho_scale = W * bs.PX_MM * 0.001
    data.clip_start, data.clip_end = 0.01, 2.0
    cam = bpy.data.objects.new("SP_MatchCam", data)
    bpy.context.scene.collection.objects.link(cam)
    cam.matrix_world = Matrix(m.tolist())
    return cam


def _load(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, im.channels)[::-1]  # row 0 = top
    bpy.data.images.remove(im)
    if a.shape[2] == 3:
        a = np.concatenate([a, np.ones_like(a[..., :1])], -1)
    return a


def render(path, frame=None):
    """frame=None renders the armature's rest position (independent of NLA mute state)."""
    sc = bpy.context.scene
    arm = bpy.data.objects["SP_Rig"].data
    keep_pose = arm.pose_position
    keep = dict(
        engine=sc.render.engine, cam=sc.camera, x=sc.render.resolution_x, y=sc.render.resolution_y,
        pct=sc.render.resolution_percentage, fp=sc.render.filepath, transp=sc.render.film_transparent,
        frame=sc.frame_current, fmt=sc.render.image_settings.file_format, mode=sc.render.image_settings.color_mode,
    )
    import s10_export as s10

    keep_objs = set(s10.BIRD) | {"SP_Rig"}
    hidden = [o for o in sc.objects if o.name not in keep_objs and o.type != "LIGHT" and not o.hide_render]
    cam = _camera()
    try:
        for o in hidden:
            o.hide_render = True
        sc.render.engine = "BLENDER_EEVEE"
        sc.camera = cam
        sc.render.resolution_x, sc.render.resolution_y = bs.SIDE_SIZE
        sc.render.resolution_percentage = 100
        sc.render.film_transparent = True
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGBA"
        if frame is None:
            arm.pose_position = "REST"
        else:
            sc.frame_set(frame)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
    finally:
        arm.pose_position = keep_pose
        for o in hidden:
            o.hide_render = False
        sc.render.engine, sc.camera = keep["engine"], keep["cam"]
        sc.render.resolution_x, sc.render.resolution_y = keep["x"], keep["y"]
        sc.render.resolution_percentage, sc.render.filepath = keep["pct"], keep["fp"]
        sc.render.film_transparent = keep["transp"]
        sc.render.image_settings.file_format, sc.render.image_settings.color_mode = keep["fmt"], keep["mode"]
        if frame is not None:
            sc.frame_set(keep["frame"])
        data = cam.data
        bpy.data.objects.remove(cam)
        bpy.data.cameras.remove(data)


def run(name, crop=(430, 90, 790, 340), scale=3, frame=None):
    os.makedirs(DEBUG, exist_ok=True)
    raw = os.path.join(DEBUG, "photomatch_%s_render.png" % name)
    render(raw, frame)
    photo = _load(os.path.join(bt.PHOTOS, bs.SIDE_PHOTO))
    rend = _load(raw)
    x0, y0, x1, y1 = crop
    p, r = photo[y0:y1, x0:x1], rend[y0:y1, x0:x1]
    over = r[..., :3] * r[..., 3:] + p[..., :3] * (1 - r[..., 3:])
    ghost = np.where(r[..., 3:] > 0.5, 0.5 * r[..., :3] + 0.5 * p[..., :3], p[..., :3])
    panels = [p[..., :3], r[..., :3] * r[..., 3:] + 0.25 * (1 - r[..., 3:]), over, ghost]
    out = np.concatenate([np.concatenate(panels[:2], 1), np.concatenate(panels[2:], 1)], 0)
    out = np.repeat(np.repeat(out, scale, 0), scale, 1)
    path = os.path.join(DEBUG, "photomatch_%s.png" % name)
    h, w = out.shape[:2]
    img = bpy.data.images.new("dbg_photomatch", w, h, alpha=False)
    img.pixels[:] = np.concatenate([out[::-1], np.ones((h, w, 1), np.float32)], -1).ravel()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path
