"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

import { OrbitNavigationController } from "@/lib/navigation";
import { SceneViewer } from "@/lib/viewer";

type ThreeSceneProps = {
  className?: string;
};

export function ThreeScene({ className }: ThreeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let viewer: SceneViewer;
    try {
      viewer = new SceneViewer({
        container,
        fov: 50,
        near: 0.1,
        far: 100,
        cameraPosition: [0, 0.5, 4],
        background: 0x0f172a,
      });
    } catch {
      // 无 WebGL 支持时静默降级。
      return;
    }

    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.9, 0.28, 128, 16),
      new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        metalness: 0.35,
        roughness: 0.45,
      }),
    );

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3, 48),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;

    viewer.add(mesh, ground);

    const nav = new OrbitNavigationController({
      camera: viewer.camera,
      domElement: viewer.context.domElement,
      enableDamping: true,
      minDistance: 2,
      maxDistance: 12,
    });
    viewer.setNavigation(nav);

    viewer.addUpdatable({
      update: () => {
        mesh.rotation.x += 0.004;
        mesh.rotation.y += 0.008;
      },
    });

    viewer.start();

    return () => {
      viewer.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label="3D 预览场景"
    />
  );
}
