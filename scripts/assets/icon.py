"""Renders images/icon.png (128x128, transparent) for the extension.

    blender --background --factory-startup --python scripts/assets/icon.py

Original artwork: a twenty-sided die (a regular icosahedron) in dark navy stone with
gold edges, its front face showing a glowing blue "20". Rendered with Cycles on the GPU;
the script stops with an error when no GPU device is available instead of silently
falling back to the CPU.

The "20" is set in Inter, the font Blender bundles (datafiles/fonts/Inter.woff2; SIL Open
Font License 1.1, as Blender's license/license.md lists it). The OFL does not restrict
images made with the font, so the rendered PNG carries no font notice.
"""
import math
import pathlib
import sys

import bpy
from mathutils import Matrix, Vector

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
    # Blender 5.2 gives new materials a node tree and deprecates `use_nodes`; older versions need it.
    if mat.node_tree is None:
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


def icosahedron(mat):
    """A regular icosahedron of circumradius 1, turned so that one face looks at the camera
    (+Z) with a corner pointing up (+Y), as a die rests on the table showing that face."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(0, 0, 0))
    die = bpy.context.object
    die.name = "Die"
    mesh = die.data
    front = max(mesh.polygons, key=lambda polygon: polygon.normal.z)
    align = front.normal.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
    mesh.transform(align)
    mesh.update()
    front = mesh.polygons[front.index]
    # Turn about Z so the corner of the front face that is highest points straight up.
    corner = max((mesh.vertices[i].co for i in front.vertices), key=lambda co: co.y)
    mesh.transform(Matrix.Rotation(math.pi / 2 - math.atan2(corner.y, corner.x), 4, "Z"))
    mesh.update()
    die.data.materials.append(mat)
    return die, mesh.polygons[front.index].center.z


def edges(die, mat, thickness):
    """Gold edges: a wireframe copy of the die, its struts slightly outside the faces."""
    rim = die.copy()
    rim.data = die.data.copy()
    rim.name = "Edges"
    bpy.context.collection.objects.link(rim)
    rim.data.materials.clear()
    rim.data.materials.append(mat)
    wire = rim.modifiers.new("Wire", "WIREFRAME")
    wire.thickness = thickness
    wire.offset = 0.0
    wire.use_even_offset = True
    wire.use_relative_offset = False
    bevel(rim, thickness / 4, 2)
    return rim


def number(text, mat, z, size):
    """`text` centered on the front face, raised just above it."""
    font_path = pathlib.Path(bpy.utils.system_resource("DATAFILES")) / "fonts" / "Inter.woff2"
    if not font_path.is_file():
        fail(f"Blender's bundled font {font_path} was not found.")
    bpy.ops.object.text_add(location=(0, 0, z + 0.004))
    label = bpy.context.object
    label.name = "Number"
    label.data.body = text
    label.data.font = bpy.data.fonts.load(str(font_path))
    label.data.align_x = "CENTER"
    label.data.align_y = "CENTER"
    label.data.size = size
    label.data.extrude = 0.01
    # A slightly thicker outline, so the digits stay legible at 16 to 32 pixels.
    label.data.offset = 0.008
    label.data.materials.append(mat)
    return label


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
    if world.node_tree is None:  # as for materials, above
        world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.025, 0.04, 1.0)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
    scene.world = world

    gold = material("Gold", (0.83, 0.62, 0.25), metallic=1.0, roughness=0.28)
    stone = material("Stone", (0.02, 0.045, 0.13), roughness=0.4)
    glow = material("Glow", (0.75, 0.88, 1.0), roughness=0.3, emission=(0.55, 0.8, 1.0), strength=6.0)

    die, front_z = icosahedron(stone)
    edges(die, gold, 0.09)
    number("20", glow, front_z, 0.5)

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

    # Seen from slightly below the front face's normal, so the upper faces show their depth.
    tilt = math.radians(8)
    bpy.ops.object.camera_add(location=(0, -6.0 * math.sin(tilt), 6.0 * math.cos(tilt)), rotation=(tilt, 0, 0))
    camera = bpy.context.object
    camera.data.type = "ORTHO"
    # The silhouette of the die seen face-on spans its circumradius-1 corners; a small margin.
    camera.data.ortho_scale = 2.15
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
