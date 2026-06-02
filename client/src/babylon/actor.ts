// ══════════════════════════════════════════════
// Character avatar factory: each call creates ONE independent humanoid
// avatar (head + neck + torso + shoulders + arms + hands + legs + feet +
// face features), suitable for spawning N avatars in a multiplayer scene.
//
// Sub-meshes are all parented to a single TransformNode root so the whole
// avatar moves/rotates as one unit. The factory also returns applyOutfit
// (paints skin + builds garments + builds accessories) and dispose.
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

export interface AvatarUpdateContext {
  config?: Config;
  deltaSeconds: number;
}

export interface CharacterAvatar {
  root: TransformNode;
  /** Backwards-compat handle used by other modules — the torso mesh. */
  mesh: Mesh;
  applyOutfit(textureItemIds: readonly string[], accessoryItemIds: readonly string[]): void;
  setPosition(x: number, y: number, z: number): void;
  setRotationY(rad: number): void;
  update(context: AvatarUpdateContext): void;
  dispose(): void;
}

const SKIN_DEFAULT_HEX = '#f1c8a5';
const TORSO_DEFAULT_HEX = '#e0d5c4';
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

let avatarCounter = 0;

export interface CharacterAvatarOptions {
  /** Optional id suffix for mesh/material names so multiple avatars don't collide. */
  id?: string;
  /** Initial position (x, y, z). y=0 is ground level. */
  x?: number;
  y?: number;
  z?: number;
}

