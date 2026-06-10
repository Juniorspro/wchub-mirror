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

import { Color3, DynamicTexture, MeshBuilder, StandardMaterial, TransformNode, type Mesh, type Scene, type Texture } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';
import { applyMapTexture } from './world';

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
// Map recenter (2026-06-08): PLAZA_X moved from 24 → 110 to put the
// fair plaza (and the stadium that frames it) on the new map midline.
const PLAZA_X = 110;
const PLAZA_Z = 24;

// Helper — facing angle that points (sx, sz) toward (PLAZA_X, PLAZA_Z).
// atan2(dx, dz) gives an angle measured from +Z (which is what the
// avatar / stall counter's local +Z faces) toward +X.
function facePlaza(sx: number, sz: number): number {
  return Math.atan2(PLAZA_X - sx, PLAZA_Z - sz);
}

export const STALL_LAYOUT: StallDef[] = [
  // All x values += 86 from the original layout (map recenter).
  { id: 'stall-shirts',     label: "Sasha's Shirts",   category: 'shirt',     x:  98, z: 16, facing: facePlaza( 98, 16), color: '#c14444' },
  { id: 'stall-pants',      label: 'Pants Pavilion',   category: 'pants',     x: 121, z: 18, facing: facePlaza(121, 18), color: '#3a6ea5' },
  { id: 'stall-shoes',      label: 'Sneaker Stand',    category: 'shoes',     x: 170, z: 20, facing: facePlaza(170, 20), color: '#e8c84a' },
  { id: 'stall-hats',       label: 'The Hattery',      category: 'hat',       x: 114, z: 39, facing: facePlaza(114, 39), color: '#9bd96b' },
  { id: 'stall-accessories',label: 'Glasses + Bags',   category: 'glasses',   x: 100, z: 34, facing: facePlaza(100, 34), color: '#d96bc4' },
  { id: 'stall-scarves',    label: 'Cozy Scarves',     category: 'scarf',     x:  94, z: 28, facing: facePlaza( 94, 28), color: '#e89c4a' },
  // Design Bench — just south of the plaza on the spine path.
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
  const mapTextures: Texture[] = [];

  // Sentinel mesh kept so SceneEntities.marker still resolves to a Mesh (the
  // pre-multiplayer contract). We use it as a hidden ground anchor that
  // dispose can rely on; the visible content is the stalls themselves.
  const marker = MeshBuilder.CreateBox('fair-anchor', { size: 0.001 }, scene);
  marker.position.set(PLAZA_X, 0, PLAZA_Z);
  marker.isVisible = false;
  marker.isPickable = false;

  for (const stall of STALL_LAYOUT) {
    buildStall(scene, stall, meshes, mapTextures);
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
      for (const t of mapTextures) t.dispose();
      marker.dispose();
    },
  };
}

