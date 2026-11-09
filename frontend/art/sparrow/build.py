"""Rebuild the Eurasian tree sparrow (Passer montanus) from sources/ and export it for the web.

Headless (what `npm run art:sparrow` does, from frontend/):
    blender -b --factory-startup --python-exit-code 1 -P art/sparrow/build.py -- [options]
Inside a running Blender (Python console / MCP bridge), building into the open session:
    import runpy; runpy.run_path(r"<repo>/frontend/art/sparrow/build.py")["main"](["--steps", "s05_plumage,s07_feathers"])

Options:
    --steps a,b,...  run only these pipeline steps (in pipeline order; see pipeline/steps.py)
    --previews       render preview stills into build/previews/ afterwards
    --no-save        don't write sparrow.blend

Reads  sources/ (photos, feather scans, call excerpt + song.json).
Writes textures/, build/ (intermediate data + debug images, git-ignored), sparrow.blend,
       public/models/sparrow.glb and public/audio/birds/sparrow/tree-sparrow-call-01.wav.
Verify with `npm run art:sparrow:verify` (tools/verify.mjs).
"""
import argparse
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.join(HERE, "pipeline")
TOOLS = os.path.join(HERE, "tools")
OWN_MODULES = {
    "steps", "splib", "spshape", "photo_trace", "feather_scan", "photomatch", "grid", "previews",
    "s00_song", "s01_scene", "s02_refs", "s03_body", "s04_parts", "s05_plumage", "s06_feather_atlas",
    "s07_feathers", "s08_rig", "s09_anim", "s10_export",
}


def _use_this_checkout():
    """Put pipeline/ and tools/ first on sys.path and drop same-named modules a live session imported
    from anywhere else (an older checkout or the pre-reorganisation scripts/ folder)."""
    for p in (TOOLS, PIPELINE):
        if p in sys.path:
            sys.path.remove(p)
        sys.path.insert(0, p)
    for name in OWN_MODULES:
        mod = sys.modules.get(name)
        f = os.path.abspath(getattr(mod, "__file__", "") or "") if mod else ""
        if mod and not f.startswith(HERE):
            del sys.modules[name]


def _parse(argv):
    ap = argparse.ArgumentParser(prog="build.py")
    ap.add_argument("--steps", help="comma-separated subset of pipeline steps")
    ap.add_argument("--previews", action="store_true", help="render preview stills into build/previews")
    ap.add_argument("--no-save", action="store_true", help="don't write sparrow.blend")
    return ap.parse_args(argv)


def _save_blend(path):
    bpy.data.orphans_purge(do_recursive=True)  # startup-file leftovers (default material, brushes)
    bpy.ops.wm.save_as_mainfile(filepath=path)
    # textures, photos and the song load from any checkout location; files from Blender's own
    # install (the studio HDRI, bundled brushes) stay absolute
    frontend = os.path.normcase(os.path.dirname(os.path.dirname(HERE)))
    for block in (*bpy.data.images, *bpy.data.sounds):
        if not block.filepath or block.packed_file or block.filepath.startswith("//"):
            continue
        if os.path.normcase(os.path.abspath(bpy.path.abspath(block.filepath))).startswith(frontend):
            block.filepath = bpy.path.relpath(block.filepath)
    bpy.ops.wm.save_mainfile()
    backup = path + "1"
    if os.path.exists(backup):
        os.remove(backup)


def main(argv=None):
    if argv is None:
        argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    args = _parse(argv)
    _use_this_checkout()
    import splib as bt
    import steps

    t0 = time.time()
    steps.run(args.steps.split(",") if args.steps else None)
    if not args.no_save:
        _save_blend(bt.BLEND_PATH)
        print("saved %s" % bt.BLEND_PATH)
    if args.previews:
        import previews

        print(previews.run())
    print("sparrow build finished in %.1fs (Blender %s)" % (time.time() - t0, bpy.app.version_string))


if __name__ == "__main__":
    main()
