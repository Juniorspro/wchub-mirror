// ══════════════════════════════════════════════
// Babylon stability helpers: consolidate high-risk API usage so each
// generation does not repeat the same mistakes.
// Constraints: top-level imports only; CommonJS dynamic loading is banned
// in browser code; per-frame updates reuse scratch vectors instead of
// allocating new Vector3 objects.
// ══════════════════════════════════════════════

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  ImportMeshAsync,
  Matrix,
  Mesh,
  Quaternion,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import type { Nullable } from '@babylonjs/core';
// Side-effect import: registers the glTF/glb loader so loadHeroModel() below
// can import injected character models. Kept at the top level — CommonJS /
// dynamic require is banned in browser code (see module header).
import '@babylonjs/loaders/glTF';
import { RUNTIME_CONFIG } from './config';

const CAMERA_TARGET = new Vector3(0, 1, 0);
const HEMI_DIRECTION = new Vector3(0, 1, 0);
const SUN_DIRECTION = new Vector3(-0.35, -1, -0.45);
const RECOVERY_POSITION = new Vector3(0, 1, 0);
const SCRATCH_PICKUP_POSITION = new Vector3(0, 0, 0);
const SCRATCH_PICKUP_SCALE = new Vector3(1, 1, 1);
const SCRATCH_PICKUP_ROTATION = Quaternion.Identity();
const SCRATCH_PICKUP_MATRIX = Matrix.Identity();
const SCRATCH_CAMERA_MOVE = new Vector3(0, 0, 0);

export interface BaseSceneObjects {
  camera: ArcRotateCamera;
  hemiLight: HemisphericLight;
  sunLight: DirectionalLight;
}

export interface PickupField {
  mesh: Mesh;
  alive: Uint8Array;
  count: number;
  setAlive(index: number, alive: boolean): void;
  update(timeSeconds: number): void;
  dispose(): void;
}

export function configureHardwareScaling(engine: Engine): void {
  const memory = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const lowMemory = typeof memory === 'number' && memory <= 4;
  engine.setHardwareScalingLevel(
    lowMemory ? RUNTIME_CONFIG.engine.lowMemoryHardwareScaling : RUNTIME_CONFIG.engine.defaultHardwareScaling,
  );
}

export function createBaseSceneObjects(scene: Scene, canvas: HTMLCanvasElement): BaseSceneObjects {
  scene.clearColor = Color4.FromHexString(`${RUNTIME_CONFIG.world.clearColor}ff`);

  const camera = new ArcRotateCamera(
    'main-camera',
    RUNTIME_CONFIG.camera.alpha,
    RUNTIME_CONFIG.camera.beta,
    RUNTIME_CONFIG.camera.radius,
    CAMERA_TARGET,
    scene,
  );
  camera.minZ = RUNTIME_CONFIG.camera.minZ;
  camera.maxZ = RUNTIME_CONFIG.camera.maxZ;
  camera.lowerRadiusLimit = RUNTIME_CONFIG.camera.lowerRadiusLimit;
  camera.upperRadiusLimit = RUNTIME_CONFIG.camera.upperRadiusLimit;
  camera.attachControl(canvas, true);
  scene.activeCamera = camera;

  const hemiLight = new HemisphericLight('ambient-light', HEMI_DIRECTION, scene);
  hemiLight.intensity = 0.72;
  hemiLight.groundColor = new Color3(0.42, 0.48, 0.56);

  const sunLight = new DirectionalLight('sun-light', SUN_DIRECTION, scene);
  sunLight.intensity = 0.85;
  sunLight.position.set(7, 12, 6);

  return { camera, hemiLight, sunLight };
}

export function createStandardMaterial(scene: Scene, name: string, color: Color3, emissive?: Color3): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = color;
  material.specularColor = new Color3(0.08, 0.08, 0.08);
  if (emissive) material.emissiveColor = emissive;
  return material;
}

export function createDefaultGround(scene: Scene): Mesh {
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: RUNTIME_CONFIG.world.groundSize, height: RUNTIME_CONFIG.world.groundSize, subdivisions: 1 },
    scene,
  );
  ground.material = createStandardMaterial(scene, 'ground-material', new Color3(0.36, 0.56, 0.42));
  ground.receiveShadows = true;
  return ground;
}

// A deliberately humanoid placeholder: torso + head + two arms + two legs
// merged into ONE mesh. Replaces the old single-capsule hero, which read as a
// featureless cylinder. Parts are centred on the local origin so the existing
// `position.y = 0.9` (and recoverFromFall's (0, 1, 0)) still drops the feet
// onto the ground. Not a hot path — allocations here are fine.
export function createFallbackHero(scene: Scene): Mesh {
  const bodyMaterial = createStandardMaterial(scene, 'hero-material', new Color3(0.16, 0.42, 0.92), new Color3(0.02, 0.06, 0.14));
  const headMaterial = createStandardMaterial(scene, 'hero-head-material', new Color3(0.95, 0.78, 0.62), new Color3(0.1, 0.07, 0.05));

  const part = (name: string, builder: Mesh, x: number, y: number, z: number, material: StandardMaterial): Mesh => {
    builder.position.set(x, y, z);
    builder.material = material;
    builder.name = name;
    return builder;
  };

  const parts: Mesh[] = [
    part('hero-torso', MeshBuilder.CreateBox('hero-torso', { width: 0.5, height: 0.6, depth: 0.3 }, scene), 0, 0, 0, bodyMaterial),
    part('hero-head', MeshBuilder.CreateSphere('hero-head', { diameter: 0.42, segments: 12 }, scene), 0, 0.5, 0, headMaterial),
    part('hero-arm-l', MeshBuilder.CreateBox('hero-arm-l', { width: 0.16, height: 0.55, depth: 0.18 }, scene), -0.36, 0.05, 0, bodyMaterial),
    part('hero-arm-r', MeshBuilder.CreateBox('hero-arm-r', { width: 0.16, height: 0.55, depth: 0.18 }, scene), 0.36, 0.05, 0, bodyMaterial),
    part('hero-leg-l', MeshBuilder.CreateBox('hero-leg-l', { width: 0.18, height: 0.7, depth: 0.22 }, scene), -0.16, -0.55, 0, bodyMaterial),
    part('hero-leg-r', MeshBuilder.CreateBox('hero-leg-r', { width: 0.18, height: 0.7, depth: 0.22 }, scene), 0.16, -0.55, 0, bodyMaterial),
  ];

  // disposeSource + allow32Bits + multiMultiMaterials keeps the two colours.
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, true);
  const hero = merged ?? parts[0];
  hero.name = 'hero';
  hero.position.y = 0.9;
  return hero;
}

