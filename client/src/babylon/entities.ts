// ══════════════════════════════════════════════
// Fairground stalls — six clothing stalls placed in a ring around the
// central plaza. Each stall has:
//   • a counter box (the "tabletop" players approach)
//   • a striped awning roof above
//   • a 3D color flag indicating its category
//   • a category id that the HUD uses to filter wardrobe items
//
// The stalls are static — they don't sync over the network. Server doesn't
// need to know about them; the client builds them deterministically from
// the fixed STALL_LAYOUT below.
// ══════════════════════════════════════════════

import { Color3, MeshBuilder, type Mesh, type Scene } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';

// A stall sells either a TextureSlot ('bodypaint' | 'shirt' | 'pants' | 'shoes')
// OR an AccessorySocket-grouped category ('hat' | 'glasses' | 'scarf' | 'bag').
export type StallCategory =
  | 'bodypaint'
  | 'shirt'
  | 'pants'
  | 'shoes'
  | 'hat'
  | 'glasses'
  | 'scarf'
  | 'bag';

export interface StallDef {
  id: string;
  label: string;
  category: StallCategory;
  /** World position of the stall counter front face (where players stand). */
  x: number;
  z: number;
  /** Stall's facing direction (rotation around Y, radians). */
  facing: number;
  /** Awning color (top hex). */
  color: string;
}

// Stalls arranged in a ring around the plaza. Distance from plaza center
// is 14 units (so the central plaza stays visible and walkable); angles
// split evenly. Each stall faces the plaza center.
const RING_RADIUS = 14;
const PLAZA_X = 24;
const PLAZA_Z = 24;

function ringPos(angleRad: number): { x: number; z: number; facing: number } {
  return {
    x: PLAZA_X + Math.cos(angleRad) * RING_RADIUS,
    z: PLAZA_Z + Math.sin(angleRad) * RING_RADIUS,
    // Face inward toward the plaza
    facing: angleRad + Math.PI,
  };
}

export const STALL_LAYOUT: StallDef[] = [
  { id: 'stall-shirts',    label: "Sasha's Shirts",     category: 'shirt',     ...ringPos(0),                color: '#c14444' },
  { id: 'stall-pants',     label: 'Pants Pavilion',     category: 'pants',     ...ringPos(Math.PI / 3),      color: '#3a6ea5' },
  { id: 'stall-shoes',     label: 'Sneaker Stand',      category: 'shoes',     ...ringPos((2 * Math.PI) / 3), color: '#e8c84a' },
  { id: 'stall-hats',      label: 'The Hattery',        category: 'hat',       ...ringPos(Math.PI),          color: '#9bd96b' },
  { id: 'stall-accessories', label: 'Glasses + Bags',   category: 'glasses',   ...ringPos((4 * Math.PI) / 3), color: '#d96bc4' },
  { id: 'stall-scarves',   label: 'Cozy Scarves',       category: 'scarf',     ...ringPos((5 * Math.PI) / 3), color: '#e89c4a' },
];

/** How close a player needs to be (in world units) to "browse" a stall. */
export const STALL_INTERACT_RADIUS = 2.6;

export interface SceneEntities {
  marker: Mesh;
  stalls: StallDef[];
  /** Returns the nearest stall within STALL_INTERACT_RADIUS of (x, z), or null. */
  findNearestStall(x: number, z: number): StallDef | null;
  update(timeSeconds: number): void;
  dispose(): void;
}

