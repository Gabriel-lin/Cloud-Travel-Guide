"""Step 1: clean scene, units, collections, studio lights, world, camera and the perch twig (exported with the bird by s10)."""
import math

import bpy
import numpy as np
from mathutils import Vector

import splib as bt

import spshape as bs

PERCH_R = bs.PERCH_R


def _studio_world():
    world = bpy.data.worlds.get("SP_World") or bpy.data.worlds.new("SP_World")
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


def _twig_part(path, radii, rng, segs=14, ridge=0.06, noise=0.05, cm_u=True):
    """One bark-covered branch segment: tube along `path` with longitudinal ridges and fine radial noise; UVs in
    centimetres (u around, v along) so the bark texture keeps its scale on thick and thin twigs alike."""
    v, f, uv = bt.tube(path, radii, segs=segs, caps=True)
    n = len(path)
    ctr = np.repeat(np.asarray(path), segs, axis=0)
    ring = v[: n * segs]
    rad = ring - ctr
    ang = np.tile(np.arange(segs) / segs * 2 * math.pi, n)
    t = np.repeat(np.linspace(0, 1, n), segs)
    ph = rng.random() * 6.0
    k = 1.0 + ridge * np.sin(ang * 5 + ph + 3.0 * t) * (0.6 + 0.4 * np.sin(t * 17 + ang * 2)) + noise * (rng.random(len(ang)) - 0.5)
    ring = ctr + rad * k[:, None]
    v[: n * segs] = ring
    L = float(np.sum(np.linalg.norm(np.diff(path, axis=0), axis=1)))
    circ = 2 * math.pi * float(np.mean(radii))
    uv = [(u * circ * 100.0, vv * L * 100.0) for u, vv in uv]
    return v, f, uv


def _bud(base, axis, length, rng, width=None, terminal=False):
    """Winter bud: ovoid, pointed, its scales overlapping (a slight bulge), ~3-4 mm long on a twig this size."""
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    q = np.linspace(0.0, 1.0, 9)
    bp = np.array([base + axis * length * t for t in q])
    prof = np.array([0.80, 0.95, 1.0, 1.0, 0.94, 0.80, 0.58, 0.30, 0.03])  # widest in the lower third, acute tip
    if terminal:  # sits on the shoot end and swallows it
        prof = np.array([0.92, 1.0, 1.08, 1.1, 1.04, 0.88, 0.62, 0.32, 0.03])
    br = (width if width is not None else length * 0.36) * prof * (1.0 + 0.04 * (rng.random(len(q)) - 0.5))
    return bt.tube(bp, br, segs=10, caps=True)


