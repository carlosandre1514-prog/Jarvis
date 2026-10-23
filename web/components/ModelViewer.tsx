"use client";

import { Suspense, useEffect, useMemo } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Center, ContactShadows, Environment, Grid, Lightformer, OrbitControls } from "@react-three/drei";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import * as THREE from "three";

export type ModelFormat = "glb" | "fbx";
export type ViewMode = "textured" | "clay" | "wireframe";

export interface ModelStats {
  triangles: number;
  vertices: number;
  meshes: number;
  materials: number;
  textures: number;
  size: [number, number, number];
}

const clayMaterial = new THREE.MeshStandardMaterial({ color: "#e8e6e3", roughness: 0.65, metalness: 0 });
const wireMaterial = new THREE.MeshBasicMaterial({ color: "#818cf8", wireframe: true });

function computeStats(root: THREE.Object3D): ModelStats {
  let triangles = 0;
  let vertices = 0;
  let meshes = 0;
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const g = mesh.geometry;
    const pos = g.attributes.position;
    vertices += pos ? pos.count : 0;
    triangles += g.index ? g.index.count / 3 : pos ? pos.count / 3 : 0;
    const mats = (mesh.userData.originalMaterial ?? mesh.material) as THREE.Material | THREE.Material[];
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) textures.add(v);
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  const s = box.getSize(new THREE.Vector3());
  return { triangles, vertices, meshes, materials: materials.size, textures: textures.size, size: [s.x, s.y, s.z] };
}

function Model({
  url,
  format,
  mode,
  onStats,
}: {
  url: string;
  format: ModelFormat;
  mode: ViewMode;
  onStats?: (s: ModelStats) => void;
}) {
  const loaded = useLoader(format === "fbx" ? FBXLoader : GLTFLoader, url) as THREE.Group | { scene: THREE.Group };
  const root = useMemo(() => ("scene" in loaded ? loaded.scene : loaded), [loaded]);

  useEffect(() => {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (!mesh.userData.originalMaterial) mesh.userData.originalMaterial = mesh.material;
      mesh.material =
        mode === "clay" ? clayMaterial : mode === "wireframe" ? wireMaterial : mesh.userData.originalMaterial;
    });
  }, [root, mode]);

  useEffect(() => {
    onStats?.(computeStats(root));
  }, [root, onStats]);

  return <primitive object={root} />;
}

export default function ModelViewer({
  url,
  format = "glb",
  mode = "textured",
  autoRotate = true,
  showGrid = true,
  onStats,
}: {
  url: string | null;
  format?: ModelFormat;
  mode?: ViewMode;
  autoRotate?: boolean;
  showGrid?: boolean;
  onStats?: (s: ModelStats) => void;
}) {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [2.5, 1.6, 2.5], fov: 40 }} className="h-full w-full">
      <color attach="background" args={["#141417"]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 8, 5]} intensity={1.3} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-6, 3, -4]} intensity={0.4} />
      <Suspense fallback={null}>
        {/* Reflexos de estúdio gerados localmente (sem baixar HDR da internet), para os materiais PBR. */}
        <Environment resolution={256}>
          <Lightformer intensity={2} position={[0, 5, -5]} scale={[10, 5, 1]} />
          <Lightformer intensity={1.5} position={[-5, 1, 0]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer intensity={1} position={[5, 1, 0]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer intensity={0.5} position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
        </Environment>
        {url && (
          // key força recarregar ao trocar de modelo; Bounds enquadra qualquer escala.
          <Bounds key={url + format} fit clip observe margin={1.25}>
            <Center top>
              <Model url={url} format={format} mode={mode} onStats={onStats} />
            </Center>
          </Bounds>
        )}
        <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={12} blur={2.4} far={4} />
      </Suspense>
      {showGrid && (
        <Grid
          infiniteGrid
          cellSize={0.25}
          sectionSize={1}
          cellColor="#2a2a31"
          sectionColor="#3f3f4a"
          fadeDistance={18}
          position={[0, -0.001, 0]}
        />
      )}
      {/* Rotação 360° livre com mouse/toque + giro automático. */}
      <OrbitControls makeDefault autoRotate={autoRotate} autoRotateSpeed={1.2} enableDamping />
    </Canvas>
  );
}
