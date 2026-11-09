"""Shared helpers for the Eurasian tree sparrow build scripts (same toolkit as the bluethroat's btlib). Runs inside Blender (bpy + numpy).

Conventions: metres, Z up, the bird faces -Y (exports as +Z forward in glTF), its left is +X.
The origin sits on the ground between the feet (the reference bird stands on a flat wall top).
"""
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

# frontend/art/sparrow: sources/ in, textures/ + build/ + sparrow.blend + public assets out
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "sources")
PHOTOS = os.path.join(SOURCES, "photos")
FEATHER_SCANS = os.path.join(SOURCES, "feathers")
AUDIO_SOURCES = os.path.join(SOURCES, "audio")
TEX = os.path.join(ROOT, "textures")
BUILD = os.path.join(ROOT, "build")  # intermediate data, git-ignored
DEBUG = os.path.join(BUILD, "debug")
BLEND_PATH = os.path.join(ROOT, "sparrow.blend")
PUBLIC = os.path.normpath(os.path.join(ROOT, "..", "..", "public"))
GLB_PATH = os.path.join(PUBLIC, "models", "sparrow.glb")
SONG_WAV = os.path.join(PUBLIC, "audio", "birds", "sparrow", "tree-sparrow-call-01.wav")  # house sparrow clips live there too

MM = 0.001

COLL_BIRD = "SP_Bird"
COLL_REFS = "SP_Refs"
COLL_STUDIO = "SP_Studio"

for _d in (TEX, BUILD, DEBUG):
    os.makedirs(_d, exist_ok=True)


# --------------------------------------------------------------------------- collections


def collection(name, parent=None):
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    parent = parent or bpy.context.scene.collection
    if coll.name not in parent.children and coll is not parent:
        try:
            parent.children.link(coll)
        except RuntimeError:
            pass
    return coll


def remove_object(name):
    ob = bpy.data.objects.get(name)
    if ob is None:
        return
    data = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    if data is None or data.users > 0:
        return
    pools = (
        (bpy.types.Mesh, bpy.data.meshes),
        (bpy.types.Armature, bpy.data.armatures),
        (bpy.types.Curve, bpy.data.curves),
        (bpy.types.Light, bpy.data.lights),
        (bpy.types.Camera, bpy.data.cameras),
    )
    for typ, pool in pools:
        if isinstance(data, typ):
            pool.remove(data)
            break


def clear_collection(name):
    coll = bpy.data.collections.get(name)
    if coll is None:
        return
    for ob in list(coll.objects):
        remove_object(ob.name)


def link(ob, coll_name):
    coll = collection(coll_name)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)
    return ob


# --------------------------------------------------------------------------- meshes


def mesh_object(name, verts, faces, coll_name=COLL_BIRD, uvs=None, smooth=True, uv_name="UVMap"):
    """Create (or replace) a mesh object from numpy data.

    verts: (N,3) float; faces: list of index tuples (quads/tris mixed ok);
    uvs: optional per-loop array (L,2) in face order.
    """
    remove_object(name)
    me = bpy.data.meshes.new(name)
    verts = np.asarray(verts, dtype=np.float64)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.astype(np.float32).ravel())
    sizes = np.array([len(f) for f in faces], dtype=np.int32)
    starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.int32)
    flat = np.fromiter((i for f in faces for i in f), dtype=np.int32, count=int(sizes.sum()))
    me.loops.add(len(flat))
    me.loops.foreach_set("vertex_index", flat)
    me.polygons.add(len(faces))
    me.polygons.foreach_set("loop_start", starts)
    me.polygons.foreach_set("loop_total", sizes)
    if uvs is not None:
        uv = me.uv_layers.new(name=uv_name)
        uv.data.foreach_set("uv", np.asarray(uvs, dtype=np.float32).ravel())
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if smooth:
        me.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
    ob = bpy.data.objects.new(name, me)
    collection(coll_name).objects.link(ob)
    return ob


def object_verts(ob, world=False):
    me = ob.data
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3).astype(np.float64)
    if world:
        m = np.array(ob.matrix_world)
        co = co @ m[:3, :3].T + m[:3, 3]
    return co


def set_object_verts(ob, co):
    ob.data.vertices.foreach_set("co", np.asarray(co, dtype=np.float32).ravel())
    ob.data.update()