def _perch():
    """Natural twig under the feet: a winter twig of a hedgerow / orchard shrub (hawthorn, apple, elm - where
    Eurasian tree sparrows rest and feed); it lives in SP_Studio and s10 bakes and exports it with the bird. The stem's top
    is at z = 0 and its axis runs along X through y = PERCH_Y, where the feet grip (the toes in s04 wrap around
    radius PERCH_R). The base (thick, older wood) is at -x, the growing tip at +x: real twigs taper toward the
    tip, carry alternate buds every ~2 cm (2/5 phyllotaxis), side shoots leave the stem at 35-55 deg pointing
    toward the tip, and the stem kinks slightly at each node (sympodial zig-zag). Young bark is smooth with pale
    lenticels; lichen only on the older wood."""
    R, YC = bs.PERCH_R, bs.PERCH_Y
    rng = np.random.default_rng(11)
    X0, X1 = -0.30, 0.172  # base runs out of frame; the tip ends in a terminal bud
    xs = np.linspace(X0, X1, 300)
    grip = 0.035  # |x| < grip stays straight and round (toes in s04 wrap PERCH_R there)
    wild = np.clip((np.abs(xs) - grip) / 0.05, 0, 1)
    wild = wild * wild * (3 - 2 * wild)
    node_x = np.array([-0.262, -0.236, -0.205, -0.181, -0.152, -0.128, -0.101, -0.078, -0.054,
                       0.047, 0.069, 0.090, 0.112, 0.133, 0.152])  # nodes (buds / shoots), internodes ~2.2 cm
    # sympodial zig-zag: the axis turns a few degrees at each node, alternately, plus a gentle overall bow
    zig = np.zeros_like(xs)
    for k, nx in enumerate(node_x):
        zig += (1 if k % 2 else -1) * 0.0011 * np.clip(1.0 - np.abs(xs - nx) / 0.022, 0, 1)
    y_c = YC + wild * (zig + 0.0012 * np.sin(xs * 21 + 0.6))
    z_c = -R + wild * (-0.016 * (np.minimum(xs, 0) / 0.30) ** 2 - 0.006 * (np.maximum(xs, 0) / 0.17) ** 2 + 0.0008 * np.sin(xs * 47 + 1.3))
    taper = 1.0 - 0.34 * (xs / 0.15)  # 1.0 at the grip; ~11 mm across at the base, ~4.5 mm at x = 0.15
    tipf = np.clip((xs - 0.120) / (X1 - 0.120), 0, 1)
    taper = taper * (1.0 - 0.55 * tipf ** 1.4)  # the current-year shoot narrows to ~2 mm under the terminal bud
    swell = sum(0.12 * np.exp(-((xs - nx) / 0.0035) ** 2) for nx in node_x)  # nodes are slightly swollen
    radius = R * taper * (1.0 + swell * wild) * (1.0 + 0.025 * np.sin(xs * 80) * wild)
    path = np.stack([xs, y_c, z_c], 1)
    parts, kind = [], []

    def add(part, k):
        parts.append(part)
        kind.extend([k] * len(part[1]))

    stem = _twig_part(path, radius, rng, segs=28, ridge=0.025, noise=0.02)
    parts.append(stem)
    kind.extend([2 if len(f) == 3 and f[0] == len(stem[0]) - 2 else 0 for f in stem[1]])  # the sawn base (first cap fan) shows pale wood

    def frame_at(i):
        tang = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
        tang /= np.linalg.norm(tang)
        a = np.cross(tang, [0.0, 0.0, 1.0])
        a /= np.linalg.norm(a)
        return tang, a, np.cross(a, tang)

    # side shoots: (node x, angle round the stem deg (0 = +y side, 90 = up), angle from the stem deg, length m)
    side = [(-0.236, 40, 48, 0.085), (-0.181, -25, 40, 0.060), (-0.128, 150, 52, 0.072),
            (-0.078, -165, 45, 0.034), (0.069, -150, 50, 0.048), (0.112, 30, 38, 0.064), (0.152, -20, 44, 0.030)]
    for nx, rot, ang, ln in side:
        i0 = int(np.argmin(np.abs(xs - nx)))
        tang, ay, az = frame_at(i0)
        rad = math.cos(math.radians(rot)) * ay + math.sin(math.radians(rot)) * az
        d = math.cos(math.radians(ang)) * tang + math.sin(math.radians(ang)) * rad
        n = 24
        pts = [path[i0] - d * radius[i0] * 0.2]  # starts inside the stem so its end cap stays hidden
        dd = d.copy()
        for k in range(1, n):
            f = k / (n - 1)
            # shoots curve up toward the light, then the thin end sags a little
            dd = dd + np.array([0.0, 0.0, 0.022 * (1 - f) - 0.012 * f]) + 0.03 * (rng.random(3) - 0.5)
            dd /= np.linalg.norm(dd)
            pts.append(pts[-1] + dd * ln / (n - 1))
        pts = np.array(pts)
        r0 = radius[i0] * 0.52 * min(1.0, (ln / 0.07) ** 0.5)  # side shoot ~half the parent's radius
        tt = np.linspace(0, 1, n)
        rr = r0 * (1.0 - 0.45 * tt ** 0.9) * (1.0 + 0.5 * np.exp(-tt * 15))  # branch collar at the base
        add(_twig_part(pts, rr, rng, segs=10, ridge=0.02, noise=0.02), 0)
        # alternate lateral buds along the shoot and a terminal bud
        for kq, fk in enumerate((0.30, 0.55, 0.78)):
            if ln < 0.04 and fk > 0.5:
                continue
            j = int(fk * (n - 1))
            t2 = pts[j + 1] - pts[j - 1]
            t2 /= np.linalg.norm(t2)
            sv = np.cross(t2, [0.0, 0.0, 1.0])
            sv /= np.linalg.norm(sv) + 1e-9
            sv = sv * (1 if kq % 2 else -1) + np.array([0.0, 0.0, 0.35])
            sv -= (sv @ t2) * t2
            sv /= np.linalg.norm(sv)
            out = 0.86 * t2 + 0.5 * sv  # buds lie ~30 deg off the shoot, pointing to its tip
            add(_bud(pts[j] + sv * rr[j] * 0.7, out, 0.0026 + 0.0006 * rng.random(), rng), 1)
        tl = pts[-1] - pts[-2]
        seg = float(np.linalg.norm(tl))
        add(_bud(pts[-2], tl, max(0.0040, 1.7 * seg), rng, width=rr[-1] * 1.15, terminal=True), 1)  # terminal bud as wide as the shoot tip
    # lateral buds on the stem: one per node not carrying a shoot, round the stem by 144 deg (2/5 phyllotaxis)
    shoot_x = {sx for sx, *_ in side}
    for k, nx in enumerate(node_x):
        if nx in shoot_x:
            continue
        i0 = int(np.argmin(np.abs(xs - nx)))
        tang, ay, az = frame_at(i0)
        rot = math.radians(90 + 144 * k)
        rad = math.cos(rot) * ay + math.sin(rot) * az
        if rad[2] < -0.6:  # skip buds straight underneath (hidden, and the shoot below the node usually aborted)
            rad = math.cos(rot + 1.2) * ay + math.sin(rot + 1.2) * az
        out = 0.85 * tang + 0.52 * rad
        bl = 0.0030 + 0.0008 * rng.random() if nx < 0.12 else 0.0035
        add(_bud(path[i0] + rad * radius[i0] * 0.75, out, bl, rng), 1)
    # terminal bud at the growing tip (the largest bud)
    add(_bud(path[-3], path[-1] - path[-3], 0.0050, rng, width=radius[-1] * 1.1, terminal=True), 1)
    V, F, U = bt.merge_parts(parts)
    ob = bt.mesh_object("SP_Perch", V, F, coll_name=bt.COLL_STUDIO, uvs=U)
    bark, nt, bsdf = bt.new_material("SP_Perch_Bark")
    uvn = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.1, 0.26, 1.0)  # faint bark striation runs along the twig
    nt.links.new(uvn.outputs["UV"], mp.inputs["Vector"])
    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 14.0
    n1.inputs["Detail"].default_value = 9.0
    n1.inputs["Roughness"].default_value = 0.62
    nt.links.new(mp.outputs["Vector"], n1.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")  # grey-brown young bark (not dark fissured trunk bark)
    ramp.color_ramp.elements[0].position = 0.30
    ramp.color_ramp.elements[0].color = (0.050, 0.039, 0.030, 1)
    ramp.color_ramp.elements[1].position = 0.72
    ramp.color_ramp.elements[1].color = (0.155, 0.122, 0.094, 1)
    nt.links.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    # lenticels: small pale dots, elongated round the twig (u = around, v = along, both in cm)
    mpl = nt.nodes.new("ShaderNodeMapping")
    mpl.inputs["Scale"].default_value = (5.0, 13.0, 1.0)
    nt.links.new(uvn.outputs["UV"], mpl.inputs["Vector"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 1.0
    vor.inputs["Randomness"].default_value = 1.0
    nt.links.new(mpl.outputs["Vector"], vor.inputs["Vector"])
    lent = nt.nodes.new("ShaderNodeValToRGB")
    lent.color_ramp.elements[0].position = 0.10
    lent.color_ramp.elements[0].color = (1, 1, 1, 1)
    lent.color_ramp.elements[1].position = 0.17
    lent.color_ramp.elements[1].color = (0, 0, 0, 1)
    nt.links.new(vor.outputs["Distance"], lent.inputs["Fac"])
    mixl = nt.nodes.new("ShaderNodeMix")
    mixl.data_type = "RGBA"
    mixl.inputs[7].default_value = (0.25, 0.21, 0.16, 1)  # pale buff lenticel
    nt.links.new(ramp.outputs["Color"], mixl.inputs[6])
    sl = nt.nodes.new("ShaderNodeMath")
    sl.operation = "MULTIPLY"
    sl.inputs[1].default_value = 0.6
    nt.links.new(lent.outputs["Color"], sl.inputs[0])
    nt.links.new(sl.outputs[0], mixl.inputs[0])
    # lichen (grey-green Physcia / a little yellow Xanthoria) in patches, only on the older wood (x < -0.05)
    n2 = nt.nodes.new("ShaderNodeTexNoise")
    n2.inputs["Scale"].default_value = 1.8
    n2.inputs["Detail"].default_value = 6.0
    mp2 = nt.nodes.new("ShaderNodeMapping")
    mp2.inputs["Scale"].default_value = (1.0, 0.5, 1.0)
    nt.links.new(uvn.outputs["UV"], mp2.inputs["Vector"])
    nt.links.new(mp2.outputs["Vector"], n2.inputs["Vector"])
    lich = nt.nodes.new("ShaderNodeValToRGB")
    lich.color_ramp.elements[0].position = 0.56
    lich.color_ramp.elements[0].color = (0, 0, 0, 1)
    lich.color_ramp.elements[1].position = 0.66
    lich.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(n2.outputs["Fac"], lich.inputs["Fac"])
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(uvn.outputs["Object"], sep.inputs[0])
    age = nt.nodes.new("ShaderNodeMapRange")
    age.inputs["From Min"].default_value = -0.05
    age.inputs["From Max"].default_value = -0.20
    nt.links.new(sep.outputs["X"], age.inputs["Value"])
    lm = nt.nodes.new("ShaderNodeMath")
    lm.operation = "MULTIPLY"
    nt.links.new(lich.outputs["Color"], lm.inputs[0])
    nt.links.new(age.outputs["Result"], lm.inputs[1])
    lm2 = nt.nodes.new("ShaderNodeMath")
    lm2.operation = "MULTIPLY"
    lm2.inputs[1].default_value = 0.75
    nt.links.new(lm.outputs[0], lm2.inputs[0])
    n3 = nt.nodes.new("ShaderNodeTexNoise")  # which patches are yellow
    n3.inputs["Scale"].default_value = 3.0
    nt.links.new(mp2.outputs["Vector"], n3.inputs["Vector"])
    ycol = nt.nodes.new("ShaderNodeValToRGB")
    ycol.color_ramp.elements[0].position = 0.62
    ycol.color_ramp.elements[0].color = (0.30, 0.32, 0.25, 1)  # grey-green
    ycol.color_ramp.elements[1].position = 0.70
    ycol.color_ramp.elements[1].color = (0.42, 0.30, 0.06, 1)  # orange-yellow
    nt.links.new(n3.outputs["Fac"], ycol.inputs["Fac"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(mixl.outputs[2], mix.inputs[6])
    nt.links.new(ycol.outputs["Color"], mix.inputs[7])
    nt.links.new(lm2.outputs[0], mix.inputs[0])
    nt.links.new(mix.outputs[2], bt.sock(bsdf, "Base Color"))
    hsum = nt.nodes.new("ShaderNodeMath")  # bump: fine striation, raised lenticels, lichen crust
    hsum.operation = "MULTIPLY_ADD"
    hsum.inputs[1].default_value = 0.5
    nt.links.new(lent.outputs["Color"], hsum.inputs[0])
    nt.links.new(n1.outputs["Fac"], hsum.inputs[2])
    hs2 = nt.nodes.new("ShaderNodeMath")
    hs2.operation = "ADD"
    nt.links.new(hsum.outputs[0], hs2.inputs[0])
    nt.links.new(lm2.outputs[0], hs2.inputs[1])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    bump.inputs["Distance"].default_value = 0.0004
    nt.links.new(hs2.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bt.sock(bsdf, "Normal"))
    rgh = nt.nodes.new("ShaderNodeMapRange")  # young bark has a faint sheen; lichen is dead matte
    rgh.inputs["To Min"].default_value = 0.72
    rgh.inputs["To Max"].default_value = 0.95
    nt.links.new(lm2.outputs[0], rgh.inputs["Value"])
    nt.links.new(rgh.outputs["Result"], bt.sock(bsdf, "Roughness"))
    bud, _nt, _b = bt.new_material("SP_Perch_Bud")
    bud_nt = bud.node_tree
    bsd = [n for n in bud_nt.nodes if n.type == "BSDF_PRINCIPLED"][0]
    bn = bud_nt.nodes.new("ShaderNodeTexNoise")  # bud scales: darker edges, reddish-brown
    bn.inputs["Scale"].default_value = 900.0
    bn.inputs["Detail"].default_value = 3.0
    br_ = bud_nt.nodes.new("ShaderNodeValToRGB")
    br_.color_ramp.elements[0].position = 0.35
    br_.color_ramp.elements[0].color = (0.07, 0.025, 0.015, 1)
    br_.color_ramp.elements[1].position = 0.70
    br_.color_ramp.elements[1].color = (0.22, 0.085, 0.040, 1)
    bud_nt.links.new(bn.outputs["Fac"], br_.inputs["Fac"])
    bud_nt.links.new(br_.outputs["Color"], bt.sock(bsd, "Base Color"))
    bt.sock(bsd, "Roughness").default_value = 0.45
    wood, _nt2, wb = bt.new_material("SP_Perch_Wood")  # sawn end: pale sapwood, darker pith
    bt.sock(wb, "Base Color").default_value = (0.42, 0.33, 0.22, 1)
    bt.sock(wb, "Roughness").default_value = 0.85
    ob.data.materials.clear()
    ob.data.materials.append(bark)
    ob.data.materials.append(bud)
    ob.data.materials.append(wood)
    ob.data.polygons.foreach_set("material_index", np.asarray(kind, dtype=np.int32))
    ob.data.update()
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
    _area_light("SP_Key", (-0.85, -1.0, 1.1), center, 60.0, 0.9, (1.0, 0.95, 0.88))
    _area_light("SP_Fill", (1.1, -0.65, 0.42), center, 14.0, 1.2, (0.86, 0.92, 1.0))
    _area_light("SP_Rim", (0.3, 1.1, 0.8), center, 40.0, 0.7, (1.0, 0.97, 0.92))

    bt.remove_object("SP_Camera")
    cam = bpy.data.cameras.new("SP_Camera")
    cam.lens = 85
    cam.display_size = 0.04
    cam.clip_start = 0.005
    cob = bpy.data.objects.new("SP_Camera", cam)
    cob.location = (0.25, -0.40, 0.13)
    cob.rotation_euler = (Vector(center) - cob.location).to_track_quat("-Z", "Y").to_euler()
    bt.link(cob, bt.COLL_STUDIO)
    scene.camera = cob
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1200

    _perch()
    bt.frame_view(center, 0.36, elev_deg=8, azim_deg=-30, lens=60, shading="MATERIAL")
    return "scene ready"
