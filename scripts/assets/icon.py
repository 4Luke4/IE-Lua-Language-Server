"""Renders images/icon.png (128x128, transparent) for the extension.

    blender --background --factory-startup --python scripts/assets/icon.py

Original artwork: a carved hexagonal rune stone with a glowing crescent moon
("lua" is Portuguese for moon) and a gold rim. Rendered with Cycles on the GPU;
the script stops with an error when no GPU device is available instead of
silently falling back to the CPU.
"""
import math
import pathlib
import sys

import bpy

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "images" / "icon.png"
RENDER_SIZE = 512  # rendered large, then downscaled for clean anti-aliasing
ICON_SIZE = 128    # VS Code / VSIX icon size
SAMPLES = 256
SEED = 1


def fail(message):
    print(f"::error title=Icon render::{message}", file=sys.stderr)
    sys.exit(1)


def enable_gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue  # backend not compiled into this Blender build
        prefs.get_devices()
        devices = [d for d in prefs.devices if d.type == backend]
        if devices:
            for device in prefs.devices:
                device.use = device.type == backend
            scene.cycles.device = "GPU"
            print(f"Rendering on {backend}: {', '.join(d.name for d in devices)}")
            return
    fail("No Cycles GPU device (OptiX, CUDA, HIP, oneAPI or Metal) is available.")


def material(name, color, metallic=0.0, roughness=0.5, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def bevel(obj, width, segments=4):
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle()


def hexagon(name, radius, depth, z, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=radius, depth=depth, location=(0, 0, z), rotation=(0, 0, math.pi / 6))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def crescent(mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=0.62, depth=0.12, location=(-0.06, 0, 0.36))
    moon = bpy.context.object
    moon.name = "Crescent"
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=0.52, depth=0.4, location=(0.2, 0.12, 0.36))
    cutter = bpy.context.object
    boolean = moon.modifiers.new("Cut", "BOOLEAN")
    boolean.operation = "DIFFERENCE"
    boolean.object = cutter
    bpy.context.view_layer.objects.active = moon
    bpy.ops.object.modifier_apply(modifier="Cut")
    bpy.data.objects.remove(cutter, do_unlink=True)
    moon.data.materials.append(mat)
    bevel(moon, 0.02, 3)
    return moon


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    enable_gpu(scene)
    scene.cycles.samples = SAMPLES
    scene.cycles.seed = SEED
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = RENDER_SIZE
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.025, 0.04, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
    scene.world = world

    gold = material("Gold", (0.83, 0.62, 0.25), metallic=1.0, roughness=0.28)
    stone = material("Stone", (0.02, 0.045, 0.13), roughness=0.4)
    glow = material("Moon", (0.75, 0.88, 1.0), roughness=0.3, emission=(0.55, 0.8, 1.0), strength=6.0)

    rim = hexagon("Rim", 1.0, 0.3, 0.0, gold)
    bevel(rim, 0.05)
    face = hexagon("Stone", 0.86, 0.46, 0.06, stone)
    bevel(face, 0.06)
    crescent(glow)

    bpy.ops.object.light_add(type="AREA", location=(-2.2, -2.4, 3.6))
    key = bpy.context.object
    key.data.energy = 300
    key.data.size = 2.5
    key.rotation_euler = (math.radians(40), math.radians(-25), 0)
    bpy.ops.object.light_add(type="AREA", location=(2.6, 1.8, 2.2))
    fill = bpy.context.object
    fill.data.energy = 80
    fill.data.size = 3.0
    fill.rotation_euler = (math.radians(-45), math.radians(40), 0)

    bpy.ops.object.camera_add(location=(0, -0.55, 6.0), rotation=(math.radians(5), 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 2.3
    scene.camera = camera

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(OUTPUT)
    bpy.ops.render.render(write_still=True)

    image = bpy.data.images.load(str(OUTPUT))
    image.scale(ICON_SIZE, ICON_SIZE)
    image.filepath_raw = str(OUTPUT)
    image.file_format = "PNG"
    image.save()
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({ICON_SIZE}x{ICON_SIZE})")


main()
