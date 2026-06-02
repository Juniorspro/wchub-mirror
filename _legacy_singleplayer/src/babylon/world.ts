// ══════════════════════════════════════════════
// Dress-up studio: pastel backdrop, soft studio lighting, a circular pedestal
// stage centred on the character, and an ArcRotateCamera framed for a full
// front-to-back body preview. Pointer drag on the canvas rotates the camera
// around the character (built into ArcRotateCamera.attachControl); the
// character itself does not move.
// ══════════════════════════════════════════════

import { Color3, Color4, MeshBuilder, type ArcRotateCamera, type DirectionalLight, type HemisphericLight, type Mesh, type Scene } from '@babylonjs/core';
import { createBaseSceneObjects, createStandardMaterial } from './helpers';
import { RUNTIME_CONFIG } from './config';

export interface GameWorldObjects {
  camera: ArcRotateCamera;
  hemiLight: HemisphericLight;
  sunLight: DirectionalLight;
  ground: Mesh;
  dispose(): void;
}

export function createGameWorld(scene: Scene, canvas: HTMLCanvasElement): GameWorldObjects {
  // LLM-EXTENSION:WORLD — Dress-up studio environment. Pastel clear colour, soft hemispheric ambient + low-intensity sun for even fill lighting (so clothes and skin tones read true), and a circular pedestal disc the character stands on. The ArcRotateCamera is framed for a full body preview at chest-height target; drag rotates around the character.
  // DO NOT REMOVE the LLM-EXTENSION:WORLD tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  const base = createBaseSceneObjects(scene, canvas);
  scene.clearColor = Color4.FromHexString(`${RUNTIME_CONFIG.world.clearColor}ff`);

  // Re-aim the camera at chest height (character is ~2.5 units tall, chest ~1.4).
  base.camera.target.set(0, 1.4, 0);

  // Studio lighting: bright ambient, soft directional fill.
  base.hemiLight.intensity = 0.95;
  base.hemiLight.groundColor = new Color3(0.65, 0.62, 0.55);
  base.sunLight.intensity = 0.55;

  // Pedestal stage — a slim disc the character stands on.
  const ground = MeshBuilder.CreateDisc('pedestal', { radius: 1.6, tessellation: 48 }, scene);
  ground.rotation.x = Math.PI / 2;
  ground.position.y = 0.0;
  ground.material = createStandardMaterial(scene, 'pedestal-material', Color3.FromHexString('#e8dfd1'));
  ground.receiveShadows = true;

  return {
    ...base,
    ground,
    dispose() {
      ground.dispose(false, true);
    },
  };
}
