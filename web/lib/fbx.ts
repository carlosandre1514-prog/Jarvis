/**
 * Exportador de FBX binário (versão 7.4) que roda no navegador.
 *
 * Suporta malhas estáticas com normais, UV, um material por malha e textura de cor
 * embutida (PNG). É o suficiente para importar na Unreal, Unity, Godot e Blender.
 * Eixos: Y para cima, unidade em metros (UnitScaleFactor = 100 cm).
 */

export interface FbxTexture {
  name: string;
  png: Uint8Array;
}

export interface FbxMaterial {
  name: string;
  color: [number, number, number];
  roughness?: number;
  metalness?: number;
  map?: FbxTexture;
}

export interface FbxMesh {
  name: string;
  /** xyz por vértice, já no espaço do mundo */
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** triângulos (3 índices cada) */
  indices: Uint32Array;
  material: FbxMaterial;
}

// Constantes usadas pelo Blender: o FBX SDK confere FileId/CreationTime/rodapé juntos.
const FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
const CREATION_TIME = "1970-01-01 10:00:00:000";
const VERSION = 7400;

// ---------- Modelo de nós ----------

type Prop =
  | { t: "C"; v: boolean }
  | { t: "I"; v: number }
  | { t: "L"; v: bigint }
  | { t: "D"; v: number }
  | { t: "S"; v: string }
  | { t: "R"; v: Uint8Array }
  | { t: "i"; v: Int32Array }
  | { t: "d"; v: Float64Array };

interface Node {
  name: string;
  props: Prop[];
  children: Node[];
}

const I = (v: number): Prop => ({ t: "I", v });
const L = (v: number | bigint): Prop => ({ t: "L", v: BigInt(v) });
const D = (v: number): Prop => ({ t: "D", v });
const S = (v: string): Prop => ({ t: "S", v });
const C = (v: boolean): Prop => ({ t: "C", v });

function n(name: string, props: Prop[] = [], children: Node[] = []): Node {
  return { name, props, children };
}

/** Nome no formato "Nome\x00\x01Classe" que o FBX usa para objetos. */
const objName = (name: string, cls: string) => `${name}\x00\x01${cls}`;

/** Propriedade dentro de Properties70. */
function P(name: string, type: string, label: string, flags: string, ...values: Prop[]): Node {
  return n("P", [S(name), S(type), S(label), S(flags), ...values]);
}

// ---------- Escrita binária ----------

const enc = new TextEncoder();

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  pos = 0;

  private ensure(extra: number) {
    if (this.pos + extra <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }
  u32(v: number) {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }
  i64(v: bigint) {
    this.ensure(8);
    this.view.setBigInt64(this.pos, v, true);
    this.pos += 8;
  }
  f64(v: number) {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }
  bytes(b: ArrayLike<number>) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  patchU32(at: number, v: number) {
    this.view.setUint32(at, v, true);
  }
  result() {
    return this.buf.slice(0, this.pos);
  }
}

function writeProp(w: Writer, p: Prop) {
  w.u8(p.t.charCodeAt(0));
  switch (p.t) {
    case "C":
      w.u8(p.v ? 1 : 0);
      break;
    case "I":
      w.i32(p.v);
      break;
    case "L":
      w.i64(p.v);
      break;
    case "D":
      w.f64(p.v);
      break;
    case "S":
    case "R": {
      const b = p.t === "S" ? enc.encode(p.v) : p.v;
      w.u32(b.length);
      w.bytes(b);
      break;
    }
    case "i":
    case "d": {
      const bytes = new Uint8Array(p.v.buffer, p.v.byteOffset, p.v.byteLength);
      w.u32(p.v.length); // quantidade de elementos
      w.u32(0); // sem compressão
      w.u32(bytes.length);
      w.bytes(bytes);
      break;
    }
  }
}

const NULL_RECORD = new Array(13).fill(0);

