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
import { createItemField, GLB_ACCESSORY_KEYS, type ItemField } from './items';
import { preloadAccessoryModels } from './accessoryModels';
import {
  awardCoins,
  getGameSnapshot,
  applyMilestoneReward,
  setBettingFixtures,
  setBettingPersonal,
  setBettingPool,
  setBettingStandings,
  setChatMessages,
  setGameSnapshot,
  setLastSoccerGoal,
  setNearbyStall,
  setOutfit,
  setRoomCode,
  setSelfId,
  settleBet,
  subscribeGameStore,
  type ChatEntry,
  type GameStoreSnapshot,
} from './store';
import {
  createGameWorld,
  FAIR_CENTER,
  PORTAL_INTERACT_RADIUS,
  SIGNPOST_INTERACT_RADIUS,
  SIGNPOST_X,
  SIGNPOST_Z,
  STADIUM_PORTAL_GATES,
  type GameWorldObjects,
} from './world';
import { advanceSelfPrediction, getInterpolatedPlayers, type NetClient } from '../net';
import { hasNativeBridge, openGameDetail } from './bridge';
import { cameraDragBus, isPortraitRotated, subscribeRotated } from './touch';
import { groundHeightAt, normalizeInput } from '@shared';

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
  // Avatar's world Y-rotation — sticks at whatever direction the player was
  // walking when they last let go of the keys. While idle, the camera can
  // orbit freely without the avatar following it.
  let lastAim = 0;
  // ─── Betting state ────────────────────────────────────────────────────────
  // Reference to the last bettingFixtures array we pushed to the store.
  // The NetClient swaps the array reference whenever it receives a new
  // `event:fixtures` snapshot — so an `!==` comparison is enough to
  // detect "is there fresh data?" without a deep equality check each frame.
  let lastBettingFixturesRef: unknown = null;
  // Same deal for the group-standings table (daily refresh).
  let lastBettingStandingsRef: unknown = null;
  // Top-up pool tracking (number + unlocked-tier-count → simple compare).
  let lastBettingPool = -1;
  let lastBettingPoolUnlockedLen = -1;
  // Personal contribution tracking — same diff strategy.
  let lastMyContrib = -1;
  let lastMyUnlockedLen = -1;
  // Top-voters list — reference compare.
  let lastTopVotersRef: unknown = null;

  // ─── Soccer-ball render state ─────────────────────────────────────────────
  // Server broadcasts authoritative ball position at ~20Hz when moving.
  // We track the smoothed render position separately so the visual
  // follows the server target with a short lerp (60Hz render frames →
  // 20Hz updates → ~3 frames between updates, so a moderate lerp factor
  // keeps motion fluid without visible lag).
  let ballRenderX = 158;
  let ballRenderZ = 32;
  // Accumulated spin angle (radians). Increments by velocity * dt each
  // frame so the ball texture rolls realistically.
  let ballSpinAngle = 0;
  // Last spin axis (perpendicular to ball velocity in the XZ plane).
  let ballSpinAxisX = 1;
  let ballSpinAxisZ = 0;

  // ─── Portal-gate state ────────────────────────────────────────────────────
  // G key triggers redirect to the nearby portal's URL. Edge-detect so
  // holding G doesn't fire repeatedly, plus a guard so we never redirect
  // twice in one session (the page is leaving anyway, but the guard
  // protects against any quick double-tap before navigation kicks in).
  let gHeldLastFrame = false;
  let portalRedirectFired = false;

  // ─── Community / social state ─────────────────────────────────────────────
  // Compliments + wave use the same edge+cooldown trigger pattern as jump.
  let eHeldLastFrame = false;     // 'E' = compliment nearest player
  let fHeldLastFrame = false;     // 'F' = wave emote
  let lastComplimentSentAt = 0;
  let lastWaveSentAt = 0;
  const COMPLIMENT_RETRIGGER_MS = 3100;  // slightly above server's 3000
  const WAVE_RETRIGGER_MS = 1600;
  // Crowd bonus accumulator. Tick up while ≥2 other players are within
  // CROWD_RADIUS. At CROWD_BONUS_THRESHOLD seconds, award coins + reset.
  // Recipients are credited locally (cosmetic economy → no server state).
  const CROWD_RADIUS = 8;
  const CROWD_BONUS_THRESHOLD = 30;
  const CROWD_BONUS_AMOUNT = 50;
  let crowdTimer = 0;
  // Last computed "nearest other player" for the HUD compliment hint.
  // Updated each frame so the HUD knows whom the E key would target.
  let nearestOtherId: string | null = null;
  let nearestOtherDist = Infinity;
  const COMPLIMENT_RANGE = 5;

  // Spacebar jump trigger state. Two parallel paths fire a jump:
  //   1. Edge-detect (clean press): not-held last frame, held this frame
  //      → fire immediately. Snappy feel for clean taps.
  //   2. Cooldown fallback: if space is held for longer than the cooldown
  //      since the last fire, re-fire. Covers the case where the browser
  //      misses a keyup event (window loses focus, Alt-Tab during a key
  //      hold, etc.) — without this, `keys.has(' ')` stayed true forever
  //      and the player could never jump again.
  let spaceHeldLastFrame = false;
  let lastJumpSentAt = 0;
  // Slightly above the server's 900ms rate limit so a held key bounces
  // the player at roughly stride pace without the server dropping any.
  const JUMP_RETRIGGER_MS = 950;

  // NOTE: store reset + localStorage hydration (presets/economy/outfit)
  // moved to App.tsx, BEFORE net.connect() — the join opts carry the
  // restored outfit, so hydration must complete before connecting. A
  // resetGameStore() here would wipe that restored state again.

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

  // ─── Landscape-in-portrait camera control ─────────────────────────────────
  // On portrait touch devices the rotation store (touch.tsx) rotates
  // .game-shell 90° clockwise. Babylon's ArcRotateCameraPointersInput reads
  // raw SCREEN deltas, so under that rotation its orbit axes are swapped
  // (verified: a physically-horizontal swipe changed beta, not alpha). In
  // rotated mode we detach Babylon's pointer control entirely and drive the
  // camera from the cameraDragBus filled by <CameraDragZone> (touch.tsx),
  // whose deltas are already remapped into game-local axes. On real
  // landscape (desktop or auto-rotated devices) Babylon's native control —
  // including mouse-wheel zoom — stays attached.
  // attachControl is NOT idempotent (it re-registers pointer observers), so
  // track the state and only flip on real transitions.
  let cameraPointerControlAttached = true; // helpers.ts attaches at creation
  const applyCameraControlMode = () => {
    const wantDetached = isPortraitRotated();
    if (wantDetached && cameraPointerControlAttached) {
      objects.world.camera.detachControl();
      cameraPointerControlAttached = false;
    } else if (!wantDetached && !cameraPointerControlAttached) {
      objects.world.camera.attachControl(canvas, true);
      cameraPointerControlAttached = true;
    }
  };
  applyCameraControlMode();
  const unsubRotation = subscribeRotated(applyCameraControlMode);
  // Inertial offsets are amplified ~×10 by Babylon's inertia decay
  // (total = offset / (1 - inertia), inertia 0.9), so these divisors are
  // ~10× the per-event feel. 8500 was calibrated against the native
  // pointers input: ~0.0011 rad per pixel of drag, measured both ways.
  const CAM_DRAG_SENSITIVITY = 8500;
  const CAM_PINCH_PRECISION = 400;

  // ─── Multi-avatar registry ────────────────────────────────────────────────
  const avatars = new Map<string, CharacterAvatar>();
  const appliedOutfitFor = new Map<string, string>(); // sessionId → cached "textureCSV|accessoryCSV"
  // Smoothed walkable-floor Y per avatar (sessionId → current ground Y).
  // The shared groundHeightAt() is a hard step function at platform rims;
  // a short exp-lerp turns the step into a quick "walks up onto it" rise
  // instead of a teleport pop. Cleared in disposeAvatar.
  const groundYBySid = new Map<string, number>();
  let localAvatar: CharacterAvatar | null = null;
  // Dev-only inspection hook for driving the scene from automated tests.
  // Pushed (not assigned) because React StrictMode double-mounts the
  // world — tests scan all registered maps for the live one.
  if (import.meta.env.DEV) {
    const w = window as unknown as { __avatarMaps?: unknown[]; __nets?: unknown[]; __inputs?: unknown[]; __engines?: unknown[]; __scenes?: unknown[] };
    (w.__avatarMaps ??= []).push(avatars);
    (w.__nets ??= []).push(net);
    (w.__inputs ??= []).push(runtimeContext?.input);
    // Engine + scene exposed so automated previews can pump the render loop
    // manually (background tabs throttle rAF, so avatars never spawn / render
    // otherwise — spawning happens inside engine.runRenderLoop).
    (w.__engines ??= []).push(engine);
    (w.__scenes ??= []).push(scene);
  }

  function ensureAvatar(sid: string, isSelf: boolean): CharacterAvatar {
    let a = avatars.get(sid);
    if (!a) {
      a = createCharacterAvatar(scene, { id: sid });
      a.setPosition(FAIR_CENTER.x, groundHeightAt(FAIR_CENTER.x, FAIR_CENTER.z), FAIR_CENTER.z);
      avatars.set(sid, a);
      if (isSelf) {
        localAvatar = a;
        // Self's outfit is owned by the local store — apply current outfit
        // immediately on spawn so the avatar isn't bare while we wait for
        // the next user click.
        const snap0 = getGameSnapshot();
        const textureCsv = snap0.outfit.textureItemIds.join(',');
        const accessoryCsv = snap0.outfit.accessoryItemIds.join(',');
        applyOutfitIfChanged(sid, textureCsv, accessoryCsv);
      }
      console.log(`[fair] avatar spawned: ${sid} (self=${isSelf})`);
    }
    return a;
  }

  function disposeAvatar(sid: string): void {
    const a = avatars.get(sid);
    if (a) {
      a.dispose();
      avatars.delete(sid);
      appliedOutfitFor.delete(sid);
      groundYBySid.delete(sid);
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
          // Stamp local arrival time — msg.t is the SERVER clock, which can
          // be minutes off the phone's; the HUD's unread comparison must
          // stay in one clock domain (see ChatEntry.localT).
          chatHistory.push({ ...msg, localT: Date.now() });
          while (chatHistory.length > CHAT_HISTORY_CAP) chatHistory.shift();
          setChatMessages([...chatHistory]);
          // Trigger a floating speech bubble above the sender's avatar.
          // Avatar might not exist yet on the very first chat (race), in
          // which case the bubble is just skipped — chat history still
          // captures it in the bottom-left panel either way.
          const a = avatars.get(msg.from);
          if (a) a.triggerChat(msg.text);
        });
      }
    }, 250);
    // Stash so dispose can clear it
    (net as unknown as { _attachInterval?: ReturnType<typeof setInterval> })._attachInterval = attachInterval;
  }

  // ─── Preload GLB accessory models (glasses) ───────────────────────────────
  // The wardrobe build path is synchronous, so GLB-backed accessories clone a
  // preloaded template (see accessoryModels.ts). Kick the load off up front;
  // once it settles, re-apply every avatar's CURRENT outfit so any glasses
  // equipped before the meshes finished loading now appear.
  void preloadAccessoryModels(scene, GLB_ACCESSORY_KEYS).then(() => {
    if (disposed) return;
    for (const [sid, outfitKey] of appliedOutfitFor) {
      const a = avatars.get(sid);
      if (!a) continue;
      const sep = outfitKey.indexOf('|');
      const textureCsv = sep >= 0 ? outfitKey.slice(0, sep) : outfitKey;
      const accessoryCsv = sep >= 0 ? outfitKey.slice(sep + 1) : '';
      a.applyOutfit(csvToArray(textureCsv), csvToArray(accessoryCsv));
    }
  });

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

    // ── Net input: camera-relative WASD → world-space (vx, vz).
    //    Also runs CLIENT-SIDE PREDICTION via advanceSelfPrediction each
    //    frame using the same @shared.movePlayer the server's step() uses,
    //    so the local avatar moves at full render-rate (instead of jumping
    //    once per 50ms server snapshot). reconcileSelf later smooths any
    //    small disagreement between this prediction and the server.
    if (net && input) {
      const di = input.dir;
      const move = getCameraRelativeMoveXZ(objects.world.camera, di.x, di.y);
      // `aim` is the avatar's world Y-rotation. ONLY update it when the
      // player is actually moving — that way the camera can orbit freely
      // (mouse drag on the canvas) without yanking the avatar around. When
      // idle, the avatar keeps the direction it was last walking in.
      //
      // An avatar with rotation.y=θ has local +Z (the face direction) at
      // world (sin θ, cos θ). We want that to match the world-space
      // movement vector (move.x, move.z): sin θ = move.x, cos θ = move.z,
      // so θ = atan2(move.x, move.z).
      const moveMag = Math.hypot(move.x, move.z);
      if (moveMag > 0.05) lastAim = Math.atan2(move.x, move.z);
      const aim = lastAim;
      const { x: nvx, y: nvy } = normalizeInput(move.x, move.z);

      net.sendInput(nvx, nvy, aim);

      if (net.predictedSelf && net.meta) {
        advanceSelfPrediction(
          net.predictedSelf,
          { vx: nvx, vy: nvy, aim },
          dt,
          net.meta,
          net.meta.playerSpeed,
        );
      }
    }

    if (input?.consumeTap()) audio.unlock();

    // ── Rotated-mode camera orbit/zoom: drain the touch bus into Babylon's
    //    inertial offsets so damping and the alpha/beta/radius limits (incl.
    //    world.ts's per-frame ground guard + stadium keep-out) apply as-is.
    if (cameraDragBus.dx !== 0 || cameraDragBus.dy !== 0 || cameraDragBus.pinch !== 0) {
      const cam = objects.world.camera;
      cam.inertialAlphaOffset -= cameraDragBus.dx / CAM_DRAG_SENSITIVITY;
      cam.inertialBetaOffset -= cameraDragBus.dy / CAM_DRAG_SENSITIVITY;
      // += here, not -=: Babylon applies radius -= inertialRadiusOffset, so
      // a positive pinch delta (fingers spreading) must yield a POSITIVE
      // offset to shrink the radius (zoom in) — the universal convention.
      cam.inertialRadiusOffset += cameraDragBus.pinch / CAM_PINCH_PRECISION;
      cameraDragBus.dx = 0;
      cameraDragBus.dy = 0;
      cameraDragBus.pinch = 0;
    }

    // ── Jump: spacebar edge OR cooldown trigger. The server validates +
    //    rate-limits + broadcasts back to all clients; the broadcast
    //    (drained below) is what plays the visual hop on every client
    //    including the sender. No optimistic local trigger — keeps the
    //    server as the single source of truth and avoids double-fire.
    const spaceHeld = !!input?.keys.has(' ');
    if (spaceHeld && net) {
      const nowMs = performance.now();
      const justPressed = !spaceHeldLastFrame;
      const cooledDown = nowMs - lastJumpSentAt >= JUMP_RETRIGGER_MS;
      if (justPressed || cooledDown) {
        net.send('jump');
        lastJumpSentAt = nowMs;
      }
    }
    spaceHeldLastFrame = spaceHeld;

    // Drain server-confirmed jump events from the NetClient queue and
    // trigger the visual hop on the matching avatar. Multiple jumps in
    // one frame (unlikely with rate-limit) all process in order.
    if (net) {
      while (net.pendingJumps.length > 0) {
        const sid = net.pendingJumps.shift();
        if (!sid) continue;
        const a = avatars.get(sid);
        if (a) a.triggerJump();
      }
    }

    // ── Community / social: input + queue drain + crowd bonus
    if (net) {
      const selfId = net.meta?.selfId ?? '';

      // E = compliment nearest player. Edge + cooldown fallback (same
      // pattern as the jump trigger).
      const eHeld = !!input?.keys.has('e') || !!input?.keys.has('E');
      if (eHeld && nearestOtherId) {
        const nowMs = performance.now();
        const justPressed = !eHeldLastFrame;
        const cooledDown = nowMs - lastComplimentSentAt >= COMPLIMENT_RETRIGGER_MS;
        if (justPressed || cooledDown) {
          net.send('compliment', { to: nearestOtherId });
          lastComplimentSentAt = nowMs;
        }
      }
      eHeldLastFrame = eHeld;

      // F = wave emote. Edge + cooldown fallback.
      const fHeld = !!input?.keys.has('f') || !!input?.keys.has('F');
      if (fHeld) {
        const nowMs = performance.now();
        const justPressed = !fHeldLastFrame;
        const cooledDown = nowMs - lastWaveSentAt >= WAVE_RETRIGGER_MS;
        if (justPressed || cooledDown) {
          net.send('wave');
          lastWaveSentAt = nowMs;
        }
      }
      fHeldLastFrame = fHeld;

      // Drain compliment broadcasts: visual on the recipient + coin
      // award if THIS client is the recipient (cosmetic economy).
      while (net.pendingCompliments.length > 0) {
        const ev = net.pendingCompliments.shift();
        if (!ev) continue;
        const a = avatars.get(ev.to);
        if (a) a.triggerCompliment();
        if (selfId && ev.to === selfId) {
          awardCoins(5);
        }
      }

      // Drain wave broadcasts: visual on the sender's avatar.
      while (net.pendingWaves.length > 0) {
        const sid = net.pendingWaves.shift();
        if (!sid) continue;
        const a = avatars.get(sid);
        if (a) a.triggerWave();
      }

      // ── Betting: push the server-pushed fixture snapshot to the store
      //    so the HUD can render the match ticker + bet popup. We can
      //    diff cheaply by reference: NetClient replaces the array
      //    object whenever fresh data lands, so a !== comparison is enough.
      if (net.bettingFixtures !== lastBettingFixturesRef) {
        lastBettingFixturesRef = net.bettingFixtures;
        setBettingFixtures(net.bettingFixtures);
        // Repaint the in-world fixture board's display texture.
        objects.world.updateFixtureBoard(net.bettingFixtures);
      }
      if (net.bettingStandings !== lastBettingStandingsRef) {
        lastBettingStandingsRef = net.bettingStandings;
        setBettingStandings(net.bettingStandings);
      }
      // Top-up pool refresh. Tracked as a tuple of (pool, unlocked-set-length)
      // — both change atomically on a pool-update broadcast.
      if (net.bettingPool !== lastBettingPool
        || net.bettingPoolUnlocked.length !== lastBettingPoolUnlockedLen) {
        lastBettingPool = net.bettingPool;
        lastBettingPoolUnlockedLen = net.bettingPoolUnlocked.length;
        setBettingPool(net.bettingPool, net.bettingPoolUnlocked);
        objects.world.updateMonument(net.bettingPool, net.bettingPoolUnlocked);
      }
      // Personal contribution + unlocked tiers (per-player snapshot).
      if (net.bettingMyContribution !== lastMyContrib
        || net.bettingMyUnlocked.length !== lastMyUnlockedLen) {
        lastMyContrib = net.bettingMyContribution;
        lastMyUnlockedLen = net.bettingMyUnlocked.length;
        setBettingPersonal(net.bettingMyContribution, net.bettingMyUnlocked);
      }
      // Top-voters board — repaint when the server pushes a new list.
      if (net.bettingTopVoters !== lastTopVotersRef) {
        lastTopVotersRef = net.bettingTopVoters;
        objects.world.updateTopVotersBoard(net.bettingTopVoters);
      }
      // Milestone rewards — apply each + show toast.
      while (net.pendingMilestoneRewards.length > 0) {
        const r = net.pendingMilestoneRewards.shift();
        if (!r) continue;
        applyMilestoneReward(r);
      }
      // Drain bet confirmations — coins were already deducted locally
      // by placeLocalBet on click; this just ack's that the server
      // recorded it. (Soft-confirm slot; could trigger a toast later.)
      while (net.pendingBetConfirms.length > 0) {
        net.pendingBetConfirms.shift();
      }
      // Drain resolve payouts — credit coins + show result toast.
      while (net.pendingBetResults.length > 0) {
        const r = net.pendingBetResults.shift();
        if (!r) continue;
        settleBet(r.matchId, r.payout, r.profit);
      }

      // ── Soccer ball — smoothed follow of the server's authoritative pos.
      const ball = net.ballState;
      // Lerp toward the target. Coefficient k≈0.25 → ~63% of distance
      // closed per 60Hz frame; ball reaches target within 100ms which
      // matches the 50ms server tick + 1-frame network jitter buffer.
      const k = 0.25;
      ballRenderX += (ball.x - ballRenderX) * k;
      ballRenderZ += (ball.z - ballRenderZ) * k;
      // Rolling: spin axis is perpendicular to velocity in XZ plane.
      // Linear speed (m/s) divided by ball radius gives angular speed
      // (rad/s); accumulate over dt.
      const ballSpeed = Math.hypot(ball.vx, ball.vy);
      if (ballSpeed > 0.05) {
        ballSpinAxisX = ball.vx;
        ballSpinAxisZ = ball.vy;
        ballSpinAngle += (ballSpeed / 0.28) * dt;  // 0.28 = ball radius
      }
      objects.world.updateSoccerBall(
        ballRenderX, ballRenderZ,
        ballSpinAngle, ballSpinAxisX, ballSpinAxisZ,
      );

      // Drain goal events — show banner + award reward to scorer.
      const ownSid = net.meta?.selfId ?? '';
      while (net.pendingBallGoals.length > 0) {
        const g = net.pendingBallGoals.shift();
        if (!g) continue;
        // Coin reward goes to the scorer (and only the scorer's
        // client awards the local balance — server doesn't track coins).
        if (g.scorerSid && g.scorerSid === ownSid && g.reward > 0) {
          settleBet(`goal:${g.side}`, g.reward, g.reward);
        }
        setLastSoccerGoal({
          scorerName: g.scorerName || 'Someone',
          side: g.side,
          scoreN: g.scoreN,
          scoreS: g.scoreS,
          mine: g.scorerSid === ownSid,
          at: now,
        });
      }

      // Compute nearest other player + count nearby for the crowd bonus
      // (in the same loop pass, since they both need positions). Uses
      // the LATEST snapshot, not predicted — close enough for distance
      // checks at this tick rate.
      const latestSnapForSocial = net.snapshots[net.snapshots.length - 1];
      let nearestId: string | null = null;
      let nearestName = '';
      let nearestDist = Infinity;
      let crowdCount = 0;
      if (latestSnapForSocial && selfId) {
        const self = latestSnapForSocial.players.find((p) => p.id === selfId);
        const myX = net.predictedSelf?.x ?? self?.x ?? 0;
        const myZ = net.predictedSelf?.y ?? self?.y ?? 0;
        for (const p of latestSnapForSocial.players) {
          if (p.id === selfId) continue;
          const d = Math.hypot(p.x - myX, p.y - myZ);
          if (d < COMPLIMENT_RANGE && d < nearestDist) {
            nearestDist = d;
            nearestId = p.id;
            nearestName = p.username || 'player';
          }
          if (d < CROWD_RADIUS) crowdCount += 1;
        }
      }
      nearestOtherId = nearestId;
      nearestOtherDist = nearestDist;

      // Crowd bonus: tick while ≥2 OTHER players are within range.
      // Award + reset on threshold hit.
      if (crowdCount >= 2) {
        crowdTimer += dt;
        if (crowdTimer >= CROWD_BONUS_THRESHOLD) {
          awardCoins(CROWD_BONUS_AMOUNT);
          crowdTimer = 0;
        }
      } else {
        // Decay slowly when out of crowd so brief disconnections don't
        // wipe progress, but it doesn't accrue while alone.
        crowdTimer = Math.max(0, crowdTimer - dt * 0.5);
      }
      // ── Portal-gate proximity scan + redirect on G
      // Scan all stadium portals each frame; pick the closest one within
      // PORTAL_INTERACT_RADIUS of the player. If G was just pressed and a
      // portal is nearby, navigate to that game.
      let nearbyPortalId: string | null = null;
      let nearbyPortalLabel = '';
      let nearbyPortalUrl = '';
      let nearbyPortalGameId = 0;
      let nearbyPortalDist = Infinity;
      const myX = net.predictedSelf?.x ?? 0;
      const myZ = net.predictedSelf?.y ?? 0;
      for (const portal of STADIUM_PORTAL_GATES) {
        const d = Math.hypot(portal.x - myX, portal.z - myZ);
        if (d < PORTAL_INTERACT_RADIUS && d < nearbyPortalDist) {
          nearbyPortalDist = d;
          nearbyPortalId = portal.id;
          nearbyPortalLabel = portal.label;
          nearbyPortalUrl = portal.url;
          nearbyPortalGameId = portal.gameId;
        }
      }
      const gHeld = !!input?.keys.has('g') || !!input?.keys.has('G');
      // Edge-detected G-press near a portal jumps to that game. Inside the
      // host App we deep-link via the native bridge (openGameDetail) — this
      // does NOT unload our WebView, so the player can return and jump again;
      // hence no permanent latch on that path. On desktop/browser there's no
      // bridge, so we fall back to a real navigation, which DOES leave the
      // page → latch with portalRedirectFired to guard against a double-tap.
      // A reserved/"Coming Soon" gate carries gameId 0 + empty url → no jump.
      const portalLinked = nearbyPortalGameId > 0 || !!nearbyPortalUrl;
      if (gHeld && !gHeldLastFrame && nearbyPortalId && portalLinked && !portalRedirectFired) {
        if (hasNativeBridge() && nearbyPortalGameId > 0) {
          openGameDetail(nearbyPortalGameId);
        } else if (nearbyPortalUrl) {
          portalRedirectFired = true;
          try { window.location.href = nearbyPortalUrl; } catch { /* ignore */ }
        }
      }
      gHeldLastFrame = gHeld;

      // Signpost proximity — surfaces a HUD controls cheat-sheet when
      // the player walks up to the map signpost. No key required;
      // pure "info on approach" interaction.
      const distToSignpost = Math.hypot(SIGNPOST_X - myX, SIGNPOST_Z - myZ);
      const newNearSignpost = distToSignpost < SIGNPOST_INTERACT_RADIUS;

      // Only push to the store when one of the HUD-visible fields
      // actually changes — this runs 60Hz inside the render loop so a
      // naive setGameSnapshot would trigger React re-renders every frame.
      // crowdTimer is animated continuously but the HUD only shows
      // whole-second resolution, so we diff on floor(timer).
      const curSnap = getGameSnapshot();
      const timerSec = Math.floor(crowdTimer);
      const shownDist = Number.isFinite(nearestDist) ? Math.round(nearestDist * 10) / 10 : Infinity;
      const distChanged = shownDist !== (Number.isFinite(curSnap.nearestOtherDist) ? Math.round(curSnap.nearestOtherDist * 10) / 10 : Infinity);
      const changed = curSnap.nearestOtherId !== nearestId
        || curSnap.nearestOtherName !== nearestName
        || distChanged
        || curSnap.crowdCount !== crowdCount
        || Math.floor(curSnap.crowdTimer) !== timerSec
        || curSnap.nearbyPortalId !== nearbyPortalId
        || curSnap.nearbyPortalLabel !== nearbyPortalLabel
        || curSnap.nearbyPortalUrl !== nearbyPortalUrl
        || curSnap.nearbyPortalGameId !== nearbyPortalGameId
        || curSnap.nearbySignpost !== newNearSignpost;
      if (changed) {
        setGameSnapshot({
          nearestOtherId: nearestId,
          nearestOtherName: nearestName,
          nearestOtherDist: nearestDist,
          crowdTimer,
          crowdCount,
          nearbyPortalId,
          nearbyPortalLabel,
          nearbyPortalUrl,
          nearbyPortalGameId,
          nearbySignpost: newNearSignpost,
        });
      }
    }

    // ── Once meta is available, expose selfId + roomCode to store (one-time)
    if (net?.meta && !getStoreFlag('selfId-set')) {
      setSelfId(net.meta.selfId);
      setRoomCode(net.roomCode);
      markStoreFlag('selfId-set');
    }

    // ── Drive every avatar from the latest snapshot.
    //    Self uses net.predictedSelf if it's been initialised (smoother
    //    immediate-response feel); falls back to its snapshot row when not
    //    yet available so the local avatar still spawns right after join.
    //    Other avatars use the latest snapshot row directly.
    if (net?.meta) {
      const selfSid = net.meta.selfId;
      const latestSnap = net.snapshots[net.snapshots.length - 1];
      const seen = new Set<string>();

      // Use interpolated positions where possible (smoother for ≥2 snapshots);
      // fall back to the latest snapshot row otherwise.
      const interpolated = getInterpolatedPlayers(net);
      const interpById = new Map<string, { x: number; y: number; aim: number }>();
      for (const p of interpolated) interpById.set(p.id, { x: p.x, y: p.y, aim: p.aim });

      if (latestSnap) {
        for (const p of latestSnap.players) {
          seen.add(p.id);
          const isSelf = p.id === selfSid;
          const a = ensureAvatar(p.id, isSelf);

          let px = p.x;
          let py = p.y;
          let pa = p.aim;
          if (isSelf && net.predictedSelf) {
            px = net.predictedSelf.x;
            py = net.predictedSelf.y;
            pa = net.predictedSelf.aim;
          } else if (!isSelf) {
            const interp = interpById.get(p.id);
            if (interp) { px = interp.x; py = interp.y; pa = interp.aim; }
          }
          // Walkable-floor elevation ("levels"): raised platforms (plaza
          // plinth, monument plot, podium tiers, amphitheater stage) lift
          // the avatar. Smoothed so stepping onto a rim reads as a quick
          // climb, not a pop; same shared data for self + remotes so all
          // clients agree.
          const gTarget = groundHeightAt(px, py);
          const gPrev = groundYBySid.get(p.id);
          const gy = gPrev === undefined
            ? gTarget
            : gPrev + (gTarget - gPrev) * (1 - Math.exp(-dt / 0.08));
          groundYBySid.set(p.id, gy);
          a.setPosition(px, gy, py);
          a.setRotationY(pa);
          // Walking animation tick — uses Δpos between setPosition calls to
          // detect motion, so this MUST run after setPosition every frame
          // (otherwise smoothedSpeed never updates and the rig never animates).
          a.update({ deltaSeconds: dt, config: runtimeContext?.configRef.current });

          // Outfit diff (cheap key compare) — ONLY for remote players. The
          // local store owns self's outfit (see syncLocalOutfit + the spawn
          // hook in ensureAvatar). Without this guard, the snapshot still
          // carrying the OLD outfit between click and server echo would
          // immediately revert the just-applied local change → flicker.
          if (!isSelf) {
            applyOutfitIfChanged(p.id, p.textureItems, p.accessoryItems);
          }

          // Camera + stall proximity follow the local player.
          if (isSelf) {
            // Hybrid camera follow:
            //   • When the player is ACTIVELY moving (WASD / joystick),
            //     snap the camera target to the player position. Zero
            //     follow delay — the world doesn't drift behind the
            //     avatar as they walk further from spawn.
            //   • When IDLE, exp-lerp toward the player so sub-pixel
            //     prediction noise doesn't propagate to camera shake.
            // The earlier pure-lerp version had a ~0.5 unit steady-state
            // trailing offset that read as "delay the further they
            // travel" — gone now since the snap branch is active whenever
            // the player is intentionally moving.
            const cam = objects.world.camera;
            const dirInput = runtimeContext?.input?.dir;
            const isMovingInput = !!dirInput && (Math.abs(dirInput.x) + Math.abs(dirInput.y)) > 0.05;
            // Look-up boost: raise the camera target as the user tilts
            // the camera past horizontal (beta > π/2). Since
            // ArcRotateCamera always looks AT the target, lifting the
            // target lifts the view direction — letting the user
            // actually see the sky, the gate top, and tall objects
            // above the avatar without hitting the ground-clamp limit.
            // Capped so it can't run away into orbit.
            // Ride the smoothed ground Y so standing on a raised platform
            // lifts the camera with the avatar instead of aiming at its feet.
            const baseTargetY = 1.2 + gy;
            const lookUpBoost = Math.min(8, Math.max(0, cam.beta - Math.PI / 2) * 8);
            const targetY = baseTargetY + lookUpBoost;
            if (isMovingInput) {
              cam.target.set(px, targetY, py);
            } else {
              const camAlpha = 1 - Math.exp(-dt / 0.05);
              cam.target.x += (px - cam.target.x) * camAlpha;
              cam.target.y += (targetY - cam.target.y) * camAlpha;
              cam.target.z += (py - cam.target.z) * camAlpha;
            }
            const nearest = objects.entities.findNearestStall(px, py);
            setNearbyStall(nearest ? nearest.id : null);
          }
        }
      }

      // Despawn avatars that aren't in the latest snapshot anymore.
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
      unsubRotation();
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
