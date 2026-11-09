"""Shared shape constants: how the side reference photo maps onto the model, plus key landmarks.

The side profile is traced from Jakub Hałun's photo (sources/photos/side_profile_halun.jpg, 1280x852,
CC BY 4.0): an adult Eurasian tree sparrow standing on a flat wall top against green bokeh. The bird
looks slightly down there, so it is tilted back by -TILT_DEG to carry the bill a little higher.
Scale: ~0.115 mm per full-resolution pixel: standing height ~72 mm, bill tip to tail tip ~110 mm in this hunched pose (~140 mm measured stretched, as in field guides).
"""
import math

import numpy as np

SIDE_PHOTO = "side_profile_halun.jpg"
SIDE_SIZE = (1280, 852)
PX_MM = 0.115  # mm per full-resolution pixel (standing height ~72 mm, wing ~70 mm)
REF_PX = (680.0, 420.0)  # body centre in the photo (full-res px)
REF_BL = (0.0, 0.0345)  # where the body centre lands in Blender (Y, Z), metres: wall top at z = 0
TILT_DEG = -8.0


def px_to_bl(px, py):
    """Full-resolution photo pixel(s) -> Blender (Y, Z) in metres. Arrays allowed."""
    px = np.asarray(px, dtype=np.float64)
    py = np.asarray(py, dtype=np.float64)
    u = (px - REF_PX[0]) * PX_MM
    w = -(py - REF_PX[1]) * PX_MM
    a = math.radians(TILT_DEG)
    ur = u * math.cos(a) - w * math.sin(a)
    wr = u * math.sin(a) + w * math.cos(a)
    return REF_BL[0] + ur * 0.001, REF_BL[1] + wr * 0.001


def half_to_bl(x, y):
    """Half-resolution trace pixel(s) -> Blender (Y, Z)."""
    return px_to_bl(np.asarray(x) * 2.0, np.asarray(y) * 2.0)


# Landmarks measured on the side photo (half-resolution px).
EYE_PX = (235.0, 91.0)
EYE_VISIBLE_DIAM_MM = 3.4
EYEBALL_R_MM = 2.5
JAW_HINGE_PX = (221.0, 104.0)  # quadrate region, below and in front of the eye
PERCH_R = 0.0034  # radius of the preview twig's stem in s01 where the feet grip (toes in s04 wrap around it); stem top at z = 0
PERCH_Y = -0.0020  # y of the stem axis (the feet's y)
