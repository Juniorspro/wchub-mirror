// ──────────────────────────────────────────────
// App.tsx — thin React shell for the Dressup Lounge (multiplayer).
// Owns the NetClient lifecycle + connection to the server, then passes both
// the runtime context AND the live NetClient into startGame(). The Babylon
// runtime in src/babylon/game.ts drives meshes from snapshots (predicted self
// + interpolated others) instead of running gameplay locally.
//
// The whole boot is gated behind the <Landing> "Enter the Fair" screen:
// nothing connects or renders until the player clicks. The click is a real
// user gesture (unlocks audio), guarantees the tab is foregrounded (rAF
// ticking, so the avatar spawn loop actually runs), and gives us one clean
// moment to hydrate persisted state BEFORE the join opts are built.
// ──────────────────────────────────────────────

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useGameConfig, useInput, useScreen, type Input, type Phase, type Screen } from '@rezona/core/3d';
import { SCHEMA, type Config } from './game/schema';
import { startGame, type GameRuntimeHandle } from './babylon/game';
import { Hud } from './babylon/hud';
import { CameraDragZone, VirtualJoystick } from './babylon/touch';
import { Landing, EnteringVeil } from './Landing';
import {
  getGameSnapshot,
  hydrateEconomyFromStorage,
  hydrateOutfitFromStorage,
  hydratePresetsFromStorage,
  resetGameStore,
} from './babylon/store';
import { NetClient } from './net';

export interface GameRuntimeContext {
  input: Input;
  screenRef: MutableRefObject<Screen>;
  configRef: MutableRefObject<Config>;
  phaseRef: MutableRefObject<Phase>;
  net: NetClient;
}

// Pull a room code out of the URL hash (#room=foo) so two browser tabs can
// land in the same lounge by visiting the same URL. Falls back to a default
// lounge if none provided.
function readRoomCode(): string {
  const hash = window.location.hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);
  return params.get('room') || 'lounge';
}

// Reconnect backoff: 2s, 4s, 8s, then 15s forever. Fast enough that a
// Container cold start (the main real-world cause of the 25s connect
// timeout) gets retried promptly; slow enough not to hammer a dead server.
function retryDelayMs(attempt: number): number {
  return Math.min(15_000, 2_000 * 2 ** Math.min(attempt, 3));
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { screenRef, containerRef } = useScreen();
  const input = useInput();
  const { configRef } = useGameConfig(SCHEMA);
  const phaseRef = useRef<Phase>('ACTIVE');
  const netRef = useRef<NetClient | null>(null);
  // Boot gate — flipped once by the Landing screen's Enter button.
  const [entered, setEntered] = useState(false);
  // Used to render: we need to pass the live NetClient into <Hud> so chat
  // can call net.send('chat', ...). It's the same instance attached in
  // useEffect below — we just need to surface it for the JSX render.
  const [netState, setNetState] = useState<NetClient | null>(null);

  useEffect(() => {
    if (!entered) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // `disposed` guards against React StrictMode's double-mount race: the
    // first effect's cleanup runs WHILE the first net.connect() is still
    // awaiting joinOrCreate. At that moment net.room is null so disconnect
    // is a no-op; the await later resolves and silently leaks an extra
    // sessionId in the room — which the surviving second runtime then
    // renders as a duplicate avatar. connectLoop() cancels that orphan by
    // calling disconnect once the flag is set.
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    // Hydrate persisted state BEFORE connecting: the join opts carry the
    // restored outfit so a returning player walks in already dressed
    // (server addPlayer accepts textureItems/accessoryItems), and
    // startGame() below must not see a half-hydrated store.
    resetGameStore();
    hydratePresetsFromStorage();
    hydrateEconomyFromStorage();
    hydrateOutfitFromStorage();

    // Connect with retry. NetClient.connect never throws (it settles to
    // status 'error' / 'connected'), and its 25s internal timeout exists
    // precisely so this layer can retry — without this loop a single
    // failed join meant net.meta stayed null forever and the avatar
    // never spawned until a manual page reload.
    let connecting = false;
    const currentOutfit = () => {
      const o = getGameSnapshot().outfit;
      return {
        textureItems: o.textureItemIds.join(','),
        accessoryItems: o.accessoryItemIds.join(','),
      };
    };
    const connectLoop = async (net: NetClient) => {
      if (connecting) return;
      connecting = true;
      for (let attempt = 0; !disposed; attempt++) {
        // Outfit re-read per attempt: a reconnect after the player changed
        // clothes should rejoin wearing the CURRENT outfit.
        await net.connect(readRoomCode(), undefined, undefined, currentOutfit());
        if (disposed) {
          net.disconnect();
          break;
        }
        if (net.isOpen()) break;
        await new Promise((resolve) => {
          retryTimer = setTimeout(resolve, retryDelayMs(attempt));
        });
      }
      connecting = false;
    };

    const net: NetClient = new NetClient({
      onStatus: (s) => {
        console.log('[net]', s);
        // Auto-rejoin on mid-session drops (server restart, network blip).
        // 'error' during the initial loop is already handled by the loop
        // itself — the `connecting` flag makes this re-entry a no-op then.
        if ((s === 'disconnected' || s === 'error') && !disposed) {
          void connectLoop(net);
        }
      },
      onHello: (meta) => console.log('[net] hello', meta.selfId),
    });
    netRef.current = net;
    setNetState(net);
    void connectLoop(net);

    const runtimeContext: GameRuntimeContext = {
      input,
      screenRef,
      configRef,
      phaseRef,
      net,
    };
    const runtime = startGame(canvas, runtimeContext);

    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      net.disconnect();
      netRef.current = null;
      setNetState(null);
      const maybeHandle = runtime as GameRuntimeHandle | Promise<GameRuntimeHandle>;
      if (typeof (maybeHandle as Promise<GameRuntimeHandle>).then === 'function') {
        void (maybeHandle as Promise<GameRuntimeHandle>).then((handle) => handle.dispose());
      } else {
        (maybeHandle as GameRuntimeHandle).dispose();
      }
    };
  }, [configRef, input, screenRef, entered]);

  return (
    <div ref={containerRef} className="game-shell">
      {entered ? (
        <>
          <canvas ref={canvasRef} className="game-canvas" aria-label="Dressup Lounge viewport" />
          {/* Touch layers (DOM order = stacking order, no z-index anywhere):
              CameraDragZone first so ANY surface no later element claims orbits
              the camera (rotated-portrait mode only — Babylon's own pointer
              input misreads axes under the CSS rotation, see touch.tsx), then
              the visible joystick, then the HUD so its buttons stay tappable.
              The old invisible {...input.handlers} corner zone is gone: those
              handlers never produced movement (nothing called setMobileMove) —
              the joystick drives input.setMobileMove directly, which is the
              same path WASD takes. Desktop keyboard (useInput's document-level
              listener) is unaffected. */}
          <CameraDragZone />
          <VirtualJoystick input={input} />
          <Hud phaseRef={phaseRef} net={netState ?? undefined} />
          <EnteringVeil />
        </>
      ) : (
        <Landing onEnter={() => setEntered(true)} />
      )}
    </div>
  );
}
