"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

type ThreeSceneProps = {
  className?: string;
};

export function ThreeScene({ className }: ThreeSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ?? probe.getContext("webgl");
    if (!gl) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    camera.position.set(0, 0.5, 4);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.9, 0.28, 128, 16),
      new THREE.MeshStandardMaterial({
        color: 0x0ea5e9,
        metalness: 0.35,
        roughness: 0.45,
      }),
    );
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(5, 8, 6);
    scene.add(keyLight);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(3, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.9,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    scene.add(ground);

    let frameId = 0;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      mesh.rotation.x += 0.004;
      mesh.rotation.y += 0.008;
      renderer.render(scene, camera);
    };
    animate();

    const onResize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
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
