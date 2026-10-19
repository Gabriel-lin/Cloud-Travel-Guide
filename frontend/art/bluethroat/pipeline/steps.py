"""Ordered pipeline steps; build.py (one level up) is the entry point that calls run().

Each step module has run() -> short report string. Later steps read what earlier ones left in the
scene or in build/, so partial runs must keep the order (e.g. s03 before s04, s07 before s08).
"""
import importlib
import sys
import time

STEPS = [
    "s00_song", "s01_scene", "s02_refs", "s03_body", "s04_parts", "s05_plumage",
    "s06_feather_atlas", "s07_feathers", "s08_rig", "s09_anim", "s10_export",
]
HELPERS = ["btlib", "btshape", "photo_trace", "feather_scan"]


def run(steps=None, log=print):
    """Run the given steps (all by default) in pipeline order, reloading modules so edits take effect."""
    for h in HELPERS:
        if h in sys.modules:
            importlib.reload(sys.modules[h])
    wanted = list(STEPS) if steps is None else list(steps)
    unknown = [s for s in wanted if s not in STEPS]
    if unknown:
        raise ValueError("unknown steps %s (known: %s)" % (", ".join(unknown), ", ".join(STEPS)))
    lines = []
    for name in sorted(wanted, key=STEPS.index):
        mod = importlib.import_module(name)
        importlib.reload(mod)
        t0 = time.time()
        res = mod.run()
        lines.append("%s (%.1fs): %s" % (name, time.time() - t0, str(res)[:300]))
        log(lines[-1])
    return "\n".join(lines)