function buildStall(scene: Scene, stall: StallDef, meshes: Mesh[], mapTextures: Texture[]): void {
  // Materials shared per-stall (one set per booth so colors don't bleed
  // between stalls).
  const counterMat = createStandardMaterial(scene, `${stall.id}-counter-mat`, Color3.FromHexString('#d8b88a'));
  const counterTopMat = createStandardMaterial(scene, `${stall.id}-counter-top-mat`, Color3.FromHexString('#6e4a26'));
  const postMat = createStandardMaterial(scene, `${stall.id}-post-mat`, Color3.FromHexString('#7a5430'));
  const awningMat = createStandardMaterial(scene, `${stall.id}-awning-mat`, Color3.FromHexString(stall.color));
  const awningTrimMat = createStandardMaterial(scene, `${stall.id}-awning-trim-mat`, Color3.FromHexString('#f3ecd9'));
  // AI tileable-texture skin (guarded no-ops when the asset isn't
  // registered). keepTint everywhere: the near-white awning cloth picks up
  // each stall's color via diffuseColor multiply, and the wood surfaces
  // keep their designed light/dark tone variation under the plank grain.
  applyMapTexture(scene, awningMat, 'tex_awning_cloth', mapTextures, { repeat: 2, keepTint: true });
  applyMapTexture(scene, counterMat, 'tex_wood_planks', mapTextures, { repeat: 2, keepTint: true });
  applyMapTexture(scene, counterTopMat, 'tex_wood_planks', mapTextures, { repeat: 2, keepTint: true });
  applyMapTexture(scene, postMat, 'tex_wood_planks', mapTextures, { repeat: 1, keepTint: true });
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

  // ─── Painted shop sign — name + category on the banner ───────────────────
  // First of two purpose cues (the other is the 3D merchandise icon on
  // the roof): a DynamicTexture plane over the banner with the stall's
  // name and WHAT IT SELLS in plain words, so a player reads the
  // purpose from the approach without opening the browse panel.
  const CATEGORY_WORD: Record<StallCategory, string> = {
    bodypaint: 'BODY PAINT',
    shirt: 'SHIRTS & JERSEYS',
    pants: 'PANTS & SHORTS',
    shoes: 'SHOES',
    hat: 'HATS',
    glasses: 'GLASSES & BAGS',
    scarf: 'SCARVES',
    bag: 'BAGS',
    customize: 'DESIGN YOUR OWN',
  };
  const labelTex = new DynamicTexture(`${stall.id}-label-tex`, { width: 512, height: 256 }, scene, true);
  const lctx = labelTex.getContext() as unknown as CanvasRenderingContext2D;
  lctx.fillStyle = stall.color;
  lctx.fillRect(0, 0, 512, 256);
  // Darker strip behind the category line for contrast
  lctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  lctx.fillRect(0, 152, 512, 104);
  lctx.fillStyle = '#ffffff';
  lctx.textAlign = 'center';
  lctx.textBaseline = 'middle';
  lctx.font = 'bold 58px Inter, system-ui, sans-serif';
  lctx.fillText(stall.label, 256, 84, 470);
  lctx.font = 'bold 44px Inter, system-ui, sans-serif';
  lctx.fillText(CATEGORY_WORD[stall.category], 256, 204, 470);
  labelTex.update();
  const labelMat = new StandardMaterial(`${stall.id}-label-mat`, scene);
  labelMat.diffuseTexture = labelTex;
  labelMat.emissiveTexture = labelTex;
  labelMat.emissiveColor = new Color3(0.6, 0.6, 0.6);
  labelMat.specularColor = new Color3(0, 0, 0);
  const labelPlane = MeshBuilder.CreatePlane(`${stall.id}-label`, {
    width: 2.2, height: 1.1,
  }, scene);
  labelPlane.parent = root;
  // Plane's front face looks down local -Z; the stall front (counter
  // side) is local +Z, so flip it to face approaching players.
  labelPlane.rotation.y = Math.PI;
  labelPlane.position.set(0, 1.5, -0.46);
  labelPlane.material = labelMat;
  meshes.push(labelPlane);

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

  // ─── Merchandise icon — the second purpose cue ────────────────────────────
  buildMerchandiseIcon(scene, stall, root, meshes);

  // Push the TransformNode last as a Mesh-like reference for cleanup —
  // it isn't a Mesh, but disposing it via dispose() recursively cleans
  // the children too, which is a no-op since we already dispose them.
  // We don't add it to the `meshes` array (typed Mesh[]) to keep types
  // honest; the node leaks at scene tear-down only if the SceneEntities
  // wrapper is itself disposed — acceptable since the scene is recreated
  // on a full reload.
}

