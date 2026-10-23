/**
 * Pós-processamento no navegador (substitui o Blender do servidor):
 * solda vértices, reduz polígonos com meshoptimizer, padroniza escala/origem
 * e, no modo "só o modelo", troca os materiais por branco.
 */
import { WebIO, type Document, type Primitive, type mat4 as Mat4 } from "@gltf-transform/core";
import { dedup, getBounds, prune, simplify, transformMesh, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

export interface OptimizeOptions {
  targetTriangles: number;
  white: boolean;
  /** altura final em metros (personagem ≈ 1,8 m); 0 mantém a escala */
  height: number;
}

export interface OptimizeResult {
  glb: Uint8Array;
  trianglesBefore: number;
  trianglesAfter: number;
}

function countTriangles(doc: Document): number {
  let total = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      const pos = prim.getAttribute("POSITION");
      total += Math.floor((idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3);
    }
  }
  return total;
}

export async function optimizeGlb(input: ArrayBuffer, opts: OptimizeOptions): Promise<OptimizeResult> {
  await MeshoptSimplifier.ready;
  const io = new WebIO();
  const doc = await io.readBinary(new Uint8Array(input));
  const trianglesBefore = countTriangles(doc);

  if (opts.white) {
    for (const mat of doc.getRoot().listMaterials()) {
      mat.setBaseColorTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
      mat.setBaseColorFactor([0.92, 0.92, 0.92, 1]).setMetallicFactor(0).setRoughnessFactor(0.7).setEmissiveFactor([0, 0, 0]);
    }
    if (doc.getRoot().listMaterials().length === 0) {
      const mat = doc.createMaterial("Branco").setBaseColorFactor([0.92, 0.92, 0.92, 1]).setMetallicFactor(0).setRoughnessFactor(0.7);
      for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setMaterial(mat);
    }
  }

  // Normais (e UV no modo branco) separam vértices iguais; sem elas a solda junta tudo
  // e o simplificador consegue colapsar arestas. As normais são recalculadas no fim.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      prim.setAttribute("NORMAL", null).setAttribute("TANGENT", null);
      if (opts.white) prim.setAttribute("TEXCOORD_0", null).setAttribute("TEXCOORD_1", null);
    }
  }
  await doc.transform(dedup(), weld());
  if (countTriangles(doc) > opts.targetTriangles) {
    const ratio = Math.max(0.005, opts.targetTriangles / countTriangles(doc));
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false }));
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) smoothNormals(doc, prim);
  await doc.transform(prune());

  // Origem no chão e no centro, altura padronizada: chega pronto para a engine.
  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (scene && opts.height > 0) {
    const b = getBounds(scene);
    const size = b.max[1] - b.min[1];
    if (size > 0 && Number.isFinite(size)) {
      const s = opts.height / size;
      const cx = (b.min[0] + b.max[0]) / 2;
      const cz = (b.min[2] + b.max[2]) / 2;
      const m = mat4(s, -cx * s, -b.min[1] * s, -cz * s);
      for (const node of doc.getRoot().listNodes()) {
        const mesh = node.getMesh();
        if (!mesh) continue;
        const world = node.getWorldMatrix();
        transformMesh(mesh, multiply(m, world) as Mat4);
        node.setMatrix(IDENTITY);
      }
      for (const node of doc.getRoot().listNodes()) {
        if (!node.getMesh()) node.setMatrix(IDENTITY);
      }
    }
  }

  const glb = await io.writeBinary(doc);
  return { glb, trianglesBefore, trianglesAfter: countTriangles(doc) };
}

/**
 * Normais suaves ponderadas pela área. Vértices na mesma posição (costuras de UV)
 * compartilham a normal, para não aparecer "risco" na emenda da textura.
 */
function smoothNormals(doc: Document, prim: Primitive) {
  const pos = prim.getAttribute("POSITION");
  const idx = prim.getIndices();
  if (!pos || !idx) return;
  const p = pos.getArray()!;
  const ind = idx.getArray()!;
  const count = pos.getCount();
  const group = new Int32Array(count);
  const key = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const k = `${p[i * 3].toFixed(5)},${p[i * 3 + 1].toFixed(5)},${p[i * 3 + 2].toFixed(5)}`;
    let g = key.get(k);
    if (g === undefined) key.set(k, (g = i));
    group[i] = g;
  }
  const acc = new Float32Array(count * 3);
  for (let t = 0; t < ind.length; t += 3) {
    const a = ind[t] * 3, b = ind[t + 1] * 3, c = ind[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const v of [ind[t], ind[t + 1], ind[t + 2]]) {
      const g = group[v] * 3;
      acc[g] += nx;
      acc[g + 1] += ny;
      acc[g + 2] += nz;
    }
  }
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const g = group[i] * 3;
    const len = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1;
    normals[i * 3] = acc[g] / len;
    normals[i * 3 + 1] = acc[g + 1] / len;
    normals[i * 3 + 2] = acc[g + 2] / len;
  }
  const buffer = pos.getBuffer();
  prim.setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer));
}

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Escala uniforme seguida de translação, em ordem de colunas. */
function mat4(s: number, tx: number, ty: number, tz: number): number[] {
  return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, tx, ty, tz, 1];
}

/** Multiplica duas matrizes 4x4 em ordem de colunas (a × b). */
function multiply(a: number[], b: ArrayLike<number>): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
