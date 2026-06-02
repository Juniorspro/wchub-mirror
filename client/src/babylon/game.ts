// ══════════════════════════════════════════════
// Babylon runtime entry. Unique creator of Engine + Scene + runRenderLoop.
//
// Multiplayer wiring:
//   • One CharacterAvatar per sessionId — spawned on first sight, disposed
//     when the player leaves the room.
//   • Local avatar driven by net.predictedSelf each frame (instant input
//     response).
//   • Remote avatars driven by net.getInterpolatedPlayers() (smoothed
//     snapshot data).
//   • Camera target tracks the local avatar each frame.
//   • Outfit changes come in via player.textureItems / accessoryItems
//     strings — the avatar's applyOutfit only re-runs when the string
//     for THAT player actually changes (cheap diff via Map).
//   • Stall proximity is recomputed per frame for the local avatar; the
//     nearest stall (within radius) is published to the store so the HUD
//     can show a "Browse [Stall]" panel.
// ══════════════════════════════════════════════

import '@babylonjs/core/Physics/joinedPhysicsEngineComponent';
import HavokPhysics from '@babylonjs/havok';
import { Engine, Scene, Vector3 } from '@babylonjs/core';
import { HavokPlugin } from '@babylonjs/core/Physics/v2/Plugins/havokPlugin';
import type { GameRuntimeContext } from '../App';
import { createCharacterAvatar, disposeAvatarSharedCaches, type CharacterAvatar } from './actor';
import { createGameAudio } from './audio';
import { configureHardwareScaling, getCameraRelativeMoveXZ } from './helpers';
import { RUNTIME_CONFIG } from './config';
import { createSceneEntities, type SceneEntities, type StallDef } from './entities';
import { createItemField, type ItemField } from './items';
import {
  hydratePresetsFromStorage,
  resetGameStore,
  setChatMessages,
  setGameSnapshot,
  setNearbyStall,
  setOutfit,
  setRoomCode,
  setSelfId,
  subscribeGameStore,
  type ChatEntry,
  type GameStoreSnapshot,
} from './store';
import { createGameWorld, FAIR_CENTER, type GameWorldObjects } from './world';
import { getInterpolatedPlayers, type NetClient } from '../net';

export interface GameRuntimeHandle {
  dispose(): void;
}

interface RuntimeObjects {
  world: GameWorldObjects;
  items: ItemField;
  entities: SceneEntities;
}

const GRAVITY = new Vector3(0, RUNTIME_CONFIG.physics.gravityY, 0);
const CHAT_HISTORY_CAP = 40;

