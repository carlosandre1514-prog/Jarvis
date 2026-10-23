"use client";

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { exportFbx, type FbxMaterial, type FbxMesh } from "./fbx";

async function imageToPng(image: CanvasImageSource & { width: number; height: number }): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao converter textura"))), "image/png")
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Copia um atributo (normal ou intercalado) para um array compacto. */
function compact(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): Float32Array {
  const out = new Float32Array(attr.count * size);
  for (let i = 0; i < attr.count; i++) {
    out[i * size] = attr.getX(i);
    out[i * size + 1] = attr.getY(i);
    if (size > 2) out[i * size + 2] = attr.getZ(i);
  }
  return out;
}

/** Converte um .glb (já otimizado) em .fbx binário com a textura de cor embutida. */
export async function glbToFbx(glb: ArrayBuffer): Promise<Uint8Array> {
  const gltf = await new GLTFLoader().parseAsync(glb, "");
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  const materials = new Map<THREE.Material, FbxMaterial>();
  const meshes: FbxMesh[] = [];
  let texCount = 0;

  const toFbxMaterial = async (m: THREE.Material): Promise<FbxMaterial> => {
    const cached = materials.get(m);
    if (cached) return cached;
    const std = m as THREE.MeshStandardMaterial;
    const fm: FbxMaterial = {
      name: m.name || `Material_${materials.size + 1}`,
      color: std.color ? [std.color.r, std.color.g, std.color.b] : [0.9, 0.9, 0.9],
      roughness: std.roughness,
      metalness: std.metalness,
    };
    const img = std.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (img && img.width) fm.map = { name: `textura_${++texCount}.png`, png: await imageToPng(img) };
    materials.set(m, fm);
    return fm;
  };

  const meshList: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshList.push(o as THREE.Mesh);
  });

  for (const mesh of meshList) {
    const geom = mesh.geometry.clone();
    geom.applyMatrix4(mesh.matrixWorld);
    if (!geom.attributes.normal) geom.computeVertexNormals();
    const pos = geom.attributes.position;
    const indices = geom.index
      ? Uint32Array.from(geom.index.array as ArrayLike<number>)
      : Uint32Array.from({ length: pos.count }, (_, i) => i);
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    meshes.push({
      name: mesh.name || "Modelo",
      positions: compact(pos, 3),
      normals: compact(geom.attributes.normal, 3),
      uvs: geom.attributes.uv ? compact(geom.attributes.uv, 2) : undefined,
      indices,
      material: await toFbxMaterial(mat),
    });
    geom.dispose();
  }
  return exportFbx(meshes);
}