function writeNode(w: Writer, node: Node) {
  const start = w.pos;
  w.u32(0); // EndOffset (preenchido depois)
  w.u32(node.props.length);
  w.u32(0); // PropertyListLen (preenchido depois)
  const name = enc.encode(node.name);
  w.u8(name.length);
  w.bytes(name);
  const propsStart = w.pos;
  for (const p of node.props) writeProp(w, p);
  w.patchU32(start + 8, w.pos - propsStart);
  if (node.children.length || node.props.length === 0) {
    for (const c of node.children) writeNode(w, c);
    w.bytes(NULL_RECORD);
  }
  w.patchU32(start, w.pos);
}

function serialize(nodes: Node[]): Uint8Array {
  const w = new Writer();
  w.bytes(enc.encode("Kaydara FBX Binary  \x00"));
  w.bytes([0x1a, 0x00]);
  w.u32(VERSION);
  for (const node of nodes) writeNode(w, node);
  w.bytes(NULL_RECORD);
  // Rodapé
  w.bytes(FOOT_ID);
  w.bytes([0, 0, 0, 0]);
  let pad = ((w.pos + 15) & ~15) - w.pos;
  if (pad === 0) pad = 16;
  w.bytes(new Array(pad).fill(0));
  w.u32(VERSION);
  w.bytes(new Array(120).fill(0));
  w.bytes(FOOT_MAGIC);
  return w.result();
}

// ---------- Cena ----------

