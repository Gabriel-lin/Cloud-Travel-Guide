"""Step 2: reference boards.

- SP_Ref_Side: the traced side photo at true scale in the model's YZ plane (only visible in side ortho views).
- SP_Ref_Front: front photo in the XZ plane (only visible in front/back ortho views).
- SP_Gallery_*: every reference photo and feather scan on a wall behind the bird.
"""
import math
import os

import bpy
from mathutils import Euler, Matrix, Vector

import splib as bt
import spshape as bs

GALLERY = [
    "side_profile_halun.jpg", "front34_halun.jpg", "head_closeup_othagoer.jpg", "side_perched_laitche.jpg",
    "side_perched_kiran.jpg", "rear34_laitche.jpg", "calling_open_bill_hedera.jpg", "ground_forage_food_halun.jpg",
    "ground_peck_hedera.jpg", "ground_forage_hedera.jpg", "flight_spread_mildeep.jpg", "flight_pair_pavadk.jpg",
    "flight_hover_arquus.jpg", "flight_lam.jpg", "specimen_naturalis.jpg",
]
SCANS = ["hansen_4010_flight_tail.jpg", "hansen_4009_full_set.jpg"]


def _board(name, path, matrix, size, axis_only=False, alpha=1.0, depth="DEFAULT"):
    bt.remove_object(name)
    img = bt.load_image(path)
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "IMAGE"
    ob.data = img
    ob.empty_display_size = size
    ob.empty_image_offset = (-0.5, -0.5)
    ob.empty_image_depth = depth
    ob.empty_image_side = "DOUBLE_SIDED"
    ob.show_empty_image_orthographic = True
    ob.show_empty_image_perspective = not axis_only
    ob.show_empty_image_only_axis_aligned = axis_only
    ob.use_empty_image_alpha = alpha < 1.0
    ob.color = (1, 1, 1, alpha)
    ob.matrix_world = matrix
    ob.hide_select = True
    bt.link(ob, bt.COLL_REFS)
    return ob


def _side_board():
    w, h = bs.SIDE_SIZE
    cy, cz = bs.px_to_bl(w / 2.0, h / 2.0)
    a = math.radians(bs.TILT_DEG)
    base = Euler((math.radians(90), 0, math.radians(90)), "XYZ").to_matrix().to_4x4()
    rot = Matrix.Rotation(a, 4, "X") @ base
    m = Matrix.Translation((-0.045, cy, cz)) @ rot
    return _board("SP_Ref_Side", os.path.join(bt.PHOTOS, bs.SIDE_PHOTO), m, w * bs.PX_MM * 0.001, axis_only=True, alpha=0.85, depth="BACK")


def _front_board():
    # Ten Cate front shot: belly ~147 px wide at 1280 px  ->  ~0.184 mm/px; bird centre ~ (980, 470) px.
    path = os.path.join(bt.PHOTOS, "front_singing_tailfan_tencate.jpg")
    img = bt.load_image(path)
    w, h = img.size
    mm = 0.184
    cx = (w / 2.0 - 980.0) * mm * 0.001
    cz = 0.047 - (h / 2.0 - 470.0) * mm * 0.001
    m = Matrix.Translation((cx, 0.06, cz)) @ Euler((math.radians(90), 0, 0), "XYZ").to_matrix().to_4x4()
    return _board("SP_Ref_Front", path, m, w * mm * 0.001, axis_only=True, alpha=0.85, depth="BACK")


def _gallery():
    items = [(os.path.join(bt.PHOTOS, f), f) for f in GALLERY] + [(os.path.join(bt.FEATHER_SCANS, f), f) for f in SCANS]
    view_dir = Vector((0.57, 0.82, 0.0)).normalized()
    centre = Vector((0.0, 0.0, 0.07)) + view_dir * 0.34
    right = Vector((view_dir.y, -view_dir.x, 0.0)).normalized()
    up = Vector((0, 0, 1))
    cols, size, gap = 5, 0.088, 0.008
    rows = (len(items) + cols - 1) // cols
    face = view_dir.to_track_quat("Z", "Y").to_matrix().to_4x4()
    for i, (path, fname) in enumerate(items):
        r, c = divmod(i, cols)
        off = right * ((c - (cols - 1) / 2.0) * (size + gap)) + up * (((rows - 1) / 2.0 - r) * (size * 0.72 + gap))
        m = Matrix.Translation(centre + off) @ face @ Matrix.Rotation(math.pi, 4, "Y")
        _board("SP_Gallery_%02d" % i, path, m, size)


def run():
    bt.clear_collection(bt.COLL_REFS)
    _side_board()
    _gallery()
    bt.frame_view((0.0, 0.05, 0.075), 0.62, elev_deg=6, azim_deg=-30, lens=50, shading="MATERIAL")
    return "reference boards placed"
