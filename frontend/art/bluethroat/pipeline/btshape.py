"""Shared shape constants: how the side reference photo maps onto the model, plus key landmarks.

The side profile is traced from Francesco Veronesi's photo (sources/photos/side_upright_veronesi.jpg,
1280x853). The bird is tilted forward by TILT_DEG so the bill points level instead of up.
"""
import math

import numpy as np

SIDE_PHOTO = "side_upright_veronesi.jpg"
SIDE_SIZE = (1280, 853)
PX_MM = 0.175  # mm per full-resolution pixel (bird ~140 mm along its body)
REF_PX = (660.0, 400.0)  # body centre in the photo
REF_BL = (0.0, 0.052)  # where the body centre lands in Blender (Y, Z), metres
TILT_DEG = 10.0


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
EYE_PX = (301.5, 98.25)
EYE_VISIBLE_DIAM_MM = 4.4
EYEBALL_R_MM = 2.6
JAW_HINGE_PX = (281.0, 96.0)  # quadrate region, below and in front of the eye
PERCH_R = 0.005  # perch radius (m); its top is at z = 0, axis along X at (y=0, z=-PERCH_R)
