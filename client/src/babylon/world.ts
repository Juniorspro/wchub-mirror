// ══════════════════════════════════════════════
// Fairground environment: a 24×24 outdoor lounge — grass-textured ground,
// a central plaza disc, decorative tents at the corners with their own
// conical canvas roofs, warm afternoon lighting. The camera is an
// ArcRotateCamera that follows a target (re-pointed by game.ts to the
// local player's avatar each frame).
//
// World coords are XZ; +X is east, +Z is north. Server uses (x, y) where
// y maps to Babylon Z. The fairground center is at (12, 0, 12).
// ══════════════════════════════════════════════

import {
  Color3,
  Color4,
  MeshBuilder,
  StandardMaterial,
  Vector3,
  type ArcRotateCamera,
  type DirectionalLight,
  type HemisphericLight,
  type Mesh,
  type Scene,
} from '@babylonjs/core';
import { createBaseSceneObjects, createStandardMaterial } from './helpers';
import { RUNTIME_CONFIG } from './config';

export interface GameWorldObjects {
  camera: ArcRotateCamera;
  hemiLight: HemisphericLight;
  sunLight: DirectionalLight;
  ground: Mesh;
  dispose(): void;
}

export const FAIR_CENTER = new Vector3(12, 0, 12);
export const FAIR_SIZE = 24;
export const PLAZA_RADIUS = 4;

export function createGameWorld(scene: Scene, canvas: HTMLCanvasElement): GameWorldObjects {
  // LLM-EXTENSION:WORLD — Multiplayer fairground: 24×24 grass ground centered at (12, 0, 12), a beige plaza disc in the middle, four perimeter tents at the corners with conical canvas tops, warm sun + soft ambient. Camera is ArcRotateCamera framed to follow the local avatar; game.ts re-targets camera.target each frame as the avatar walks. Stalls live in a separate module (entities.ts/stalls.ts) so they enumerate cleanly for proximity checks.
  // DO NOT REMOVE the LLM-EXTENSION:WORLD tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  const base = createBaseSceneObjects(scene, canvas);
  scene.clearColor = Color4.FromHexString(`${RUNTIME_CONFIG.world.clearColor}ff`);

  // Follow-cam framing (game.ts updates camera.target each frame).
  base.camera.alpha = -Math.PI / 2;
  base.camera.beta = Math.PI / 3;
  base.camera.radius = 9;
  base.camera.target.copyFrom(FAIR_CENTER);
  base.camera.lowerRadiusLimit = 4;
  base.camera.upperRadiusLimit = 18;

  // Outdoor lighting: warmer ambient, brighter sun.
  base.hemiLight.intensity = 0.85;
  base.hemiLight.groundColor = new Color3(0.55, 0.6, 0.45);
  base.sunLight.intensity = 0.75;

  // ─── Grass ground ─────────────────────────────────────────────────────────
  const ground = MeshBuilder.CreateGround('fair-ground', {
    width: FAIR_SIZE, height: FAIR_SIZE, subdivisions: 1,
  }, scene);
  ground.position.copyFrom(FAIR_CENTER);
  ground.material = createStandardMaterial(scene, 'fair-ground-mat', Color3.FromHexString('#7fa86e'));
  ground.receiveShadows = true;

  // ─── Central plaza disc ───────────────────────────────────────────────────
  const plaza = MeshBuilder.CreateDisc('fair-plaza', { radius: PLAZA_RADIUS, tessellation: 48 }, scene);
  plaza.rotation.x = Math.PI / 2;
  plaza.position.set(FAIR_CENTER.x, 0.01, FAIR_CENTER.z);
  plaza.material = createStandardMaterial(scene, 'fair-plaza-mat', Color3.FromHexString('#dccbab'));

  // ─── Decorative perimeter tents (corner pieces) ───────────────────────────
  const tentMeshes: Mesh[] = [];
  const tentColors = ['#d96b6b', '#6bb3d9', '#d9c46b', '#9bd96b'];
  const tentCorners: Array<[number, number]> = [
    [2.5, 2.5], [21.5, 2.5], [2.5, 21.5], [21.5, 21.5],
  ];
  tentCorners.forEach(([x, z], i) => {
    const cabin = MeshBuilder.CreateBox(`tent-base-${i}`, { width: 2, height: 1.6, depth: 2 }, scene);
    cabin.position.set(x, 0.8, z);
    cabin.material = createStandardMaterial(scene, `tent-base-mat-${i}`, Color3.FromHexString('#f0e2c8'));
    tentMeshes.push(cabin);

    const roof = MeshBuilder.CreateCylinder(`tent-roof-${i}`, {
      height: 1.4, diameterTop: 0, diameterBottom: 2.6, tessellation: 6,
    }, scene);
    roof.position.set(x, 2.3, z);
    roof.material = createStandardMaterial(scene, `tent-roof-mat-${i}`, Color3.FromHexString(tentColors[i]));
    tentMeshes.push(roof);
  });

  // ─── Soft plaza shadow ────────────────────────────────────────────────────
  const plazaShadow = MeshBuilder.CreateDisc('plaza-shadow', { radius: PLAZA_RADIUS + 0.2, tessellation: 48 }, scene);
  plazaShadow.rotation.x = Math.PI / 2;
  plazaShadow.position.set(FAIR_CENTER.x, 0.005, FAIR_CENTER.z);
  const shadowMat = new StandardMaterial('plaza-shadow-mat', scene);
  shadowMat.diffuseColor = Color3.FromHexString('#000000');
  shadowMat.alpha = 0.08;
  plazaShadow.material = shadowMat;
  plazaShadow.isPickable = false;

  return {
    ...base,
    ground,
    dispose() {
      ground.dispose();
      plaza.dispose();
      plazaShadow.dispose();
      for (const t of tentMeshes) t.dispose();
    },
  };
}
