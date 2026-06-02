// ══════════════════════════════════════════════
// Wardrobe catalog. Two item types share TextureItemDef:
//   (1) BODYPAINT items: carry `paints` — skin-tone Patterns applied to the
//       five region StandardMaterials by actor.applyOutfit.
//   (2) GARMENT items (tops / bottoms / footwear): carry `build` — a
//       constructor that creates 3D mesh sub-parts (torso shell, sleeves,
//       leg covers, shoe boxes…) sitting ON TOP of the body, slightly
//       inflated so the bare skin underneath cannot poke through.
//
// Accessory items (hats / glasses / scarves / bags) keep their own build
// path; they parent rigid sub-meshes to bone-socket TransformNodes.
// ══════════════════════════════════════════════

import { Color3, Mesh, MeshBuilder, StandardMaterial, type Scene, type TransformNode } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';
import { getImageTexture, getPatternTexture, patternKey, type Pattern } from './textures';
import { ASSETS } from '../assets';

export type BodyRegion = 'head' | 'torso' | 'arms' | 'legs' | 'feet';
export type TextureSlot = 'bodypaint' | 'shirt' | 'pants' | 'shoes';
export type AccessorySocket = 'head_top' | 'head_front' | 'neck_front' | 'back_center' | 'hand_l' | 'hand_r';

export interface TextureItemDef {
  id: string;
  label: string;
  slot: TextureSlot;
  zIndex: number;
  swatch: Pattern;
  // EITHER paints (bodypaint slot) OR build (garment slots), not both.
  paints?: Partial<Record<BodyRegion, Pattern>>;
  build?: (scene: Scene, parent: TransformNode) => Mesh[];
}

export interface AccessoryItemDef {
  id: string;
  label: string;
  socket: AccessorySocket;
  swatch: Pattern;
  build: (scene: Scene, parent: TransformNode) => Mesh[];
}

// ─── Material helper shared by garment + accessory builders ────────────────
function makePatternMaterial(scene: Scene, name: string, pattern: Pattern): StandardMaterial {
  if (pattern.kind === 'solid') {
    return createStandardMaterial(scene, name, Color3.FromHexString(pattern.color));
  }
  if (pattern.kind === 'image') {
    const mat = createStandardMaterial(scene, name, new Color3(1, 1, 1));
    mat.diffuseTexture = getImageTexture(scene, pattern.url);
    return mat;
  }
  const mat = createStandardMaterial(scene, name, new Color3(1, 1, 1));
  mat.diffuseTexture = getPatternTexture(scene, patternKey('garment', pattern), pattern);
  return mat;
}

// ─── Garment template builders ──────────────────────────────────────────────
// All builders return the meshes they created so applyOutfit can dispose
// them on re-equip. Materials are NOT returned because dispose(false, true)
// drops the material with the last sub-mesh that owns it.

// Builds the two-frustum body shell shared by every shirt template:
//   shellLower: waist → high-chest (mostly cylindrical, gentle widening)
//   shellUpper: shoulder yoke → neckline opening (gentle taper)
// The slope start sits HIGH on the torso (y=1.85), so the visible V at the
// top of the shirt is a soft, short taper rather than a steep diagonal that
// runs all the way down from the chest.
function buildShirtBody(scene: Scene, parent: TransformNode, pattern: Pattern, label: string, opts: { topDiameter: number; zScale: number; bottomDiameter: number; neckline: number; topY: number }): { mat: StandardMaterial; meshes: Mesh[] } {
  const mat = makePatternMaterial(scene, `${label}-mat`, pattern);

  const yokeStartY = 1.85; // Where the upper-frustum taper begins (raised from 1.77).

  // Lower frustum: from waist (narrower) to high-chest/shoulder height. Mostly
  // cylindrical — the taper is gentle, so it reads as a fitted body, not a flared cone.
  const shellLower = MeshBuilder.CreateCylinder(`${label}-shell-lower`, {
    height: yokeStartY - 1.07, diameterTop: opts.topDiameter, diameterBottom: opts.bottomDiameter, tessellation: 28,
    cap: Mesh.CAP_START,
  }, scene);
  shellLower.parent = parent;
  shellLower.position.set(0, (1.07 + yokeStartY) / 2, 0);
  shellLower.scaling.set(1.0, 1.0, opts.zScale);
  shellLower.material = mat;

  // Upper frustum (the yoke): a short, gentle taper from the shoulder line up
  // to the neckline opening. Slope angle ≈ atan((topDiameter − neckline) / 2
  // / (topY − yokeStartY)) — calibrated so the V at the top reads as soft.
  const shellUpper = MeshBuilder.CreateCylinder(`${label}-shell-upper`, {
    height: opts.topY - yokeStartY, diameterTop: opts.neckline, diameterBottom: opts.topDiameter, tessellation: 28,
    cap: Mesh.CAP_END,
  }, scene);
  shellUpper.parent = parent;
  shellUpper.position.set(0, (yokeStartY + opts.topY) / 2, 0);
  shellUpper.scaling.set(1.0, 1.0, opts.zScale);
  shellUpper.material = mat;

  return { mat, meshes: [shellLower, shellUpper] };
}

