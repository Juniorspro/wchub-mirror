// ──────────────────────────────────────────────
// App.tsx — thin React shell for the Dressup Lounge (multiplayer).
// Owns the NetClient lifecycle + connection to the server, then passes both
// the runtime context AND the live NetClient into startGame(). The Babylon
// runtime in src/babylon/game.ts drives meshes from snapshots (predicted self
// + interpolated others) instead of running gameplay locally.
// ──────────────────────────────────────────────

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useGameConfig, useInput, useScreen, type Input, type Phase, type Screen } from '@rezona/core/3d';
import { SCHEMA, type Config } from './game/schema';
import { startGame, type GameRuntimeHandle } from './babylon/game';
import { Hud } from './babylon/hud';
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

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { screenRef, containerRef } = useScreen();
  const input = useInput();
  const { configRef } = useGameConfig(SCHEMA);
  const phaseRef = useRef<Phase>('ACTIVE');
  const netRef = useRef<NetClient | null>(null);
  // Used to render: we need to pass the live NetClient into <Hud> so chat
  // can call net.send('chat', ...). It's the same instance attached in
  // useEffect below — we just need to surface it for the JSX render.
  const [netState, setNetState] = useState<NetClient | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // `disposed` guards against React StrictMode's double-mount race: the
    // first effect's cleanup runs WHILE the first net.connect() is still
    // awaiting joinOrCreate. At that moment net.room is null so disconnect
    // is a no-op; the await later resolves and silently leaks an extra
    // sessionId in the room — which the surviving second runtime then
    // renders as a duplicate avatar. The .then() below cancels that orphan
    // by calling disconnect once the flag is set.
    let disposed = false;

    const net = new NetClient({
      onStatus: (s) => console.log('[net]', s),
      onHello: (meta) => console.log('[net] hello', meta.selfId),
    });
    netRef.current = net;
    setNetState(net);
    void net.connect(readRoomCode()).then(() => {
      if (disposed) net.disconnect();
    });

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
  }, [configRef, input, screenRef]);

  return (
    <div ref={containerRef} className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Dressup Lounge viewport" />
      {/* Mobile virtual-joystick zone — input.handlers (touch/pointer) used
          to cover the entire container, which swallowed mouse-drag on the
          canvas and prevented ArcRotateCamera from orbiting. Confining the
          handlers to a bottom-left square lets the rest of the canvas
          receive pointer-drag events for free camera look-around, while
          mobile players still get a touch joystick in the corner.
          On desktop the keyboard listener (auto-attached by useInput at
          document level) is unaffected — WASD continues to work. */}
      <div
        {...input.handlers}
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: 'min(240px, 38vw)',
          height: 'min(240px, 38vw)',
          touchAction: 'none',
          pointerEvents: 'auto',
          // Invisible — purely an input target.
          background: 'transparent',
        }}
      />
      <Hud phaseRef={phaseRef} net={netState ?? undefined} />
    </div>
  );
}