# --------------------------------------------------------------------------- images


def load_image(path, name=None, colorspace=None):
    img = bpy.data.images.load(path, check_existing=True)
    if name:
        img.name = name
    if colorspace:
        img.colorspace_settings.name = colorspace
    return img


def image_np(img):
    """Pixels as (H, W, 4) float32, row 0 = bottom (Blender convention)."""
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def np_image(arr, name, path=None, colorspace="sRGB"):
    """Write (H, W, 3|4) float array (row 0 = bottom) into a Blender image, optionally saving a PNG."""
    arr = np.asarray(arr, dtype=np.float32)
    if arr.shape[2] == 3:
        arr = np.concatenate([arr, np.ones(arr.shape[:2] + (1,), np.float32)], axis=2)
    h, w = arr.shape[:2]
    img = bpy.data.images.get(name)
    if img is not None and tuple(img.size) != (w, h):
        bpy.data.images.remove(img)
        img = None
    if img is None:
        img = bpy.data.images.new(name, w, h, alpha=True)
    img.colorspace_settings.name = colorspace
    img.alpha_mode = "STRAIGHT"
    img.pixels.foreach_set(np.clip(arr, 0, 1).ravel())
    img.update()
    if path:
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        img.filepath = path
        img.source = "FILE"
        img.reload()
        img.colorspace_settings.name = colorspace
    return img


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)])


# --------------------------------------------------------------------------- materials


def _node(nt, type_name):
    return next((n for n in nt.nodes if n.type == type_name), None)


def sock(node, ident):
    for s in node.inputs:
        if s.identifier == ident or s.name == ident:
            return s
    raise KeyError(ident)


def new_material(name):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (250, 0)
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return mat, nt, bsdf


def tex_node(nt, img, loc, non_color=False, interp="Linear"):
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    n.location = loc
    n.interpolation = interp
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return n


def material_textured(
    name,
    base_img,
    normal_img=None,
    rough_img=None,
    roughness=0.7,
    normal_strength=1.0,
    alpha_clip=None,
    vertex_color=None,
    sheen=0.0,
    sheen_tint=(1, 1, 1),
    specular=0.5,
    coat=0.0,
    double_sided=True,
    alpha_blend=False,
):
    """glTF-exportable Principled material.

    alpha_clip: cutoff (e.g. 0.5) -> Texture.Alpha -> Math(GREATER_THAN) -> Alpha => glTF MASK.
    alpha_blend: Texture.Alpha -> Alpha directly => glTF BLEND (soft, sorted per object in three.js).
    vertex_color: name of a color attribute multiplied into base color (exported as COLOR_0).
    """
    mat, nt, bsdf = new_material(name)
    base = tex_node(nt, base_img, (-600, 200))
    col_out = base.outputs["Color"]
    if vertex_color:
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = vertex_color
        attr.location = (-600, 450)
        mul = nt.nodes.new("ShaderNodeMix")
        mul.data_type = "RGBA"
        mul.blend_type = "MULTIPLY"
        mul.location = (-250, 300)
        sock(mul, "Factor_Float").default_value = 1.0
        nt.links.new(col_out, mul.inputs[6])
        nt.links.new(attr.outputs["Color"], mul.inputs[7])
        col_out = mul.outputs[2]
    nt.links.new(col_out, sock(bsdf, "Base Color"))
    if alpha_clip is not None:
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = alpha_clip
        gt.location = (-250, 0)
        nt.links.new(base.outputs["Alpha"], gt.inputs[0])
        nt.links.new(gt.outputs[0], sock(bsdf, "Alpha"))
        mat.surface_render_method = "DITHERED"
    elif alpha_blend:
        nt.links.new(base.outputs["Alpha"], sock(bsdf, "Alpha"))
        mat.surface_render_method = "DITHERED"
    if rough_img is not None:
        r = tex_node(nt, rough_img, (-600, -150), non_color=True)
        nt.links.new(r.outputs["Color"], sock(bsdf, "Roughness"))
    else:
        sock(bsdf, "Roughness").default_value = roughness
    if normal_img is not None:
        n = tex_node(nt, normal_img, (-600, -450), non_color=True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.location = (-250, -400)
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], sock(bsdf, "Normal"))
    sock(bsdf, "Specular IOR Level").default_value = specular
    if sheen > 0:
        sock(bsdf, "Sheen Weight").default_value = sheen
        sock(bsdf, "Sheen Tint").default_value = (*sheen_tint, 1)
        sock(bsdf, "Sheen Roughness").default_value = 0.4
    if coat > 0:
        sock(bsdf, "Coat Weight").default_value = coat
        sock(bsdf, "Coat Roughness").default_value = 0.08
    mat.use_backface_culling = not double_sided
    return mat


