// ──────────────────────────────────────────────
// App.tsx — thin React shell for the dress-up studio.
// Only platform hooks (useScreen / useInput / useGameConfig), the canvas
// mount, the DOM HUD, and the startGame() call. The Babylon Engine / Scene /
// render loop are owned by src/babylon/game.ts.
//
// No MobileControlHud: the dress-up studio has no character locomotion or
// action button (the wardrobe panel is the only interaction surface, and
// canvas-drag rotates the ArcRotateCamera around the static character).
// ──────────────────────────────────────────────

import { useEffect, useRef, type MutableRefObject } from 'react';
import { useGameConfig, useInput, useScreen, type Input, type Phase, type Screen } from '@rezona/core/3d';
import { SCHEMA, type Config } from './game/schema';
import { startGame, type GameRuntimeHandle } from './babylon/game';
import { Hud } from './babylon/hud';

export interface GameRuntimeContext {
  input: Input;
  screenRef: MutableRefObject<Screen>;
  configRef: MutableRefObject<Config>;
  phaseRef: MutableRefObject<Phase>;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { screenRef, containerRef } = useScreen();
  const input = useInput();
  const { configRef } = useGameConfig(SCHEMA);
  const phaseRef = useRef<Phase>('ACTIVE');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const runtimeContext: GameRuntimeContext = {
      input,
      screenRef,
      configRef,
      phaseRef,
    };
    const runtime = startGame(canvas, runtimeContext);

    return () => {
      const maybeHandle = runtime as GameRuntimeHandle | Promise<GameRuntimeHandle>;
      if (typeof (maybeHandle as Promise<GameRuntimeHandle>).then === 'function') {
        void (maybeHandle as Promise<GameRuntimeHandle>).then((handle) => handle.dispose());
      } else {
        (maybeHandle as GameRuntimeHandle).dispose();
      }
    };
  }, [configRef, input, screenRef]);

  return (
    <div ref={containerRef} {...input.handlers} className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Dressing Room viewport" />
      <Hud phaseRef={phaseRef} />
    </div>
  );
}
