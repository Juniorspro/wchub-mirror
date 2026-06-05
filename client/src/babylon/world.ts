// ══════════════════════════════════════════════
// Stadium park: a festive plaza on the outside of a football stadium.
// The stadium dominates the north horizon; the playable area is a 48×48
// grass park to the south, threaded by paved walkways, dotted with
// hand-placed trees (rendered as crossed-billboard SPRITES rather than
// 3D meshes, à la Don't Starve), grass tufts (same technique), and a
// championship football monument at the plaza center.
//
// World coords are XZ; +X is east, +Z is north. Server uses (x, y) where
// y maps to Babylon Z. The fair center is at (24, 0, 24).
// ══════════════════════════════════════════════

import {
  Color3,
  Color4,
  DynamicTexture,
  Material,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type ArcRotateCamera,
  type DirectionalLight,
  type HemisphericLight,
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

// Spawn point + playable park extents — unchanged so server / game.ts
// keep working with the existing coordinates.
export const FAIR_CENTER = new Vector3(24, 0, 24);
export const FAIR_SIZE = 48;
export const PLAZA_RADIUS = 4.5;

// Stadium center is north of the park. The server clamps players to
// z ≤ 85, and the stadium's south wall sits at z ≈ 90 — so players
// walk right up to the wall but can't pass through it.
const STADIUM_CENTER = new Vector3(24, 0, 140);
const STADIUM_OUTER_DIAMETER = 100;
const STADIUM_OVAL_RATIO = 1.5;
const STADIUM_WALL_HEIGHT = 22;
const STADIUM_ROOF_Y = 24;

export function createGameWorld(scene: Scene, canvas: HTMLCanvasElement): GameWorldObjects {
  // LLM-EXTENSION:WORLD — Multiplayer stadium-park: 48×48 grass park (centered at 24,0,24) just south of a large football stadium (oval cylinder + roof torus + perimeter pillars + signage at z=125). Trees and grass are rendered as CROSSED-BILLBOARD 2D sprites (two perpendicular planes per instance with canvas-painted PNG textures via DynamicTexture) for a stylized Don't-Starve look. A championship football monument sits at the plaza center. Stalls live in entities.ts at scattered/organic positions with a new design: peaked awning + back-wall banner + side panels + lanterns. Camera is ArcRotateCamera; game.ts re-targets camera.target each frame. FAIR_CENTER/FAIR_SIZE preserved so spawn + server boundaries are unchanged.
  // DO NOT REMOVE the LLM-EXTENSION:WORLD tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  const base = createBaseSceneObjects(scene, canvas);
  scene.clearColor = Color4.FromHexString(`${RUNTIME_CONFIG.world.clearColor}ff`);

  base.camera.alpha = -Math.PI / 2;
  base.camera.beta = Math.PI / 3;
  base.camera.radius = 16;
  base.camera.target.copyFrom(FAIR_CENTER);
  base.camera.lowerRadiusLimit = 4;
  base.camera.upperRadiusLimit = 60;
  base.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');

  base.hemiLight.intensity = 0.95;
  base.hemiLight.groundColor = new Color3(0.55, 0.6, 0.45);
  base.sunLight.intensity = 0.7;

  const allMeshes: Mesh[] = [];
  const allTextures: DynamicTexture[] = [];
  const allMaterials: StandardMaterial[] = [];

  // ─── Ground ───────────────────────────────────────────────────────────────
  const ground = MeshBuilder.CreateGround('park-ground', {
    width: 260, height: 260, subdivisions: 1,
  }, scene);
  ground.position.set(FAIR_CENTER.x, 0, 80);
  ground.material = createStandardMaterial(scene, 'park-ground-mat', Color3.FromHexString('#74a05f'));
  ground.receiveShadows = true;

  // ─── Plaza disc + soft shadow ─────────────────────────────────────────────
  const plazaMat = createStandardMaterial(scene, 'plaza-mat', Color3.FromHexString('#d8c5a4'));
  const plaza = MeshBuilder.CreateDisc('plaza', { radius: PLAZA_RADIUS, tessellation: 48 }, scene);
  plaza.rotation.x = Math.PI / 2;
  plaza.position.set(FAIR_CENTER.x, 0.015, FAIR_CENTER.z);
  plaza.material = plazaMat;
  allMeshes.push(plaza);

  const plazaShadow = MeshBuilder.CreateDisc('plaza-shadow', {
    radius: PLAZA_RADIUS + 0.18, tessellation: 48,
  }, scene);
  plazaShadow.rotation.x = Math.PI / 2;
  plazaShadow.position.set(FAIR_CENTER.x, 0.008, FAIR_CENTER.z);
  const shadowMat = new StandardMaterial('plaza-shadow-mat', scene);
  shadowMat.diffuseColor = Color3.FromHexString('#000000');
  shadowMat.alpha = 0.08;
  plazaShadow.material = shadowMat;
  plazaShadow.isPickable = false;
  allMeshes.push(plazaShadow);

  // ─── Walkways ─────────────────────────────────────────────────────────────
  // Park-interior cross + radial branches to stalls, PLUS a wider
  // network connecting the new outdoor attractions:
  //   - East main path extends out past the soccer field to the trophy
  //     plaza and photo spot
  //   - North spine continues to the stadium gate
  //   - Branches lead to the concession-stand cluster and amphitheater
  const pathMat = createStandardMaterial(scene, 'walkway-mat', Color3.FromHexString('#cbb389'));
  const pathSpec: Array<[number, number, number, number, number?]> = [
    // Park interior — central cross
    [24,  1, 24, 47, 2.0],
    [ 1, 24, 47, 24, 2.0],
    // Park interior — radial branches to stalls
    [24, 14, 22, 14, 1.2],
    [24, 18, 12, 16, 1.2],
    [24, 18, 35, 18, 1.2],
    [29, 24, 39, 32, 1.2],
    [24, 32, 28, 39, 1.2],
    [22, 32, 14, 34, 1.2],
    [18, 24,  8, 28, 1.2],
    // Extension — north spine to the stadium gate
    [24, 47, 24, 82, 2.0],
    // Extension — east main artery past soccer + shoes to photo spot
    [47, 24, 100, 24, 1.8],
    // Branch — main artery → shoes stall + soccer field's south end
    [70, 24, 80, 20, 1.4],
    // Branch — south to concession cluster
    [60, 24, 60, 12, 1.4],
    // Branch — north to amphitheater
    [62, 45, 62, 65, 1.4],
    // Branch — north to trophy plaza (NE corner)
    [100, 24, 100, 58, 1.6],
  ];
  for (const [x1, z1, x2, z2, w] of pathSpec) {
    allMeshes.push(buildWalkway(scene, x1, z1, x2, z2, w ?? 1.5, pathMat));
  }

  // ─── Soccer practice field ────────────────────────────────────────────────
  for (const m of buildSoccerField(scene, 72, 32)) allMeshes.push(m);

  // ─── Stadium entrance gate ────────────────────────────────────────────────
  for (const m of buildStadiumGate(scene, 24, 82)) allMeshes.push(m);

  // ─── Concession stand cluster (south-east, 4 colorful food carts) ────────
  for (const m of buildConcessionCluster(scene, 60, 12)) allMeshes.push(m);

  // ─── Trophy plaza (north-east corner) ─────────────────────────────────────
  for (const m of buildTrophyPlaza(scene, 100, 60)) allMeshes.push(m);

  // ─── Photo selfie spot (far east) ─────────────────────────────────────────
  for (const m of buildPhotoSpot(scene, 100, 25)) allMeshes.push(m);

  // ─── Amphitheater (north of soccer field) ─────────────────────────────────
  for (const m of buildAmphitheater(scene, 62, 70)) allMeshes.push(m);

  // ─── Stadium ──────────────────────────────────────────────────────────────
  for (const m of buildStadium(scene, STADIUM_CENTER.x, STADIUM_CENTER.z)) {
    allMeshes.push(m);
  }

  // ─── Centerpiece: championship football monument at plaza center ──────────
  for (const m of buildCenterpiece(scene, FAIR_CENTER.x, FAIR_CENTER.z)) {
    allMeshes.push(m);
  }

  // ─── Trees — crossed-billboard sprites ────────────────────────────────────
  // ONE texture + ONE material per type, shared across all instances of
  // that type. Each tree contributes 2 perpendicular planes (so the
  // silhouette reads as 3D from any rotation angle).
  const oakTex = makeOakTexture(scene);
  const pineTex = makePineTexture(scene);
  allTextures.push(oakTex, pineTex);
  const oakMat = makeFoliageMaterial(scene, 'oak-sprite-mat', oakTex);
  const pineMat = makeFoliageMaterial(scene, 'pine-sprite-mat', pineTex);
  allMaterials.push(oakMat, pineMat);

  // Tree positions span the FULL 260×260 ground, not just the playable
  // 48×48 park. Inside the park we keep a sparse handful (so walkways
  // and stalls breathe); outside we add forest fringes to the south,
  // east, west, and a buffer grove between the park edge and the
  // stadium. Outer trees are larger so they read at distance as proper
  // park trees rather than shrubs. Positions are hand-placed and
  // avoid: the stadium footprint (x ∈ [-51, 99] && z ∈ [75, 175]) and
  // the central walkways.
  // Thinned tree set (~35 trees, was 55) — opens the map so the new
  // attractions (trophy plaza, concession cluster, photo spot,
  // amphitheater) read clearly without forest clutter around them.
  // Stays clear of: stadium footprint, walkways, attraction footprints.
  const treeSpec: Array<[number, number, 'oak' | 'pine', number]> = [
    // ─── Park interior — left as borders only, center clear ─────────────────
    [ 6, 10, 'oak',  1.9],
    [ 5, 32, 'oak',  1.7],
    [ 6, 42, 'pine', 1.9],
    [18,  6, 'pine', 1.7],
    [30,  6, 'oak',  1.9],
    [42, 12, 'oak',  1.8],
    [44, 22, 'pine', 1.7],
    [43, 32, 'oak',  1.9],
    [36, 45, 'oak',  1.7],
    [18, 44, 'pine', 1.8],

    // ─── South forest fringe (z < 0) — thinned, mainly silhouette ──────────
    [-15, -12, 'pine', 2.0],
    [ 10, -16, 'pine', 2.2],
    [ 40, -10, 'pine', 1.9],
    [ 70,  -8, 'pine', 2.1],
    [ 30, -38, 'oak',  2.4],
    [ 90, -25, 'oak',  2.2],

    // ─── East scatter — sparse so attractions stand out ─────────────────────
    [ 88,  10, 'oak',  2.1],
    [113,  18, 'pine', 2.0],
    [113,  45, 'oak',  2.2],
    [114,  68, 'pine', 2.0],

    // ─── West side (x < 0) — minimal frame ─────────────────────────────────
    [-22,  28, 'pine', 1.9],
    [-14,  58, 'oak',  2.3],
    [-30,  12, 'pine', 1.9],

    // ─── North buffer — frame the stadium gate ──────────────────────────────
    [  8,  72, 'oak',  2.1],
    [ 42,  74, 'pine', 2.0],
    [ -6,  60, 'pine', 1.9],
    [ 46,  56, 'oak',  2.0],

    // ─── Behind stadium (z > 175, deep background) ─────────────────────────
    [-15, 180, 'pine', 2.5],
    [ 50, 190, 'oak',  2.6],
    [ 90, 185, 'pine', 2.5],
  ];
  for (const [x, z, type, scale] of treeSpec) {
    const mat = type === 'oak' ? oakMat : pineMat;
    for (const m of buildSpriteTree(scene, x, z, scale, mat, type)) allMeshes.push(m);
  }

  // ─── Grass tufts — sprite-stacked across the green areas ──────────────────
  // One shared material; many tiny instances scattered with a 2D Poisson-
  // ish distribution that AVOIDS walkways, the plaza, and the centerpiece.
  const grassTex = makeGrassTexture(scene);
  allTextures.push(grassTex);
  const grassMat = makeFoliageMaterial(scene, 'grass-sprite-mat', grassTex);
  allMaterials.push(grassMat);

  // Hand-generated lattice with small jitter — deterministic so all
  // clients see the same scatter. Filtered to keep tufts off walkways,
  // off the plaza, and away from the stadium itself.
  let grassIdx = 0;
  for (let gx = 2; gx < 46; gx += 2.6) {
    for (let gz = 2; gz < 46; gz += 2.6) {
      // Deterministic jitter so the grid doesn't read as a checkerboard.
      const jx = (Math.sin(grassIdx * 12.9898) * 43758.5453) % 1;
      const jz = (Math.sin(grassIdx * 78.233)  * 43758.5453) % 1;
      const x = gx + jx * 1.5;
      const z = gz + jz * 1.5;
      grassIdx++;
      if (!isGrassOpenArea(x, z)) continue;
      for (const m of buildGrassTuft(scene, x, z, grassMat, grassIdx)) allMeshes.push(m);
    }
  }

  // ─── Benches ──────────────────────────────────────────────────────────────
  const benchSpec: Array<[number, number, number]> = [
    [21,  9,  Math.PI],
    [27,  9,  0],
    [21, 43,  Math.PI],
    [27, 43,  0],
    [ 9, 21,  Math.PI / 2],
    [ 9, 27, -Math.PI / 2],
    [39, 21,  Math.PI / 2],
    [39, 27, -Math.PI / 2],
  ];
  for (const [x, z, rot] of benchSpec) {
    for (const m of buildBench(scene, x, z, rot)) allMeshes.push(m);
  }

  return {
    ...base,
    ground,
    dispose() {
      ground.dispose();
      for (const m of allMeshes) m.dispose();
      for (const mat of allMaterials) mat.dispose();
      for (const t of allTextures) t.dispose();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Open-area filter for grass: rejects positions that overlap walkways,
// the plaza, the centerpiece base, or the bench footprints.
function isGrassOpenArea(x: number, z: number): boolean {
  // Plaza disc + centerpiece radius
  const dPlaza = Math.hypot(x - 24, z - 24);
  if (dPlaza < PLAZA_RADIUS + 0.5) return false;

  // Main + cross walkways (1.2 wide buffer)
  if (Math.abs(x - 24) < 1.5) return false;
  if (Math.abs(z - 24) < 1.5) return false;

  // Skip tiles very close to known stall positions (small clearing
  // around each stall counter so grass doesn't poke through the booth).
  const stallPts = [
    [12, 16], [35, 18], [39, 32], [28, 39],
    [14, 34], [8, 28], [24, 14],
  ];
  for (const [sx, sz] of stallPts) {
    if (Math.hypot(x - sx, z - sz) < 2.4) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Walkway: thin paved box from (x1, z1) to (x2, z2).
function buildWalkway(scene: Scene, x1: number, z1: number, x2: number, z2: number, width: number, mat: StandardMaterial): Mesh {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  const midX = (x1 + x2) / 2;
  const midZ = (z1 + z2) / 2;
  const angle = Math.atan2(dz, dx);

  const path = MeshBuilder.CreateBox('walkway', {
    width: length, height: 0.04, depth: width,
  }, scene);
  path.position.set(midX, 0.02, midZ);
  path.rotation.y = -angle;
  path.material = mat;
  path.isPickable = false;
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Foliage materials: alpha-tested (no semi-transparency to sort), two-
// sided, slightly self-lit so the planes don't acquire harsh directional
// shading from one side.
function makeFoliageMaterial(scene: Scene, name: string, tex: DynamicTexture): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = tex;
  mat.diffuseTexture.hasAlpha = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  // Alpha-test (cut-off) instead of alpha-blend → no back-to-front
  // sorting issues with many overlapping foliage planes.
  mat.transparencyMode = Material.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.4;
  mat.specularColor = new Color3(0, 0, 0);
  // Self-illumination so the back side of the flat plane doesn't read
  // as pitch dark when the directional sun is in front of it.
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.45, 0.45, 0.45);
  return mat;
}

// Sprite-stacked tree — two perpendicular planes at the same XZ point.
// One faces the X axis, the other faces the Z axis; together the
// silhouette reads as a 3D shape from any camera angle.
function buildSpriteTree(scene: Scene, x: number, z: number, scale: number, mat: StandardMaterial, type: 'oak' | 'pine'): Mesh[] {
  // Texture aspect is 1:1 but pine renders taller than oak by ~1.4.
  // Base size bumped 5 → 9 so trees reach ~5-7× the avatar height for
  // a proper "park tree looming over you" feel.
  const aspectY = type === 'oak' ? 1.1 : 1.4;
  const size = 9 * scale;
  const planeOpts = { width: size, height: size * aspectY, sideOrientation: Mesh.DOUBLESIDE };

  const meshes: Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const plane = MeshBuilder.CreatePlane(`tree-${type}-${x}-${z}-${i}`, planeOpts, scene);
    plane.position.set(x, (size * aspectY) / 2, z);
    plane.rotation.y = (i * Math.PI) / 2;
    plane.material = mat;
    plane.isPickable = false;
    meshes.push(plane);
  }
  return meshes;
}

// Sprite-stacked grass tuft — same technique, smaller. Light random
// rotation around Y per instance so the field doesn't read as aligned.
function buildGrassTuft(scene: Scene, x: number, z: number, mat: StandardMaterial, seed: number): Mesh[] {
  // Pseudo-random size + rotation, deterministic from seed.
  const r1 = ((Math.sin(seed * 17.31)  * 43758.5453) % 1 + 1) % 1;
  const r2 = ((Math.sin(seed * 53.179) * 43758.5453) % 1 + 1) % 1;
  const size = 0.6 + r1 * 0.4;
  const baseRot = r2 * Math.PI;

  const planeOpts = { width: size, height: size, sideOrientation: Mesh.DOUBLESIDE };
  const meshes: Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const plane = MeshBuilder.CreatePlane(`grass-${seed}-${i}`, planeOpts, scene);
    plane.position.set(x, size / 2, z);
    plane.rotation.y = baseRot + (i * Math.PI) / 2;
    plane.material = mat;
    plane.isPickable = false;
    meshes.push(plane);
  }
  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// TEXTURES — canvas-painted "PNG sprites" for the foliage.
// Each builder creates a transparent canvas at the given size, paints
// the silhouette + a couple of shading passes, returns the texture.

const TREE_TEX_SIZE = 256;
const GRASS_TEX_SIZE = 64;

function makeOakTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture('oak-sprite-tex', { width: TREE_TEX_SIZE, height: TREE_TEX_SIZE }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, TREE_TEX_SIZE, TREE_TEX_SIZE);

  // Trunk
  ctx.fillStyle = '#5d3e23';
  ctx.fillRect(116, 165, 24, 85);
  // Trunk shadow on left side
  ctx.fillStyle = '#3e2814';
  ctx.fillRect(116, 165, 8, 85);

  // Foliage — overlapping circles for an organic bushy silhouette.
  const blobs: Array<[number, number, number, string]> = [
    [128,  90, 65, '#3a7036'],
    [ 88, 122, 50, '#3a7036'],
    [168, 122, 50, '#3a7036'],
    [108,  68, 45, '#3a7036'],
    [148,  68, 45, '#3a7036'],
  ];
  for (const [bx, by, br, fill] of blobs) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
  }
  // Highlights (lighter green on the upper-left)
  ctx.fillStyle = '#5fa050';
  ctx.beginPath();
  ctx.arc(95, 75, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(135, 95, 22, 0, Math.PI * 2);
  ctx.fill();
  // Dark base shadow
  ctx.fillStyle = '#2b5226';
  ctx.beginPath();
  ctx.arc(128, 155, 50, 0, Math.PI * 2);
  ctx.fill();

  tex.update();
  return tex;
}

function makePineTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture('pine-sprite-tex', { width: TREE_TEX_SIZE, height: TREE_TEX_SIZE }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, TREE_TEX_SIZE, TREE_TEX_SIZE);

  // Trunk (shorter for pines — tucked under the lowest foliage layer)
  ctx.fillStyle = '#4a2f1a';
  ctx.fillRect(120, 210, 16, 40);
  ctx.fillStyle = '#33200f';
  ctx.fillRect(120, 210, 6, 40);

  // Three stacked tapered triangles for a classic conifer silhouette.
  const layers: Array<[number, number, number]> = [
    // [centerX, peakY, baseY]
    [128,  10,  90],
    [128,  60, 150],
    [128, 110, 215],
  ];
  for (let i = 0; i < layers.length; i++) {
    const [cx, peakY, baseY] = layers[i];
    const halfWidth = 50 + i * 18;
    ctx.fillStyle = '#2a5e30';
    ctx.beginPath();
    ctx.moveTo(cx, peakY);
    ctx.lineTo(cx - halfWidth, baseY);
    ctx.lineTo(cx + halfWidth, baseY);
    ctx.closePath();
    ctx.fill();
    // Lighter highlight on the left side of each layer
    ctx.fillStyle = '#3f7a3e';
    ctx.beginPath();
    ctx.moveTo(cx, peakY);
    ctx.lineTo(cx - halfWidth * 0.5, baseY);
    ctx.lineTo(cx, baseY);
    ctx.closePath();
    ctx.fill();
  }

  tex.update();
  return tex;
}

function makeGrassTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture('grass-sprite-tex', { width: GRASS_TEX_SIZE, height: GRASS_TEX_SIZE }, scene, false);
  tex.hasAlpha = true;
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, GRASS_TEX_SIZE, GRASS_TEX_SIZE);

  // Tuft of vertical blades. We draw 6 narrow tapered triangles fanning
  // up from a central root. Each gets a slight color variation.
  const greens = ['#4d8a3e', '#3e7a36', '#5a9a4a', '#447030'];
  const rootX = GRASS_TEX_SIZE / 2;
  const rootY = GRASS_TEX_SIZE - 4;
  for (let i = 0; i < 6; i++) {
    const angle = -Math.PI / 2 + (i - 2.5) * 0.18;
    const length = 32 + (i % 3) * 6;
    const tipX = rootX + Math.cos(angle) * length;
    const tipY = rootY + Math.sin(angle) * length;
    ctx.fillStyle = greens[i % greens.length];
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(rootX - 3, rootY);
    ctx.lineTo(rootX + 3, rootY);
    ctx.closePath();
    ctx.fill();
  }

  tex.update();
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bench: unchanged from prior version.
function buildBench(scene: Scene, x: number, z: number, rotationY: number): Mesh[] {
  const meshes: Mesh[] = [];
  const woodMat = createStandardMaterial(scene, `bench-wood-${x}-${z}`, Color3.FromHexString('#8a6435'));
  const legMat = createStandardMaterial(scene, `bench-leg-${x}-${z}`, Color3.FromHexString('#383838'));

  const place = (mesh: Mesh, lx: number, ly: number, lz: number): void => {
    const wx = x + lx * Math.cos(rotationY) - lz * Math.sin(rotationY);
    const wz = z + lx * Math.sin(rotationY) + lz * Math.cos(rotationY);
    mesh.position.set(wx, ly, wz);
    mesh.rotation.y = rotationY;
  };

  const seat = MeshBuilder.CreateBox(`bench-seat-${x}-${z}`, {
    width: 1.6, height: 0.08, depth: 0.5,
  }, scene);
  place(seat, 0, 0.45, 0);
  seat.material = woodMat;
  meshes.push(seat);

  const back = MeshBuilder.CreateBox(`bench-back-${x}-${z}`, {
    width: 1.6, height: 0.55, depth: 0.07,
  }, scene);
  place(back, 0, 0.73, -0.22);
  back.material = woodMat;
  meshes.push(back);

  const legOffsets: Array<[number, number]> = [
    [-0.72, -0.18], [0.72, -0.18], [-0.72, 0.18], [0.72, 0.18],
  ];
  for (let i = 0; i < legOffsets.length; i++) {
    const [lx, lz] = legOffsets[i];
    const leg = MeshBuilder.CreateBox(`bench-leg-${x}-${z}-${i}`, {
      width: 0.08, height: 0.42, depth: 0.08,
    }, scene);
    place(leg, lx, 0.21, lz);
    leg.material = legMat;
    meshes.push(leg);
  }
  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Centerpiece: a championship football monument at the plaza center.
// Stone pedestal (3 stacked cylinders for base / column / cap) topped by
// a giant gold soccer ball with hex-patch detail.
function buildCenterpiece(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const stoneMat = createStandardMaterial(scene, 'cp-stone', Color3.FromHexString('#a9a59a'));
  const stoneAccentMat = createStandardMaterial(scene, 'cp-stone-accent', Color3.FromHexString('#7e7a70'));
  const goldMat = createStandardMaterial(scene, 'cp-gold', Color3.FromHexString('#e6c34a'));
  goldMat.specularColor = new Color3(0.9, 0.75, 0.3);
  goldMat.specularPower = 64;
  const darkMat = createStandardMaterial(scene, 'cp-dark', Color3.FromHexString('#2b2820'));

  // Base — wide drum
  const base = MeshBuilder.CreateCylinder('cp-base', {
    height: 0.35, diameterTop: 2.4, diameterBottom: 2.8, tessellation: 24,
  }, scene);
  base.position.set(cx, 0.175, cz);
  base.material = stoneMat;
  meshes.push(base);

  // Lower trim ring
  const trim1 = MeshBuilder.CreateCylinder('cp-trim-1', {
    height: 0.1, diameter: 2.3, tessellation: 24,
  }, scene);
  trim1.position.set(cx, 0.4, cz);
  trim1.material = stoneAccentMat;
  meshes.push(trim1);

  // Column
  const column = MeshBuilder.CreateCylinder('cp-column', {
    height: 1.6, diameter: 1.1, tessellation: 24,
  }, scene);
  column.position.set(cx, 1.25, cz);
  column.material = stoneMat;
  meshes.push(column);

  // Upper trim ring
  const trim2 = MeshBuilder.CreateCylinder('cp-trim-2', {
    height: 0.12, diameter: 1.3, tessellation: 24,
  }, scene);
  trim2.position.set(cx, 2.11, cz);
  trim2.material = stoneAccentMat;
  meshes.push(trim2);

  // Cap (slightly wider on top to receive the ball)
  const cap = MeshBuilder.CreateCylinder('cp-cap', {
    height: 0.3, diameterTop: 1.6, diameterBottom: 1.3, tessellation: 24,
  }, scene);
  cap.position.set(cx, 2.32, cz);
  cap.material = stoneMat;
  meshes.push(cap);

  // Gold ball
  const ball = MeshBuilder.CreateSphere('cp-ball', { diameter: 1.5, segments: 24 }, scene);
  ball.position.set(cx, 3.3, cz);
  ball.material = goldMat;
  meshes.push(ball);

  // Football panel pattern — small dark hex-shaped patches on the ball.
  // Each patch is a small disc, slightly offset OUTWARD from the ball
  // center so it sits flush with the sphere's surface.
  const patchPositions: Array<[number, number]> = [
    [0,         0],
    [Math.PI / 3,        Math.PI / 4],
    [-Math.PI / 3,      -Math.PI / 4],
    [2 * Math.PI / 3,    Math.PI / 4],
    [-2 * Math.PI / 3,  -Math.PI / 4],
    [Math.PI,             0],
  ];
  const ballRadius = 0.75;
  const patchOffset = ballRadius + 0.005;
  for (let i = 0; i < patchPositions.length; i++) {
    const [longitude, latitude] = patchPositions[i];
    const px = cx + Math.cos(latitude) * Math.cos(longitude) * patchOffset;
    const py = 3.3 + Math.sin(latitude) * patchOffset;
    const pz = cz + Math.cos(latitude) * Math.sin(longitude) * patchOffset;
    const patch = MeshBuilder.CreateDisc(`cp-patch-${i}`, { radius: 0.18, tessellation: 6 }, scene);
    patch.position.set(px, py, pz);
    // Make the disc face outward from the ball center.
    patch.lookAt(new Vector3(cx + (px - cx) * 100, 3.3 + (py - 3.3) * 100, cz + (pz - cz) * 100));
    patch.material = darkMat;
    meshes.push(patch);
  }

  // Plaque on the front of the pedestal
  const plaque = MeshBuilder.CreateBox('cp-plaque', {
    width: 0.8, height: 0.5, depth: 0.05,
  }, scene);
  plaque.position.set(cx, 1.25, cz - 0.58);
  plaque.material = stoneAccentMat;
  meshes.push(plaque);

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Soccer practice field — a striped grass pitch with two goalposts. The
// pitch surface is just a flat box; the goals are simple frame meshes
// at each short end. Centered on (cx, cz). Pitch span: ~20 × 28 units.
function buildSoccerField(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const turfMat = createStandardMaterial(scene, 'soccer-turf-mat', Color3.FromHexString('#3e8a3a'));
  const lineMat = createStandardMaterial(scene, 'soccer-line-mat', Color3.FromHexString('#f4f4ee'));
  const goalMat = createStandardMaterial(scene, 'soccer-goal-mat', Color3.FromHexString('#f4f4ee'));

  // Pitch (slightly above ground so it doesn't z-fight)
  const pitch = MeshBuilder.CreateBox('soccer-pitch', {
    width: 18, height: 0.05, depth: 26,
  }, scene);
  pitch.position.set(cx, 0.03, cz);
  pitch.material = turfMat;
  pitch.isPickable = false;
  meshes.push(pitch);

  // Border lines — thin white strips along the pitch outline
  const borderSpec: Array<[number, number, number, number]> = [
    // [w, d, dx, dz] relative to pitch center
    [18, 0.2,  0,  13],   // long line, far end
    [18, 0.2,  0, -13],   // long line, near end
    [0.2, 26,  9,   0],   // side line, +X
    [0.2, 26, -9,   0],   // side line, -X
    [18, 0.2,  0,   0],   // center line
  ];
  for (let i = 0; i < borderSpec.length; i++) {
    const [w, d, dx, dz] = borderSpec[i];
    const line = MeshBuilder.CreateBox(`soccer-line-${i}`, {
      width: w, height: 0.03, depth: d,
    }, scene);
    line.position.set(cx + dx, 0.06, cz + dz);
    line.material = lineMat;
    line.isPickable = false;
    meshes.push(line);
  }

  // Center circle
  const centerCircle = MeshBuilder.CreateTorus('soccer-center-circle', {
    diameter: 5, thickness: 0.18, tessellation: 32,
  }, scene);
  centerCircle.position.set(cx, 0.05, cz);
  centerCircle.material = lineMat;
  centerCircle.isPickable = false;
  meshes.push(centerCircle);

  // Two goals — one on each short end (+Z and -Z from center).
  for (const sign of [1, -1] as const) {
    const goalZ = cz + sign * 13.4;
    // Crossbar
    const crossbar = MeshBuilder.CreateBox(`soccer-goal-${sign}-crossbar`, {
      width: 5, height: 0.15, depth: 0.15,
    }, scene);
    crossbar.position.set(cx, 2.2, goalZ);
    crossbar.material = goalMat;
    meshes.push(crossbar);

    // Left + right posts
    for (const px of [-2.4, 2.4]) {
      const post = MeshBuilder.CreateCylinder(`soccer-goal-${sign}-post-${px}`, {
        height: 2.3, diameter: 0.18, tessellation: 8,
      }, scene);
      post.position.set(cx + px, 1.15, goalZ);
      post.material = goalMat;
      meshes.push(post);
    }
    // Back depth posts (forming the rectangular goal box from above)
    for (const px of [-2.4, 2.4]) {
      const backPost = MeshBuilder.CreateCylinder(`soccer-goal-${sign}-back-${px}`, {
        height: 2.3, diameter: 0.15, tessellation: 8,
      }, scene);
      backPost.position.set(cx + px, 1.15, goalZ + sign * 1.0);
      backPost.material = goalMat;
      meshes.push(backPost);
    }
    // Back crossbar
    const backCrossbar = MeshBuilder.CreateBox(`soccer-goal-${sign}-back-crossbar`, {
      width: 5, height: 0.12, depth: 0.12,
    }, scene);
    backCrossbar.position.set(cx, 2.2, goalZ + sign * 1.0);
    backCrossbar.material = goalMat;
    meshes.push(backCrossbar);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stadium entrance gate — a pair of tall pylons with a connecting arch
// banner. Sits just inside the world's north boundary (z ≈ 82, server
// clamps at z=85), so players walking up the spine path arrive AT the
// gate but bump against the boundary before walking through the stadium.
function buildStadiumGate(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const pylonMat = createStandardMaterial(scene, 'gate-pylon-mat', Color3.FromHexString('#ededea'));
  const accentMat = createStandardMaterial(scene, 'gate-accent-mat', Color3.FromHexString('#3a6ea5'));
  const goldMat = createStandardMaterial(scene, 'gate-gold-mat', Color3.FromHexString('#e6c34a'));

  // Left + right pylons (square columns flanking the path)
  const pylonHeight = 7;
  for (const sign of [-1, 1] as const) {
    const pylon = MeshBuilder.CreateBox(`gate-pylon-${sign}`, {
      width: 1.4, height: pylonHeight, depth: 1.4,
    }, scene);
    pylon.position.set(cx + sign * 3.5, pylonHeight / 2, cz);
    pylon.material = pylonMat;
    meshes.push(pylon);

    // Gold cap on each pylon
    const cap = MeshBuilder.CreateCylinder(`gate-cap-${sign}`, {
      height: 0.4, diameterTop: 0.9, diameterBottom: 1.5, tessellation: 12,
    }, scene);
    cap.position.set(cx + sign * 3.5, pylonHeight + 0.2, cz);
    cap.material = goldMat;
    meshes.push(cap);
  }

  // Arch banner connecting the two pylons
  const arch = MeshBuilder.CreateBox('gate-arch', {
    width: 8, height: 1.8, depth: 0.6,
  }, scene);
  arch.position.set(cx, pylonHeight - 0.4, cz);
  arch.material = accentMat;
  meshes.push(arch);

  // Top trim on the arch
  const trim = MeshBuilder.CreateBox('gate-trim', {
    width: 8.4, height: 0.3, depth: 0.7,
  }, scene);
  trim.position.set(cx, pylonHeight + 0.65, cz);
  trim.material = goldMat;
  meshes.push(trim);

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concession-stand cluster: 4 small food carts ringed around a central
// open paved square. Each cart has a counter, peaked striped awning, a
// flag, and a slightly different color to read as a festival row.
function buildConcessionCluster(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const paveMat = createStandardMaterial(scene, 'concession-pave-mat', Color3.FromHexString('#d3b88a'));
  const counterMat = createStandardMaterial(scene, 'concession-counter-mat', Color3.FromHexString('#a07851'));
  const postMat = createStandardMaterial(scene, 'concession-post-mat', Color3.FromHexString('#6b4628'));

  // Central paved square (a slightly larger plaza for the cluster)
  const plazaSquare = MeshBuilder.CreateBox('concession-plaza', {
    width: 10, height: 0.05, depth: 10,
  }, scene);
  plazaSquare.position.set(cx, 0.025, cz);
  plazaSquare.material = paveMat;
  plazaSquare.isPickable = false;
  meshes.push(plazaSquare);

  // Four carts at the cardinal directions of the plaza
  const cartColors = ['#d96b6b', '#e8c84a', '#3a6ea5', '#9bd96b'];
  const cartOffsets: Array<[number, number, number]> = [
    [ 0,  4.5, Math.PI],     // N edge, facing south
    [ 4.5, 0, -Math.PI / 2], // E edge, facing west
    [ 0, -4.5, 0],           // S edge, facing north
    [-4.5, 0,  Math.PI / 2], // W edge, facing east
  ];
  for (let i = 0; i < 4; i++) {
    const [dx, dz, facing] = cartOffsets[i];
    const cartX = cx + dx;
    const cartZ = cz + dz;
    const awningMat = createStandardMaterial(scene, `concession-${i}-awn-mat`, Color3.FromHexString(cartColors[i]));
    const trimMat = createStandardMaterial(scene, `concession-${i}-trim-mat`, Color3.FromHexString('#f4ecd9'));
    const root = new TransformNode(`concession-${i}-root`, scene);
    root.position.set(cartX, 0, cartZ);
    root.rotation.y = facing;

    // Counter
    const counter = MeshBuilder.CreateBox(`concession-${i}-counter`, {
      width: 1.8, height: 0.9, depth: 0.6,
    }, scene);
    counter.parent = root;
    counter.position.set(0, 0.45, 0);
    counter.material = counterMat;
    meshes.push(counter);
    // Counter top
    const top = MeshBuilder.CreateBox(`concession-${i}-counter-top`, {
      width: 2.0, height: 0.06, depth: 0.7,
    }, scene);
    top.parent = root;
    top.position.set(0, 0.93, 0);
    top.material = trimMat;
    meshes.push(top);

    // Two posts
    for (const sign of [-1, 1] as const) {
      const post = MeshBuilder.CreateBox(`concession-${i}-post-${sign}`, {
        width: 0.1, height: 2.2, depth: 0.1,
      }, scene);
      post.parent = root;
      post.position.set(sign * 0.85, 1.1, 0.05);
      post.material = postMat;
      meshes.push(post);
    }

    // Peaked awning (two slanted panels)
    for (const sign of [-1, 1] as const) {
      const panel = MeshBuilder.CreateBox(`concession-${i}-roof-${sign}`, {
        width: 2.2, height: 0.07, depth: 0.7,
      }, scene);
      panel.parent = root;
      panel.position.set(0, 2.35, sign * 0.25);
      panel.rotation.x = sign * 0.55;
      panel.material = awningMat;
      meshes.push(panel);
    }
    // Ridge cap
    const ridge = MeshBuilder.CreateBox(`concession-${i}-ridge`, {
      width: 2.25, height: 0.08, depth: 0.1,
    }, scene);
    ridge.parent = root;
    ridge.position.set(0, 2.62, 0);
    ridge.material = trimMat;
    meshes.push(ridge);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trophy plaza: a small paved disc with a giant championship trophy in
// the middle and four smaller pedestals (one per cardinal direction)
// holding mini-trophies — like a winners' display.
function buildTrophyPlaza(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const paveMat = createStandardMaterial(scene, 'trophy-plaza-pave-mat', Color3.FromHexString('#d8c5a4'));
  const stoneMat = createStandardMaterial(scene, 'trophy-stone-mat', Color3.FromHexString('#9c968b'));
  const goldMat = createStandardMaterial(scene, 'trophy-gold-mat', Color3.FromHexString('#e8c84a'));
  goldMat.specularColor = new Color3(0.9, 0.75, 0.3);
  goldMat.specularPower = 64;
  const silverMat = createStandardMaterial(scene, 'trophy-silver-mat', Color3.FromHexString('#c8c8d0'));
  silverMat.specularColor = new Color3(0.7, 0.7, 0.75);

  // Paved disc base
  const disc = MeshBuilder.CreateDisc('trophy-plaza-disc', {
    radius: 6, tessellation: 32,
  }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(cx, 0.02, cz);
  disc.material = paveMat;
  disc.isPickable = false;
  meshes.push(disc);

  // Central tall pedestal + giant trophy
  const ped = MeshBuilder.CreateCylinder('trophy-main-pedestal', {
    height: 1.8, diameterTop: 1.4, diameterBottom: 1.6, tessellation: 24,
  }, scene);
  ped.position.set(cx, 0.9, cz);
  ped.material = stoneMat;
  meshes.push(ped);

  // Trophy: cup + handles + base ring + stem
  const trophyStem = MeshBuilder.CreateCylinder('trophy-main-stem', {
    height: 0.6, diameter: 0.4, tessellation: 16,
  }, scene);
  trophyStem.position.set(cx, 2.1, cz);
  trophyStem.material = goldMat;
  meshes.push(trophyStem);

  const trophyBaseRing = MeshBuilder.CreateCylinder('trophy-main-baseRing', {
    height: 0.18, diameter: 0.95, tessellation: 16,
  }, scene);
  trophyBaseRing.position.set(cx, 1.89, cz);
  trophyBaseRing.material = goldMat;
  meshes.push(trophyBaseRing);

  const cup = MeshBuilder.CreateCylinder('trophy-main-cup', {
    height: 1.2, diameterTop: 1.3, diameterBottom: 0.7, tessellation: 24,
  }, scene);
  cup.position.set(cx, 3.0, cz);
  cup.material = goldMat;
  meshes.push(cup);

  // Two handles (toruses on the side of the cup)
  for (const sign of [-1, 1] as const) {
    const handle = MeshBuilder.CreateTorus(`trophy-main-handle-${sign}`, {
      diameter: 0.55, thickness: 0.1, tessellation: 16,
    }, scene);
    handle.position.set(cx + sign * 0.75, 3.0, cz);
    handle.rotation.z = Math.PI / 2;
    handle.material = goldMat;
    meshes.push(handle);
  }

  // Cup top — a small ring + cap to give the trophy a finished look
  const cupTop = MeshBuilder.CreateTorus('trophy-main-rim', {
    diameter: 1.3, thickness: 0.08, tessellation: 24,
  }, scene);
  cupTop.position.set(cx, 3.6, cz);
  cupTop.material = goldMat;
  meshes.push(cupTop);

  // Four smaller pedestals + mini-trophies around the main one
  const surroundOffsets: Array<[number, number]> = [
    [0, 3.5], [3.5, 0], [0, -3.5], [-3.5, 0],
  ];
  for (let i = 0; i < surroundOffsets.length; i++) {
    const [dx, dz] = surroundOffsets[i];
    const px = cx + dx;
    const pz = cz + dz;
    const sped = MeshBuilder.CreateCylinder(`trophy-small-pedestal-${i}`, {
      height: 1.0, diameter: 0.7, tessellation: 16,
    }, scene);
    sped.position.set(px, 0.5, pz);
    sped.material = stoneMat;
    meshes.push(sped);

    // Mini trophy on top — silver for variety
    const miniMat = i % 2 === 0 ? silverMat : goldMat;
    const miniBase = MeshBuilder.CreateCylinder(`trophy-mini-base-${i}`, {
      height: 0.18, diameter: 0.5, tessellation: 12,
    }, scene);
    miniBase.position.set(px, 1.1, pz);
    miniBase.material = miniMat;
    meshes.push(miniBase);

    const miniCup = MeshBuilder.CreateCylinder(`trophy-mini-cup-${i}`, {
      height: 0.5, diameterTop: 0.5, diameterBottom: 0.3, tessellation: 12,
    }, scene);
    miniCup.position.set(px, 1.5, pz);
    miniCup.material = miniMat;
    meshes.push(miniCup);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo selfie spot: a giant freestanding jersey-shaped backdrop (just a
// big rectangle frame), a circular pavement disc to stand on for the
// shot, and a comically oversized soccer ball next to the frame.
function buildPhotoSpot(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const paveMat = createStandardMaterial(scene, 'photo-pave-mat', Color3.FromHexString('#e7d8b4'));
  const frameMat = createStandardMaterial(scene, 'photo-frame-mat', Color3.FromHexString('#3a6ea5'));
  const frameAccentMat = createStandardMaterial(scene, 'photo-frame-accent-mat', Color3.FromHexString('#f4f4ee'));
  const ballWhiteMat = createStandardMaterial(scene, 'photo-ball-white-mat', Color3.FromHexString('#f8f8f4'));
  const ballDarkMat = createStandardMaterial(scene, 'photo-ball-dark-mat', Color3.FromHexString('#222020'));

  // Standing disc
  const disc = MeshBuilder.CreateDisc('photo-disc', {
    radius: 3, tessellation: 24,
  }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(cx, 0.02, cz);
  disc.material = paveMat;
  disc.isPickable = false;
  meshes.push(disc);

  // Backdrop frame — a thick rectangular jersey-style banner standing
  // upright behind the photo disc (further from approach direction).
  const frameRoot = new TransformNode('photo-frame-root', scene);
  frameRoot.position.set(cx, 0, cz - 2);
  // Outer frame (blue jersey shape)
  const frameOuter = MeshBuilder.CreateBox('photo-frame-outer', {
    width: 5, height: 6, depth: 0.3,
  }, scene);
  frameOuter.parent = frameRoot;
  frameOuter.position.set(0, 3, 0);
  frameOuter.material = frameMat;
  meshes.push(frameOuter);
  // White interior cutout (visual — slightly smaller, in front of the outer)
  const frameInner = MeshBuilder.CreateBox('photo-frame-inner', {
    width: 4, height: 4.8, depth: 0.32,
  }, scene);
  frameInner.parent = frameRoot;
  frameInner.position.set(0, 3, 0.01);
  frameInner.material = frameAccentMat;
  meshes.push(frameInner);
  // Big number "10" on the white area — represented as two boxes (the
  // characters themselves are too detailed for primitives; use a stylized
  // mark of a vertical bar + a small ring to suggest "10")
  const numberMark = MeshBuilder.CreateBox('photo-number-bar', {
    width: 0.4, height: 2.0, depth: 0.05,
  }, scene);
  numberMark.parent = frameRoot;
  numberMark.position.set(-0.8, 3, 0.18);
  numberMark.material = frameMat;
  meshes.push(numberMark);
  const numberRing = MeshBuilder.CreateTorus('photo-number-ring', {
    diameter: 1.6, thickness: 0.3, tessellation: 20,
  }, scene);
  numberRing.parent = frameRoot;
  numberRing.position.set(0.8, 3, 0.18);
  numberRing.rotation.x = Math.PI / 2;
  numberRing.material = frameMat;
  meshes.push(numberRing);

  // Oversized soccer ball next to the frame
  const ballX = cx + 2.5;
  const ballY = 1.2;
  const ballZ = cz + 0.5;
  const ball = MeshBuilder.CreateSphere('photo-ball', {
    diameter: 2.4, segments: 32,
  }, scene);
  ball.position.set(ballX, ballY, ballZ);
  ball.material = ballWhiteMat;
  meshes.push(ball);

  // Dark patches on the ball (6 hex-disc patches around the surface)
  const ballRadius = 1.2;
  const patchOffset = ballRadius + 0.005;
  const patchPositions: Array<[number, number]> = [
    [0,          0],
    [Math.PI / 3,        Math.PI / 4],
    [-Math.PI / 3,      -Math.PI / 4],
    [2 * Math.PI / 3,    Math.PI / 4],
    [-2 * Math.PI / 3,  -Math.PI / 4],
    [Math.PI,             0],
  ];
  for (let i = 0; i < patchPositions.length; i++) {
    const [lon, lat] = patchPositions[i];
    const px = ballX + Math.cos(lat) * Math.cos(lon) * patchOffset;
    const py = ballY + Math.sin(lat) * patchOffset;
    const pz = ballZ + Math.cos(lat) * Math.sin(lon) * patchOffset;
    const patch = MeshBuilder.CreateDisc(`photo-ball-patch-${i}`, { radius: 0.32, tessellation: 6 }, scene);
    patch.position.set(px, py, pz);
    patch.lookAt(new Vector3(ballX + (px - ballX) * 100, ballY + (py - ballY) * 100, ballZ + (pz - ballZ) * 100));
    patch.material = ballDarkMat;
    meshes.push(patch);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Amphitheater: a small curved tiered seating area with a flat stage in
// front. The tiers are concentric arc-shaped rings (built as wide flat
// boxes that approximate the curve).
function buildAmphitheater(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const stageMat = createStandardMaterial(scene, 'amp-stage-mat', Color3.FromHexString('#6e4a2c'));
  const tierMat = createStandardMaterial(scene, 'amp-tier-mat', Color3.FromHexString('#b3a989'));
  const tierAccentMat = createStandardMaterial(scene, 'amp-tier-accent-mat', Color3.FromHexString('#8a7e5d'));
  const flagpoleMat = createStandardMaterial(scene, 'amp-pole-mat', Color3.FromHexString('#444444'));
  const flagMat = createStandardMaterial(scene, 'amp-flag-mat', Color3.FromHexString('#3a6ea5'));

  // Flat stage at the front (the player-facing side, -Z from center)
  const stageZ = cz - 4;
  const stage = MeshBuilder.CreateCylinder('amp-stage', {
    height: 0.3, diameter: 7, tessellation: 24,
  }, scene);
  stage.position.set(cx, 0.15, stageZ);
  stage.scaling.set(1.2, 1, 0.7);
  stage.material = stageMat;
  meshes.push(stage);

  // Three tiered seating rows curving around the back of the stage.
  // Each row is a partial torus segment approximated by a wider, flatter
  // torus with most of it hidden by the next-larger row in front.
  const tierSpecs: Array<[number, number, number]> = [
    // [innerRadius, height, y]
    [5.5, 0.5, 0.25],
    [7.5, 0.9, 0.65],
    [9.5, 1.4, 1.05],
  ];
  for (let i = 0; i < tierSpecs.length; i++) {
    const [r, h, y] = tierSpecs[i];
    const tier = MeshBuilder.CreateCylinder(`amp-tier-${i}`, {
      height: h, diameter: r * 2 + 1.2, tessellation: 24,
      cap: Mesh.NO_CAP,
    }, scene);
    tier.position.set(cx, y, cz + 0.5);
    tier.scaling.set(1.2, 1, 0.6);
    tier.material = i === tierSpecs.length - 1 ? tierAccentMat : tierMat;
    meshes.push(tier);
  }

  // Flagpole + flag on the stage
  const pole = MeshBuilder.CreateCylinder('amp-flagpole', {
    height: 4, diameter: 0.18, tessellation: 8,
  }, scene);
  pole.position.set(cx + 2.5, 2.3, stageZ);
  pole.material = flagpoleMat;
  meshes.push(pole);

  const flag = MeshBuilder.CreateBox('amp-flag', {
    width: 1.2, height: 0.8, depth: 0.05,
  }, scene);
  flag.position.set(cx + 3.1, 3.7, stageZ);
  flag.material = flagMat;
  meshes.push(flag);

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stadium
function buildStadium(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const beigeMat = createStandardMaterial(scene, 'stadium-beige', Color3.FromHexString('#d8c4a5'));
  const grayMat = createStandardMaterial(scene, 'stadium-gray', Color3.FromHexString('#8a8a86'));
  const whiteMat = createStandardMaterial(scene, 'stadium-white', Color3.FromHexString('#ededea'));
  const accentMat = createStandardMaterial(scene, 'stadium-accent', Color3.FromHexString('#3a6ea5'));

  const outerWall = MeshBuilder.CreateCylinder('stadium-outer-wall', {
    height: STADIUM_WALL_HEIGHT,
    diameter: STADIUM_OUTER_DIAMETER,
    tessellation: 32,
    cap: Mesh.NO_CAP,
  }, scene);
  outerWall.position.set(cx, STADIUM_WALL_HEIGHT / 2, cz);
  outerWall.scaling.set(STADIUM_OVAL_RATIO, 1, 1);
  outerWall.material = beigeMat;
  meshes.push(outerWall);

  const roofRing = MeshBuilder.CreateTorus('stadium-roof', {
    diameter: STADIUM_OUTER_DIAMETER + 4,
    thickness: 6,
    tessellation: 32,
  }, scene);
  roofRing.position.set(cx, STADIUM_ROOF_Y, cz);
  roofRing.scaling.set(STADIUM_OVAL_RATIO, 0.45, 1);
  roofRing.material = grayMat;
  meshes.push(roofRing);

  const a = (STADIUM_OUTER_DIAMETER / 2) * STADIUM_OVAL_RATIO;
  const b = STADIUM_OUTER_DIAMETER / 2;
  const numPillars = 24;
  for (let i = 0; i < numPillars; i++) {
    const angle = (i / numPillars) * Math.PI * 2;
    const px = cx + Math.cos(angle) * a;
    const pz = cz + Math.sin(angle) * b;
    const pillar = MeshBuilder.CreateBox(`stadium-pillar-${i}`, {
      width: 1.2, height: STADIUM_WALL_HEIGHT + 2, depth: 1.2,
    }, scene);
    pillar.position.set(px, (STADIUM_WALL_HEIGHT + 2) / 2, pz);
    pillar.material = whiteMat;
    meshes.push(pillar);
  }

  const signZ = cz - b - 8;
  const sign = MeshBuilder.CreateBox('stadium-sign', {
    width: 26, height: 5, depth: 0.9,
  }, scene);
  sign.position.set(cx, 22, signZ);
  sign.material = accentMat;
  meshes.push(sign);

  for (const polePx of [-12, 12]) {
    const pole = MeshBuilder.CreateCylinder(`stadium-sign-pole-${polePx}`, {
      height: 28,
      diameter: 0.8,
      tessellation: 8,
    }, scene);
    pole.position.set(cx + polePx, 14, signZ);
    pole.material = whiteMat;
    meshes.push(pole);
  }

  for (const fx of [-26, -13, 0, 13, 26]) {
    const flagpole = MeshBuilder.CreateCylinder(`stadium-flagpole-${fx}`, {
      height: 8, diameter: 0.35, tessellation: 6,
    }, scene);
    flagpole.position.set(cx + fx, STADIUM_ROOF_Y + 4, cz - b * 0.7);
    flagpole.material = whiteMat;
    meshes.push(flagpole);

    const flag = MeshBuilder.CreateBox(`stadium-flag-${fx}`, {
      width: 1.7, height: 1.1, depth: 0.06,
    }, scene);
    flag.position.set(cx + fx + 0.85, STADIUM_ROOF_Y + 7, cz - b * 0.7);
    flag.material = accentMat;
    meshes.push(flag);
  }

  return meshes;
}