def material_flat(name, color, roughness=0.5, specular=0.5, coat=0.0, metallic=0.0, double_sided=False):
    mat, nt, bsdf = new_material(name)
    sock(bsdf, "Base Color").default_value = (*color, 1)
    sock(bsdf, "Roughness").default_value = roughness
    sock(bsdf, "Specular IOR Level").default_value = specular
    sock(bsdf, "Metallic").default_value = metallic
    if coat > 0:
        sock(bsdf, "Coat Weight").default_value = coat
        sock(bsdf, "Coat Roughness").default_value = 0.05
    mat.use_backface_culling = not double_sided
    return mat


def white_image():
    """4x4 white texture so vertex-colour-only materials export as texture x COLOR_0."""
    path = os.path.join(TEX, "white.png")
    return np_image(np.ones((4, 4, 4), np.float32), "SP_White", path=path)


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


# --------------------------------------------------------------------------- viewport


def view3d():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                space = area.spaces.active
                return area, space, space.region_3d
    return None, None, None


def frame_view(center, distance, elev_deg=10.0, azim_deg=-35.0, lens=60.0, shading=None):
    """azim 0 = looking at the bird's face from the front (-Y side); positive azim orbits to the bird's left (+X)."""
    area, space, r3d = view3d()
    if area is None:
        return
    r3d.view_perspective = "PERSP"
    r3d.view_location = Vector(center)
    r3d.view_distance = distance
    r3d.view_rotation = Euler((math.radians(90.0 - elev_deg), 0.0, math.radians(azim_deg)), "XYZ").to_quaternion()
    space.lens = lens
    space.clip_start = 0.0005
    space.clip_end = 50.0
    if shading:
        space.shading.type = shading
    redraw()


def side_view(center=(0.0, 0.01, 0.055), distance=0.16, side="RIGHT", shading=None):
    """Orthographic side view. RIGHT looks from +X (bird faces screen-left, like the traced photo)."""
    area, space, r3d = view3d()
    if area is None:
        return
    r3d.view_perspective = "ORTHO"
    z = 90 if side == "RIGHT" else -90
    r3d.view_rotation = Euler((math.radians(90), 0, math.radians(z)), "XYZ").to_quaternion()
    r3d.view_location = Vector(center)
    r3d.view_distance = distance
    if shading:
        space.shading.type = shading
    redraw()


def redraw():
    for win in bpy.context.window_manager.windows:
        for area in win.screen.areas:
            area.tag_redraw()
    try:
        bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=1)
    except Exception:
        pass


# --------------------------------------------------------------------------- 2D curves


def catmull_rom(points, samples_per_seg=24, closed=False, alpha=0.5):
    """Centripetal Catmull-Rom through 2D/3D points; returns dense polyline."""
    p = np.asarray(points, dtype=np.float64)
    if closed:
        p = np.vstack([p[-1], p, p[0], p[1]])
    else:
        p = np.vstack([2 * p[0] - p[1], p, 2 * p[-1] - p[-2]])
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-9) ** alpha
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-9) ** alpha
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-9) ** alpha
        ts = np.linspace(t1, t2, samples_per_seg, endpoint=False)[:, None]
        a1 = (t1 - ts) / (t1 - t0) * p0 + (ts - t0) / (t1 - t0) * p1
        a2 = (t2 - ts) / (t2 - t1) * p1 + (ts - t1) / (t2 - t1) * p2
        a3 = (t3 - ts) / (t3 - t2) * p2 + (ts - t2) / (t3 - t2) * p3
        b1 = (t2 - ts) / (t2 - t0) * a1 + (ts - t0) / (t2 - t0) * a2
        b2 = (t3 - ts) / (t3 - t1) * a2 + (ts - t1) / (t3 - t1) * a3
        out.append((t2 - ts) / (t2 - t1) * b1 + (ts - t1) / (t2 - t1) * b2)
    out.append(p[-2][None, :] if not closed else p[1][None, :])
    return np.vstack(out)


