"""Step 10: export frontend/public/models/sparrow.glb (bird + its perch twig) and report what it contains."""
import json
import os
import struct

import bpy

import numpy as np

import splib as bt
import s08_rig as sr

BIRD = [
    "SP_Body", "SP_Bill_Upper", "SP_Bill_Lower", "SP_Eye_L", "SP_Eye_R", "SP_Leg_L", "SP_Leg_R",
    "SP_Wing_L", "SP_Wing_R", "SP_Tail", "SP_Contour", "SP_Scapulars", "SP_Trousers", "SP_Down",
    "SP_Back", "SP_Spine", "SP_WingBars", "SP_WingFold", "SP_Mouth",
]
COPYRIGHT = (
    "Eurasian Tree Sparrow model. Plumage colour projected from reference photographs (see sources/CREDITS.md); Feather textures derived from the scientific feather collection of Wilfried Hansen, "
    "Feather Research Group (est. 1972), featherbase.info, CC BY 4.0."
)


BAKE_RES = 4096
BAKE_MAT = "SP_FeathersBaked"
BAKE_IMG = os.path.join(bt.BUILD, "feathers_baked.png")


def _islands(me):
    """Connected face sets (one per feather card) via shared vertices."""
    parent = list(range(len(me.vertices)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for e in me.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    groups = {}
    for poly in me.polygons:
        groups.setdefault(find(poly.vertices[0]), []).append(poly.index)
    return list(groups.values())


def bake_feathers():
    """SP_WingFold mixes photo projection, scan relief and vertex colour - glTF can't carry that node tree.
    Give every card using it its own cell in one atlas (UV 'bake'), Cycles-bake colour and alpha into it and
    switch those objects to a plain textured alpha-clip material."""
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.name in BIRD
            and any(m and m.name.startswith("SP_WingFold") for m in o.data.materials)]
    if not objs:
        return 0
    cards = [(o, isl) for o in objs for isl in _islands(o.data)]
    n = int(np.ceil(np.sqrt(len(cards))))
    cell = 1.0 / n
    pad = 2.0 / BAKE_RES
    for o in objs:
        me = o.data
        src = me.uv_layers["UVMap"] if "UVMap" in me.uv_layers else me.uv_layers[0]
        uv = me.uv_layers.get("bake") or me.uv_layers.new(name="bake")
        o["_src_uv"] = src.name
    for k, (o, faces) in enumerate(cards):
        me = o.data
        src, dst = me.uv_layers[o["_src_uv"]], me.uv_layers["bake"]
        loops = [li for fi in faces for li in me.polygons[fi].loop_indices]
        q = np.array([src.data[li].uv[:] for li in loops])
        lo, hi = q.min(0), q.max(0)
        span = np.maximum(hi - lo, 1e-6)
        cx, cy = (k % n) * cell, (k // n) * cell
        r = (q - lo) / span * (cell - 2 * pad) + pad + np.array([cx, cy])
        for li, v in zip(loops, r):
            dst.data[li].uv = v
    img = bpy.data.images.get("feathers_baked") or bpy.data.images.new("feathers_baked", BAKE_RES, BAKE_RES, alpha=True)
    sc = bpy.context.scene
    old_engine = sc.render.engine
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 1
    sc.render.bake.margin = 2
    sc.render.bake.use_clear = False
    # colour pass and alpha pass, both as emission so lighting stays out of the texture
    planes = {}
    for chan in ("color", "alpha"):
        tgt = bpy.data.images.new("bake_" + chan, BAKE_RES, BAKE_RES, alpha=False, float_buffer=False)
        tgt.generated_color = (0, 0, 0, 1)
        for m in {m for o in objs for m in o.data.materials if m and m.name.startswith("SP_WingFold")}:
            nt = m.node_tree
            out = next(nd for nd in nt.nodes if nd.type == "OUTPUT_MATERIAL" and nd.is_active_output)
            bsdf = out.inputs["Surface"].links[0].from_node
            sockn = "Base Color" if chan == "color" else "Alpha"
            emi = nt.nodes.new("ShaderNodeEmission")
            emi.name = "_bake_emit"
            inp = bsdf.inputs[sockn]
            if inp.links:
                nt.links.new(inp.links[0].from_socket, emi.inputs["Color"])
            else:
                v = inp.default_value
                emi.inputs["Color"].default_value = tuple(v) if chan == "color" else (v, v, v, 1)
            m["_surf"] = bsdf.name
            nt.links.new(emi.outputs[0], out.inputs["Surface"])
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.name = "_bake_tgt"
            tn.image = tgt
            tn.select = True
            nt.nodes.active = tn
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        for o in objs:
            o.hide_set(False)
            o.hide_render = False
            o.select_set(True)
            o.data.uv_layers["bake"].active = True
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.bake(type="EMIT")
        planes[chan] = np.array(tgt.pixels[:], dtype=np.float32).reshape(-1, 4)
        for m in {m for o in objs for m in o.data.materials if m and m.name.startswith("SP_WingFold")}:
            nt = m.node_tree
            out = next(nd for nd in nt.nodes if nd.type == "OUTPUT_MATERIAL" and nd.is_active_output)
            nt.links.new(nt.nodes[m["_surf"]].outputs[0], out.inputs["Surface"])
            for nm in ("_bake_emit", "_bake_tgt"):
                nt.nodes.remove(nt.nodes[nm])
        bpy.data.images.remove(tgt)
    px = planes["color"].copy()
    px[:, 3] = planes["alpha"][:, 0]
    img.pixels[:] = px.ravel()
    img.filepath_raw = BAKE_IMG
    img.file_format = "PNG"
    img.save()
    sc.render.engine = old_engine
    mat = bpy.data.materials.get(BAKE_MAT)
    if mat:
        bpy.data.materials.remove(mat)
    mat = bt.material_textured(BAKE_MAT, img, roughness=0.8, alpha_clip=0.5, sheen=0.3)
    for nd in mat.node_tree.nodes:
        if nd.type == "TEX_IMAGE":
            uvn = mat.node_tree.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = "bake"
            mat.node_tree.links.new(uvn.outputs[0], nd.inputs["Vector"])
    for o in objs:
        me = o.data
        for i, m in enumerate(me.materials):
            if m and m.name.startswith("SP_WingFold"):
                me.materials[i] = mat
        # keep only the bake UV (exported as TEXCOORD_0) and drop the projection-only data
        for nm in [u.name for u in me.uv_layers if u.name != "bake"]:
            me.uv_layers.remove(me.uv_layers[nm])
        me.uv_layers["bake"].active_render = True
    return len(cards)


PERCH = "SP_Perch"  # the twig under the feet (s01): exported with the bird as a static, unskinned prop
PERCH_RES = 2048
PERCH_MAT = "SP_Perch_Baked"
PERCH_IMG = {"color": os.path.join(bt.BUILD, "perch_color.png"), "normal": os.path.join(bt.BUILD, "perch_normal.png")}
PERCH_CHUNK = 0.04  # m: the long tubes are cut into UV islands of at most this size so they pack densely


def _perch_bake_uv(ob):
    """'bake' UV for the twig, at true scale in one square atlas: each tube's own unwrap (u round, v along) is
    cut into ~4 cm pieces (by face centre) so the 47 cm stem packs densely; the end caps (triangle fans, no UV
    area in the tube unwrap) get a planar projection of their own; pieces are shelf-packed with padding."""
    me = ob.data
    src = me.uv_layers[0]
    dst = me.uv_layers.get("bake") or me.uv_layers.new(name="bake")
    isl = {}
    for k, faces in enumerate(_islands(me)):
        for fi in faces:
            isl[fi] = k
    co = np.array([v.co[:] for v in me.vertices])
    groups = {}
    for poly in me.polygons:
        c = poly.center
        cell = tuple(int(np.floor(x / PERCH_CHUNK)) for x in c)
        groups.setdefault((isl[poly.index], cell, len(poly.vertices) == 3), []).append(poly)
    pieces = []
    for (_i, _c, cap), polys in groups.items():
        loops = [li for p in polys for li in p.loop_indices]
        vidx = np.array([me.loops[li].vertex_index for li in loops])
        if cap:
            n = np.array(polys[0].normal[:])
            a = np.cross(n, [0.0, 0.0, 1.0] if abs(n[2]) < 0.9 else [1.0, 0.0, 0.0])
            a /= np.linalg.norm(a)
            bb = np.cross(n, a)
            q = np.stack([co[vidx] @ a, co[vidx] @ bb], 1)
        else:
            q = np.array([src.data[li].uv[:] for li in loops], float)
            a3 = sum(p.area for p in polys)
            auv = 0.0
            for p in polys:
                t = np.array([src.data[li].uv[:] for li in p.loop_indices])
                x, y = t[:, 0], t[:, 1]
                auv += 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))
            q = q * np.sqrt(a3 / max(auv, 1e-12))
        q -= q.min(0)
        pieces.append((loops, q, q.max(0) + 1e-6))
    total = sum(w * h for _l, _q, (w, h) in pieces)
    pad = np.sqrt(total) * 0.006
    order = sorted(range(len(pieces)), key=lambda k: -pieces[k][2][1])
    for width in np.sqrt(total) * np.linspace(1.05, 2.0, 40):  # shelf packing; first row width that stays square
        x = y = row_h = 0.0
        place = {}
        for k in order:
            w, h = pieces[k][2]
            if x + w + pad > width and x > 0:
                x, y, row_h = 0.0, y + row_h + pad, 0.0
            place[k] = (x + pad, y + pad)
            x += w + pad
            row_h = max(row_h, h)
        side = max(width, y + row_h + 2 * pad)
        if y + row_h + 2 * pad <= width:
            break
    for k, (loops, q, _wh) in enumerate(pieces):
        uv = (q + np.array(place[k])) / side
        for li, t in zip(loops, uv):
            dst.data[li].uv = t
    me.uv_layers.active = dst
    return len(pieces)


