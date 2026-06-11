// ══════════════════════════════════════════════
// GLB accessory models — load-once-then-clone for wearable meshes.
//
// The wardrobe accessory build path (items.ts → actor.applyOutfit) is
// SYNCHRONOUS: `build(scene, socket) => Mesh[]`. GLB loading is async, so we
// can't load inside build(). Instead we preload each GLB ONCE into a disabled
// template, then clone it synchronously per avatar inside build().
//
// Two deliberate choices keep this safe + cheap:
//
//  1. Every clone's materials are REPLACED with a single solid-color toon
//     StandardMaterial (matching the existing procedural glasses look). This
//     (a) keeps GLB glasses stylistically "in line with" glasses-round /
//     glasses-shades, and (b) sidesteps a real hazard: actor.detachAndDispose
//     calls mesh.dispose(false, /*disposeMaterialAndTextures*/ true), which
//     would otherwise free a SHARED GLB material/texture out from under every
//     other avatar wearing the same pair. A fresh per-instance StandardMaterial
//     is safe to dispose.
//
//  2. Models are generated texture-less (gen-model-3d --no-texture), so the
//     GLBs are geometry-only and tiny — the frame COLOR comes from code here,
//     not from baked textures. The GLB contributes the frame SHAPE only.
//
// Outside the preloaded set (or before load completes) instantiate() returns
// [] and the accessory simply doesn't render until game.ts re-applies the
// outfit on preload completion. No throw, no disposal race.
// ══════════════════════════════════════════════

import { Color3, Mesh, type Scene } from '@babylonjs/core';
import { ImportMeshAsync } from '@babylonjs/core';
// Side-effect: ensure the glTF/glb loader is registered even if this module is
// reached before helpers.ts. Idempotent.
import '@babylonjs/loaders/glTF';
import { createStandardMaterial } from './helpers';
import { ASSETS } from '../assets';

/** Per-item fit applied when a template is cloned onto a bone socket. The
 *  template is auto-normalised so its longest axis = `targetSize`; offsets +
 *  rotation then seat it on the face. Tuned per glasses style. */
export interface AccessoryFit {
  /** Solid frame color (hex) — replaces all GLB materials on the clone. */
  frameColor: string;
  /** World size of the model's longest axis after normalisation. */
  targetSize: number;
  xOffset?: number;
  yOffset?: number;
  zOffset?: number;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
}

interface ModelTemplate {
  root: Mesh;          // disabled empty root holding the imported geometry
  scale: number;       // 1 / longestAxis — normalises to a unit before targetSize
  cx: number; cy: number; cz: number; // bbox centre in template-local space
}

type Entry = ModelTemplate | 'failed';

// Per-scene template cache + in-flight promise dedupe.
const TEMPLATES = new WeakMap<Scene, Map<string, Entry>>();
const PENDING = new WeakMap<Scene, Map<string, Promise<void>>>();
let cloneSeed = 0;

function sceneMap<V>(wm: WeakMap<Scene, Map<string, V>>, scene: Scene): Map<string, V> {
  let m = wm.get(scene);
  if (!m) { m = new Map(); wm.set(scene, m); }
  return m;
}

async function loadTemplate(scene: Scene, assetKey: string): Promise<void> {
  const cache = sceneMap(TEMPLATES, scene);
  if (cache.has(assetKey)) return; // already resolved (template or 'failed')
  const url = ASSETS[assetKey];
  if (!url) {
    console.warn(`[accessory-model] no ASSETS['${assetKey}'] — skipping.`);
    cache.set(assetKey, 'failed');
    return;
  }
  try {
    const res = await ImportMeshAsync(url, scene);
    const root = new Mesh(`acc-tpl-${assetKey}`, scene);
    for (const m of res.meshes) {
      if (!m.parent) m.parent = root;
      m.isPickable = false;
    }
    // Measure in local space (root is at identity) to derive the normalising
    // scale + recentre offset. getHierarchyBoundingVectors forces the world
    // matrices it needs.
    root.computeWorldMatrix(true);
    const bb = root.getHierarchyBoundingVectors(true);
    const longest = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) || 1;
    const template: ModelTemplate = {
      root,
      scale: 1 / longest,
      cx: (bb.min.x + bb.max.x) / 2,
      cy: (bb.min.y + bb.max.y) / 2,
      cz: (bb.min.z + bb.max.z) / 2,
    };
    root.setEnabled(false); // template never renders; clones do
    cache.set(assetKey, template);
  } catch (err) {
    console.warn(`[accessory-model] load failed for '${assetKey}'; accessory will be skipped.`, err);
    cache.set(assetKey, 'failed');
  }
}

/** Preload a set of GLB accessory templates. Resolves once all attempts
 *  settle (failures are recorded, not thrown). Safe to call repeatedly —
 *  already-loaded keys are no-ops and concurrent loads are de-duped. */
export async function preloadAccessoryModels(scene: Scene, assetKeys: readonly string[]): Promise<void> {
  const pending = sceneMap(PENDING, scene);
  await Promise.all(
    assetKeys.map((key) => {
      let p = pending.get(key);
      if (!p) {
        p = loadTemplate(scene, key).finally(() => pending.delete(key));
        pending.set(key, p);
      }
      return p;
    }),
  );
}

/** True once the template for `assetKey` has loaded successfully in `scene`. */
export function isAccessoryModelReady(scene: Scene, assetKey: string): boolean {
  const e = TEMPLATES.get(scene)?.get(assetKey);
  return !!e && e !== 'failed';
}

/** Clone a preloaded GLB template onto a bone socket. Returns the wrapper mesh
 *  (with the model parented + materials replaced) for actor disposal tracking,
 *  or [] if the template isn't loaded yet (caller re-applies on preload done). */
export function instantiateAccessoryModel(
  scene: Scene,
  parent: import('@babylonjs/core').TransformNode,
  assetKey: string,
  fit: AccessoryFit,
): Mesh[] {
  const entry = TEMPLATES.get(scene)?.get(assetKey);
  if (!entry || entry === 'failed') return [];
  const tpl = entry;

  // Wrapper carries the normalising scale + per-item seat (offset/rotation);
  // it's the single mesh returned, so disposing it recursively frees the clone.
  const wrapper = new Mesh(`acc-${assetKey}-${cloneSeed++}`, scene);
  wrapper.parent = parent;
  wrapper.isPickable = false;

  const clone = tpl.root.clone(`${wrapper.name}-c`, wrapper, /* doNotCloneChildren */ false);
  if (!clone) { wrapper.dispose(); return []; }
  clone.setEnabled(true);
  clone.isPickable = false;
  // Shift the clone so the model's bbox centre lands on the wrapper origin —
  // then wrapper scale (about origin) + rotation pivot around the model centre.
  clone.position.set(-tpl.cx, -tpl.cy, -tpl.cz);

  wrapper.scaling.setAll(tpl.scale * fit.targetSize);
  wrapper.position.set(fit.xOffset ?? 0, fit.yOffset ?? 0, fit.zOffset ?? 0);
  wrapper.rotation.set(fit.rotX ?? 0, fit.rotY ?? 0, fit.rotZ ?? 0);

  // Replace every GLB material with one solid toon material (see header).
  const mat = createStandardMaterial(scene, `${wrapper.name}-mat`, Color3.FromHexString(fit.frameColor));
  for (const m of clone.getChildMeshes(false)) {
    m.material = mat;
    m.isPickable = false;
  }

  return [wrapper];
}
