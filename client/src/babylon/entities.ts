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

import { Color3, MeshBuilder, TransformNode, type Mesh, type Scene } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';

// A stall sells either a TextureSlot ('bodypaint' | 'shirt' | 'pants' | 'shoes')
// OR an AccessorySocket-grouped category ('hat' | 'glasses' | 'scarf' | 'bag')
// OR the special 'customize' stall — a dedicated booth where players paint
// per-panel garment designs.
export type StallCategory =
  | 'bodypaint'
  | 'shirt'
  | 'pants'
  | 'shoes'
  | 'hat'
  | 'glasses'
  | 'scarf'
  | 'bag'
  | 'customize';

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

// Stall positions — hand-placed at organic / "random" spots around the
// park (not on a perfect ring) so the lounge reads as a festive plaza
// outside the stadium rather than a market in a circle. Each stall has
// a `facing` rotation aimed roughly toward the plaza center so the
// counter approach is visible from the main walkways.
//
// All coords are inside the 48×48 playable area centered at (24, 24).
// Facing rotations are world-Y radians; 0 = facing +Z (north / stadium).
const PLAZA_X = 24;
const PLAZA_Z = 24;

// Helper — facing angle that points (sx, sz) toward (PLAZA_X, PLAZA_Z).
// atan2(dx, dz) gives an angle measured from +Z (which is what the
// avatar / stall counter's local +Z faces) toward +X.
function facePlaza(sx: number, sz: number): number {
  return Math.atan2(PLAZA_X - sx, PLAZA_Z - sz);
}

export const STALL_LAYOUT: StallDef[] = [
  { id: 'stall-shirts',     label: "Sasha's Shirts",   category: 'shirt',     x: 12, z: 16, facing: facePlaza(12, 16), color: '#c14444' },
  { id: 'stall-pants',      label: 'Pants Pavilion',   category: 'pants',     x: 35, z: 18, facing: facePlaza(35, 18), color: '#3a6ea5' },
  // Shoes stall — relocated outside the original 48×48 park, next to
  // the soccer practice field. Wardrobe-slot reason for players to
  // venture beyond the park.
  { id: 'stall-shoes',      label: 'Sneaker Stand',    category: 'shoes',     x: 84, z: 20, facing: facePlaza(84, 20), color: '#e8c84a' },
  { id: 'stall-hats',       label: 'The Hattery',      category: 'hat',       x: 28, z: 39, facing: facePlaza(28, 39), color: '#9bd96b' },
  { id: 'stall-accessories',label: 'Glasses + Bags',   category: 'glasses',   x: 14, z: 34, facing: facePlaza(14, 34), color: '#d96bc4' },
  { id: 'stall-scarves',    label: 'Cozy Scarves',     category: 'scarf',     x:  8, z: 28, facing: facePlaza(8, 28),  color: '#e89c4a' },
  // Design Bench — placed just south of the plaza, on the spine path so
  // players see it immediately after spawning at the plaza center.
  { id: 'stall-customize',  label: 'The Design Bench', category: 'customize', x: PLAZA_X, z: PLAZA_Z - 10, facing: 0, color: '#a85dd9' },
];