function buildTshirt(scene: Scene, parent: TransformNode, pattern: Pattern, label: string): Mesh[] {
  const { mat, meshes } = buildShirtBody(scene, parent, pattern, label, {
    topDiameter: 0.95,
    zScale: 0.62,
    bottomDiameter: 0.82,
    neckline: 0.55,
    topY: 2.07,
  });

  // Short sleeves — capsules tight over the thinner arms.
  const sleeveL = MeshBuilder.CreateCapsule(`${label}-sleeve-l`, {
    height: 0.55, radius: 0.17, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveL.parent = parent;
  sleeveL.position.set(-0.53, 1.78, 0);
  sleeveL.material = mat;

  const sleeveR = MeshBuilder.CreateCapsule(`${label}-sleeve-r`, {
    height: 0.55, radius: 0.17, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveR.parent = parent;
  sleeveR.position.set(0.53, 1.78, 0);
  sleeveR.material = mat;

  // Collar ring — sits at the neckline.
  const collar = MeshBuilder.CreateTorus(`${label}-collar`, {
    diameter: 0.42, thickness: 0.04, tessellation: 18,
  }, scene);
  collar.parent = parent;
  collar.position.set(0, 2.06, 0);
  collar.scaling.set(1.0, 1.0, 0.7);
  collar.material = mat;

  // Front chest pocket.
  const pocket = MeshBuilder.CreateBox(`${label}-pocket`, {
    width: 0.18, height: 0.14, depth: 0.015,
  }, scene);
  pocket.parent = parent;
  pocket.position.set(-0.16, 1.6, 0.28);
  pocket.material = mat;

  // Hem trim ring.
  const hem = MeshBuilder.CreateTorus(`${label}-hem`, {
    diameter: 0.86, thickness: 0.022, tessellation: 24,
  }, scene);
  hem.parent = parent;
  hem.position.set(0, 1.08, 0);
  hem.scaling.set(1.0, 1.0, 0.62);
  hem.material = mat;

  return [...meshes, sleeveL, sleeveR, collar, pocket, hem];
}

function buildLongSleeveShirt(scene: Scene, parent: TransformNode, pattern: Pattern, label: string): Mesh[] {
  const { mat, meshes } = buildShirtBody(scene, parent, pattern, label, {
    topDiameter: 0.98,
    zScale: 0.62,
    bottomDiameter: 0.84,
    neckline: 0.58,
    topY: 2.07,
  });

  const sleeveL = MeshBuilder.CreateCapsule(`${label}-sleeve-l`, {
    height: 1.08, radius: 0.17, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveL.parent = parent;
  sleeveL.position.set(-0.53, 1.52, 0);
  sleeveL.material = mat;

  const sleeveR = MeshBuilder.CreateCapsule(`${label}-sleeve-r`, {
    height: 1.08, radius: 0.17, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveR.parent = parent;
  sleeveR.position.set(0.53, 1.52, 0);
  sleeveR.material = mat;

  const collar = MeshBuilder.CreateTorus(`${label}-collar`, {
    diameter: 0.44, thickness: 0.04, tessellation: 18,
  }, scene);
  collar.parent = parent;
  collar.position.set(0, 2.06, 0);
  collar.scaling.set(1.0, 1.0, 0.7);
  collar.material = mat;

  return [...meshes, sleeveL, sleeveR, collar];
}

function buildHoodie(scene: Scene, parent: TransformNode, pattern: Pattern, label: string): Mesh[] {
  const drawstringMat = createStandardMaterial(scene, `${label}-drawstring-mat`, Color3.FromHexString('#f5f5f5'));
  const { mat, meshes } = buildShirtBody(scene, parent, pattern, label, {
    topDiameter: 1.05,
    zScale: 0.64,
    bottomDiameter: 0.92,
    neckline: 0.62,
    topY: 2.1,
  });

  const sleeveL = MeshBuilder.CreateCapsule(`${label}-sleeve-l`, {
    height: 1.1, radius: 0.18, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveL.parent = parent;
  sleeveL.position.set(-0.53, 1.53, 0);
  sleeveL.material = mat;

  const sleeveR = MeshBuilder.CreateCapsule(`${label}-sleeve-r`, {
    height: 1.1, radius: 0.18, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveR.parent = parent;
  sleeveR.position.set(0.53, 1.53, 0);
  sleeveR.material = mat;

  // Hood — wraps the back-top of the head.
  const hood = MeshBuilder.CreateSphere(`${label}-hood`, {
    diameter: 0.84, segments: 18, slice: 0.72,
  }, scene);
  hood.parent = parent;
  hood.position.set(0, 2.42, -0.06);
  hood.material = mat;

  // Kangaroo pocket.
  const pocket = MeshBuilder.CreateBox(`${label}-pocket`, {
    width: 0.6, height: 0.3, depth: 0.02,
  }, scene);
  pocket.parent = parent;
  pocket.position.set(0, 1.32, 0.34);
  pocket.material = mat;

  // Drawstrings.
  const stringL = MeshBuilder.CreateCylinder(`${label}-string-l`, {
    height: 0.32, diameter: 0.025, tessellation: 8,
  }, scene);
  stringL.parent = parent;
  stringL.position.set(-0.07, 1.94, 0.32);
  stringL.material = drawstringMat;

  const stringR = MeshBuilder.CreateCylinder(`${label}-string-r`, {
    height: 0.32, diameter: 0.025, tessellation: 8,
  }, scene);
  stringR.parent = parent;
  stringR.position.set(0.07, 1.94, 0.32);
  stringR.material = drawstringMat;

  return [...meshes, sleeveL, sleeveR, hood, pocket, stringL, stringR];
}

function buildJacket(scene: Scene, parent: TransformNode, pattern: Pattern, label: string): Mesh[] {
  const buttonMat = createStandardMaterial(scene, `${label}-button-mat`, Color3.FromHexString('#caa84a'));
  const { mat, meshes } = buildShirtBody(scene, parent, pattern, label, {
    topDiameter: 1.1,
    zScale: 0.66,
    bottomDiameter: 1.0,
    neckline: 0.66,
    topY: 2.08,
  });

  const sleeveL = MeshBuilder.CreateCapsule(`${label}-sleeve-l`, {
    height: 1.1, radius: 0.19, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveL.parent = parent;
  sleeveL.position.set(-0.54, 1.53, 0);
  sleeveL.material = mat;

  const sleeveR = MeshBuilder.CreateCapsule(`${label}-sleeve-r`, {
    height: 1.1, radius: 0.19, tessellation: 18, capSubdivisions: 6,
  }, scene);
  sleeveR.parent = parent;
  sleeveR.position.set(0.54, 1.53, 0);
  sleeveR.material = mat;

  // Lapels.
  const lapelL = MeshBuilder.CreateBox(`${label}-lapel-l`, {
    width: 0.16, height: 0.5, depth: 0.04,
  }, scene);
  lapelL.parent = parent;
  lapelL.position.set(-0.14, 1.76, 0.32);
  lapelL.rotation.z = 0.22;
  lapelL.material = mat;

  const lapelR = MeshBuilder.CreateBox(`${label}-lapel-r`, {
    width: 0.16, height: 0.5, depth: 0.04,
  }, scene);
  lapelR.parent = parent;
  lapelR.position.set(0.14, 1.76, 0.32);
  lapelR.rotation.z = -0.22;
  lapelR.material = mat;

  // Button column.
  const buttons: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const button = MeshBuilder.CreateSphere(`${label}-button-${i}`, { diameter: 0.06, segments: 10 }, scene);
    button.parent = parent;
    button.position.set(0, 1.82 - i * 0.18, 0.36);
    button.material = buttonMat;
    buttons.push(button);
  }

  return [...meshes, sleeveL, sleeveR, lapelL, lapelR, ...buttons];
}

function buildPants(scene: Scene, parent: TransformNode, pattern: Pattern, label: string): Mesh[] {
  const mat = makePatternMaterial(scene, `${label}-mat`, pattern);
  // Thinner leg covers to match the slimmer body legs.
  const legCoverL = MeshBuilder.CreateCapsule(`${label}-leg-l`, {
    height: 0.92, radius: 0.22, tessellation: 18, capSubdivisions: 6,
  }, scene);
  legCoverL.parent = parent;
  legCoverL.position.set(-0.22, 0.7, 0);
  legCoverL.material = mat;

  const legCoverR = MeshBuilder.CreateCapsule(`${label}-leg-r`, {
    height: 0.92, radius: 0.22, tessellation: 18, capSubdivisions: 6,
  }, scene);
  legCoverR.parent = parent;
  legCoverR.position.set(0.22, 0.7, 0);
  legCoverR.material = mat;

  // Waistband.
  const waistband = MeshBuilder.CreateCylinder(`${label}-waistband`, {
    height: 0.1, diameter: 0.85, tessellation: 24,
  }, scene);
  waistband.parent = parent;
  waistband.position.set(0, 1.08, 0);
  waistband.scaling.set(1.0, 1.0, 0.6);
  waistband.material = mat;

  // Back pockets.
  const pocketL = MeshBuilder.CreateBox(`${label}-pocket-l`, {
    width: 0.18, height: 0.2, depth: 0.02,
  }, scene);
  pocketL.parent = parent;
  pocketL.position.set(-0.18, 0.92, -0.26);
  pocketL.material = mat;

  const pocketR = MeshBuilder.CreateBox(`${label}-pocket-r`, {
    width: 0.18, height: 0.2, depth: 0.02,
  }, scene);
  pocketR.parent = parent;
  pocketR.position.set(0.18, 0.92, -0.26);
  pocketR.material = mat;

  return [legCoverL, legCoverR, waistband, pocketL, pocketR];
}

function buildShorts(scene: Scene, parent: TransformNode, pattern: Pattern, label: string): Mesh[] {
  const mat = makePatternMaterial(scene, `${label}-mat`, pattern);
  // Shorter leg covers — only the upper third or so of the legs.
  const legCoverL = MeshBuilder.CreateCapsule(`${label}-leg-l`, {
    height: 0.55, radius: 0.22, tessellation: 18, capSubdivisions: 6,
  }, scene);
  legCoverL.parent = parent;
  legCoverL.position.set(-0.22, 0.85, 0);
  legCoverL.material = mat;

  const legCoverR = MeshBuilder.CreateCapsule(`${label}-leg-r`, {
    height: 0.55, radius: 0.22, tessellation: 18, capSubdivisions: 6,
  }, scene);
  legCoverR.parent = parent;
  legCoverR.position.set(0.22, 0.85, 0);
  legCoverR.material = mat;

  const waistband = MeshBuilder.CreateCylinder(`${label}-waistband`, {
    height: 0.1, diameter: 0.85, tessellation: 24,
  }, scene);
  waistband.parent = parent;
  waistband.position.set(0, 1.08, 0);
  waistband.scaling.set(1.0, 1.0, 0.6);
  waistband.material = mat;

  return [legCoverL, legCoverR, waistband];
}

function buildShoes(scene: Scene, parent: TransformNode, pattern: Pattern, label: string, _options?: { soleColor?: string; laceColor?: string }): Mesh[] {
  // ONE continuous mesh per side — a sliced-sphere dome scaled to a shoe
  // shape. Same silhouette signature as the bare foot (same scaling ratios),
  // just slightly larger so it visually wraps over the foot.
  const mat = makePatternMaterial(scene, `${label}-mat`, pattern);
  const meshes: Mesh[] = [];

  const buildOne = (side: 'l' | 'r', x: number) => {
    const shoe = MeshBuilder.CreateSphere(`${label}-shoe-${side}`, {
      diameter: 0.52, segments: 22, slice: 0.5,
    }, scene);
    shoe.parent = parent;
    shoe.position.set(x, 0, 0.1);
    shoe.scaling.set(0.88, 0.7, 1.7);
    shoe.material = mat;
    meshes.push(shoe);
  };

  buildOne('l', -0.22);
  buildOne('r', 0.22);

  return meshes;
}

// ─── Imported-asset helper ──────────────────────────────────────────────────
const imageAsset = (key: string, fallback: string): Pattern => {
  const url = ASSETS[key];
  return url ? { kind: 'image', url, fallbackColor: fallback } : { kind: 'solid', color: fallback };
};

const solid = (color: string): Pattern => ({ kind: 'solid', color });

// ─── Wardrobe catalog ───────────────────────────────────────────────────────
export const WARDROBE_TEXTURE_ITEMS: TextureItemDef[] = [
  // Bodypaint — paints head + torso + arms + legs + feet (all visible skin).
  {
    id: 'skin-light', label: 'Light Skin', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#f1c8a5'),
    paints: { head: solid('#f1c8a5'), torso: solid('#f1c8a5'), arms: solid('#f1c8a5'), legs: solid('#f1c8a5'), feet: solid('#f1c8a5') },
  },
  {
    id: 'skin-tan', label: 'Tan Skin', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#c79b6f'),
    paints: { head: solid('#c79b6f'), torso: solid('#c79b6f'), arms: solid('#c79b6f'), legs: solid('#c79b6f'), feet: solid('#c79b6f') },
  },
  {
    id: 'skin-deep', label: 'Deep Skin', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#7a513a'),
    paints: { head: solid('#7a513a'), torso: solid('#7a513a'), arms: solid('#7a513a'), legs: solid('#7a513a'), feet: solid('#7a513a') },
  },
  {
    id: 'skin-mint', label: 'Mint Alien', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#a8d8b9'),
    paints: { head: solid('#a8d8b9'), torso: solid('#a8d8b9'), arms: solid('#a8d8b9'), legs: solid('#a8d8b9'), feet: solid('#a8d8b9') },
  },

  // ─── Shirts (garments) ─────────────────────────────────────────────────────
  {
    id: 'shirt-white-tee', label: 'White Tee', slot: 'shirt', zIndex: 40,
    swatch: solid('#f5f5f5'),
    build: (s, p) => buildTshirt(s, p, solid('#f5f5f5'), 'shirt-white-tee'),
  },
  {
    id: 'shirt-yellow-polo', label: 'Yellow Polo', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'hatch', bg: '#e8c84a', line: '#c9a92e', spacing: 10 },
    build: (s, p) => buildTshirt(s, p, { kind: 'hatch', bg: '#e8c84a', line: '#c9a92e', spacing: 14 }, 'shirt-yellow-polo'),
  },
  {
    id: 'shirt-red-sweater', label: 'Red Sweater', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'hStripes', colors: ['#c14444', '#9c2f2f'], thickness: 10 },
    build: (s, p) => buildLongSleeveShirt(s, p, { kind: 'hStripes', colors: ['#c14444', '#9c2f2f'], thickness: 18 }, 'shirt-red-sweater'),
  },
  {
    id: 'shirt-blue-hoodie', label: 'Blue Hoodie', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'twoTone', top: '#3a6ea5', bottom: '#2c557d' },
    build: (s, p) => buildHoodie(s, p, solid('#3a6ea5'), 'shirt-blue-hoodie'),
  },
  {
    id: 'shirt-black-jacket', label: 'Black Jacket', slot: 'shirt', zIndex: 50,
    swatch: { kind: 'vStripes', colors: ['#222226', '#15151a'], thickness: 12 },
    build: (s, p) => buildJacket(s, p, solid('#222226'), 'shirt-black-jacket'),
  },

  // AI-generated clothing-fabric shirts — real fabric textures applied to
  // garment-template-shaped meshes (flannel → long-sleeve; knit → long-sleeve
  // sweater; hawaiian → t-shirt; denim → jacket; leather → jacket).
  {
    id: 'shirt-flannel', label: 'Red Flannel', slot: 'shirt', zIndex: 40,
    swatch: imageAsset('shirt-flannel', '#a52020'),
    build: (s, p) => buildLongSleeveShirt(s, p, imageAsset('shirt-flannel', '#a52020'), 'shirt-flannel'),
  },
  {
    id: 'shirt-knit', label: 'Cable-Knit Sweater', slot: 'shirt', zIndex: 40,
    swatch: imageAsset('shirt-knit', '#dccfb4'),
    build: (s, p) => buildLongSleeveShirt(s, p, imageAsset('shirt-knit', '#dccfb4'), 'shirt-knit'),
  },
  {
    id: 'shirt-hawaiian', label: 'Hawaiian Shirt', slot: 'shirt', zIndex: 40,
    swatch: imageAsset('shirt-hawaiian', '#3aa898'),
    build: (s, p) => buildTshirt(s, p, imageAsset('shirt-hawaiian', '#3aa898'), 'shirt-hawaiian'),
  },
  {
    id: 'shirt-denim', label: 'Denim Jacket', slot: 'shirt', zIndex: 50,
    swatch: imageAsset('shirt-denim', '#3b537c'),
    build: (s, p) => buildJacket(s, p, imageAsset('shirt-denim', '#3b537c'), 'shirt-denim'),
  },
  {
    id: 'shirt-leather', label: 'Leather Jacket', slot: 'shirt', zIndex: 50,
    swatch: imageAsset('shirt-leather', '#121212'),
    build: (s, p) => buildJacket(s, p, imageAsset('shirt-leather', '#121212'), 'shirt-leather'),
  },

  // ─── Pants (garments) ──────────────────────────────────────────────────────
  {
    id: 'pants-blue-jeans', label: 'Blue Jeans', slot: 'pants', zIndex: 20,
    swatch: { kind: 'hatch', bg: '#3b537c', line: '#2a3e5d', spacing: 6 },
    build: (s, p) => buildPants(s, p, { kind: 'hatch', bg: '#3b537c', line: '#2a3e5d', spacing: 8 }, 'pants-blue-jeans'),
  },
  {
    id: 'pants-black-slacks', label: 'Black Slacks', slot: 'pants', zIndex: 20,
    swatch: solid('#2a2a30'),
    build: (s, p) => buildPants(s, p, solid('#2a2a30'), 'pants-black-slacks'),
  },
  {
    id: 'pants-gray-sweats', label: 'Gray Sweats', slot: 'pants', zIndex: 20,
    swatch: { kind: 'hStripes', colors: ['#9a9ca3', '#888a91'], thickness: 8 },
    build: (s, p) => buildPants(s, p, { kind: 'hStripes', colors: ['#9a9ca3', '#888a91'], thickness: 12 }, 'pants-gray-sweats'),
  },
  {
    id: 'pants-red-shorts', label: 'Red Shorts', slot: 'pants', zIndex: 20,
    swatch: solid('#c14444'),
    build: (s, p) => buildShorts(s, p, solid('#c14444'), 'pants-red-shorts'),
  },
  {
    id: 'pants-khaki-cargo', label: 'Khaki Cargo', slot: 'pants', zIndex: 20,
    swatch: { kind: 'hatch', bg: '#a89868', line: '#8a7e54', spacing: 16 },
    build: (s, p) => buildPants(s, p, { kind: 'hatch', bg: '#a89868', line: '#8a7e54', spacing: 16 }, 'pants-khaki-cargo'),
  },
  {
    id: 'pants-plaid', label: 'Plaid Pants', slot: 'pants', zIndex: 20,
    swatch: { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 10 },
    build: (s, p) => buildPants(s, p, { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 18 }, 'pants-plaid'),
  },

  // ─── Shoes (garments) ──────────────────────────────────────────────────────
  // Sneakers + canvas trainers use the generated canvas-fabric texture; the
  // brown loafer + black boot use the generated leather texture. Sole and
  // lace colors are picked per-item so e.g. white sneakers have a rubber-
  // white sole + white laces but the canvas top texture wins the upper.
  {
    id: 'shoes-white-sneakers', label: 'White Sneakers', slot: 'shoes', zIndex: 30,
    swatch: imageAsset('shoes-canvas', '#f5f5f5'),
    build: (s, p) => buildShoes(s, p, imageAsset('shoes-canvas', '#f5f5f5'), 'shoes-white-sneakers', { soleColor: '#dadada', laceColor: '#f5f5f5' }),
  },
  {
    id: 'shoes-black-boots', label: 'Black Boots', slot: 'shoes', zIndex: 30,
    swatch: solid('#1a1a1d'),
    build: (s, p) => buildShoes(s, p, solid('#1a1a1d'), 'shoes-black-boots', { soleColor: '#0a0a0d', laceColor: '#3a3a3d' }),
  },
  {
    id: 'shoes-red-trainers', label: 'Red Trainers', slot: 'shoes', zIndex: 30,
    swatch: solid('#c14444'),
    build: (s, p) => buildShoes(s, p, solid('#c14444'), 'shoes-red-trainers', { soleColor: '#f5f5f5', laceColor: '#f5f5f5' }),
  },
  {
    id: 'shoes-brown-loafers', label: 'Brown Loafers', slot: 'shoes', zIndex: 30,
    swatch: imageAsset('shoes-leather', '#7a4a26'),
    build: (s, p) => buildShoes(s, p, imageAsset('shoes-leather', '#7a4a26'), 'shoes-brown-loafers', { soleColor: '#3a2410', laceColor: '#5a3818' }),
  },
  {
    id: 'shoes-yellow-sandals', label: 'Yellow Sandals', slot: 'shoes', zIndex: 30,
    swatch: solid('#e8c84a'),
    build: (s, p) => buildShoes(s, p, solid('#e8c84a'), 'shoes-yellow-sandals', { soleColor: '#a8893a', laceColor: '#a8893a' }),
  },
];

// ─── Accessory builders ─────────────────────────────────────────────────────
export const WARDROBE_ACCESSORY_ITEMS: AccessoryItemDef[] = [
  // Hats / glasses / scarves / backpack are each ONE continuous mesh —
  // primitives are built, materialed, then Mesh.MergeMeshes-d into a single
  // resulting block. Multi-color details (top-hat band, backpack strap) are
  // dropped because a single-mesh merge keeps a single material.
  {
    id: 'hat-cap',
    label: 'Baseball Cap',
    socket: 'head_top',
    swatch: solid('#c14444'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'hat-cap-mat', solid('#c14444'));
      const crown = MeshBuilder.CreateSphere('hat-cap-crown', { diameter: 0.74, segments: 16, slice: 0.55 }, scene);
      const brim = MeshBuilder.CreateCylinder('hat-cap-brim', { height: 0.04, diameterTop: 0.66, diameterBottom: 0.76, tessellation: 18 }, scene);
      crown.position.set(0, -0.02, 0);
      brim.position.set(0, -0.05, 0.22);
      brim.rotation.x = -0.18;
      crown.material = mat;
      brim.material = mat;
      const merged = Mesh.MergeMeshes([crown, brim], true, true);
      if (!merged) return [];
      merged.name = 'hat-cap';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'hat-top-hat',
    label: 'Top Hat',
    socket: 'head_top',
    swatch: solid('#1a1a1d'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'hat-top-mat', solid('#1a1a1d'));
      const crown = MeshBuilder.CreateCylinder('hat-top-crown', { height: 0.55, diameter: 0.52, tessellation: 24 }, scene);
      const brim = MeshBuilder.CreateCylinder('hat-top-brim', { height: 0.04, diameter: 0.82, tessellation: 24 }, scene);
      crown.position.set(0, 0.32, 0);
      brim.position.set(0, 0.04, 0);
      crown.material = mat;
      brim.material = mat;
      const merged = Mesh.MergeMeshes([crown, brim], true, true);
      if (!merged) return [];
      merged.name = 'hat-top-hat';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'hat-beanie',
    label: 'Knit Beanie',
    socket: 'head_top',
    swatch: { kind: 'hStripes', colors: ['#3a6ea5', '#2c557d'], thickness: 10 },
    build: (scene, parent) => {
      // Already a single mesh — no merge needed.
      const beanie = MeshBuilder.CreateSphere('hat-beanie', { diameter: 0.7, segments: 18, slice: 0.5 }, scene);
      beanie.parent = parent;
      beanie.position.set(0, -0.05, 0);
      const pattern: Pattern = { kind: 'hStripes', colors: ['#3a6ea5', '#2c557d'], thickness: 10 };
      beanie.material = makePatternMaterial(scene, 'hat-beanie-mat', pattern);
      return [beanie];
    },
  },
  {
    id: 'hat-wizard',
    label: 'Wizard Hat',
    socket: 'head_top',
    swatch: { kind: 'dots', bg: '#2d2470', dot: '#e8c84a', size: 16 },
    build: (scene, parent) => {
      const pattern: Pattern = { kind: 'dots', bg: '#2d2470', dot: '#e8c84a', size: 22 };
      const mat = makePatternMaterial(scene, 'hat-wiz-mat', pattern);
      const cone = MeshBuilder.CreateCylinder('hat-wiz-cone', { height: 0.85, diameterTop: 0.0, diameterBottom: 0.6, tessellation: 24 }, scene);
      const brim = MeshBuilder.CreateCylinder('hat-wiz-brim', { height: 0.04, diameter: 0.88, tessellation: 24 }, scene);
      cone.position.set(0, 0.47, 0);
      cone.rotation.z = -0.08;
      brim.position.set(0, 0.04, 0);
      cone.material = mat;
      brim.material = mat;
      const merged = Mesh.MergeMeshes([cone, brim], true, true);
      if (!merged) return [];
      merged.name = 'hat-wizard';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'glasses-round',
    label: 'Round Glasses',
    socket: 'head_front',
    swatch: solid('#22232a'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'glasses-mat', solid('#22232a'));
      const left = MeshBuilder.CreateTorus('glasses-l', { diameter: 0.22, thickness: 0.025, tessellation: 18 }, scene);
      const right = MeshBuilder.CreateTorus('glasses-r', { diameter: 0.22, thickness: 0.025, tessellation: 18 }, scene);
      const bridge = MeshBuilder.CreateBox('glasses-bridge', { width: 0.1, height: 0.025, depth: 0.025 }, scene);
      left.position.set(-0.13, 0, 0);
      left.rotation.x = Math.PI / 2;
      right.position.set(0.13, 0, 0);
      right.rotation.x = Math.PI / 2;
      bridge.position.set(0, 0, 0);
      left.material = mat;
      right.material = mat;
      bridge.material = mat;
      const merged = Mesh.MergeMeshes([left, right, bridge], true, true);
      if (!merged) return [];
      merged.name = 'glasses-round';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'glasses-shades',
    label: 'Shades',
    socket: 'head_front',
    swatch: solid('#000000'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'shades-mat', solid('#000000'));
      const lens = MeshBuilder.CreateBox('shades-lens', { width: 0.5, height: 0.12, depth: 0.04 }, scene);
      const frame = MeshBuilder.CreateBox('shades-frame', { width: 0.52, height: 0.02, depth: 0.04 }, scene);
      lens.position.set(0, 0, 0.02);
      frame.position.set(0, 0.06, 0.02);
      lens.material = mat;
      frame.material = mat;
      const merged = Mesh.MergeMeshes([lens, frame], true, true);
      if (!merged) return [];
      merged.name = 'glasses-shades';
      merged.parent = parent;
      return [merged];
    },
  },
  // Scarves built as a STACK of thin horizontal torus rings — alternating
  // colors create clearly horizontal bands wrapping the neck (not a single
  // ring with a vertical hanging tail). A short side-flap suggests the
  // scarf's end being tucked across the chest rather than dangling down.
  {
    id: 'scarf-red',
    label: 'Striped Scarf',
    socket: 'neck_front',
    swatch: { kind: 'hStripes', colors: ['#c14444', '#f5f5f5'], thickness: 6 },
    build: (scene, parent) => {
      const matA = makePatternMaterial(scene, 'scarf-red-a-mat', solid('#c14444'));
      const matB = makePatternMaterial(scene, 'scarf-red-b-mat', solid('#f5f5f5'));
      const meshes: Mesh[] = [];
      const bandColors = [matA, matB, matA, matB, matA];
      const bandSpacing = 0.05;
      const startY = bandSpacing * 2; // centred around y=0 — bands lie HORIZONTAL (XZ plane), stacked vertically.
      for (let i = 0; i < bandColors.length; i++) {
        const band = MeshBuilder.CreateTorus(`scarf-red-band-${i}`, {
          diameter: 0.6, thickness: 0.07, tessellation: 24,
        }, scene);
        band.parent = parent;
        // No rotation: default torus is in XZ plane (axis = Y), so it wraps a
        // vertical neck — exactly what we want.
        band.position.set(0, startY - i * bandSpacing, 0);
        band.material = bandColors[i];
        meshes.push(band);
      }
      // Short horizontal flap draped across the chest front.
      const flap = MeshBuilder.CreateBox('scarf-red-flap', {
        width: 0.34, height: 0.06, depth: 0.14,
      }, scene);
      flap.parent = parent;
      flap.position.set(0.08, -0.1, 0.28);
      flap.rotation.y = -0.25;
      flap.material = matA;
      meshes.push(flap);
      return meshes;
    },
  },
  {
    id: 'scarf-mustard',
    label: 'Mustard Scarf',
    socket: 'neck_front',
    swatch: { kind: 'hatch', bg: '#e8c84a', line: '#a8893a', spacing: 8 },
    build: (scene, parent) => {
      const matA = makePatternMaterial(scene, 'scarf-m-a-mat', solid('#e8c84a'));
      const matB = makePatternMaterial(scene, 'scarf-m-b-mat', solid('#a8893a'));
      const meshes: Mesh[] = [];
      const bandColors = [matA, matB, matA, matB, matA];
      const bandSpacing = 0.05;
      const startY = bandSpacing * 2;
      for (let i = 0; i < bandColors.length; i++) {
        const band = MeshBuilder.CreateTorus(`scarf-m-band-${i}`, {
          diameter: 0.6, thickness: 0.07, tessellation: 24,
        }, scene);
        band.parent = parent;
        band.position.set(0, startY - i * bandSpacing, 0);
        band.material = bandColors[i];
        meshes.push(band);
      }
      const flap = MeshBuilder.CreateBox('scarf-m-flap', {
        width: 0.34, height: 0.06, depth: 0.14,
      }, scene);
      flap.parent = parent;
      flap.position.set(0.08, -0.1, 0.28);
      flap.rotation.y = -0.25;
      flap.material = matA;
      meshes.push(flap);
      return meshes;
    },
  },
  {
    id: 'backpack-standard',
    label: 'Backpack',
    socket: 'back_center',
    swatch: solid('#3a6ea5'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'backpack-mat', solid('#3a6ea5'));
      const body = MeshBuilder.CreateBox('backpack-body', { width: 0.7, height: 0.75, depth: 0.3 }, scene);
      const strap = MeshBuilder.CreateBox('backpack-strap', { width: 0.82, height: 0.08, depth: 0.04 }, scene);
      const pocket = MeshBuilder.CreateBox('backpack-pocket', { width: 0.4, height: 0.3, depth: 0.05 }, scene);
      body.position.set(0, 0, -0.2);
      strap.position.set(0, 0.3, 0.27);
      pocket.position.set(0, -0.05, -0.38);
      body.material = mat;
      strap.material = mat;
      pocket.material = mat;
      const merged = Mesh.MergeMeshes([body, strap, pocket], true, true);
      if (!merged) return [];
      merged.name = 'backpack';
      merged.parent = parent;
      return [merged];
    },
  },
];

const TEXTURE_INDEX = new Map(WARDROBE_TEXTURE_ITEMS.map((i) => [i.id, i] as const));
const ACCESSORY_INDEX = new Map(WARDROBE_ACCESSORY_ITEMS.map((i) => [i.id, i] as const));

export function getTextureItem(id: string): TextureItemDef | undefined {
  return TEXTURE_INDEX.get(id);
}

export function getAccessoryItem(id: string): AccessoryItemDef | undefined {
  return ACCESSORY_INDEX.get(id);
}

export interface ItemField {
  field: { count: number };
  collected: number;
  update(): number;
  dispose(): void;
}

export function createItemField(_scene: Scene): ItemField {
  // LLM-EXTENSION:ITEMS — Wardrobe catalog with TWO mechanisms: (1) BODYPAINT items carry `paints` — Pattern per skin region applied directly to the actor's region StandardMaterials; (2) GARMENT items (shirts, pants, shoes) carry `build` — a builder function that creates 3D mesh sub-parts (torso shells, sleeves, leg covers, shoe boxes) sitting on top of the body with slight inflation so the skin can't poke through. Garment templates: tshirt, longSleeveShirt, hoodie, jacket, pants, shorts, shoes. Accessory items (hats, glasses, scarves, bag) parent rigid primitive sub-meshes to bone-socket TransformNodes.
  // DO NOT REMOVE the LLM-EXTENSION:ITEMS tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  return {
    field: { count: WARDROBE_TEXTURE_ITEMS.length + WARDROBE_ACCESSORY_ITEMS.length },
    collected: 0,
    update() { return 0; },
    dispose() { /* no-op */ },
  };
}
