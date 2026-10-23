"""
Pós-processamento de malhas geradas por IA usando o Blender (bpy).

Uso (headless):
  blender --background --factory-startup --python process_mesh.py -- \
      --input raw.glb --output-dir ./out --name model --target-faces 20000

  blender --background --factory-startup --python process_mesh.py -- --demo exemplo.glb

Etapas:
  1. Importa o .GLB
  2. Limpa a malha (merge de vértices duplicados, normais consistentes)
  3. Decimação até o número alvo de faces (retopologia leve, preserva UVs)
  4. Verifica o mapeamento UV e gera um (Smart UV Project) se faltar
  5. Exporta .FBX (Unreal/Unity, texturas embutidas) e .GLB (Godot/Web)

Ao final imprime "RESULT_JSON:{...}" com estatísticas para o backend.
"""

import argparse
import json
import math
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(description="Otimiza e exporta modelos 3D")
    p.add_argument("--input", help="Arquivo .glb/.gltf de entrada")
    p.add_argument("--output-dir", default=".", help="Pasta de saída")
    p.add_argument("--name", default="model", help="Nome base dos arquivos exportados")
    p.add_argument("--target-faces", type=int, default=20000, help="Faces alvo após decimação")
    p.add_argument("--merge-distance", type=float, default=0.0001)
    p.add_argument("--demo", metavar="SAIDA.glb", help="Cria um modelo de exemplo e sai")
    return p.parse_args(argv)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def count_faces(objs):
    return sum(len(o.data.polygons) for o in objs)


def make_active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def build_demo(path):
    """Modelo de exemplo com material PBR simples, para testar sem IA."""
    reset_scene()
    bpy.ops.mesh.primitive_monkey_add(size=1.0)
    obj = bpy.context.active_object
    obj.name = "Demo"
    sub = obj.modifiers.new("Subdiv", "SUBSURF")
    sub.levels = 3
    make_active(obj)
    bpy.ops.object.modifier_apply(modifier=sub.name)
    bpy.ops.object.shade_smooth()

    mat = bpy.data.materials.new("DemoMaterial")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (0.8, 0.45, 0.1, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.4
    bsdf.inputs["Metallic"].default_value = 0.2
    obj.data.materials.append(mat)

    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB")
    return {"demo": path, "faces": len(obj.data.polygons)}


def import_model(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise ValueError(f"Formato não suportado: {ext}")


def clean_mesh(obj, merge_distance):
    """Remove vértices duplicados e recalcula normais para fora."""
    make_active(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=merge_distance)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def decimate(objs, target_faces):
    """Decimação proporcional em todos os objetos até atingir o alvo total."""
    total = count_faces(objs)
    if total <= target_faces or total == 0:
        return
    ratio = max(0.01, target_faces / total)
    for obj in objs:
        mod = obj.modifiers.new("Decimate", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        # Mantém costuras de UV para não estragar as texturas.
        mod.delimit = {"UV", "SEAM", "SHARP"}
        make_active(obj)
        bpy.ops.object.modifier_apply(modifier=mod.name)


def uv_area(mesh):
    """Área total ocupada no espaço UV (0 = UV inexistente/degenerado)."""
    if not mesh.uv_layers.active:
        return 0.0
    uv = mesh.uv_layers.active.data
    area = 0.0
    for poly in mesh.polygons:
        idx = list(poly.loop_indices)
        for i in range(1, len(idx) - 1):
            a, b, c = uv[idx[0]].uv, uv[idx[i]].uv, uv[idx[i + 1]].uv
            area += abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
    return area


def ensure_uv(objs):
    """Retorna True se todas as malhas já tinham UV válido; senão gera Smart UV."""
    all_ok = True
    for obj in objs:
        if uv_area(obj.data) > 1e-6:
            continue
        all_ok = False
        if not obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap")
        make_active(obj)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    return all_ok


def unpack_textures(tex_dir):
    """Texturas vindas de GLB ficam empacotadas; o FBX precisa de arquivos para embutir."""
    os.makedirs(tex_dir, exist_ok=True)
    count = 0
    for img in bpy.data.images:
        if img.type != "IMAGE" or (not img.has_data and not img.packed_file):
            continue
        ext = ".jpg" if img.file_format == "JPEG" else ".png"
        if ext == ".png":
            img.file_format = "PNG"
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in img.name)
        img.filepath_raw = os.path.join(tex_dir, safe + ext)
        img.save()
        count += 1
    return count


def export(out_dir, name):
    fbx_path = os.path.join(out_dir, name + ".fbx")
    glb_path = os.path.join(out_dir, name + ".glb")
    bpy.ops.object.select_all(action="DESELECT")

    bpy.ops.export_scene.fbx(
        filepath=fbx_path,
        use_selection=False,
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        mesh_smooth_type="FACE",
        use_tspace=True,
        path_mode="COPY",
        embed_textures=True,
        add_leaf_bones=False,
    )
    bpy.ops.export_scene.gltf(filepath=glb_path, export_format="GLB", export_apply=True)
    return fbx_path, glb_path


def main():
    args = parse_args()

    if args.demo:
        result = build_demo(args.demo)
        print("RESULT_JSON:" + json.dumps(result))
        return

    if not args.input:
        raise SystemExit("Informe --input ou --demo")

    os.makedirs(args.output_dir, exist_ok=True)
    reset_scene()
    import_model(args.input)

    objs = mesh_objects()
    if not objs:
        raise SystemExit("Nenhuma malha encontrada no arquivo")

    faces_before = count_faces(objs)
    for obj in objs:
        clean_mesh(obj, args.merge_distance)
    decimate(objs, args.target_faces)
    uv_ok = ensure_uv(objs)
    textures = unpack_textures(os.path.join(args.output_dir, "textures"))
    fbx_path, glb_path = export(args.output_dir, args.name)

    print("RESULT_JSON:" + json.dumps({
        "facesBefore": faces_before,
        "facesAfter": count_faces(mesh_objects()),
        "meshes": len(objs),
        "uvOk": uv_ok,
        "textures": textures,
        "fbx": fbx_path,
        "glb": glb_path,
    }))


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"ERRO: {exc}", file=sys.stderr)
        sys.exit(1)