// Approximate inscribed circle for distance comparisons (kept so callers
// that imported RING_RADIUS don't break). The new layout isn't a ring,
// but most stalls sit ~13 units from the plaza.
const RING_RADIUS = 13;

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
  // Materials shared per-stall (one set per booth so colors don't bleed
  // between stalls).
  const counterMat = createStandardMaterial(scene, `${stall.id}-counter-mat`, Color3.FromHexString('#d8b88a'));
  const counterTopMat = createStandardMaterial(scene, `${stall.id}-counter-top-mat`, Color3.FromHexString('#6e4a26'));
  const postMat = createStandardMaterial(scene, `${stall.id}-post-mat`, Color3.FromHexString('#7a5430'));
  const awningMat = createStandardMaterial(scene, `${stall.id}-awning-mat`, Color3.FromHexString(stall.color));
  const awningTrimMat = createStandardMaterial(scene, `${stall.id}-awning-trim-mat`, Color3.FromHexString('#f3ecd9'));
  const backWallMat = createStandardMaterial(scene, `${stall.id}-back-wall-mat`, Color3.FromHexString('#e7d6b3'));
  const lanternMat = createStandardMaterial(scene, `${stall.id}-lantern-mat`, Color3.FromHexString('#f6d76a'));
  lanternMat.emissiveColor = Color3.FromHexString('#5b3a00');
  const lanternRopeMat = createStandardMaterial(scene, `${stall.id}-lantern-rope-mat`, Color3.FromHexString('#1d1a14'));
  const bannerMat = createStandardMaterial(scene, `${stall.id}-banner-mat`, Color3.FromHexString(stall.color));

  // ─── Stall root — holds the booth's world position + facing. Every
  // mesh below is a child of this node and positioned in LOCAL space,
  // so Babylon composes (parent_facing × local_pitch) correctly. The
  // previous code set both rotations on each mesh directly, which under
  // Babylon's YXZ Euler order applied the pitch in the already-yawed
  // frame — fine for facing=0 (one stall) but wrong for the other six.
  const root = new TransformNode(`${stall.id}-root`, scene);
  root.position.set(stall.x, 0, stall.z);
  root.rotation.y = stall.facing;

  // ─── Counter — wide low box with a darker top trim ────────────────────────
  const counter = MeshBuilder.CreateBox(`${stall.id}-counter`, {
    width: 2.4, height: 1.0, depth: 0.7,
  }, scene);
  counter.parent = root;
  counter.position.set(0, 0.5, 0);
  counter.material = counterMat;
  meshes.push(counter);

  const counterTop = MeshBuilder.CreateBox(`${stall.id}-counter-top`, {
    width: 2.6, height: 0.08, depth: 0.85,
  }, scene);
  counterTop.parent = root;
  counterTop.position.set(0, 1.04, 0);
  counterTop.material = counterTopMat;
  meshes.push(counterTop);

  // ─── Posts — four corner pillars holding the roof ─────────────────────────
  const postHeight = 2.6;
  const postOffsetX = 1.2;
  const postOffsetZ = 0.4;
  for (const [lx, lz, idx] of [
    [-postOffsetX,  postOffsetZ, 0],
    [ postOffsetX,  postOffsetZ, 1],
    [-postOffsetX, -postOffsetZ, 2],
    [ postOffsetX, -postOffsetZ, 3],
  ] as Array<[number, number, number]>) {
    const post = MeshBuilder.CreateBox(`${stall.id}-post-${idx}`, {
      width: 0.14, height: postHeight, depth: 0.14,
    }, scene);
    post.parent = root;
    post.position.set(lx, postHeight / 2, lz);
    post.material = postMat;
    meshes.push(post);
  }

  // ─── Back wall + banner ────────────────────────────────────────────────────
  const backWall = MeshBuilder.CreateBox(`${stall.id}-back-wall`, {
    width: 2.6, height: 1.6, depth: 0.08,
  }, scene);
  backWall.parent = root;
  backWall.position.set(0, 1.4, -0.55);
  backWall.material = backWallMat;
  meshes.push(backWall);

  const banner = MeshBuilder.CreateBox(`${stall.id}-banner`, {
    width: 2.2, height: 1.1, depth: 0.03,
  }, scene);
  banner.parent = root;
  banner.position.set(0, 1.5, -0.50);
  banner.material = bannerMat;
  meshes.push(banner);

  // ─── Peaked awning — two slanted roof panels meeting at a ridge ───────────
  const roofPitch = 0.5;
  const roofWidth = 3.0;
  const roofPlaneDepth = 1.05;
  const roofRidgeY = postHeight + 0.55;
  const roofPlaneCenterY = postHeight + 0.27;

  const makeRoofPanel = (idx: number, sign: 1 | -1): void => {
    const panel = MeshBuilder.CreateBox(`${stall.id}-roof-${idx}`, {
      width: roofWidth, height: 0.08, depth: roofPlaneDepth,
    }, scene);
    panel.parent = root;
    // In local space the pitch is now a clean rotation around X only;
    // the parent's Y rotation handles the stall facing automatically.
    panel.position.set(0, roofPlaneCenterY, sign * (roofPlaneDepth / 2 - 0.05));
    panel.rotation.x = sign * roofPitch;
    panel.material = awningMat;
    meshes.push(panel);
  };
  makeRoofPanel(0, 1);
  makeRoofPanel(1, -1);

  const ridge = MeshBuilder.CreateBox(`${stall.id}-ridge`, {
    width: roofWidth + 0.05, height: 0.1, depth: 0.12,
  }, scene);
  ridge.parent = root;
  ridge.position.set(0, roofRidgeY + 0.02, 0);
  ridge.material = awningTrimMat;
  meshes.push(ridge);

  // ─── Hanging lanterns ────────────────────────────────────────────────────
  for (const [lx, idx] of [[-0.85, 0], [0.85, 1]] as Array<[number, number]>) {
    const rope = MeshBuilder.CreateCylinder(`${stall.id}-rope-${idx}`, {
      height: 0.45, diameter: 0.025, tessellation: 6,
    }, scene);
    rope.parent = root;
    rope.position.set(lx, postHeight - 0.05, postOffsetZ + 0.05);
    rope.material = lanternRopeMat;
    meshes.push(rope);

    const lantern = MeshBuilder.CreateBox(`${stall.id}-lantern-${idx}`, {
      width: 0.22, height: 0.3, depth: 0.22,
    }, scene);
    lantern.parent = root;
    lantern.position.set(lx, postHeight - 0.4, postOffsetZ + 0.05);
    lantern.material = lanternMat;
    meshes.push(lantern);
  }

  // ─── Side privacy panels ─────────────────────────────────────────────────
  for (const [lx, idx] of [[-1.2, 0], [1.2, 1]] as Array<[number, number]>) {
    const side = MeshBuilder.CreateBox(`${stall.id}-side-${idx}`, {
      width: 0.06, height: 1.4, depth: 0.85,
    }, scene);
    side.parent = root;
    side.position.set(lx, postHeight - 1.4, -0.18);
    side.material = backWallMat;
    meshes.push(side);
  }

  // Push the TransformNode last as a Mesh-like reference for cleanup —
  // it isn't a Mesh, but disposing it via dispose() recursively cleans
  // the children too, which is a no-op since we already dispose them.
  // We don't add it to the `meshes` array (typed Mesh[]) to keep types
  // honest; the node leaks at scene tear-down only if the SceneEntities
  // wrapper is itself disposed — acceptable since the scene is recreated
  // on a full reload.
}

// Re-export helpers some callers may use directly.
export { PLAZA_X, PLAZA_Z, RING_RADIUS };
