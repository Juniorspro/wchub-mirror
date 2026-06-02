// ══════════════════════════════════════════════
// Babylon runtime entry. Unique creator of Engine + Scene + runRenderLoop.
// Bridges store → actor.applyOutfit on every outfit version change so the
// React-side wardrobe UI drives the 3D character without ever calling
// Babylon APIs directly.
// ══════════════════════════════════════════════

import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import HavokPhysics from '@babylonjs/havok';
import { Engine, Scene, Vector3 } from '@babylonjs/core';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import type { GameRuntimeContext } from '../App';
import { createPlayerActor, type PlayerActor } from './actor';
import { createGameAudio } from './audio';
import { configureHardwareScaling } from './helpers';
import { RUNTIME_CONFIG } from './config';
import { createSceneEntities, type SceneEntities } from './entities';
import { createItemField, type ItemField } from './items';
import {
  hydratePresetsFromStorage,
  resetGameStore,
  setGameSnapshot,
  subscribeGameStore,
  type GameStoreSnapshot,
} from './store';
import { createGameWorld, type GameWorldObjects } from './world';

export interface GameRuntimeHandle {
  dispose(): void;
}

interface RuntimeObjects {
  world: GameWorldObjects;
  actor: PlayerActor;
  items: ItemField;
  entities: SceneEntities;
}

const GRAVITY = new Vector3(0, RUNTIME_CONFIG.physics.gravityY, 0);

function createRuntimeObjects(scene: Scene, canvas: HTMLCanvasElement): RuntimeObjects {
  return {
    world: createGameWorld(scene, canvas),
    actor: createPlayerActor(scene),
    items: createItemField(scene),
    entities: createSceneEntities(scene),
  };
}

async function enableHavokPhysics(scene: Scene): Promise<boolean> {
  try {
    const havok = await HavokPhysics();
    const plugin = new HavokPlugin(true, havok);
    return scene.enablePhysics(GRAVITY, plugin);
  } catch (error) {
    console.warn('[babylon] Havok physics unavailable; continuing without physics.', error);
    return false;
  }
}

export function startGame(canvas: HTMLCanvasElement, runtimeContext?: GameRuntimeContext): GameRuntimeHandle {
  let disposed = false;
  let frame = 0;
  let elapsed = 0;
  let lastTime = 0;
  let lastOutfitVersion = -1;

  resetGameStore();
  hydratePresetsFromStorage();

  const audio = createGameAudio();
  const engine = new Engine(canvas, RUNTIME_CONFIG.engine.antialias, {
    preserveDrawingBuffer: RUNTIME_CONFIG.engine.preserveDrawingBuffer,
    stencil: RUNTIME_CONFIG.engine.stencil,
    adaptToDeviceRatio: RUNTIME_CONFIG.engine.adaptToDeviceRatio,
  });
  configureHardwareScaling(engine);

  const scene = new Scene(engine);
  const objects = createRuntimeObjects(scene, canvas);
  setGameSnapshot({ totalItems: objects.items.field.count });

  // Bridge: any outfit version change in the store → repaint regions + rebuild accessories on the actor.
  // subscribeGameStore() invokes the listener immediately with the current snapshot, so the default outfit applies on boot.
  const onSnapshot = (snap: GameStoreSnapshot) => {
    if (snap.outfit.version === lastOutfitVersion) return;
    lastOutfitVersion = snap.outfit.version;
    objects.actor.applyOutfit(snap.outfit.textureItemIds, snap.outfit.accessoryItemIds);
  };
  const unsubOutfit = subscribeGameStore(onSnapshot);

  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);

  void enableHavokPhysics(scene).then((physicsEnabled) => {
    if (disposed) return;
    setGameSnapshot({
      ready: true,
      physicsEnabled,
      message: physicsEnabled ? 'Studio ready' : 'Studio ready',
    });
  });

  engine.runRenderLoop(() => {
    if (disposed) return;

    const now = performance.now();
    const dt = Math.min((now - (lastTime || now)) / 1000, 0.05);
    lastTime = now;

    if (runtimeContext?.phaseRef.current !== 'ACTIVE') {
      scene.render();
      return;
    }

    elapsed += dt;
    frame += 1;

    const input = runtimeContext?.input;
    objects.actor.update({
      config: runtimeContext?.configRef.current,
      deltaSeconds: dt,
    });

    if (input?.consumeTap()) audio.unlock();

    objects.entities.update(elapsed);
    objects.items.update();

    if (frame % 12 === 0) {
      setGameSnapshot({
        frame,
        elapsed,
      });
    }

    scene.render();
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('resize', onResize);
      engine.stopRenderLoop();
      unsubOutfit();
      objects.items.dispose();
      objects.entities.dispose();
      objects.actor.dispose();
      objects.world.dispose();
      audio.dispose();
      scene.disablePhysicsEngine();
      scene.dispose();
      engine.dispose();
    },
  };
}
