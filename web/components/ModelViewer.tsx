"use client";

import { Suspense, useEffect, useMemo } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { Bounds, Center, ContactShadows, Environment, Lightformer, OrbitControls, useGLTF } from "@react-three/drei";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import * as THREE from "three";

export type ModelFormat = "glb" | "fbx";

function GlbModel({ url }: { url: string }) {
  const { scene } = useGLTF(url);
  return <primitive object={scene} />;
}

function FbxModel({ url }: { url: string }) {
  const fbx = useLoader(FBXLoader, url);
  useEffect(() => {
    fbx.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
  }, [fbx]);
  return <primitive object={fbx} />;
}

/** Detecta o formato pela extensão quando não é informado. */
export function formatFromUrl(url: string): ModelFormat {
  return url.split("?")[0].toLowerCase().endsWith(".fbx") ? "fbx" : "glb";
}

export default function ModelViewer({
  url,
  format,
  autoRotate = true,
}: {
  url: string | null;
  format?: ModelFormat;
  autoRotate?: boolean;
}) {
  const fmt = useMemo(() => (url ? format ?? formatFromUrl(url) : null), [url, format]);

  return (
    <Canvas shadows camera={{ position: [2.5, 1.8, 2.5], fov: 45 }} className="h-full w-full">
      <color attach="background" args={["#18181b"]} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={1.2} castShadow />
      <Suspense fallback={null}>
        {/* Reflexos de estúdio gerados localmente (sem baixar HDR da internet), para os materiais PBR. */}
        <Environment resolution={256}>
          <Lightformer intensity={2} position={[0, 5, -5]} scale={[10, 5, 1]} />
          <Lightformer intensity={1.5} position={[-5, 1, 0]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer intensity={1} position={[5, 1, 0]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer intensity={0.5} position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} />
        </Environment>
        {url && fmt && (
          // key força recarregar ao trocar de modelo; Bounds enquadra qualquer escala.
          <Bounds key={url} fit clip observe margin={1.2}>
            <Center>{fmt === "fbx" ? <FbxModel url={url} /> : <GlbModel url={url} />}</Center>
          </Bounds>
        )}
        <ContactShadows position={[0, -1, 0]} opacity={0.5} scale={10} blur={2.5} far={4} />
      </Suspense>
      {/* Rotação 360° livre com mouse/toque + giro automático. */}
      <OrbitControls makeDefault autoRotate={autoRotate} autoRotateSpeed={1.5} enableDamping />
    </Canvas>
  );
}
