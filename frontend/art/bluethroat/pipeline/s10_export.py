"""Step 10: export frontend/public/models/bluethroat.glb and report what it contains."""
import json
import os
import struct

import bpy

import btlib as bt
import s08_rig as sr

BIRD = [
    "BT_Body", "BT_Bill_Upper", "BT_Bill_Lower", "BT_Eye_L", "BT_Eye_R", "BT_Leg_L", "BT_Leg_R",
    "BT_Wing_L", "BT_Wing_R", "BT_Tail", "BT_Contour", "BT_Scapulars", "BT_Trousers", "BT_Down",
]
COPYRIGHT = (
    "Bluethroat model. Feather textures derived from the scientific feather collection of Wilfried Hansen, "
    "Feather Research Group (est. 1972), featherbase.info, CC BY 4.0."
)


def export(path=bt.GLB_PATH):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    rig = bpy.data.objects[sr.RIG]
    ad = rig.animation_data
    ad.action = None
    for tr in ad.nla_tracks:
        tr.mute = False
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for n in BIRD + [sr.RIG]:
        ob = bpy.data.objects[n]
        ob.hide_viewport = False
        ob.hide_set(False)  # hidden objects can't be selected, and use_selection would drop them
        ob.select_set(True)
    bpy.context.view_layer.objects.active = rig
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_nla_strips=True,
        export_force_sampling=True,
        export_frame_step=1,
        export_anim_slide_to_zero=True,
        export_skins=True,
        export_def_bones=False,
        export_rest_position_armature=True,
        export_reset_pose_bones=True,
        export_optimize_animation_size=True,
        export_image_format="WEBP",
        export_image_quality=88,
        export_vertex_color="MATERIAL",
        export_tangents=True,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_copyright=COPYRIGHT,
    )
    # leave the file previewing WalkSing (its song strip follows that track); Fly is one click away in the NLA
    for tr in ad.nla_tracks:
        tr.mute = tr.name != "WalkSing"
    rig.hide_set(True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    bpy.context.scene.frame_set(1)
    return path


CLIP_CUES = os.path.join(bt.BUILD, "clip_cues.json")


def _read_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _total = struct.unpack_from("<III", data, 0)
    clen, ctype = struct.unpack_from("<II", data, 12)
    doc = json.loads(data[20 : 20 + clen])
    rest = data[20 + clen :]  # BIN chunk (header included), untouched
    return version, doc, rest


def _write_glb(path, version, doc, rest):
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + len(rest)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, version, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(rest)


def inject_clip_extras(path=bt.GLB_PATH, cues_path=CLIP_CUES):
    """Per-clip metadata (audio cues, markers, loop flag) as glTF animation extras, read by the TS controller."""
    with open(cues_path, encoding="utf-8") as f:
        cues = json.load(f)
    version, doc, rest = _read_glb(path)
    hit = []
    for anim in doc.get("animations", []):
        extra = cues.get(anim.get("name"))
        if extra is not None:
            anim["extras"] = extra
            hit.append(anim["name"])
    _write_glb(path, version, doc, rest)
    return hit


def inspect(path=bt.GLB_PATH):
    with open(path, "rb") as f:
        magic, version, total = struct.unpack("<III", f.read(12))
        clen, ctype = struct.unpack("<II", f.read(8))
        doc = json.loads(f.read(clen))
    views = doc.get("bufferViews", [])
    imgs = []
    for im in doc.get("images", []):
        bv = views[im["bufferView"]] if "bufferView" in im else {}
        imgs.append("%s %s %.0fKB" % (im.get("name"), im.get("mimeType"), bv.get("byteLength", 0) / 1024))
    anims = ["%s (%d channels, extras: %s)" % (a.get("name"), len(a["channels"]), ",".join(sorted(a.get("extras", {}))) or "-")
             for a in doc.get("animations", [])]
    mats = []
    for m in doc.get("materials", []):
        mats.append("%s[%s%s]" % (m.get("name"), m.get("alphaMode", "OPAQUE"), ",double" if m.get("doubleSided") else ""))
    prims = sum(len(m["primitives"]) for m in doc.get("meshes", []))
    return {
        "size_mb": round(total / 1048576, 2),
        "animations": anims,
        "skins": [len(s["joints"]) for s in doc.get("skins", [])],
        "meshes": len(doc.get("meshes", [])),
        "primitives": prims,
        "materials": mats,
        "images": imgs,
        "extensions": doc.get("extensionsUsed", []),
        "copyright": doc.get("asset", {}).get("copyright", "")[:60],
    }


def run():
    path = export()
    inject_clip_extras(path)
    return json.dumps(inspect(path), ensure_ascii=False, indent=1)