// ─────────────────────────────────────────────────────────────────────────────
// Oversized 3D icon of the merchandise, mounted on a short pole above the
// roof ridge — the medieval-shop-sign trick. A giant shirt / boot / hat
// silhouette reads from across the park, before any text is legible.
// Built from a handful of primitives per category, parented to an icon
// root so the whole sign inherits the stall's facing.
function buildMerchandiseIcon(scene: Scene, stall: StallDef, root: TransformNode, meshes: Mesh[]): void {
  const primary = createStandardMaterial(scene, `${stall.id}-icon-primary`, Color3.FromHexString(stall.color));
  const accent = createStandardMaterial(scene, `${stall.id}-icon-accent`, Color3.FromHexString('#f3ecd9'));
  const dark = createStandardMaterial(scene, `${stall.id}-icon-dark`, Color3.FromHexString('#2c2c30'));

  // Mounting pole from the roof ridge up to the icon.
  const pole = MeshBuilder.CreateCylinder(`${stall.id}-icon-pole`, {
    height: 0.75, diameter: 0.07, tessellation: 8,
  }, scene);
  pole.parent = root;
  pole.position.set(0, 3.55, 0);
  pole.material = dark;
  meshes.push(pole);

  const iconRoot = new TransformNode(`${stall.id}-icon-root`, scene);
  iconRoot.parent = root;
  iconRoot.position.set(0, 4.25, 0);

  const add = (mesh: Mesh, lx: number, ly: number, lz: number, mat = primary): void => {
    mesh.parent = iconRoot;
    mesh.position.set(lx, ly, lz);
    mesh.material = mat;
    mesh.isPickable = false;
    meshes.push(mesh);
  };

  switch (stall.category) {
    case 'shirt': {
      // T-shirt: torso + two angled sleeves + white collar notch.
      add(MeshBuilder.CreateBox(`${stall.id}-icon-body`, { width: 0.85, height: 0.95, depth: 0.2 }, scene), 0, -0.05, 0);
      for (const sign of [-1, 1] as const) {
        const sleeve = MeshBuilder.CreateBox(`${stall.id}-icon-sleeve-${sign}`, { width: 0.42, height: 0.5, depth: 0.2 }, scene);
        sleeve.rotation.z = sign * 0.55;
        add(sleeve, sign * 0.58, 0.22, 0);
      }
      add(MeshBuilder.CreateBox(`${stall.id}-icon-collar`, { width: 0.38, height: 0.1, depth: 0.22 }, scene), 0, 0.43, 0, accent);
      break;
    }
    case 'pants': {
      // Trousers: waistband + two legs.
      add(MeshBuilder.CreateBox(`${stall.id}-icon-waist`, { width: 0.78, height: 0.26, depth: 0.2 }, scene), 0, 0.42, 0);
      for (const sign of [-1, 1] as const) {
        add(MeshBuilder.CreateBox(`${stall.id}-icon-leg-${sign}`, { width: 0.32, height: 0.85, depth: 0.2 }, scene), sign * 0.22, -0.14, 0);
      }
      add(MeshBuilder.CreateBox(`${stall.id}-icon-belt`, { width: 0.8, height: 0.07, depth: 0.21 }, scene), 0, 0.55, 0, dark);
      break;
    }
    case 'shoes': {
      // Side-profile sneaker: sole + heel block + toe block + lace patch.
      add(MeshBuilder.CreateBox(`${stall.id}-icon-sole`, { width: 1.0, height: 0.16, depth: 0.36 }, scene), 0, -0.32, 0, accent);
      add(MeshBuilder.CreateBox(`${stall.id}-icon-heel`, { width: 0.5, height: 0.45, depth: 0.34 }, scene), -0.22, -0.02, 0);
      add(MeshBuilder.CreateBox(`${stall.id}-icon-toe`, { width: 0.45, height: 0.24, depth: 0.34 }, scene), 0.26, -0.12, 0);
      add(MeshBuilder.CreateBox(`${stall.id}-icon-lace`, { width: 0.22, height: 0.18, depth: 0.36 }, scene), 0.06, 0.05, 0, accent);
      break;
    }
    case 'hat': {
      // Sun hat: wide brim + crown + dark band.
      add(MeshBuilder.CreateCylinder(`${stall.id}-icon-brim`, { diameter: 1.1, height: 0.08, tessellation: 24 }, scene), 0, -0.18, 0);
      add(MeshBuilder.CreateCylinder(`${stall.id}-icon-crown`, { diameter: 0.6, height: 0.5, tessellation: 24 }, scene), 0, 0.1, 0);
      add(MeshBuilder.CreateCylinder(`${stall.id}-icon-band`, { diameter: 0.64, height: 0.12, tessellation: 24 }, scene), 0, -0.08, 0, dark);
      break;
    }
    case 'glasses':
    case 'bag': {
      // Spectacles: two lens rings + bridge.
      for (const sign of [-1, 1] as const) {
        const lens = MeshBuilder.CreateTorus(`${stall.id}-icon-lens-${sign}`, { diameter: 0.5, thickness: 0.08, tessellation: 20 }, scene);
        lens.rotation.x = Math.PI / 2;  // face the approach
        add(lens, sign * 0.33, 0, 0, dark);
      }
      add(MeshBuilder.CreateBox(`${stall.id}-icon-bridge`, { width: 0.18, height: 0.07, depth: 0.07 }, scene), 0, 0.06, 0, dark);
      break;
    }
    case 'scarf': {
      // Hanging scarf: knot at top, two draped tails, fringe stubs.
      add(MeshBuilder.CreateBox(`${stall.id}-icon-knot`, { width: 0.55, height: 0.28, depth: 0.2 }, scene), 0, 0.4, 0);
      add(MeshBuilder.CreateBox(`${stall.id}-icon-tail-l`, { width: 0.34, height: 0.85, depth: 0.18 }, scene), -0.16, -0.12, 0);
      add(MeshBuilder.CreateBox(`${stall.id}-icon-tail-r`, { width: 0.34, height: 0.62, depth: 0.18 }, scene), 0.2, -0.02, 0);
      for (const [fx, fy] of [[-0.26, -0.6], [-0.06, -0.6], [0.12, -0.38], [0.3, -0.38]] as Array<[number, number]>) {
        add(MeshBuilder.CreateBox(`${stall.id}-icon-fringe-${fx}`, { width: 0.07, height: 0.16, depth: 0.16 }, scene), fx, fy, 0, accent);
      }
      break;
    }
    case 'customize': {
      // Painter's palette facing the approach + three paint dabs + brush.
      const palette = MeshBuilder.CreateCylinder(`${stall.id}-icon-palette`, { diameter: 1.0, height: 0.08, tessellation: 24 }, scene);
      palette.rotation.x = Math.PI / 2;
      add(palette, 0, 0, 0, accent);
      const dabColors = ['#c14444', '#3a6ea5', '#9bd96b'];
      for (let i = 0; i < dabColors.length; i++) {
        const dabMat = createStandardMaterial(scene, `${stall.id}-icon-dab-${i}`, Color3.FromHexString(dabColors[i]));
        const dab = MeshBuilder.CreateCylinder(`${stall.id}-icon-dab-${i}`, { diameter: 0.18, height: 0.05, tessellation: 12 }, scene);
        dab.rotation.x = Math.PI / 2;
        const a = -0.6 + i * 0.75;
        add(dab, Math.cos(a) * 0.3, Math.sin(a) * 0.3 + 0.05, -0.06, dabMat);
      }
      const brush = MeshBuilder.CreateCylinder(`${stall.id}-icon-brush`, { diameter: 0.06, height: 0.7, tessellation: 8 }, scene);
      brush.rotation.z = 0.65;
      add(brush, 0.3, -0.18, -0.1, dark);
      break;
    }
    case 'bodypaint':
    default: {
      // Generic swatch stack.
      add(MeshBuilder.CreateBox(`${stall.id}-icon-swatch-1`, { width: 0.7, height: 0.35, depth: 0.18 }, scene), 0, 0.2, 0);
      add(MeshBuilder.CreateBox(`${stall.id}-icon-swatch-2`, { width: 0.7, height: 0.35, depth: 0.18 }, scene), 0, -0.2, 0, accent);
      break;
    }
  }
}

// Re-export helpers some callers may use directly.
export { PLAZA_X, PLAZA_Z, RING_RADIUS };
