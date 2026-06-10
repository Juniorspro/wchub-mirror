// ══════════════════════════════════════════════
// Character avatar factory: each call creates ONE independent humanoid
// avatar (head + neck + torso + shoulders + arms + hands + legs + feet +
// face features), suitable for spawning N avatars in a multiplayer scene.
//
// Sub-meshes are all parented to a single TransformNode root so the whole
// avatar moves/rotates as one unit. The factory also returns applyOutfit
// (paints skin + builds garments + builds accessories) and dispose.
// ══════════════════════════════════════════════

import { Color3, DynamicTexture, Mesh, MeshBuilder, StandardMaterial, TransformNode, type Scene } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';
import {
  getAccessoryItem,
  getTextureItemOrCustom,
  type AccessorySocket,
  type BodyRegion,
} from './items';
import { disposePatternTextureCache, getImageTexture, getPatternTexture, patternKey, uniformDesign, type Pattern } from './textures';
import type { Config } from '../game/schema';

export interface AvatarUpdateContext {
  config?: Config;
  deltaSeconds: number;
}

/** Facial expression presets. Synced between players as a `face-<expr>`
 * token riding the accessoryItems CSV (validated server-side like any
 * accessory id); 'neutral' is the default and is never sent. */
export type AvatarExpression = 'neutral' | 'happy' | 'surprised' | 'wink' | 'cool';

export interface CharacterAvatar {
  root: TransformNode;
  /** Backwards-compat handle used by other modules — the torso mesh. */
  mesh: Mesh;
  applyOutfit(textureItemIds: readonly string[], accessoryItemIds: readonly string[]): void;
  /** Set the avatar's facial expression (reshapes the eye + mouth
   * meshes). Also applied automatically by applyOutfit when the
   * accessory list carries a face-<expr> token. */
  setExpression(expr: AvatarExpression): void;
  setPosition(x: number, y: number, z: number): void;
  setRotationY(rad: number): void;
  /** Trigger a one-shot visual jump (gravity-driven Y offset). No-op if
   *  already in the air — wait for landing before next jump fires. */
  triggerJump(): void;
  /** Spawn a floating heart particle above the head that rises and fades. */
  triggerCompliment(): void;
  triggerChat(text: string): void;
  /** Wave the right arm — a brief shoulder rotation that overrides the
   *  walk animation on that arm for ~1.2s. */
  triggerWave(): void;
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

  // Shoulder spheres + arms lowered by ~0.1 so the body's natural shoulder
  // line sits at y≈1.95, lining up with the shirt's sleeve top — which in
  // turn lets the shoulder dome (apex ~0.07 above sleeve top) reach exactly
  // the neck base at y=2.02 instead of towering past it.
  const shoulderL = MeshBuilder.CreateSphere(`body-shoulder-l-${id}`, { diameter: 0.22, segments: 14 }, scene);
  shoulderL.parent = root;
  shoulderL.position.set(-0.42, 1.82, 0);
  shoulderL.material = materials.arms;

  const shoulderR = MeshBuilder.CreateSphere(`body-shoulder-r-${id}`, { diameter: 0.22, segments: 14 }, scene);
  shoulderR.parent = root;
  shoulderR.position.set(0.42, 1.82, 0);
  shoulderR.material = materials.arms;

  // ─── Arm L — jointed for walking animation ──────────────────────────────
  // Structure: shoulderJoint → upperArm → elbowJoint → lowerArm + hand.
  // Rotating shoulderJoint swings the WHOLE arm; rotating elbowJoint
  // articulates only the lower arm + hand. Joints are TransformNodes
  // (invisible) used purely as rotation pivots.
  const shoulderJointL = new TransformNode(`joint-shoulder-l-${id}`, scene);
  shoulderJointL.parent = root;
  shoulderJointL.position.set(-0.53, 1.95, 0);

  const upperArmL = MeshBuilder.CreateCapsule(`body-upper-arm-l-${id}`, {
    height: 0.55, radius: 0.13, tessellation: 18, capSubdivisions: 8,
  }, scene);
  upperArmL.parent = shoulderJointL;
  upperArmL.position.set(0, -0.275, 0);
  upperArmL.material = materials.arms;

  const elbowJointL = new TransformNode(`joint-elbow-l-${id}`, scene);
  elbowJointL.parent = shoulderJointL;
  elbowJointL.position.set(0, -0.55, 0);

  // Joint bridge sphere — fills the gap exposed between upper/lower arm
  // capsule hemispheres when the elbow rotates. Slightly larger than the
  // upper-arm radius (0.13) so it never disappears inside either capsule.
  const elbowBridgeL = MeshBuilder.CreateSphere(`body-elbow-bridge-l-${id}`, { diameter: 0.16, segments: 12 }, scene);
  elbowBridgeL.parent = elbowJointL;
  elbowBridgeL.position.set(0, 0, 0);
  elbowBridgeL.material = materials.arms;

  const lowerArmL = MeshBuilder.CreateCapsule(`body-lower-arm-l-${id}`, {
    height: 0.5, radius: 0.12, tessellation: 18, capSubdivisions: 8,
  }, scene);
  lowerArmL.parent = elbowJointL;
  lowerArmL.position.set(0, -0.25, 0);
  lowerArmL.material = materials.arms;