export function createCharacterAvatar(scene: Scene, opts: CharacterAvatarOptions = {}): CharacterAvatar {
  // LLM-EXTENSION:ACTOR — Multi-player humanoid avatar factory. Each call builds an independent character (semi-humanoid: sphere head with eyes/mouth, neck, tapered torso, shoulders, capsule arms with hand spheres, capsule legs, single-mesh shoe-shaped feet). Six bone-socket transforms (head_top/head_front/neck_front/back_center/hand_l/hand_r) host accessories. Materials are per-avatar (so each player's skin/clothes don't share state). applyOutfit handles bodypaint (paint region materials), garments (call build() functions in items.ts), and accessories (parent to sockets). Used by the multiplayer registry in game.ts — one avatar per sessionId.
  // DO NOT REMOVE the LLM-EXTENSION:ACTOR tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.

  const id = opts.id ?? `a${++avatarCounter}`;
  const root = new TransformNode(`avatar-root-${id}`, scene);
  root.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);

  const materials: RegionMaterials = {
    head: createStandardMaterial(scene, `region-head-${id}`, Color3.FromHexString(SKIN_DEFAULT_HEX)),
    torso: createStandardMaterial(scene, `region-torso-${id}`, Color3.FromHexString(TORSO_DEFAULT_HEX)),
    arms: createStandardMaterial(scene, `region-arms-${id}`, Color3.FromHexString(SKIN_DEFAULT_HEX)),
    legs: createStandardMaterial(scene, `region-legs-${id}`, Color3.FromHexString(LEGS_DEFAULT_HEX)),
    feet: createStandardMaterial(scene, `region-feet-${id}`, Color3.FromHexString(FEET_DEFAULT_HEX)),
  };

  // Body — total height ~2.74 from floor to head top.
  const head = MeshBuilder.CreateSphere(`body-head-${id}`, { diameter: 0.62, segments: 22 }, scene);
  head.parent = root;
  head.position.set(0, 2.46, 0);
  head.scaling.set(0.95, 1.12, 0.98);
  head.material = materials.head;

  const neck = MeshBuilder.CreateCylinder(`body-neck-${id}`, { height: 0.13, diameter: 0.32, tessellation: 18 }, scene);
  neck.parent = root;
  neck.position.set(0, 2.085, 0);
  neck.material = materials.head;

  const torso = MeshBuilder.CreateCylinder(`body-torso-${id}`, { height: 0.96, diameterTop: 0.92, diameterBottom: 0.74, tessellation: 28 }, scene);
  torso.parent = root;
  torso.position.set(0, 1.55, 0);
  torso.scaling.set(1.0, 1.0, 0.58);
  torso.material = materials.torso;

  const shoulderL = MeshBuilder.CreateSphere(`body-shoulder-l-${id}`, { diameter: 0.22, segments: 14 }, scene);
  shoulderL.parent = root;
  shoulderL.position.set(-0.42, 1.92, 0);
  shoulderL.material = materials.arms;

  const shoulderR = MeshBuilder.CreateSphere(`body-shoulder-r-${id}`, { diameter: 0.22, segments: 14 }, scene);
  shoulderR.parent = root;
  shoulderR.position.set(0.42, 1.92, 0);
  shoulderR.material = materials.arms;

  const armL = MeshBuilder.CreateCapsule(`body-arm-l-${id}`, { height: 1.0, radius: 0.13, tessellation: 18, capSubdivisions: 8 }, scene);
  armL.parent = root;
  armL.position.set(-0.53, 1.55, 0);
  armL.material = materials.arms;

  const armR = MeshBuilder.CreateCapsule(`body-arm-r-${id}`, { height: 1.0, radius: 0.13, tessellation: 18, capSubdivisions: 8 }, scene);
  armR.parent = root;
  armR.position.set(0.53, 1.55, 0);
  armR.material = materials.arms;

  const handMeshL = MeshBuilder.CreateSphere(`body-hand-l-${id}`, { diameter: 0.2, segments: 14 }, scene);
  handMeshL.parent = root;
  handMeshL.position.set(-0.53, 0.96, 0);
  handMeshL.material = materials.arms;

  const handMeshR = MeshBuilder.CreateSphere(`body-hand-r-${id}`, { diameter: 0.2, segments: 14 }, scene);
  handMeshR.parent = root;
  handMeshR.position.set(0.53, 0.96, 0);
  handMeshR.material = materials.arms;

  const legL = MeshBuilder.CreateCapsule(`body-leg-l-${id}`, { height: 1.0, radius: 0.18, tessellation: 18, capSubdivisions: 8 }, scene);
  legL.parent = root;
  legL.position.set(-0.22, 0.6, 0);
  legL.material = materials.legs;

  const legR = MeshBuilder.CreateCapsule(`body-leg-r-${id}`, { height: 1.0, radius: 0.18, tessellation: 18, capSubdivisions: 8 }, scene);
  legR.parent = root;
  legR.position.set(0.22, 0.6, 0);
  legR.material = materials.legs;

  const footL = MeshBuilder.CreateSphere(`body-foot-l-${id}`, { diameter: 0.46, segments: 20, slice: 0.5 }, scene);
  footL.parent = root;
  footL.position.set(-0.22, 0, 0.1);
  footL.scaling.set(0.82, 0.7, 1.7);
  footL.material = materials.feet;

  const footR = MeshBuilder.CreateSphere(`body-foot-r-${id}`, { diameter: 0.46, segments: 20, slice: 0.5 }, scene);
  footR.parent = root;
  footR.position.set(0.22, 0, 0.1);
  footR.scaling.set(0.82, 0.7, 1.7);
  footR.material = materials.feet;

  // Face features
  const faceDetailMat = createStandardMaterial(scene, `face-detail-${id}`, Color3.FromHexString('#1a1a1d'));
  const eyeHighlightMat = createStandardMaterial(scene, `eye-hi-${id}`, Color3.FromHexString('#ffffff'));

  const eyeL = MeshBuilder.CreateSphere(`face-eye-l-${id}`, { diameter: 0.085, segments: 12 }, scene);
  eyeL.parent = root;
  eyeL.position.set(-0.085, 2.53, 0.29);
  eyeL.material = faceDetailMat;

  const eyeR = MeshBuilder.CreateSphere(`face-eye-r-${id}`, { diameter: 0.085, segments: 12 }, scene);
  eyeR.parent = root;
  eyeR.position.set(0.085, 2.53, 0.29);
  eyeR.material = faceDetailMat;

  const eyeHighlightL = MeshBuilder.CreateSphere(`face-eye-hi-l-${id}`, { diameter: 0.028, segments: 10 }, scene);
  eyeHighlightL.parent = root;
  eyeHighlightL.position.set(-0.07, 2.55, 0.325);
  eyeHighlightL.material = eyeHighlightMat;

  const eyeHighlightR = MeshBuilder.CreateSphere(`face-eye-hi-r-${id}`, { diameter: 0.028, segments: 10 }, scene);
  eyeHighlightR.parent = root;
  eyeHighlightR.position.set(0.1, 2.55, 0.325);
  eyeHighlightR.material = eyeHighlightMat;

  const mouth = MeshBuilder.CreateBox(`face-mouth-${id}`, { width: 0.14, height: 0.028, depth: 0.02 }, scene);
  mouth.parent = root;
  mouth.position.set(0, 2.37, 0.292);
  mouth.material = faceDetailMat;

  // Sockets
  const headTop = new TransformNode(`socket-head-top-${id}`, scene);
  headTop.parent = root;
  headTop.position.set(0, 2.65, 0);

  const headFront = new TransformNode(`socket-head-front-${id}`, scene);
  headFront.parent = root;
  headFront.position.set(0, 2.50, 0.305);

  const neckFront = new TransformNode(`socket-neck-front-${id}`, scene);
  neckFront.parent = root;
  neckFront.position.set(0, 2.05, 0.0);

  const backCenter = new TransformNode(`socket-back-center-${id}`, scene);
  backCenter.parent = root;
  backCenter.position.set(0, 1.55, -0.32);

  const handLSocket = new TransformNode(`socket-hand-l-${id}`, scene);
  handLSocket.parent = root;
  handLSocket.position.set(-0.53, 0.96, 0);

  const handRSocket = new TransformNode(`socket-hand-r-${id}`, scene);
  handRSocket.parent = root;
  handRSocket.position.set(0.53, 0.96, 0);

  const sockets: Sockets = {
    head_top: headTop,
    head_front: headFront,
    neck_front: neckFront,
    back_center: backCenter,
    hand_l: handLSocket,
    hand_r: handRSocket,
  };

  let attachedGarmentMeshes: Mesh[] = [];
  let attachedAccessoryMeshes: Mesh[] = [];

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

  function applyOutfit(textureItemIds: readonly string[], accessoryItemIds: readonly string[]): void {
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

    const wearingTop = allItems.some((i) => i.slot === 'shirt' && i.build);
    torso.isVisible = !wearingTop;
    shoulderL.isVisible = !wearingTop;
    shoulderR.isVisible = !wearingTop;

    clearGarments();
    const garmentItems = allItems.filter((i) => !!i.build).sort((a, b) => a.zIndex - b.zIndex);
    for (const item of garmentItems) {
      if (!item.build) continue;
      const built = item.build(scene, root);
      for (const m of built) attachedGarmentMeshes.push(m);
    }

    clearAccessories();
    for (const accessoryId of accessoryItemIds) {
      const def = getAccessoryItem(accessoryId);
      if (!def) continue;
      const socket = sockets[def.socket as AccessorySocket];
      if (!socket) continue;
      const built = def.build(scene, socket);
      for (const m of built) attachedAccessoryMeshes.push(m);
    }
  }

  function setPosition(x: number, y: number, z: number): void {
    root.position.set(x, y, z);
  }

  function setRotationY(rad: number): void {
    root.rotation.y = rad;
  }

  function update({ config, deltaSeconds }: AvatarUpdateContext): void {
    const speed = config?.idleRotationSpeed ?? 0;
    if (speed > 0) root.rotation.y += deltaSeconds * speed;
  }

  function dispose(): void {
    clearGarments();
    clearAccessories();
    head.dispose();
    neck.dispose();
    torso.dispose();
    shoulderL.dispose();
    shoulderR.dispose();
    armL.dispose();
    armR.dispose();
    legL.dispose();
    legR.dispose();
    footL.dispose();
    footR.dispose();
    handMeshL.dispose();
    handMeshR.dispose();
    eyeL.dispose();
    eyeR.dispose();
    eyeHighlightL.dispose();
    eyeHighlightR.dispose();
    mouth.dispose();
    headTop.dispose();
    headFront.dispose();
    neckFront.dispose();
    backCenter.dispose();
    handLSocket.dispose();
    handRSocket.dispose();
    materials.head.dispose();
    materials.torso.dispose();
    materials.arms.dispose();
    materials.legs.dispose();
    materials.feet.dispose();
    faceDetailMat.dispose();
    eyeHighlightMat.dispose();
    root.dispose();
  }

  return { root, mesh: torso, applyOutfit, setPosition, setRotationY, update, dispose };
}

/** Call once at scene teardown to drop cached pattern/image textures. */
export function disposeAvatarSharedCaches(): void {
  disposePatternTextureCache();
}

// Backwards-compat aliases so older callers keep compiling during migration.
export type PlayerActor = CharacterAvatar;
export type ActorUpdateContext = AvatarUpdateContext;
export const createPlayerActor = (scene: Scene): CharacterAvatar => createCharacterAvatar(scene);
