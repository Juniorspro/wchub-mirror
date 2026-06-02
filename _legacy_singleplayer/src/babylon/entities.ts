// ══════════════════════════════════════════════
// Studio decorations: a soft floor-blob shadow under the character to anchor
// it visually to the pedestal. No animation, no NPCs, no goal markers —
// the dress-up studio is a single-actor stage.
// ══════════════════════════════════════════════

import { Color3, MeshBuilder, type Mesh, type Scene } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';

export interface SceneEntities {
  marker: Mesh;
  update(timeSeconds: number): void;
  dispose(): void;
}

export function createSceneEntities(scene: Scene): SceneEntities {
  // LLM-EXTENSION:ENTITIES — Minimal studio dressing: one soft floor shadow disc under the character to ground it on the pedestal. No animated content, no NPCs, no per-frame work.
  // DO NOT REMOVE the LLM-EXTENSION:ENTITIES tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  const shadow = MeshBuilder.CreateDisc('character-shadow', { radius: 0.8, tessellation: 32 }, scene);
  shadow.rotation.x = Math.PI / 2;
  shadow.position.y = 0.008;
  const shadowMat = createStandardMaterial(scene, 'character-shadow-mat', Color3.FromHexString('#000000'));
  shadowMat.alpha = 0.22;
  shadowMat.backFaceCulling = false;
  shadow.material = shadowMat;
  shadow.isPickable = false;

  return {
    marker: shadow,
    update() {
      // no-op
    },
    dispose() {
      shadow.dispose(false, true);
    },
  };
}