  const handMeshL = MeshBuilder.CreateSphere(`body-hand-l-${id}`, { diameter: 0.2, segments: 14 }, scene);
  handMeshL.parent = elbowJointL;
  handMeshL.position.set(0, -0.55, 0);
  handMeshL.material = materials.arms;

  // ─── Arm R — mirror of L ────────────────────────────────────────────────
  const shoulderJointR = new TransformNode(`joint-shoulder-r-${id}`, scene);
  shoulderJointR.parent = root;
  shoulderJointR.position.set(0.53, 1.95, 0);

  const upperArmR = MeshBuilder.CreateCapsule(`body-upper-arm-r-${id}`, {
    height: 0.55, radius: 0.13, tessellation: 18, capSubdivisions: 8,
  }, scene);
  upperArmR.parent = shoulderJointR;
  upperArmR.position.set(0, -0.275, 0);
  upperArmR.material = materials.arms;

  const elbowJointR = new TransformNode(`joint-elbow-r-${id}`, scene);
  elbowJointR.parent = shoulderJointR;
  elbowJointR.position.set(0, -0.55, 0);

  const elbowBridgeR = MeshBuilder.CreateSphere(`body-elbow-bridge-r-${id}`, { diameter: 0.16, segments: 12 }, scene);
  elbowBridgeR.parent = elbowJointR;
  elbowBridgeR.position.set(0, 0, 0);
  elbowBridgeR.material = materials.arms;

  const lowerArmR = MeshBuilder.CreateCapsule(`body-lower-arm-r-${id}`, {
    height: 0.5, radius: 0.12, tessellation: 18, capSubdivisions: 8,
  }, scene);
  lowerArmR.parent = elbowJointR;
  lowerArmR.position.set(0, -0.25, 0);
  lowerArmR.material = materials.arms;

  const handMeshR = MeshBuilder.CreateSphere(`body-hand-r-${id}`, { diameter: 0.2, segments: 14 }, scene);
  handMeshR.parent = elbowJointR;
  handMeshR.position.set(0, -0.55, 0);
  handMeshR.material = materials.arms;

  // ─── Leg L — jointed for walking animation ──────────────────────────────
  const hipJointL = new TransformNode(`joint-hip-l-${id}`, scene);
  hipJointL.parent = root;
  hipJointL.position.set(-0.22, 1.1, 0);

  const thighL = MeshBuilder.CreateCapsule(`body-thigh-l-${id}`, {
    height: 0.55, radius: 0.18, tessellation: 18, capSubdivisions: 8,
  }, scene);
  thighL.parent = hipJointL;
  thighL.position.set(0, -0.275, 0);
  thighL.material = materials.legs;

  const kneeJointL = new TransformNode(`joint-knee-l-${id}`, scene);
  kneeJointL.parent = hipJointL;
  kneeJointL.position.set(0, -0.55, 0);

  // Knee bridge — same role as the elbow bridge but at the knee. Slightly
  // larger than the thigh radius (0.18) so it spans the seam between thigh
  // and shin even at full knee bend.
  const kneeBridgeL = MeshBuilder.CreateSphere(`body-knee-bridge-l-${id}`, { diameter: 0.22, segments: 12 }, scene);
  kneeBridgeL.parent = kneeJointL;
  kneeBridgeL.position.set(0, 0, 0);
  kneeBridgeL.material = materials.legs;

  const shinL = MeshBuilder.CreateCapsule(`body-shin-l-${id}`, {
    height: 0.5, radius: 0.17, tessellation: 18, capSubdivisions: 8,
  }, scene);
  shinL.parent = kneeJointL;
  shinL.position.set(0, -0.25, 0);
  shinL.material = materials.legs;

  // Ankle joint — sits at the bottom of the shin. The foot is parented
  // here (not directly to the knee) so the walk-anim update can
  // counter-rotate the foot against the knee bend, keeping the foot
  // aligned with the thigh's direction instead of flexing like an
  // articulated ankle when the knee folds.
  const ankleJointL = new TransformNode(`joint-ankle-l-${id}`, scene);
  ankleJointL.parent = kneeJointL;
  ankleJointL.position.set(0, -0.55, 0);

  // Foot — shifted forward (z=0.07 → 0.12) and Z scale tightened
  // (1.45 → 1.2) so the heel sits closer to the ankle instead of
  // sticking out far behind it. Toe length is roughly preserved.
  const footL = MeshBuilder.CreateSphere(`body-foot-l-${id}`, { diameter: 0.34, segments: 20, slice: 0.5 }, scene);
  footL.parent = ankleJointL;
  footL.position.set(0, 0, 0.12);
  footL.scaling.set(0.85, 0.7, 1.2);
  footL.material = materials.feet;

  // ─── Leg R — mirror of L ────────────────────────────────────────────────
  const hipJointR = new TransformNode(`joint-hip-r-${id}`, scene);
  hipJointR.parent = root;
  hipJointR.position.set(0.22, 1.1, 0);

  const thighR = MeshBuilder.CreateCapsule(`body-thigh-r-${id}`, {
    height: 0.55, radius: 0.18, tessellation: 18, capSubdivisions: 8,
  }, scene);
  thighR.parent = hipJointR;
  thighR.position.set(0, -0.275, 0);
  thighR.material = materials.legs;