export function createSceneEntities(scene: Scene): SceneEntities {
  // LLM-EXTENSION:ENTITIES — Multiplayer fairground stalls: six clothing booths arranged in a ring around the central plaza (Shirts, Pants, Shoes, Hats, Glasses+Bags, Scarves). Each booth = counter box + striped awning + small flag. STALL_LAYOUT is the static catalog; findNearestStall does a flat-distance test for HUD proximity. Stalls don't sync over the network — client builds them deterministically from the constant layout so all players see the same fair.
  // DO NOT REMOVE the LLM-EXTENSION:ENTITIES tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  const meshes: Mesh[] = [];

  // Sentinel mesh kept so SceneEntities.marker still resolves to a Mesh (the
  // pre-multiplayer contract). We use it as a hidden ground anchor that
  // dispose can rely on; the visible content is the stalls themselves.
  const marker = MeshBuilder.CreateBox('fair-anchor', { size: 0.001 }, scene);
  marker.position.set(PLAZA_X, 0, PLAZA_Z);
  marker.isVisible = false;
  marker.isPickable = false;

  for (const stall of STALL_LAYOUT) {
    buildStall(scene, stall, meshes);
  }

  function findNearestStall(x: number, z: number): StallDef | null {
    let best: StallDef | null = null;
    let bestDist = STALL_INTERACT_RADIUS;
    for (const s of STALL_LAYOUT) {
      const dx = s.x - x;
      const dz = s.z - z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best;
  }

  return {
    marker,
    stalls: STALL_LAYOUT,
    findNearestStall,
    update() {
      // Stalls are static; if you want flag flapping or particles, do it here.
    },
    dispose() {
      for (const m of meshes) m.dispose();
      marker.dispose();
    },
  };
}

function buildStall(scene: Scene, stall: StallDef, meshes: Mesh[]): void {
  const counterMat = createStandardMaterial(scene, `${stall.id}-counter-mat`, Color3.FromHexString('#d8b88a'));
  const postMat = createStandardMaterial(scene, `${stall.id}-post-mat`, Color3.FromHexString('#8b6b3f'));
  const awningMat = createStandardMaterial(scene, `${stall.id}-awning-mat`, Color3.FromHexString(stall.color));
  const flagMat = createStandardMaterial(scene, `${stall.id}-flag-mat`, Color3.FromHexString(stall.color));

  // Counter — wide, low box facing toward the plaza.
  const counter = MeshBuilder.CreateBox(`${stall.id}-counter`, {
    width: 2.2, height: 1.0, depth: 0.6,
  }, scene);
  counter.position.set(stall.x, 0.5, stall.z);
  counter.rotation.y = stall.facing;
  counter.material = counterMat;
  meshes.push(counter);

  // Posts — four corner pillars holding the awning.
  const postOffsetX = 1.05;
  const postOffsetZ = 0.28;
  const postHeight = 2.4;
  const postPositions: Array<[number, number]> = [
    [-postOffsetX, postOffsetZ], [postOffsetX, postOffsetZ],
    [-postOffsetX, -postOffsetZ], [postOffsetX, -postOffsetZ],
  ];
  for (let i = 0; i < postPositions.length; i++) {
    const [lx, lz] = postPositions[i];
    const post = MeshBuilder.CreateBox(`${stall.id}-post-${i}`, {
      width: 0.12, height: postHeight, depth: 0.12,
    }, scene);
    // Local offset rotated by facing
    const wx = stall.x + lx * Math.cos(stall.facing) - lz * Math.sin(stall.facing);
    const wz = stall.z + lx * Math.sin(stall.facing) + lz * Math.cos(stall.facing);
    post.position.set(wx, postHeight / 2, wz);
    post.material = postMat;
    meshes.push(post);
  }

  // Awning — striped flat box above the counter, slightly larger.
  const awning = MeshBuilder.CreateBox(`${stall.id}-awning`, {
    width: 2.4, height: 0.12, depth: 0.9,
  }, scene);
  awning.position.set(stall.x, postHeight, stall.z);
  awning.rotation.y = stall.facing;
  awning.material = awningMat;
  meshes.push(awning);

  // Flag — small angled box sticking up from the awning corner.
  const flag = MeshBuilder.CreateBox(`${stall.id}-flag`, {
    width: 0.04, height: 0.7, depth: 0.04,
  }, scene);
  // Position flag pole at the front-right corner of the awning
  const flagLocalX = 1.0;
  const flagLocalZ = 0.4;
  const fwx = stall.x + flagLocalX * Math.cos(stall.facing) - flagLocalZ * Math.sin(stall.facing);
  const fwz = stall.z + flagLocalX * Math.sin(stall.facing) + flagLocalZ * Math.cos(stall.facing);
  flag.position.set(fwx, postHeight + 0.35, fwz);
  flag.material = postMat;
  meshes.push(flag);

  const flagCloth = MeshBuilder.CreateBox(`${stall.id}-flag-cloth`, {
    width: 0.3, height: 0.2, depth: 0.02,
  }, scene);
  flagCloth.position.set(fwx + 0.16, postHeight + 0.55, fwz);
  flagCloth.rotation.y = stall.facing;
  flagCloth.material = flagMat;
  meshes.push(flagCloth);
}

// Re-export helpers some callers may use directly.
export { PLAZA_X, PLAZA_Z, RING_RADIUS };
