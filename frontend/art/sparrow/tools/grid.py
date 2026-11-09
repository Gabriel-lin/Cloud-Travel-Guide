"""Measuring aid (inside Blender): gridded crop of a reference photo for reading coordinates.

    import grid; grid.grid_crop("side_upright_veronesi.jpg", 230, 350, 60, 140, scale=7)  # -> build/debug/
"""
import os
import sys

import numpy as np

_PIPELINE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pipeline")
if _PIPELINE not in sys.path:
    sys.path.insert(0, _PIPELINE)
import splib as bt  # noqa: E402

DEBUG = bt.DEBUG


def grid_crop(photo, x0, x1, y0, y1, scale=3, minor=10, major=50, name=None, folder=None, step=2):
    img = bt.load_image(os.path.join(folder or bt.PHOTOS, photo))
    a = bt.image_np(img)[::-1, :, :3][::step, ::step]  # downsampled by `step`, top-down
    c = a[y0:y1, x0:x1].copy()
    big = np.repeat(np.repeat(c, scale, 0), scale, 1)
    for gx in range(x0 - x0 % minor + minor, x1, minor):
        col = (gx - x0) * scale
        tint = (1.0, 0.25, 0.1) if gx % major == 0 else (1.0, 1.0, 0.3)
        alpha = 0.85 if gx % major == 0 else 0.35
        big[:, col] = big[:, col] * (1 - alpha) + np.array(tint) * alpha
    for gy in range(y0 - y0 % minor + minor, y1, minor):
        row = (gy - y0) * scale
        tint = (1.0, 0.25, 0.1) if gy % major == 0 else (1.0, 1.0, 0.3)
        alpha = 0.85 if gy % major == 0 else 0.35
        big[row, :] = big[row, :] * (1 - alpha) + np.array(tint) * alpha
    name = name or "grid_%s_%d_%d.png" % (os.path.splitext(photo)[0], x0, y0)
    bt.np_image(big[::-1], "dbg_" + name, path=os.path.join(DEBUG, name))
    return os.path.join(DEBUG, name)