  const kneeJointR = new TransformNode(`joint-knee-r-${id}`, scene);
  kneeJointR.parent = hipJointR;
  kneeJointR.position.set(0, -0.55, 0);

  const kneeBridgeR = MeshBuilder.CreateSphere(`body-knee-bridge-r-${id}`, { diameter: 0.22, segments: 12 }, scene);
  kneeBridgeR.parent = kneeJointR;
  kneeBridgeR.position.set(0, 0, 0);
  kneeBridgeR.material = materials.legs;

  const shinR = MeshBuilder.CreateCapsule(`body-shin-r-${id}`, {
    height: 0.5, radius: 0.17, tessellation: 18, capSubdivisions: 8,
  }, scene);
  shinR.parent = kneeJointR;
  shinR.position.set(0, -0.25, 0);
  shinR.material = materials.legs;

  const ankleJointR = new TransformNode(`joint-ankle-r-${id}`, scene);
  ankleJointR.parent = kneeJointR;
  ankleJointR.position.set(0, -0.55, 0);

  const footR = MeshBuilder.CreateSphere(`body-foot-r-${id}`, { diameter: 0.34, segments: 20, slice: 0.5 }, scene);
  footR.parent = ankleJointR;
  footR.position.set(0, 0, 0.12);
  footR.scaling.set(0.85, 0.7, 1.2);
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

  // ─── Expressions — reshape the eye + mouth meshes ─────────────────────────
  // Cheap parametric presets: scaling + small position/rotation nudges on
  // the existing face meshes (no extra geometry, no texture work). Reset
  // to neutral first so presets don't compound.
  function setExpression(expr: AvatarExpression): void {
    eyeL.scaling.set(1, 1, 1);
    eyeR.scaling.set(1, 1, 1);
    mouth.scaling.set(1, 1, 1);
    mouth.position.set(0, 2.37, 0.292);
    mouth.rotation.z = 0;
    switch (expr) {
      case 'happy':
        // Wide grin, slightly raised.
        mouth.scaling.set(1.7, 2.4, 1);
        mouth.position.y = 2.385;
        break;
      case 'surprised':
        // Tall "O" mouth + wide eyes.
        mouth.scaling.set(0.85, 5.0, 1);
        eyeL.scaling.set(1.35, 1.35, 1.35);
        eyeR.scaling.set(1.35, 1.35, 1.35);
        break;
      case 'wink':
        // Right eye squeezed shut + cheeky tilted smile.
        eyeR.scaling.set(1.2, 0.18, 1);
        mouth.scaling.set(1.45, 1.7, 1);
        mouth.rotation.z = -0.14;
        break;
      case 'cool':
        // Relaxed half-lidded eyes, easy smile.
        eyeL.scaling.set(1.2, 0.4, 1);
        eyeR.scaling.set(1.2, 0.4, 1);
        mouth.scaling.set(1.3, 1.4, 1);
        break;
      case 'neutral':
      default:
        break;
    }
  }

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

  // Hand sockets attach to the ELBOW joints so any held accessory swings
  // with the arm during the walk cycle. Local position (0, -0.55, 0)
  // matches the hand mesh — held items end up centred on the hand.
  const handLSocket = new TransformNode(`socket-hand-l-${id}`, scene);
  handLSocket.parent = elbowJointL;
  handLSocket.position.set(0, -0.55, 0);

