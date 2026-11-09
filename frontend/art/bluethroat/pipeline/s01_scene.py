"""Step 1: clean scene, units, collections, studio lights, world, camera and a perch twig (not exported)."""
import math

import bpy
import numpy as np
from mathutils import Vector

import btlib as bt

PERCH_R = 0.005


def _studio_world():
    world = bpy.data.worlds.get("BT_World") or bpy.data.worlds.new("BT_World")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    path = bpy.utils.system_resource("DATAFILES", path="studiolights/world/forest.exr")
    try:
        env.image = bpy.data.images.load(path, check_existing=True)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    except Exception:
        bg.inputs["Color"].default_value = (0.42, 0.47, 0.5, 1)
    bg.inputs["Strength"].default_value = 0.3
    nt.links.new(bg.outputs[0], out.inputs["Surface"])


def _area_light(name, loc, target, power, size, color):
    bt.remove_object(name)
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "DISK"  # round catchlights in the eye, like a softbox / the sun in the photos
    ld.energy = power
    ld.size = size
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bt.link(ob, bt.COLL_STUDIO)
    return ob


def _perch():
    """Short curved twig under the feet; preview only, it lives in BT_Studio and is not exported."""
    n_len, n_rad = 90, 20
    xs = np.linspace(-0.11, 0.11, n_len)
    # clean cylinder (r = PERCH_R, top at z = 0) where the feet grip, natural twig further out
    wild = np.clip((np.abs(xs) - 0.048) / 0.035, 0, 1)  # the walk in WalkSing stays within +-45 mm
    wild = wild * wild * (3 - 2 * wild)
    radius = PERCH_R * (1.0 + 0.18 * np.cos(xs * 31.0) * wild) * (1.0 - 0.25 * (xs / 0.11) ** 2 * wild)
    sag = (-0.012 * (xs / 0.11) ** 2 + 0.003 * np.sin(xs * 22.0)) * wild
    verts, faces, uvs = [], [], []
    for i, x in enumerate(xs):
        for j in range(n_rad):
            a = 2 * math.pi * j / n_rad
            r = radius[i] * (1.0 + 0.06 * math.sin(7 * a + 13 * x) * wild[i])
            verts.append((x, 0.0012 * math.sin(x * 40) * wild[i] + r * math.cos(a), sag[i] + r * math.sin(a) - PERCH_R))
    for i in range(n_len - 1):
        for j in range(n_rad):
            a, b = i * n_rad + j, i * n_rad + (j + 1) % n_rad
            faces.append((a, b, b + n_rad, a + n_rad))
    ob = bt.mesh_object("BT_Perch", np.array(verts), faces, coll_name=bt.COLL_STUDIO)
    mat, nt, bsdf = bt.new_material("BT_Perch_Bark")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 900.0
    noise.inputs["Detail"].default_value = 8.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.10, 0.075, 0.055, 1)
    ramp.color_ramp.elements[1].color = (0.36, 0.31, 0.26, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bt.sock(bsdf, "Base Color"))
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bt.sock(bsdf, "Normal"))
    bt.sock(bsdf, "Roughness").default_value = 0.85
    bt.assign(ob, mat)
    return ob


def run():
    scene = bpy.context.scene
    for name in ("Cube", "Light", "Camera"):
        bt.remove_object(name)

    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "CENTIMETERS"
    scene.render.fps = 30
    scene.frame_start, scene.frame_end = 1, 60

    bt.collection(bt.COLL_BIRD)
    bt.collection(bt.COLL_REFS)
    bt.collection(bt.COLL_STUDIO)

    _studio_world()
    center = (0.0, 0.0, 0.065)
    _area_light("BT_Key", (-0.85, -1.0, 1.1), center, 60.0, 0.9, (1.0, 0.95, 0.88))
    _area_light("BT_Fill", (1.1, -0.65, 0.42), center, 14.0, 1.2, (0.86, 0.92, 1.0))
    _area_light("BT_Rim", (0.3, 1.1, 0.8), center, 40.0, 0.7, (1.0, 0.97, 0.92))

    bt.remove_object("BT_Camera")
    cam = bpy.data.cameras.new("BT_Camera")
    cam.lens = 85
    cam.display_size = 0.04
    cam.clip_start = 0.005
    cob = bpy.data.objects.new("BT_Camera", cam)
    cob.location = (0.25, -0.40, 0.13)
    cob.rotation_euler = (Vector(center) - cob.location).to_track_quat("-Z", "Y").to_euler()
    bt.link(cob, bt.COLL_STUDIO)
    scene.camera = cob
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200

    _perch()
    bt.frame_view(center, 0.36, elev_deg=8, azim_deg=-30, lens=60, shading="MATERIAL")
    return "scene ready"