def bake_perch():
    """The twig's bark / bud / wood materials are procedural (noise, voronoi lenticels, lichen) - glTF can't carry
    them. Bake colour (as emission, no lighting) and the tangent-space normal (bark relief) into one atlas and
    give the twig a plain textured material. Skipped when the twig is already baked."""
    ob = bpy.data.objects.get(PERCH)
    if ob is None or any(m and m.name == PERCH_MAT for m in ob.data.materials):
        return 0
    pieces = _perch_bake_uv(ob)
    mats = [m for m in ob.data.materials if m]
    sc = bpy.context.scene
    old_engine = sc.render.engine
    sc.render.engine = "CYCLES"
    sc.cycles.samples = 4
    sc.render.bake.margin = 6
    sc.render.bake.use_clear = True
    imgs = {}
    for chan in ("color", "normal"):
        tgt = bpy.data.images.new("perch_" + chan, PERCH_RES, PERCH_RES, alpha=False, float_buffer=False)
        if chan == "normal":
            tgt.colorspace_settings.name = "Non-Color"
        for m in mats:
            nt = m.node_tree
            if chan == "color":
                out = next(nd for nd in nt.nodes if nd.type == "OUTPUT_MATERIAL" and nd.is_active_output)
                bsdf = out.inputs["Surface"].links[0].from_node
                emi = nt.nodes.new("ShaderNodeEmission")
                emi.name = "_bake_emit"
                inp = bsdf.inputs["Base Color"]
                if inp.links:
                    nt.links.new(inp.links[0].from_socket, emi.inputs["Color"])
                else:
                    emi.inputs["Color"].default_value = tuple(inp.default_value)
                m["_surf"] = bsdf.name
                nt.links.new(emi.outputs[0], out.inputs["Surface"])
            tn = nt.nodes.new("ShaderNodeTexImage")
            tn.name = "_bake_tgt"
            tn.image = tgt
            tn.select = True
            nt.nodes.active = tn
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        ob.hide_render = False
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        if chan == "color":
            bpy.ops.object.bake(type="EMIT")
        else:
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT")
        for m in mats:
            nt = m.node_tree
            if chan == "color":
                out = next(nd for nd in nt.nodes if nd.type == "OUTPUT_MATERIAL" and nd.is_active_output)
                nt.links.new(nt.nodes[m["_surf"]].outputs[0], out.inputs["Surface"])
                nt.nodes.remove(nt.nodes["_bake_emit"])
            nt.nodes.remove(nt.nodes["_bake_tgt"])
        tgt.filepath_raw = PERCH_IMG[chan]
        tgt.file_format = "PNG"
        tgt.save()
        imgs[chan] = tgt
    sc.render.engine = old_engine
    old = bpy.data.materials.get(PERCH_MAT)
    if old:
        bpy.data.materials.remove(old)
    mat = bt.material_textured(PERCH_MAT, imgs["color"], normal_img=imgs["normal"], roughness=0.82, specular=0.35)
    for nd in mat.node_tree.nodes:
        if nd.type == "TEX_IMAGE":
            uvn = mat.node_tree.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = "bake"
            mat.node_tree.links.new(uvn.outputs[0], nd.inputs["Vector"])
    me = ob.data
    me.materials.clear()
    me.materials.append(mat)
    for nm in [u.name for u in me.uv_layers if u.name != "bake"]:
        me.uv_layers.remove(me.uv_layers[nm])
    me.uv_layers["bake"].active_render = True
    me.update()
    return pieces