  const handRSocket = new TransformNode(`socket-hand-r-${id}`, scene);
  handRSocket.parent = elbowJointR;
  handRSocket.position.set(0, -0.55, 0);

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
    // mesh.dispose(doNotRecurse=false, disposeMaterialAndTextures=true).
    // Default args leave materials hanging on scene.materials forever;
    // every outfit re-equip would otherwise leak ~5-10 per change.
    //
    // CRITICAL: garment textures are SHARED + owned by the texture cache
    // (getPatternTexture / getImageTexture). disposeMaterialAndTextures
    // would kill the shared texture out from under any OTHER avatar
    // wearing the same design — and even under THIS avatar on an
    // identical re-equip — leaving the garment invisible ("the avatar
    // got stripped" bug). So we detach every texture from the material
    // FIRST, then dispose. The material dies; the cached texture lives
    // until disposePatternTextureCache() at scene teardown.
    for (const m of attachedGarmentMeshes) detachAndDispose(m);
    attachedGarmentMeshes = [];
  }
  function clearAccessories(): void {
    for (const m of attachedAccessoryMeshes) detachAndDispose(m);
    attachedAccessoryMeshes = [];
  }
  function detachAndDispose(m: Mesh): void {
    const mat = m.material as StandardMaterial | null;
    if (mat) {
      // Null the texture slots so dispose(…, true) can't free the
      // cache-owned textures. Assigning null is the documented way to
      // detach without disposing.
      mat.diffuseTexture = null;
      mat.emissiveTexture = null;
      mat.bumpTexture = null;
    }
    m.dispose(false, true);
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
    // Skin regions are not unfolded garments; wrap the single Pattern in a
    // uniformDesign so it goes through the now-design-shaped compositor.
    // Seams baked into the texture do show on non-solid skin patterns, but
    // the current catalog only uses solid skin tones (which take the early-
    // return diffuseColor path above), so this is fine in practice.
    material.diffuseTexture = getPatternTexture(scene, patternKey(regionKey, pattern), uniformDesign(pattern));
  }

  // Map a garment mesh's name to the joint it should rig to. Garment
  // builders name their meshes with side-suffixed parts:
  //   sleeves (single): ${label}-sleeve-{l|r}, ${label}-shoulder-{l|r}, ${label}-cuff-{l|r}
  //   sleeves (split):  upper=${label}-sleeve-{l|r}, lower=${label}-sleeve-lower-{l|r}
  //   pants (single):   ${label}-leg-{l|r}-{front|back}
  //   pants (split):    upper=${label}-leg-{l|r}-{front|back},
  //                     lower=${label}-leg-lower-{l|r}-{front|back}
  //   shoes:            ${label}-{sole|upper|lace}-{l|r}
  // Torso shell, collar, hem, waistband, hood, pocket, lapel, strings,
  // buttons stay parented to root.
  function jointForGarmentMesh(name: string): TransformNode | null {
    // Lower-sleeve (forearm) → elbow. Must be checked BEFORE the shoulder
    // regex so `-sleeve-lower-l` isn't matched as `-sleeve-l` first.
    // Actually `-sleeve-l\b` requires a word boundary AFTER the `l`,
    // which `-sleeve-lower-l` lacks (next char `o` is a word char), but
    // explicit ordering makes the intent clear.
    if (/-sleeve-lower-l\b/.test(name)) return elbowJointL;
    if (/-sleeve-lower-r\b/.test(name)) return elbowJointR;
    // Elbow + knee patches — small spheres at the joint pivot in the
    // garment's material, masking the V-gap that opens between the
    // upper/lower cylinders when the limb bends. Stay at the pivot
    // (local 0,0,0 on the joint) so they don't move as the joint
    // rotates — the surrounding cylinders rotate around them.
    if (/-elbow-l\b/.test(name)) return elbowJointL;
    if (/-elbow-r\b/.test(name)) return elbowJointR;
    if (/-knee-l\b/.test(name)) return kneeJointL;
    if (/-knee-r\b/.test(name)) return kneeJointR;
    // Upper sleeve, shoulder dome, cuff → shoulder joint
    if (/-sleeve-l\b|-shoulder-l\b|-cuff-l\b/.test(name)) return shoulderJointL;
    if (/-sleeve-r\b|-shoulder-r\b|-cuff-r\b/.test(name)) return shoulderJointR;
    // Lower pant leg (shin) → knee
    if (/-leg-lower-l-(back|front)\b/.test(name)) return kneeJointL;
    if (/-leg-lower-r-(back|front)\b/.test(name)) return kneeJointR;
    // Upper pant leg (thigh) → hip
    if (/-leg-l-(back|front)\b/.test(name)) return hipJointL;
    if (/-leg-r-(back|front)\b/.test(name)) return hipJointR;
    // Shoes → ankle (counter-rotated against knee bend → no foot kink)
    if (/-sole-l\b|-upper-l\b|-lace-l\b/.test(name)) return ankleJointL;
    if (/-sole-r\b|-upper-r\b|-lace-r\b/.test(name)) return ankleJointR;
    return null;
  }

  function applyOutfit(textureItemIds: readonly string[], accessoryItemIds: readonly string[]): void {
    // Reset all joint rotations to the rest pose BEFORE building +
    // re-parenting garments. setParent() preserves WORLD transform, so if
    // the avatar is mid-walk-cycle when applyOutfit fires (joints rotated
    // 30°+), the freshly-built mesh's local position/rotation gets baked
    // RELATIVE to that rotated joint frame. Next frame the joints return
    // to other angles and the cloth ends up visibly skewed/detached from
    // the body. Reset → re-rig → next update() restores the animation.
    shoulderJointL.rotation.set(0, 0, 0);
    shoulderJointR.rotation.set(0, 0, 0);
    elbowJointL.rotation.set(0, 0, 0);
    elbowJointR.rotation.set(0, 0, 0);
    hipJointL.rotation.set(0, 0, 0);
    hipJointR.rotation.set(0, 0, 0);
    kneeJointL.rotation.set(0, 0, 0);
    kneeJointR.rotation.set(0, 0, 0);
    ankleJointL.rotation.set(0, 0, 0);
    ankleJointR.rotation.set(0, 0, 0);

    const regionPattern: Record<BodyRegion, Pattern> = {
      head: SKIN_DEFAULT,
      torso: TORSO_DEFAULT,
      arms: SKIN_DEFAULT,
      legs: LEGS_DEFAULT,
      feet: FEET_DEFAULT,
    };

    const allItems = textureItemIds
      .map((id) => getTextureItemOrCustom(id))
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
      for (const m of built) {
        attachedGarmentMeshes.push(m);
        // Rig: meshes named after limbs follow the corresponding joint. The
        // builders construct everything in world space parented to root;
        // setParent() re-parents while preserving world transform so the
        // mesh visually stays put — then joint rotation cascades into it.
        const joint = jointForGarmentMesh(m.name);
        if (joint) m.setParent(joint);
      }
    }

    // Expression token — `face-<expr>` rides the accessory CSV but is
    // not a mesh accessory; it reshapes the face features instead.
    // Absent token = neutral, so removing it resets the face.
    const faceToken = accessoryItemIds.find((aid) => aid.startsWith('face-'));
    setExpression((faceToken ? faceToken.slice(5) : 'neutral') as AvatarExpression);

    clearAccessories();
    for (const accessoryId of accessoryItemIds) {
      if (accessoryId.startsWith('face-')) continue;  // handled above
      const def = getAccessoryItem(accessoryId);
      if (!def) continue;
      const socket = sockets[def.socket as AccessorySocket];
      if (!socket) continue;
      const built = def.build(scene, socket);
      for (const m of built) attachedAccessoryMeshes.push(m);
    }
  }

  // Walking animation state. game.ts calls setPosition every frame from the
  // server snapshot (or local prediction for self). We treat the smoothed
  // difference between consecutive positions as the avatar's velocity.
  // baseY is the ground-plane Y the game wants; root.y = baseY + bob each
  // frame so bob doesn't fight position writes. swayZ rotates around the
  // forward axis for a gentle side-to-side gait.
  let baseX = 0, baseY = 0, baseZ = 0;
  let prevX = 0, prevZ = 0;
  let prevInitialised = false; // guards a huge first-frame velocity spike
  let smoothedSpeed = 0;       // EMA of instantaneous |Δpos|/dt
  let walkPhase = 0;
  let bob = 0;
  let swayZ = 0;

  // ─── Jump state ─────────────────────────────────────────────────────────
  // Simple gravity-driven hop: y(t) = v0 * t − 0.5 * g * t², ends when y
  // returns to 0. Tuned so the avatar lifts ~1.5 units (≈ half its own
  // height) over ~0.8 seconds — readable as a jump without disrupting the
  // walking animation.
  const JUMP_V0 = 7.0;     // initial vertical velocity, units/sec
  const JUMP_G  = 18.0;    // gravity, units/sec²  → peak ~1.36, total ~0.78s
  let jumpActive = false;
  let jumpT = 0;
  let jumpY = 0;

  function triggerJump(): void {
    // Ignore re-triggers while already in the air — wait for landing.
    if (jumpActive) return;
    jumpActive = true;
    jumpT = 0;
    jumpY = 0;
  }

  // ─── Wave emote — temporarily override the R shoulder rotation ───────
  // Active for WAVE_DURATION seconds. While active, shoulderJointR is
  // driven by waveT (oscillating) instead of by the walking animation.
  // jumpActive + wave coexist; same with walking + wave.
  const WAVE_DURATION = 1.6;
  let waveActive = false;
  let waveT = 0;

  function triggerWave(): void {
    waveActive = true;
    waveT = 0;
  }

  // ─── Compliment particle — a small floating heart above the head ─────
  // Lifetime ~1.8s. Plane billboards to face the camera (BILLBOARDMODE_Y
  // keeps it upright but rotates around Y to face the viewer). Material
  // alpha-fades out across the lifetime; world Y rises ~1.5 units.
  function triggerCompliment(): void {
    const tex = new DynamicTexture(`heart-tex-${Math.floor(performance.now() * 1000)}`, { width: 128, height: 128 }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, 128, 128);
    ctx.font = '96px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💖', 64, 64);
    tex.update();

    const mat = new StandardMaterial(`heart-mat-${Math.floor(performance.now() * 1000)}`, scene);
    mat.diffuseTexture = tex;
    mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(0.9, 0.4, 0.5);
    mat.disableLighting = false;
    mat.backFaceCulling = false;

    const plane = MeshBuilder.CreatePlane(`heart-plane-${Math.floor(performance.now() * 1000)}`, {
      size: 0.8, sideOrientation: Mesh.DOUBLESIDE,
    }, scene);
    plane.parent = root;
    plane.position.set(0, 3.0, 0);
    plane.billboardMode = Mesh.BILLBOARDMODE_Y;
    plane.material = mat;
    plane.isPickable = false;

    const LIFETIME = 1.8;
    let t = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      t += dt;
      plane.position.y = 3.0 + t * 1.5;       // rise
      mat.alpha = Math.max(0, 1 - t / LIFETIME);
      if (t >= LIFETIME) {
        plane.dispose();
        mat.dispose();
        tex.dispose();
        scene.onBeforeRenderObservable.remove(obs);
      }
    });
  }

  // ─── Chat bubble — text speech bubble above the head ──────────────────
  // Lifetime ~4s. Replaces any previous bubble so spamming chat doesn't
  // stack bubbles. Word-wraps to keep long messages readable.
  let activeChatBubble: { mesh: Mesh; mat: StandardMaterial; tex: DynamicTexture; obs: { remove: () => void } | null } | null = null;
  function triggerChat(text: string): void {
    // Dispose any prior bubble so only one shows at a time.
    if (activeChatBubble) {
      const a = activeChatBubble;
      if (a.obs) scene.onBeforeRenderObservable.remove(a.obs as never);
      a.mesh.dispose();
      a.mat.dispose();
      a.tex.dispose();
      activeChatBubble = null;
    }
    const trimmed = text.slice(0, 80);
    if (!trimmed) return;

    // Word-wrap at ~22 chars per line.
    const MAX_CHARS_PER_LINE = 22;
    const lines: string[] = [];
    const words = trimmed.split(' ');
    let line = '';
    for (const w of words) {
      if ((line + ' ' + w).trim().length > MAX_CHARS_PER_LINE) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = (line + ' ' + w).trim();
      }
    }
    if (line) lines.push(line);
    const numLines = Math.min(lines.length, 3);

    // Canvas sized to fit the wrapped text + bubble padding.
    const canvasW = 512;
    const canvasH = 128 + (numLines - 1) * 56;
    const id = Math.floor(performance.now() * 1000);
    const tex = new DynamicTexture(`chat-tex-${id}`, { width: canvasW, height: canvasH }, scene, false);
    tex.hasAlpha = true;
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, canvasW, canvasH);
    // Rounded-rectangle white bubble with a small tail at the bottom.
    const pad = 22;
    const bubbleY0 = pad;
    const bubbleY1 = canvasH - pad - 18; // leave room for the tail
    const bubbleX0 = pad;
    const bubbleX1 = canvasW - pad;
    const r = 28;
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 4;
    // Rounded-rect path (manual since some Canvas2D contexts lack roundRect):
    ctx.beginPath();
    ctx.moveTo(bubbleX0 + r, bubbleY0);
    ctx.lineTo(bubbleX1 - r, bubbleY0);
    ctx.quadraticCurveTo(bubbleX1, bubbleY0, bubbleX1, bubbleY0 + r);
    ctx.lineTo(bubbleX1, bubbleY1 - r);
    ctx.quadraticCurveTo(bubbleX1, bubbleY1, bubbleX1 - r, bubbleY1);
    // Tail at the bottom-center
    ctx.lineTo(canvasW / 2 + 18, bubbleY1);
    ctx.lineTo(canvasW / 2, bubbleY1 + 22);
    ctx.lineTo(canvasW / 2 - 18, bubbleY1);
    ctx.lineTo(bubbleX0 + r, bubbleY1);
    ctx.quadraticCurveTo(bubbleX0, bubbleY1, bubbleX0, bubbleY1 - r);
    ctx.lineTo(bubbleX0, bubbleY0 + r);
    ctx.quadraticCurveTo(bubbleX0, bubbleY0, bubbleX0 + r, bubbleY0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Text inside the bubble
    ctx.fillStyle = '#202028';
    ctx.font = 'bold 40px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineH = 48;
    const textCenterY = (bubbleY0 + bubbleY1) / 2 - ((numLines - 1) * lineH) / 2;
    for (let i = 0; i < numLines; i++) {
      ctx.fillText(lines[i], canvasW / 2, textCenterY + i * lineH);
    }
    tex.update();

    const mat = new StandardMaterial(`chat-mat-${id}`, scene);
    mat.diffuseTexture = tex;
    mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(0.95, 0.95, 0.95);
    mat.specularColor = new Color3(0, 0, 0);
    mat.disableLighting = false;
    mat.backFaceCulling = false;

    // Plane sized to match the canvas aspect; ~2 world units wide.
    const planeW = 2.2;
    const planeH = planeW * (canvasH / canvasW);
    const plane = MeshBuilder.CreatePlane(`chat-plane-${id}`, {
      width: planeW, height: planeH, sideOrientation: Mesh.DOUBLESIDE,
    }, scene);
    plane.parent = root;
    plane.position.set(0, 3.4 + planeH / 2, 0);
    plane.billboardMode = Mesh.BILLBOARDMODE_Y;
    plane.material = mat;
    plane.isPickable = false;

    const LIFETIME = 4.0;
    const FADE_START = 3.2;
    let elapsed = 0;
    const obs = scene.onBeforeRenderObservable.add(() => {
      const dt = scene.getEngine().getDeltaTime() / 1000;
      elapsed += dt;
      // Pop-in scale: 0→1 over the first 0.15s
      if (elapsed < 0.15) {
        const k = elapsed / 0.15;
        const s = 0.6 + 0.4 * k;
        plane.scaling.set(s, s, s);
      } else {
        plane.scaling.set(1, 1, 1);
      }
      if (elapsed > FADE_START) {
        mat.alpha = Math.max(0, 1 - (elapsed - FADE_START) / (LIFETIME - FADE_START));
      }
      if (elapsed >= LIFETIME) {
        plane.dispose();
        mat.dispose();
        tex.dispose();
        scene.onBeforeRenderObservable.remove(obs);
        if (activeChatBubble && activeChatBubble.tex === tex) activeChatBubble = null;
      }
    });
    activeChatBubble = { mesh: plane, mat, tex, obs: obs as unknown as { remove: () => void } };
  }

  function setPosition(x: number, y: number, z: number): void {
    baseX = x; baseY = y; baseZ = z;
    if (!prevInitialised) {
      prevX = x; prevZ = z;
      prevInitialised = true;
    }
    root.position.set(x, y + bob, z);
  }

  function setRotationY(rad: number): void {
    root.rotation.y = rad;
  }

  function update({ config, deltaSeconds }: AvatarUpdateContext): void {
    const speed = config?.idleRotationSpeed ?? 0;
    if (speed > 0) root.rotation.y += deltaSeconds * speed;

    // Instantaneous speed from position delta. With high-refresh-rate
    // monitors dt is tiny (~16ms or less) and floating-point noise makes
    // raw |Δpos|/dt twitchy — feed it through a low-pass EMA so the bob
    // amplitude tracks the underlying gait, not jitter.
    const dt = Math.max(deltaSeconds, 1 / 240);
    const dx = baseX - prevX;
    const dz = baseZ - prevZ;
    prevX = baseX;
    prevZ = baseZ;
    const instSpeed = Math.hypot(dx, dz) / dt;
    // Per-frame alpha so the response time is consistent across frame
    // rates: time constant ≈ 0.15s.
    const alpha = 1 - Math.exp(-dt / 0.15);
    smoothedSpeed = smoothedSpeed + (instSpeed - smoothedSpeed) * alpha;

    if (smoothedSpeed > 0.5) {
      const intensity = Math.min(smoothedSpeed / 6, 1);
      walkPhase += dt * (5 + intensity * 3);

      // Reference signal: sin(walkPhase) represents the L-leg position
      // through the gait cycle. Phase=π/2 → L leg fully forward (heel
      // strike). Phase=3π/2 → L leg fully back (toe off). R leg lags by π.
      const sL = Math.sin(walkPhase);
      const sR = Math.sin(walkPhase + Math.PI);

      // Body bob — torso rises and falls TWICE per gait cycle, peaking
      // mid-stance when both legs straighten (foot directly under pelvis).
      // Math: |sin| has period π, so abs(sin(walkPhase)) gives 2 peaks per
      // 2π → matches the two foot plants.
      bob = Math.abs(Math.sin(walkPhase)) * 0.04 * intensity;
      // Side-to-side weight shift — one full cycle per gait. Subtle.
      swayZ = Math.cos(walkPhase) * 0.025 * intensity;

      // HIP swing — leg rotates forward/back around the hip pivot.
      // Positive rotation.x on the hip pushes the foot FORWARD.
      const hipSwing = 0.55 * intensity;
      hipJointL.rotation.x = sL * hipSwing;
      hipJointR.rotation.x = sR * hipSwing;

      // KNEE bend — Babylon left-handed: POSITIVE rotation.x at the knee
      // makes the shin fold UP-AND-BACK relative to the thigh (natural
      // knee bend, foot tucks toward the buttocks).
      //
      // Phase: the L leg's swing phase runs walkPhase ∈ (π/2, 3π/2) —
      // from toe-off (hipL maxed back at +sin = +1) through neutral hip
      // at π, to heel-strike (hipL maxed forward at -sin = -1). The knee
      // should be BENT throughout swing (so the foot clears the ground)
      // and STRAIGHT during stance. -cos(walkPhase) gives that exactly:
      //   walkPhase=π/2  → -cos = 0      (toe-off, knee straight)
      //   walkPhase=π    → -cos = 1      (mid-swing, peak bend)
      //   walkPhase=3π/2 → -cos = 0      (heel-strike, knee straight)
      //   walkPhase=0    → -cos = -1 → 0 (stance, no bend)
      // The previous formula peaked near heel-strike instead — wrong
      // phase — so the foot lifted just as it should have been touching
      // down, and the lower-pant cylinder rotated dramatically at the
      // exact moment it should have been resting straight.
      const kneeAmp = 1.2 * intensity;
      const bendL = Math.max(0, -Math.cos(walkPhase)) * kneeAmp;
      const bendR = Math.max(0,  Math.cos(walkPhase)) * kneeAmp;
      kneeJointL.rotation.x = bendL;
      kneeJointR.rotation.x = bendR;

      // ARM swing — opposite phase to legs (R arm forward when L leg
      // forward). NEGATIVE shoulder.rotation.x pulls arm FORWARD in
      // Babylon's left-handed convention (hand swings toward +Z).
      const armSwing = 0.5 * intensity;
      shoulderJointL.rotation.x = -sL * armSwing;
      shoulderJointR.rotation.x = -sR * armSwing;
      // Wave override — see below; wave drives shoulderJointR.rotation.x
      // post-walk so the gesture wins over the walking swing.

      // ELBOW bend — NEGATIVE rotation.x folds the forearm UP-AND-FORWARD
      // (hand reaches toward chest). Positive would bend the elbow
      // backwards like a T-rex. Bend is biggest when the arm is on its
      // BACK stroke (natural arm carry).
      const elbowBase = 0.2 * intensity;
      const elbowVar = 0.35 * intensity;
      elbowJointL.rotation.x = -(elbowBase + Math.max(0, sL) * elbowVar);
      elbowJointR.rotation.x = -(elbowBase + Math.max(0, sR) * elbowVar);
    } else {
      // Idle — exponentially dampen everything toward zero.
      const damp = Math.exp(-dt / 0.18);
      bob *= damp;
      swayZ *= damp;
      shoulderJointL.rotation.x *= damp;
      shoulderJointR.rotation.x *= damp;
      hipJointL.rotation.x *= damp;
      hipJointR.rotation.x *= damp;
      kneeJointL.rotation.x *= damp;
      kneeJointR.rotation.x *= damp;
      elbowJointL.rotation.x *= damp;
      elbowJointR.rotation.x *= damp;
      if (Math.abs(bob) < 0.001) bob = 0;
      if (Math.abs(swayZ) < 0.001) swayZ = 0;
    }
    // Ankle counter — PARTIAL (~half) so the foot tilts naturally with
    // the leg without snapping flat or dragging the toes through the
    // ground. Full counter (−1 × each) locked the foot world-horizontal,
    // which read as unnaturally stiff during big hip swings. No counter
    // (rotate fully with shin) made the foot kink at the ankle during
    // knee bend. Half-and-half gives a believable ankle that points the
    // toes down slightly during back-swing and the heel up slightly at
    // heel-strike — exactly how a stylized walk reads.
    const ANKLE_HIP_K = 0.5;
    const ANKLE_KNEE_K = 0.5;
    ankleJointL.rotation.x = -(hipJointL.rotation.x * ANKLE_HIP_K + kneeJointL.rotation.x * ANKLE_KNEE_K);
    ankleJointR.rotation.x = -(hipJointR.rotation.x * ANKLE_HIP_K + kneeJointR.rotation.x * ANKLE_KNEE_K);

    // ── Wave emote override — drives the R shoulder regardless of the
    //    walking/idle state. Active for WAVE_DURATION seconds after
    //    triggerWave(). The arm rotates UP (negative X pulls the hand
    //    forward and slightly up), then oscillates side-to-side a few
    //    times for a friendly hand-wave shape, then eases out.
    if (waveActive) {
      waveT += dt;
      const phase = waveT / WAVE_DURATION;        // 0 → 1
      if (phase >= 1) {
        waveActive = false;
        // Don't reset shoulderJointR.rotation.x here — the next walk-anim
        // tick will overwrite it, and idle damping will damp it from this
        // last value back to 0.
      } else {
        // Raise + wiggle: lift the arm forward-up (~-1.0 rad) plus add a
        // sine oscillation for the side-to-side wave (rotation.z).
        const liftEnvelope = Math.sin(phase * Math.PI);  // 0 → 1 → 0
        // Lift the arm OVERHEAD (was -1.1 rad ≈ 63° — barely above
        // horizontal; now -2.5 rad ≈ 143° → arm points up-and-slightly-back,
        // the natural wave-hi position).
        shoulderJointR.rotation.x = -2.5 * liftEnvelope;
        // Also straighten the elbow during the wave so the forearm
        // doesn't sag into a half-bent pose — the walking-anim block
        // above damps elbow rotation but doesn't zero it; we override.
        elbowJointR.rotation.x = 0;
        // ROTATION.Z controls the side-to-side hand wave around the
        // arm's vertical axis. 3 full oscillations across the lifetime,
        // amplitude widened a touch now that the arm is overhead.
        shoulderJointR.rotation.z = Math.sin(waveT * 12) * 0.6 * liftEnvelope;
      }
    } else {
      // Damp any residual rotation.z (from a prior wave) toward 0 so the
      // arm doesn't permanently tilt sideways.
      const damp = Math.exp(-dt / 0.18);
      shoulderJointR.rotation.z *= damp;
      if (Math.abs(shoulderJointR.rotation.z) < 0.001) shoulderJointR.rotation.z = 0;
    }

    // Tick the jump (if active) and write the combined vertical offset.
    // Closed form: y(t) = v0 * t − 0.5 * g * t². Jump ends when y returns
    // to 0 (which it does at t = 2 * v0 / g) — clamp to 0 and clear the
    // flag so the next triggerJump() fires immediately at the landing.
    if (jumpActive) {
      jumpT += dt;
      jumpY = JUMP_V0 * jumpT - 0.5 * JUMP_G * jumpT * jumpT;
      if (jumpY <= 0 && jumpT > 0.05) {
        jumpY = 0;
        jumpActive = false;
        jumpT = 0;
      }
    }

    root.position.set(baseX, baseY + bob + jumpY, baseZ);
    root.rotation.z = swayZ;
  }

  function dispose(): void {
    clearGarments();
    clearAccessories();
    head.dispose();
    neck.dispose();
    torso.dispose();
    shoulderL.dispose();
    shoulderR.dispose();
    // Joints are TransformNodes — disposing them recursively disposes the
    // upperArm/lowerArm/hand/thigh/shin/foot meshes parented under them.
    shoulderJointL.dispose();
    shoulderJointR.dispose();
    hipJointL.dispose();
    hipJointR.dispose();
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

  return {
    root, mesh: torso, applyOutfit, setExpression, setPosition, setRotationY,
    triggerJump, triggerCompliment, triggerWave, triggerChat,
    update, dispose,
  };
}

/** Call once at scene teardown to drop cached pattern/image textures. */
export function disposeAvatarSharedCaches(): void {
  disposePatternTextureCache();
}

// Backwards-compat aliases so older callers keep compiling during migration.
export type PlayerActor = CharacterAvatar;
export type ActorUpdateContext = AvatarUpdateContext;
export const createPlayerActor = (scene: Scene): CharacterAvatar => createCharacterAvatar(scene);