export function exportFbx(meshes: FbxMesh[], creator = "Gerador de Ativos 3D"): Uint8Array {
  let nextId = 1000000;
  const id = () => nextId++;

  const objects: Node[] = [];
  const connections: Node[] = [];
  const counts = { Model: 0, Geometry: 0, Material: 0, Texture: 0, Video: 0 };
  const materialIds = new Map<FbxMaterial, number>();

  const usedNames = new Set<string>();
  const unique = (base: string) => {
    let name = (base || "Mesh").replace(/[\x00\x01]/g, "_");
    for (let i = 1; usedNames.has(name); i++) name = `${base}_${i}`;
    usedNames.add(name);
    return name;
  };

  for (const mesh of meshes) {
    const name = unique(mesh.name);
    const vertCount = mesh.positions.length / 3;

    // Polígonos: o último índice de cada polígono é gravado como ~índice (negativo).
    const triCount = mesh.indices.length / 3;
    const pvi = new Int32Array(mesh.indices.length);
    for (let t = 0; t < triCount; t++) {
      pvi[t * 3] = mesh.indices[t * 3];
      pvi[t * 3 + 1] = mesh.indices[t * 3 + 1];
      pvi[t * 3 + 2] = ~mesh.indices[t * 3 + 2];
    }

    const layerElements: Node[] = [];
    const geomChildren: Node[] = [
      n("Vertices", [{ t: "d", v: Float64Array.from(mesh.positions) }]),
      n("PolygonVertexIndex", [{ t: "i", v: pvi }]),
      n("GeometryVersion", [I(124)]),
    ];

    if (mesh.normals && mesh.normals.length === vertCount * 3) {
      const normals = new Float64Array(mesh.indices.length * 3);
      mesh.indices.forEach((vi, k) => {
        normals[k * 3] = mesh.normals![vi * 3];
        normals[k * 3 + 1] = mesh.normals![vi * 3 + 1];
        normals[k * 3 + 2] = mesh.normals![vi * 3 + 2];
      });
      geomChildren.push(
        n("LayerElementNormal", [I(0)], [
          n("Version", [I(101)]),
          n("Name", [S("")]),
          n("MappingInformationType", [S("ByPolygonVertex")]),
          n("ReferenceInformationType", [S("Direct")]),
          n("Normals", [{ t: "d", v: normals }]),
        ])
      );
      layerElements.push(n("LayerElement", [], [n("Type", [S("LayerElementNormal")]), n("TypedIndex", [I(0)])]));
    }

    if (mesh.uvs && mesh.uvs.length === vertCount * 2) {
      geomChildren.push(
        n("LayerElementUV", [I(0)], [
          n("Version", [I(101)]),
          n("Name", [S("UVMap")]),
          n("MappingInformationType", [S("ByPolygonVertex")]),
          n("ReferenceInformationType", [S("IndexToDirect")]),
          // glTF tem V invertido em relação ao FBX
          n("UV", [{ t: "d", v: Float64Array.from(mesh.uvs, (v, k) => (k % 2 ? 1 - v : v)) }]),
          n("UVIndex", [{ t: "i", v: Int32Array.from(mesh.indices) }]),
        ])
      );
      layerElements.push(n("LayerElement", [], [n("Type", [S("LayerElementUV")]), n("TypedIndex", [I(0)])]));
    }

    geomChildren.push(
      n("LayerElementMaterial", [I(0)], [
        n("Version", [I(101)]),
        n("Name", [S("")]),
        n("MappingInformationType", [S("AllSame")]),
        n("ReferenceInformationType", [S("IndexToDirect")]),
        n("Materials", [{ t: "i", v: new Int32Array([0]) }]),
      ])
    );
    layerElements.push(n("LayerElement", [], [n("Type", [S("LayerElementMaterial")]), n("TypedIndex", [I(0)])]));
    geomChildren.push(n("Layer", [I(0)], [n("Version", [I(100)]), ...layerElements]));

    const geomId = id();
    const modelId = id();
    objects.push(n("Geometry", [L(geomId), S(objName(name, "Geometry")), S("Mesh")], geomChildren));
    objects.push(
      n("Model", [L(modelId), S(objName(name, "Model")), S("Mesh")], [
        n("Version", [I(232)]),
        n("Properties70", [], [
          P("Lcl Translation", "Lcl Translation", "", "A", D(0), D(0), D(0)),
          P("Lcl Rotation", "Lcl Rotation", "", "A", D(0), D(0), D(0)),
          P("Lcl Scaling", "Lcl Scaling", "", "A", D(1), D(1), D(1)),
        ]),
        n("Shading", [C(true)]),
        n("Culling", [S("CullingOff")]),
      ])
    );
    counts.Geometry++;
    counts.Model++;
    connections.push(n("C", [S("OO"), L(modelId), L(0)]));
    connections.push(n("C", [S("OO"), L(geomId), L(modelId)]));

    // Material (compartilhado entre malhas quando é o mesmo objeto)
    let matId = materialIds.get(mesh.material);
    if (matId === undefined) {
      const m = mesh.material;
      matId = id();
      materialIds.set(m, matId);
      const matName = unique(m.name || "Material");
      const [r, g, b] = m.color;
      objects.push(
        n("Material", [L(matId), S(objName(matName, "Material")), S("")], [
          n("Version", [I(102)]),
          n("ShadingModel", [S("phong")]),
          n("MultiLayer", [I(0)]),
          n("Properties70", [], [
            P("DiffuseColor", "Color", "", "A", D(r), D(g), D(b)),
            P("DiffuseFactor", "Number", "", "A", D(1)),
            P("SpecularColor", "Color", "", "A", D(0.2), D(0.2), D(0.2)),
            P("SpecularFactor", "Number", "", "A", D(1 - (m.roughness ?? 0.8))),
            P("Shininess", "Number", "", "A", D(Math.max(2, (1 - (m.roughness ?? 0.8)) * 100))),
            P("ReflectionFactor", "Number", "", "A", D(m.metalness ?? 0)),
            P("Opacity", "Number", "", "A", D(1)),
          ]),
        ])
      );
      counts.Material++;

      if (m.map) {
        const texId = id();
        const vidId = id();
        const file = m.map.name.replace(/[^\w.-]+/g, "_").replace(/\.png$/i, "") + ".png";
        objects.push(
          n("Video", [L(vidId), S(objName(file, "Video")), S("Clip")], [
            n("Type", [S("Clip")]),
            n("Properties70", [], [P("Path", "KString", "XRefUrl", "", S(file))]),
            n("UseMipMap", [I(0)]),
            n("Filename", [S(file)]),
            n("RelativeFilename", [S(file)]),
            n("Content", [{ t: "R", v: m.map.png }]),
          ])
        );
        objects.push(
          n("Texture", [L(texId), S(objName(file, "Texture")), S("")], [
            n("Type", [S("TextureVideoClip")]),
            n("Version", [I(202)]),
            n("TextureName", [S(objName(file, "Texture"))]),
            n("Properties70", [], [P("UseMaterial", "bool", "", "", I(1))]),
            n("Media", [S(objName(file, "Video"))]),
            n("FileName", [S(file)]),
            n("RelativeFilename", [S(file)]),
            n("ModelUVTranslation", [D(0), D(0)]),
            n("ModelUVScaling", [D(1), D(1)]),
            n("Texture_Alpha_Source", [S("None")]),
            n("Cropping", [I(0), I(0), I(0), I(0)]),
          ])
        );
        counts.Texture++;
        counts.Video++;
        connections.push(n("C", [S("OO"), L(vidId), L(texId)]));
        connections.push(n("C", [S("OP"), L(texId), L(matId), S("DiffuseColor")]));
      }
    }
    connections.push(n("C", [S("OO"), L(matId), L(modelId)]));
  }

  const definitions: Node[] = [n("Version", [I(100)])];
  const defTypes = Object.entries(counts).filter(([, c]) => c > 0);
  definitions.push(n("Count", [I(defTypes.reduce((a, [, c]) => a + c, 1))]));
  definitions.push(n("ObjectType", [S("GlobalSettings")], [n("Count", [I(1)])]));
  for (const [type, c] of defTypes) definitions.push(n("ObjectType", [S(type)], [n("Count", [I(c)])]));

  const docId = id();
  const doc: Node[] = [
    n("FBXHeaderExtension", [], [
      n("FBXHeaderVersion", [I(1003)]),
      n("FBXVersion", [I(VERSION)]),
      n("EncryptionType", [I(0)]),
      n("CreationTimeStamp", [], [
        n("Version", [I(1000)]),
        n("Year", [I(1970)]),
        n("Month", [I(1)]),
        n("Day", [I(1)]),
        n("Hour", [I(10)]),
        n("Minute", [I(0)]),
        n("Second", [I(0)]),
        n("Millisecond", [I(0)]),
      ]),
      n("Creator", [S(creator)]),
    ]),
    n("FileId", [{ t: "R", v: new Uint8Array(FILE_ID) }]),
    n("CreationTime", [S(CREATION_TIME)]),
    n("Creator", [S(creator)]),
    n("GlobalSettings", [], [
      n("Version", [I(1000)]),
      n("Properties70", [], [
        P("UpAxis", "int", "Integer", "", I(1)),
        P("UpAxisSign", "int", "Integer", "", I(1)),
        P("FrontAxis", "int", "Integer", "", I(2)),
        P("FrontAxisSign", "int", "Integer", "", I(1)),
        P("CoordAxis", "int", "Integer", "", I(0)),
        P("CoordAxisSign", "int", "Integer", "", I(1)),
        P("OriginalUpAxis", "int", "Integer", "", I(1)),
        P("OriginalUpAxisSign", "int", "Integer", "", I(1)),
        P("UnitScaleFactor", "double", "Number", "", D(100)),
        P("OriginalUnitScaleFactor", "double", "Number", "", D(100)),
      ]),
    ]),
    n("Documents", [], [
      n("Count", [I(1)]),
      n("Document", [L(docId), S("Scene"), S("Scene")], [n("Properties70"), n("RootNode", [L(0)])]),
    ]),
    n("References"),
    n("Definitions", [], definitions),
    n("Objects", [], objects),
    n("Connections", [], connections),
  ];
  return serialize(doc);
}