function createRuntimeObjects(scene: Scene, canvas: HTMLCanvasElement): RuntimeObjects {
  return {
    world: createGameWorld(scene, canvas),
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

  resetGameStore();
  hydratePresetsFromStorage();

  const net = runtimeContext?.net as NetClient | undefined;
  const audio = createGameAudio();
  const engine = new Engine(canvas, RUNTIME_CONFIG.engine.antialias, {
    preserveDrawingBuffer: RUNTIME_CONFIG.engine.preserveDrawingBuffer,
    stencil: RUNTIME_CONFIG.engine.stencil,
    adaptToDeviceRatio: RUNTIME_CONFIG.engine.adaptToDeviceRatio,
  });
  configureHardwareScaling(engine);

  const scene = new Scene(engine);
  const objects = createRuntimeObjects(scene, canvas);

  // ─── Multi-avatar registry ────────────────────────────────────────────────
  const avatars = new Map<string, CharacterAvatar>();
  const appliedOutfitFor = new Map<string, string>(); // sessionId → cached "textureCSV|accessoryCSV"
  let localAvatar: CharacterAvatar | null = null;

  function ensureAvatar(sid: string, isSelf: boolean): CharacterAvatar {
    let a = avatars.get(sid);
    if (!a) {
      a = createCharacterAvatar(scene, { id: sid });
      a.setPosition(FAIR_CENTER.x, 0, FAIR_CENTER.z);
      avatars.set(sid, a);
      if (isSelf) localAvatar = a;
    }
    return a;
  }

  function disposeAvatar(sid: string): void {
    const a = avatars.get(sid);
    if (a) {
      a.dispose();
      avatars.delete(sid);
      appliedOutfitFor.delete(sid);
      if (localAvatar === a) localAvatar = null;
    }
  }

  function applyOutfitIfChanged(sid: string, textureCsv: string, accessoryCsv: string): void {
    const key = `${textureCsv}|${accessoryCsv}`;
    if (appliedOutfitFor.get(sid) === key) return;
    appliedOutfitFor.set(sid, key);
    const a = avatars.get(sid);
    if (!a) return;
    const textureIds = csvToArray(textureCsv);
    const accessoryIds = csvToArray(accessoryCsv);
    a.applyOutfit(textureIds, accessoryIds);
  }

  // ─── Chat ─────────────────────────────────────────────────────────────────
  const chatHistory: ChatEntry[] = [];

  // ─── Local outfit → server sync ───────────────────────────────────────────
  // Whenever the local store's outfit version bumps (HUD equip/unequip), we
  // send it up so the server broadcasts it to other clients.
  let lastLocalOutfitVersion = -1;
  function syncLocalOutfit(snap: GameStoreSnapshot): void {
    if (snap.outfit.version === lastLocalOutfitVersion) return;
    lastLocalOutfitVersion = snap.outfit.version;
    const textureCsv = snap.outfit.textureItemIds.join(',');
    const accessoryCsv = snap.outfit.accessoryItemIds.join(',');
    // Local avatar reflects immediately (don't wait for server echo).
    if (localAvatar && net?.meta) {
      applyOutfitIfChanged(net.meta.selfId, textureCsv, accessoryCsv);
    }
    if (net?.isOpen()) {
      net.send('equip', { textureItems: textureCsv, accessoryItems: accessoryCsv });
    }
  }
  const unsubOutfit = subscribeGameStore(syncLocalOutfit);

  // ─── Net event handlers ───────────────────────────────────────────────────
  if (net) {
    const cbs = (net as unknown as {
      onChatRoomMessage?: (entry: ChatEntry) => void;
    });
    // We need to register a chat handler on the underlying room. NetClient
    // doesn't expose that directly, so we hook via the room.send path: chat
    // broadcasts come back as `room.onMessage('chat', ...)`. The cleanest
    // place to subscribe is to use the public NetClient.send method as a
    // pass-through and rely on the framework's `event` channel — but for
    // chat the server uses `room.broadcast('chat', ...)` which arrives as
    // `room.onMessage('chat', ...)`. Without a public hook, we listen via
    // a small extension below using internal access.
    void cbs;
    // Poll-style attach: every 250ms, if a room becomes available, register
    // chat + identity handlers. Cheap, idempotent.
    const attachInterval = setInterval(() => {
      const room = (net as unknown as { room?: { onMessage: (t: string, cb: (msg: ChatEntry) => void) => void; _chatHooked?: boolean } }).room;
      if (room && !room._chatHooked) {
        room._chatHooked = true;
        room.onMessage('chat', (msg) => {
          chatHistory.push(msg);
          while (chatHistory.length > CHAT_HISTORY_CAP) chatHistory.shift();
          setChatMessages([...chatHistory]);
        });
      }
    }, 250);
    // Stash so dispose can clear it
    (net as unknown as { _attachInterval?: ReturnType<typeof setInterval> })._attachInterval = attachInterval;
  }

  const onResize = () => engine.resize();
  window.addEventListener('resize', onResize);

  void enableHavokPhysics(scene).then((physicsEnabled) => {
    if (disposed) return;
    setGameSnapshot({ ready: true, physicsEnabled, message: physicsEnabled ? 'Fairground open' : 'Fairground open' });
  });

  // ─── Render loop ──────────────────────────────────────────────────────────
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

    // ── Net input: camera-relative WASD → world-space (vx, vz)
    if (net && input) {
      const di = input.dir;
      const move = getCameraRelativeMoveXZ(objects.world.camera, di.x, di.y);
      const aim = objects.world.camera.alpha;
      net.sendInput(move.x, move.z, aim);
    }

    if (input?.consumeTap()) audio.unlock();

    // ── Once meta is available, expose selfId + roomCode to store (one-time)
    if (net?.meta && !getStoreFlag('selfId-set')) {
      setSelfId(net.meta.selfId);
      setRoomCode(net.roomCode);
      markStoreFlag('selfId-set');
    }

    // ── Spawn / position local avatar from net.predictedSelf
    if (net?.meta && net.predictedSelf) {
      const selfSid = net.meta.selfId;
      const self = ensureAvatar(selfSid, true);
      self.setPosition(net.predictedSelf.x, 0, net.predictedSelf.y);
      self.setRotationY(net.predictedSelf.aim);
      // Camera follows local avatar
      objects.world.camera.target.set(net.predictedSelf.x, 1.2, net.predictedSelf.y);

      // Stall proximity
      const nearest = objects.entities.findNearestStall(net.predictedSelf.x, net.predictedSelf.y);
      setNearbyStall(nearest ? nearest.id : null);
    }

    // ── Position remote avatars + apply their outfits
    if (net?.meta) {
      const selfSid = net.meta.selfId;
      const others = getInterpolatedPlayers(net);
      const seen = new Set<string>();
      seen.add(selfSid);
      for (const p of others) {
        if (p.id === selfSid) continue;
        seen.add(p.id);
        const a = ensureAvatar(p.id, false);
        a.setPosition(p.x, 0, p.y);
        a.setRotationY(p.aim);
      }
      // Apply outfit from latest schema snapshot (cheap diff via key cache).
      const snap = net.snapshots[net.snapshots.length - 1];
      if (snap) {
        for (const p of snap.players) {
          const textureCsv = (p as unknown as { textureItems?: string }).textureItems ?? '';
          const accessoryCsv = (p as unknown as { accessoryItems?: string }).accessoryItems ?? '';
          applyOutfitIfChanged(p.id, textureCsv, accessoryCsv);
        }
      }
      // Despawn anyone who's gone (excluding self).
      for (const sid of avatars.keys()) {
        if (!seen.has(sid)) disposeAvatar(sid);
      }
    }

    objects.entities.update(elapsed);
    objects.items.update();

    if (frame % 12 === 0) {
      setGameSnapshot({ frame, elapsed });
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
      const netRef = (net as unknown as { _attachInterval?: ReturnType<typeof setInterval> });
      if (netRef?._attachInterval) clearInterval(netRef._attachInterval);
      for (const a of avatars.values()) a.dispose();
      avatars.clear();
      objects.items.dispose();
      objects.entities.dispose();
      objects.world.dispose();
      audio.dispose();
      scene.disablePhysicsEngine();
      scene.dispose();
      engine.dispose();
      disposeAvatarSharedCaches();
    },
  };
}

// ─── Tiny one-shot flag store (avoid spamming setSelfId every frame) ───────
const storeFlags = new Set<string>();
function getStoreFlag(k: string): boolean { return storeFlags.has(k); }
function markStoreFlag(k: string): void { storeFlags.add(k); }

function csvToArray(csv: string): string[] {
  if (!csv) return [];
  return csv.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

// Re-export StallDef for HUD.
export type { StallDef };

// Re-export setOutfit for backwards-compat callers in the HUD.
export { setOutfit };