// Asset key the orchestrator can populate in src/assets.ts (ASSETS['hero'])
// with a glb/gltf URL or data URL for the player character model.
export const HERO_MODEL_ASSET_KEY = 'hero';

// Loads an injected character model and returns a single root Mesh whose
// transform drives the whole rig (children — including the glTF __root__ — are
// parented to it, so animations/materials survive). Returns null on failure so
// callers keep the procedural fallback hero. Not a hot path.
export async function loadHeroModel(scene: Scene, url: string): Promise<Nullable<Mesh>> {
  try {
    // data: URLs carry no file extension, so force the glb plugin; real URLs
    // keep their own extension-based plugin selection.
    const options = url.startsWith('data:') ? { pluginExtension: '.glb' } : undefined;
    const result = await ImportMeshAsync(url, scene, options);
    const root = new Mesh('hero', scene);
    for (const imported of result.meshes) {
      if (!imported.parent) imported.parent = root;
    }
    root.position.y = 0.9;
    return root;
  } catch (error) {
    console.warn('[babylon] hero model load failed; keeping fallback hero.', error);
    return null;
  }
}

export function createPickupField(scene: Scene, count: number, radius: number): PickupField {
  const safeCount = Math.max(0, count);
  const mesh = MeshBuilder.CreateTorus('pickup-field', { diameter: 0.48, thickness: 0.08, tessellation: 12 }, scene);
  mesh.material = createStandardMaterial(scene, 'pickup-material', new Color3(1, 0.78, 0.18), new Color3(0.18, 0.08, 0.01));

  const alive = new Uint8Array(safeCount);
  alive.fill(1);
  const matrices = new Float32Array(safeCount * 16);

  const writeMatrix = (index: number, timeSeconds: number) => {
    const angle = safeCount <= 0 ? 0 : (index / safeCount) * Math.PI * 2;
    const bob = Math.sin(timeSeconds * 2 + index) * 0.12;
    SCRATCH_PICKUP_POSITION.set(Math.cos(angle) * radius, 0.8 + bob, Math.sin(angle) * radius);
    SCRATCH_PICKUP_SCALE.setAll(alive[index] ? 1 : 0.001);
    Matrix.ComposeToRef(SCRATCH_PICKUP_SCALE, SCRATCH_PICKUP_ROTATION, SCRATCH_PICKUP_POSITION, SCRATCH_PICKUP_MATRIX);
    SCRATCH_PICKUP_MATRIX.copyToArray(matrices, index * 16);
  };

  for (let index = 0; index < safeCount; index += 1) writeMatrix(index, 0);
  mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);

  return {
    mesh,
    alive,
    count: safeCount,
    setAlive(index: number, nextAlive: boolean) {
      if (index < 0 || index >= safeCount) return;
      alive[index] = nextAlive ? 1 : 0;
    },
    update(timeSeconds: number) {
      for (let index = 0; index < safeCount; index += 1) writeMatrix(index, timeSeconds);
      mesh.thinInstanceBufferUpdated('matrix');
    },
    dispose() {
      mesh.dispose(false, true);
    },
  };
}

export function recoverFromFall(mesh: Nullable<Mesh>, floorY = RUNTIME_CONFIG.world.fallRecoveryY): boolean {
  if (!mesh || mesh.position.y >= floorY) return false;
  mesh.position.copyFrom(RECOVERY_POSITION);
  mesh.rotation.set(0, 0, 0);
  return true;
}

// Screen-space input.dir uses y-down (W=(0,-1), S=(0,1), D=(1,0), A=(-1,0)).
// ArcRotateCamera in Babylon's default left-handed Y-up world has
// forwardXZ = (-cos α, -sin α) and rightXZ = (-sin α, cos α). Combining
// the two gives a camera-relative move = (-dirY)*forward + dirX*right,
// so W always walks "into the screen" and rotating the camera rotates the
// movement basis with it.
export function getCameraRelativeMoveXZ(
  camera: ArcRotateCamera,
  dirX: number,
  dirY: number,
): Vector3 {
  const cosA = Math.cos(camera.alpha);
  const sinA = Math.sin(camera.alpha);
  SCRATCH_CAMERA_MOVE.x = dirY * cosA - dirX * sinA;
  SCRATCH_CAMERA_MOVE.y = 0;
  SCRATCH_CAMERA_MOVE.z = dirY * sinA + dirX * cosA;
  return SCRATCH_CAMERA_MOVE;
}