def arclength(poly):
    d = np.linalg.norm(np.diff(poly, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(d)])


def resample(poly, n):
    """Resample polyline at n points equally spaced by arc length."""
    s = arclength(poly)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, poly[:, k]) for k in range(poly.shape[1])], axis=1)


def sample_at(poly, u):
    """Points at normalized arc-length positions u (array in [0,1])."""
    s = arclength(poly)
    t = np.asarray(u) * s[-1]
    return np.stack([np.interp(t, s, poly[:, k]) for k in range(poly.shape[1])], axis=-1)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def rmf_frames(path):
    """Rotation-minimizing frames (T, N, B) along a 3D polyline."""
    path = np.asarray(path, dtype=np.float64)
    n = len(path)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    a = np.array([0.0, 0.0, 1.0]) if abs(T[0][2]) < 0.9 else np.array([1.0, 0.0, 0.0])
    N = [np.cross(T[0], a)]
    N[0] /= np.linalg.norm(N[0])
    for i in range(1, n):
        v1 = path[i] - path[i - 1]
        c1 = v1 @ v1
        if c1 < 1e-20:
            N.append(N[-1])
            continue
        rL = N[-1] - (2 / c1) * (v1 @ N[-1]) * v1
        tL = T[i - 1] - (2 / c1) * (v1 @ T[i - 1]) * v1
        v2 = T[i] - tL
        c2 = v2 @ v2
        r = rL - (2 / c2) * (v2 @ rL) * v2 if c2 > 1e-20 else rL
        N.append(r / np.linalg.norm(r))
    N = np.array(N)
    B = np.cross(T, N)
    return T, N, B


def tube(path, radii, segs=10, squash=(1.0, 1.0), up=None, caps=True):
    """Tube mesh data along a 3D polyline. radii: per-point radius. squash scales (N, B) axes.

    up: optional vector; frames are rotated so N points as close as possible to it.
    Returns verts, faces, uvs (per loop).
    """
    path = np.asarray(path, dtype=np.float64)
    radii = np.broadcast_to(np.asarray(radii, dtype=np.float64), (len(path),))
    T, N, B = rmf_frames(path)
    if up is not None:
        up = np.asarray(up, float)
        for i in range(len(path)):
            u = up - (up @ T[i]) * T[i]
            if np.linalg.norm(u) > 1e-9:
                u /= np.linalg.norm(u)
                N[i] = u
                B[i] = np.cross(T[i], u)
    ang = np.linspace(0, 2 * math.pi, segs, endpoint=False)
    verts = []
    for i in range(len(path)):
        for a in ang:
            verts.append(path[i] + radii[i] * (math.cos(a) * squash[0] * N[i] + math.sin(a) * squash[1] * B[i]))
    faces, uvs = [], []
    L = arclength(path)
    vv = L / max(L[-1], 1e-12)
    for i in range(len(path) - 1):
        for j in range(segs):
            a, b = i * segs + j, i * segs + (j + 1) % segs
            c, d = (i + 1) * segs + (j + 1) % segs, (i + 1) * segs + j
            faces.append((a, b, c, d))
            u0, u1 = j / segs, (j + 1) / segs
            uvs += [(u0, vv[i]), (u1, vv[i]), (u1, vv[i + 1]), (u0, vv[i + 1])]
    verts = np.array(verts)
    if caps:
        c0 = len(verts)
        verts = np.vstack([verts, path[0], path[-1]])
        last = (len(path) - 1) * segs
        for j in range(segs):
            faces.append((c0, (j + 1) % segs, j))
            uvs += [(0.5, 0.0), ((j + 1) / segs, 0.0), (j / segs, 0.0)]
            faces.append((c0 + 1, last + j, last + (j + 1) % segs))
            uvs += [(0.5, 1.0), (j / segs, 1.0), ((j + 1) / segs, 1.0)]
    return verts, faces, uvs


def merge_parts(parts):
    """Concatenate several (verts, faces, uvs) tuples into one."""
    V, F, U = [], [], []
    off = 0
    for v, f, u in parts:
        V.append(np.asarray(v))
        F.extend(tuple(i + off for i in face) for face in f)
        U.extend(u)
        off += len(v)
    return np.vstack(V), F, U


def report(msg):
    print(msg)
    return msg
