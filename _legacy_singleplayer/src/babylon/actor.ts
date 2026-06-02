// ══════════════════════════════════════════════
// Player actor: a semi-humanoid body built from primitives — sphere head,
// short neck, tapered chest-to-waist torso, shoulder spheres, capsule arms
// and legs, hand spheres, box feet, plus face details (eyes, eye highlights,
// mouth). Five region StandardMaterials hold the skin colors. Clothing
// items are GARMENT MESHES built on top of the body (not texture wraps) —
// applyOutfit() invokes the item's build() to create the garment, slightly
// inflated over the body parts it covers so clipping doesn't happen.
// ══════════════════════════════════════════════

import { Color3, MeshBuilder, TransformNode, type Mesh, type Scene, type StandardMaterial } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';
import {
  getAccessoryItem,
  getTextureItem,
  type AccessorySocket,
  type BodyRegion,
} from './items';
import { disposePatternTextureCache, getImageTexture, getPatternTexture, patternKey, type Pattern } from './textures';
import type { Config } from '../game/schema';

export interface ActorUpdateContext {
  config?: Config;
  deltaSeconds: number;
}

export interface PlayerActor {
  mesh: Mesh;
  applyOutfit(textureItemIds: readonly string[], accessoryItemIds: readonly string[]): void;
  update(context: ActorUpdateContext): void;
  dispose(): void;
}

const SKIN_DEFAULT_HEX = '#f1c8a5';
const TORSO_DEFAULT_HEX = '#e0d5c4';   // default visible "underwear" tone if no top equipped
const LEGS_DEFAULT_HEX = '#f1c8a5';
const FEET_DEFAULT_HEX = '#f1c8a5';
const SKIN_DEFAULT: Pattern = { kind: 'solid', color: SKIN_DEFAULT_HEX };
const TORSO_DEFAULT: Pattern = { kind: 'solid', color: TORSO_DEFAULT_HEX };
const LEGS_DEFAULT: Pattern = { kind: 'solid', color: LEGS_DEFAULT_HEX };
const FEET_DEFAULT: Pattern = { kind: 'solid', color: FEET_DEFAULT_HEX };

interface RegionMaterials {
  head: StandardMaterial;
  torso: StandardMaterial;
  arms: StandardMaterial;
  legs: StandardMaterial;
  feet: StandardMaterial;
}

interface Sockets {
  head_top: TransformNode;
  head_front: TransformNode;
  neck_front: TransformNode;
  back_center: TransformNode;
  hand_l: TransformNode;
  hand_r: TransformNode;
}

export interface ActorBuildContext {
  scene: Scene;
  root: TransformNode;
}