def _all_tracks(rig):
    """The armature's NLA tracks plus the wing shape-key tracks that mirror them (same names)."""
    out = list(rig.animation_data.nla_tracks)
    for wn in ("SP_Wing_L", "SP_Wing_R"):
        wo = bpy.data.objects.get(wn)
        ks = wo.data.shape_keys if wo is not None else None
        if ks is not None and ks.animation_data:
            out += list(ks.animation_data.nla_tracks)
    return out


def export(path=bt.GLB_PATH):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    rig = bpy.data.objects[sr.RIG]
    ad = rig.animation_data
    ad.action = None
    for tr in _all_tracks(rig):
        tr.mute = False
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for n in BIRD + [sr.RIG] + ([PERCH] if PERCH in bpy.data.objects else []):
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
    # leave the file previewing Call (its sound strip follows that track); Fly is one click away in the NLA
    for tr in _all_tracks(rig):
        # scene left for review: HopForage active; unmute Call (and mute HopForage) to check the call + audio
        tr.mute = tr.name != "HopForage"
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


MOUTH_BONES = ("jaw", "bill_upper", "throat")
NO_MOUTH = ("HopForage", "Fly")  # body clips never key the mouth: the viewer layers Call's mouth tracks over them


def layer_mouth_channels(path=bt.GLB_PATH):
    """The glTF exporter samples every bone in every NLA track: drop the mouth bones from the body clips, so
    the viewer can mix Call's mouth tracks (filtered at runtime) over HopForage / Fly."""
    version, doc, rest = _read_glb(path)
    nodes = doc.get("nodes", [])
    out = {}
    for anim in doc.get("animations", []):
        name = anim.get("name")
        if name not in NO_MOUTH:
            continue
        keep = []
        for ch in anim["channels"]:
            is_mouth = nodes[ch["target"]["node"]].get("name") in MOUTH_BONES
            if not is_mouth:
                keep.append(ch)
        used = sorted({ch["sampler"] for ch in keep})
        remap = {o: i for i, o in enumerate(used)}
        anim["samplers"] = [anim["samplers"][o] for o in used]
        for ch in keep:
            ch["sampler"] = remap[ch["sampler"]]
        anim["channels"] = keep
        out[name] = len(keep)
    _write_glb(path, version, doc, rest)
    return out


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
    baked = bake_feathers()
    perch_pieces = bake_perch()
    path = export()
    inject_clip_extras(path)
    layer_mouth_channels(path)
    import s09_anim
    s09_anim.hide_rig(bpy.data.objects[sr.RIG])
    info = inspect(path)
    info["baked_cards"] = baked
    info["perch_uv_pieces"] = perch_pieces
    return json.dumps(info, ensure_ascii=False, indent=1)