export function createPlayerActor(scene: Scene): PlayerActor {
  // LLM-EXTENSION:ACTOR — Semi-humanoid body: sphere head with eyes + mouth, short neck, frustum torso (chest-wider, waist-narrower, z-scaled for body depth), shoulder spheres, capsule arms with hand spheres at the wrist, capsule legs, box feet. Five skin/region StandardMaterials owned here. Clothing is built by GARMENT MESH builders in items.ts on top of the body (slight inflation prevents clipping); paint-style "bodypaint" items still repaint the skin materials. Six bone sockets parented to the un-scaled root host accessories.
  // DO NOT REMOVE the LLM-EXTENSION:ACTOR tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.

  const root = new TransformNode('character-root', scene);
  root.position.set(0, 0, 0);

  const materials: RegionMaterials = {
    head: createStandardMaterial(scene, 'region-head', Color3.FromHexString(SKIN_DEFAULT_HEX)),
    torso: createStandardMaterial(scene, 'region-torso', Color3.FromHexString(TORSO_DEFAULT_HEX)),
    arms: createStandardMaterial(scene, 'region-arms', Color3.FromHexString(SKIN_DEFAULT_HEX)),
    legs: createStandardMaterial(scene, 'region-legs', Color3.FromHexString(LEGS_DEFAULT_HEX)),
    feet: createStandardMaterial(scene, 'region-feet', Color3.FromHexString(FEET_DEFAULT_HEX)),
  };

  // ─── Body parts ────────────────────────────────────────────────────────────
  // Total height ~2.74 (floor → head top). All parented to root.

  // Head — slightly elongated sphere (oval, taller-than-wide) for a more
  // natural human head shape rather than a perfect ball.
  const head = MeshBuilder.CreateSphere('body-head', { diameter: 0.62, segments: 22 }, scene);
  head.parent = root;
  head.position.set(0, 2.46, 0);
  head.scaling.set(0.95, 1.12, 0.98);
  head.material = materials.head;

  // Neck — short cylinder bridging head and torso.
  const neck = MeshBuilder.CreateCylinder('body-neck', { height: 0.13, diameter: 0.32, tessellation: 18 }, scene);
  neck.parent = root;
  neck.position.set(0, 2.085, 0);
  neck.material = materials.head;

  // Torso — slimmer frustum: tapered top to bottom, scaled along Z for a
  // flatter front-to-back body cross-section.
  const torso = MeshBuilder.CreateCylinder('body-torso', { height: 0.96, diameterTop: 0.92, diameterBottom: 0.74, tessellation: 28 }, scene);
  torso.parent = root;
  torso.position.set(0, 1.55, 0);
  torso.scaling.set(1.0, 1.0, 0.58);
  torso.material = materials.torso;

  // Shoulder spheres — subtle bumps where the torso meets the arms.
  const shoulderL = MeshBuilder.CreateSphere('body-shoulder-l', { diameter: 0.22, segments: 14 }, scene);
  shoulderL.parent = root;
  shoulderL.position.set(-0.42, 1.92, 0);
  shoulderL.material = materials.arms;

  const shoulderR = MeshBuilder.CreateSphere('body-shoulder-r', { diameter: 0.22, segments: 14 }, scene);
  shoulderR.parent = root;
  shoulderR.position.set(0.42, 1.92, 0);
  shoulderR.material = materials.arms;

  // Arms — thinner capsules.
  const armL = MeshBuilder.CreateCapsule('body-arm-l', { height: 1.0, radius: 0.13, tessellation: 18, capSubdivisions: 8 }, scene);
  armL.parent = root;
  armL.position.set(-0.53, 1.55, 0);
  armL.material = materials.arms;

  const armR = MeshBuilder.CreateCapsule('body-arm-r', { height: 1.0, radius: 0.13, tessellation: 18, capSubdivisions: 8 }, scene);
  armR.parent = root;
  armR.position.set(0.53, 1.55, 0);
  armR.material = materials.arms;

  // Hands — smaller spheres.
  const handMeshL = MeshBuilder.CreateSphere('body-hand-l', { diameter: 0.2, segments: 14 }, scene);
  handMeshL.parent = root;
  handMeshL.position.set(-0.53, 0.96, 0);
  handMeshL.material = materials.arms;

  const handMeshR = MeshBuilder.CreateSphere('body-hand-r', { diameter: 0.2, segments: 14 }, scene);
  handMeshR.parent = root;
  handMeshR.position.set(0.53, 0.96, 0);
  handMeshR.material = materials.arms;

  // Legs — thinner capsules.
  const legL = MeshBuilder.CreateCapsule('body-leg-l', { height: 1.0, radius: 0.18, tessellation: 18, capSubdivisions: 8 }, scene);
  legL.parent = root;
  legL.position.set(-0.22, 0.6, 0);
  legL.material = materials.legs;

  const legR = MeshBuilder.CreateCapsule('body-leg-r', { height: 1.0, radius: 0.18, tessellation: 18, capSubdivisions: 8 }, scene);
  legR.parent = root;
  legR.position.set(0.22, 0.6, 0);
  legR.material = materials.legs;

  // Feet — single continuous sliced-sphere block per side. Flat bottom (the
  // slice cut) sits on the floor; the dome shape elongates forward like a
  // shoe-shaped lump. Same shape signature as the shoe so the two read as
  // a continuous block whether or not shoes are equipped.
  const footL = MeshBuilder.CreateSphere('body-foot-l', { diameter: 0.46, segments: 20, slice: 0.5 }, scene);
  footL.parent = root;
  footL.position.set(-0.22, 0, 0.1);
  footL.scaling.set(0.82, 0.7, 1.7);
  footL.material = materials.feet;

  const footR = MeshBuilder.CreateSphere('body-foot-r', { diameter: 0.46, segments: 20, slice: 0.5 }, scene);
  footR.parent = root;
  footR.position.set(0.22, 0, 0.1);
  footR.scaling.set(0.82, 0.7, 1.7);
  footR.material = materials.feet;

  // ─── Face features ─────────────────────────────────────────────────────────
  const faceDetailMat = createStandardMaterial(scene, 'face-detail-mat', Color3.FromHexString('#1a1a1d'));
  const eyeHighlightMat = createStandardMaterial(scene, 'eye-highlight-mat', Color3.FromHexString('#ffffff'));

  // Face features positioned to match the scaled head (taller oval).
  const eyeL = MeshBuilder.CreateSphere('face-eye-l', { diameter: 0.085, segments: 12 }, scene);
  eyeL.parent = root;
  eyeL.position.set(-0.085, 2.53, 0.29);
  eyeL.material = faceDetailMat;

  const eyeR = MeshBuilder.CreateSphere('face-eye-r', { diameter: 0.085, segments: 12 }, scene);
  eyeR.parent = root;
  eyeR.position.set(0.085, 2.53, 0.29);
  eyeR.material = faceDetailMat;

  const eyeHighlightL = MeshBuilder.CreateSphere('face-eye-hi-l', { diameter: 0.028, segments: 10 }, scene);
  eyeHighlightL.parent = root;
  eyeHighlightL.position.set(-0.07, 2.55, 0.325);
  eyeHighlightL.material = eyeHighlightMat;

  const eyeHighlightR = MeshBuilder.CreateSphere('face-eye-hi-r', { diameter: 0.028, segments: 10 }, scene);
  eyeHighlightR.parent = root;
  eyeHighlightR.position.set(0.1, 2.55, 0.325);
  eyeHighlightR.material = eyeHighlightMat;

  const mouth = MeshBuilder.CreateBox('face-mouth', { width: 0.14, height: 0.028, depth: 0.02 }, scene);
  mouth.parent = root;
  mouth.position.set(0, 2.37, 0.292);
  mouth.material = faceDetailMat;

  // ─── Sockets ───────────────────────────────────────────────────────────────
  // Sockets sit at the head's CROWN level (slightly below the very top of the
  // scaled head) and at the front face. Hats are designed to overlap downward
  // from head_top so they read as worn, not floating.
  const headTop = new TransformNode('socket-head-top', scene);
  headTop.parent = root;
  headTop.position.set(0, 2.65, 0);

  const headFront = new TransformNode('socket-head-front', scene);
  headFront.parent = root;
  headFront.position.set(0, 2.50, 0.305);

  const neckFront = new TransformNode('socket-neck-front', scene);
  neckFront.parent = root;
  neckFront.position.set(0, 2.05, 0.0);

  const backCenter = new TransformNode('socket-back-center', scene);
  backCenter.parent = root;
  backCenter.position.set(0, 1.55, -0.32);

  const handL = new TransformNode('socket-hand-l', scene);
  handL.parent = root;
  handL.position.set(-0.53, 0.96, 0);

  const handR = new TransformNode('socket-hand-r', scene);
  handR.parent = root;
  handR.position.set(0.53, 0.96, 0);

  const sockets: Sockets = {
    head_top: headTop,
    head_front: headFront,
    neck_front: neckFront,
    back_center: backCenter,
    hand_l: handL,
    hand_r: handR,
  };

  // ─── Outfit lifecycle ──────────────────────────────────────────────────────
  let attachedGarmentMeshes: Mesh[] = [];
  let attachedAccessoryMeshes: Mesh[] = [];

  // Note: dispose(false, true) would also dispose materials AND their textures.
  // Since pattern + image textures live in shared caches (textures.ts), that
  // would kill the cached texture out from under any other mesh that's
  // about to be built. We dispose only the mesh; materials are GC'd via
  // scene refcount and the cached textures stay valid across re-equips.
  function clearGarments(): void {
    for (const m of attachedGarmentMeshes) m.dispose();
    attachedGarmentMeshes = [];
  }
  function clearAccessories(): void {
    for (const m of attachedAccessoryMeshes) m.dispose();
    attachedAccessoryMeshes = [];
  }

  function paintRegion(material: StandardMaterial, regionKey: BodyRegion, pattern: Pattern): void {
    if (pattern.kind === 'solid') {
      material.diffuseTexture = null;
      material.diffuseColor = Color3.FromHexString(pattern.color);
      return;
    }
    if (pattern.kind === 'image') {
      material.diffuseColor.set(1, 1, 1);
      material.diffuseTexture = getImageTexture(scene, pattern.url);
      return;
    }
    material.diffuseColor.set(1, 1, 1);
    material.diffuseTexture = getPatternTexture(scene, patternKey(regionKey, pattern), pattern);
  }

  function applyOutfit(
    textureItemIds: readonly string[],
    accessoryItemIds: readonly string[],
  ): void {
    // ── 1. Resolve skin regions from bodypaint items (zIndex 0).
    const regionPattern: Record<BodyRegion, Pattern> = {
      head: SKIN_DEFAULT,
      torso: TORSO_DEFAULT,
      arms: SKIN_DEFAULT,
      legs: LEGS_DEFAULT,
      feet: FEET_DEFAULT,
    };

    const allItems = textureItemIds
      .map((id) => getTextureItem(id))
      .filter((i): i is NonNullable<typeof i> => Boolean(i));

    const bodypaintItems = allItems.filter((i) => i.paints).sort((a, b) => a.zIndex - b.zIndex);
    for (const item of bodypaintItems) {
      if (!item.paints) continue;
      for (const [region, pattern] of Object.entries(item.paints) as Array<[BodyRegion, Pattern]>) {
        regionPattern[region] = pattern;
      }
    }

    paintRegion(materials.head, 'head', regionPattern.head);
    paintRegion(materials.torso, 'torso', regionPattern.torso);
    paintRegion(materials.arms, 'arms', regionPattern.arms);
    paintRegion(materials.legs, 'legs', regionPattern.legs);
    paintRegion(materials.feet, 'feet', regionPattern.feet);

    // Hide ONLY the body torso when a top is equipped — its frustum top is
    // wider than the shirt's neckline, so otherwise the bare chest can show
    // around the collar. Legs and feet stay visible so the small geometry
    // gap below the pants cuff / above the shoe upper fills with skin (the
    // exposed-ankle look) rather than rendering as empty space.
    const wearingTop = allItems.some((i) => i.slot === 'shirt' && i.build);
    torso.isVisible = !wearingTop;
    shoulderL.isVisible = !wearingTop;
    shoulderR.isVisible = !wearingTop;

    // ── 2. Rebuild garment meshes (top/bottom/footwear/overhead).
    clearGarments();
    const garmentItems = allItems.filter((i) => !!i.build).sort((a, b) => a.zIndex - b.zIndex);
    for (const item of garmentItems) {
      if (!item.build) continue;
      const built = item.build(scene, root);
      for (const m of built) attachedGarmentMeshes.push(m);
    }

    // ── 3. Rebuild accessory meshes on bone sockets.
    clearAccessories();
    for (const id of accessoryItemIds) {
      const def = getAccessoryItem(id);
      if (!def) continue;
      const socket = sockets[def.socket as AccessorySocket];
      if (!socket) continue;
      const built = def.build(scene, socket);
      for (const m of built) attachedAccessoryMeshes.push(m);
    }
  }

  function dispose(): void {
    clearGarments();
    clearAccessories();
    head.dispose(false, true);
    neck.dispose(false, true);
    torso.dispose(false, true);
    shoulderL.dispose(false, true);
    shoulderR.dispose(false, true);
    armL.dispose(false, true);
    armR.dispose(false, true);
    legL.dispose(false, true);
    legR.dispose(false, true);
    footL.dispose(false, true);
    footR.dispose(false, true);
    handMeshL.dispose(false, true);
    handMeshR.dispose(false, true);
    eyeL.dispose(false, true);
    eyeR.dispose(false, true);
    eyeHighlightL.dispose(false, true);
    eyeHighlightR.dispose(false, true);
    mouth.dispose(false, true);
    headTop.dispose();
    headFront.dispose();
    neckFront.dispose();
    backCenter.dispose();
    handL.dispose();
    handR.dispose();
    materials.head.dispose();
    materials.torso.dispose();
    materials.arms.dispose();
    materials.legs.dispose();
    materials.feet.dispose();
    faceDetailMat.dispose();
    eyeHighlightMat.dispose();
    root.dispose();
    disposePatternTextureCache();
  }

  function update({ config, deltaSeconds }: ActorUpdateContext): void {
    const speed = config?.idleRotationSpeed ?? 0.25;
    root.rotation.y += deltaSeconds * speed;
  }

  return {
    mesh: torso,
    applyOutfit,
    update,
    dispose,
  };
}
