// ══════════════════════════════════════════════
// touch.tsx — landscape-phone touch controls.
//
// The game plays HORIZONTALLY on phones. When the webview is portrait-locked
// (the host App), index.css rotates .game-shell 90° clockwise — layout stays
// landscape but raw pointer clientX/Y deltas arrive in PORTRAIT screen axes.
// Everything here is rotation-aware: screen deltas are remapped into the
// shell's local (game) axes via toLocalDelta().
//
//   • VirtualJoystick — visible left-thumb stick. Writes input.setMobileMove
//     (x, y in [-1,1], y-down, up = -1) so movement flows through the SAME
//     camera-relative → sendInput → prediction path as WASD.
//   • CameraDragZone — rendered ONLY in rotated-portrait mode, where
//     Babylon's own pointer input misreads axes (it uses screen deltas).
//     game.ts detaches the Babylon pointer input in that mode and instead
//     consumes cameraDragBus, which this zone fills with remapped one-finger
//     orbit deltas + two-finger pinch distance.
//
// Iron rules respected: pointer capture on the touched element, hard reset
// of the move vector on pointerup/pointercancel/blur/visibilitychange (a
// stuck vector = avatar walks forever), stopPropagation so the canvas /
// Babylon never see joystick touches, and ensureAudioReady() on first touch
// (replaces the old input.consumeTap() unlock path on phones).
// ══════════════════════════════════════════════

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { ensureAudioReady, type Input } from '@rezona/core/3d';

// ─── Camera drag bus ─────────────────────────────────────────────────────────
// Accumulated PHYSICAL-axis deltas (what the player's finger did on the
// rotated screen, expressed in game-local axes). game.ts drains + zeroes
// this every render frame and applies it to the ArcRotateCamera's inertial
// offsets, inheriting Babylon's own damping and alpha/beta/radius limits.
export const cameraDragBus = { dx: 0, dy: 0, pinch: 0 };

// ─── Rotation mode store (single source of truth) ────────────────────────────
// This game is PHONE-ONLY and plays HORIZONTALLY. Whenever the viewport is
// portrait (the host App webview is portrait-locked), the entire game is
// force-rotated 90° clockwise; an already-landscape viewport needs nothing.
//
// The decision is published as a `game-rotated` class on <html> (index.css
// keys the shell rotation off it — NOT off a raw media query) plus this JS
// store, so CSS and JS can never disagree. Re-evaluation is suppressed while
// a text input is focused: Android webviews in adjustResize mode shrink the
// layout viewport under the soft keyboard, which can flip (orientation:
// portrait) to landscape mid-typing and would otherwise snap the whole game
// 90° while the player types chat. Deferred to focusout instead.

const PORTRAIT_QUERY = '(orientation: portrait)';
const ROTATED_CLASS = 'game-rotated';

function shouldRotate(): boolean {
  // QA override: ?rotate=1 forces rotated mode in a landscape window,
  // ?rotate=0 forces it off in a portrait one.
  const force = new URLSearchParams(window.location.search).get('rotate');
  if (force === '1') return true;
  if (force === '0') return false;
  return window.matchMedia(PORTRAIT_QUERY).matches;
}

let rotatedState = typeof window !== 'undefined' ? shouldRotate() : false;
const rotatedListeners = new Set<(rotated: boolean) => void>();
let rotationWired = false;

function ensureRotationWired(): void {
  if (rotationWired || typeof window === 'undefined') return;
  rotationWired = true;
  document.documentElement.classList.toggle(ROTATED_CLASS, rotatedState);
  const reevaluate = () => {
    // Soft-keyboard hysteresis: never flip orientation while typing.
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    const next = shouldRotate();
    if (next === rotatedState) return;
    rotatedState = next;
    document.documentElement.classList.toggle(ROTATED_CLASS, next);
    for (const listener of rotatedListeners) listener(next);
  };
  // resize fallback: some webviews (and emulated viewports) resize without
  // dispatching media-query change events.
  window.addEventListener('resize', reevaluate);
  window.matchMedia(PORTRAIT_QUERY).addEventListener('change', reevaluate);
  // Re-check once typing ends (the suppressed flip, if any, applies here).
  document.addEventListener('focusout', () => { setTimeout(reevaluate, 50); });
}

export function isPortraitRotated(): boolean {
  ensureRotationWired();
  return rotatedState;
}

export function subscribeRotated(listener: (rotated: boolean) => void): () => void {
  ensureRotationWired();
  rotatedListeners.add(listener);
  return () => { rotatedListeners.delete(listener); };
}

function usePortraitRotated(): boolean {
  const [rotated, setRotated] = useState(isPortraitRotated);
  useEffect(() => subscribeRotated(setRotated), []);
  return rotated;
}

// Map a screen-space (clientX/Y) delta into the shell's LOCAL axes.
// Unrotated: identity. Rotated 90°CW (screen = [H−ly, lx]): the inverse is
// local_x = +screen_y, local_y = −screen_x.
function toLocalDelta(dx: number, dy: number, rotated: boolean): { x: number; y: number } {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

function unlockAudio(): void {
  try { ensureAudioReady(); } catch { /* audio must never block input */ }
}

// ─── Virtual joystick ────────────────────────────────────────────────────────

const JOY_BASE = 116;      // base circle diameter (px)
const JOY_KNOB = 48;       // knob diameter (px)
const JOY_TRAVEL = (JOY_BASE - JOY_KNOB) / 2; // knob travel radius = full deflection

export function VirtualJoystick({ input }: { input: Input }) {
  const rotated = usePortraitRotated();
  const rotatedRef = useRef(rotated);
  rotatedRef.current = rotated;
  const knobRef = useRef<HTMLDivElement | null>(null);
  const activePointer = useRef<number | null>(null);
  const center = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const reset = () => {
    activePointer.current = null;
    input.setMobileMove(0, 0);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)';
  };

  // A stuck vector means the avatar walks forever — reset on every way the
  // pointer stream can silently die, and on unmount.
  useEffect(() => {
    const onHide = () => reset();
    window.addEventListener('blur', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', onHide);
      document.removeEventListener('visibilitychange', onHide);
      reset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = toLocalDelta(e.clientX - center.current.x, e.clientY - center.current.y, rotatedRef.current);
    const mag = Math.hypot(d.x, d.y);
    const scale = mag > JOY_TRAVEL ? JOY_TRAVEL / mag : 1;
    const lx = d.x * scale;
    const ly = d.y * scale;
    // y-down convention matches W=(0,-1): pushing up gives ly < 0.
    input.setMobileMove(lx / JOY_TRAVEL, ly / JOY_TRAVEL);
    if (knobRef.current) knobRef.current.style.transform = `translate(${lx}px, ${ly}px)`;
  };

  return (
    <div
      style={joystickBaseStyle}
      aria-label="Movement joystick"
      onPointerDown={(e) => {
        if (activePointer.current !== null) return;
        e.stopPropagation();
        e.preventDefault();
        unlockAudio();
        activePointer.current = e.pointerId;
        // The base's screen-space center is correct in both modes —
        // getBoundingClientRect returns the transformed box.
        const r = e.currentTarget.getBoundingClientRect();
        center.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        // Untrusted/synthetic pointers (tests) have no capturable id — the
        // joystick still works without capture as long as moves bubble here.
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        apply(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerId !== activePointer.current) return;
        e.stopPropagation();
        apply(e);
      }}
      onPointerUp={(e) => { if (e.pointerId === activePointer.current) { e.stopPropagation(); reset(); } }}
      onPointerCancel={(e) => { if (e.pointerId === activePointer.current) reset(); }}
    >
      <div ref={knobRef} style={joystickKnobStyle} />
    </div>
  );
}

// ─── Camera drag zone (rotated-portrait mode only) ──────────────────────────
// Full-shell transparent layer rendered between the canvas and the joystick/
// HUD (DOM order), so any touch that no interactive element claims becomes a
// camera orbit — same affordance as Babylon's whole-canvas drag on desktop.
// One finger = orbit; two fingers = pinch zoom (screen-space distance is
// rotation-invariant, so pinch needs no remapping).

export function CameraDragZone() {
  const rotated = usePortraitRotated();
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPinchDist = useRef(0);

  useEffect(() => {
    // Mode flips mid-session (e.g. device rotation): drop stale pointers.
    pointers.current.clear();
    lastPinchDist.current = 0;
  }, [rotated]);

  // Same threat model as the joystick: a pointer stream that dies without
  // pointerup/pointercancel (app backgrounded, incoming call) would leave a
  // phantom entry in the Map — every later one-finger drag would then take
  // the pinch branch against the phantom point and orbit would be lost.
  useEffect(() => {
    const onHide = () => {
      pointers.current.clear();
      lastPinchDist.current = 0;
    };
    window.addEventListener('blur', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', onHide);
      document.removeEventListener('visibilitychange', onHide);
      onHide();
    };
  }, []);

  if (!rotated) return null;

  const pinchDist = (): number => {
    const pts = [...pointers.current.values()];
    return pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
  };

  return (
    <div
      style={cameraZoneStyle}
      aria-hidden="true"
      onPointerDown={(e) => {
        unlockAudio();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        lastPinchDist.current = pinchDist();
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const cur = { x: e.clientX, y: e.clientY };
        pointers.current.set(e.pointerId, cur);
        if (pointers.current.size >= 2) {
          const d = pinchDist();
          if (lastPinchDist.current > 0) cameraDragBus.pinch += d - lastPinchDist.current;
          lastPinchDist.current = d;
        } else {
          const local = toLocalDelta(cur.x - prev.x, cur.y - prev.y, true);
          cameraDragBus.dx += local.x;
          cameraDragBus.dy += local.y;
        }
      }}
      onPointerUp={(e) => { pointers.current.delete(e.pointerId); lastPinchDist.current = pinchDist(); }}
      onPointerCancel={(e) => { pointers.current.delete(e.pointerId); lastPinchDist.current = pinchDist(); }}
      onLostPointerCapture={(e) => { pointers.current.delete(e.pointerId); lastPinchDist.current = pinchDist(); }}
    />
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const joystickBaseStyle: CSSProperties = {
  position: 'absolute', left: 18, bottom: 18,
  width: JOY_BASE, height: JOY_BASE, borderRadius: '50%',
  background: 'rgba(20, 24, 36, 0.30)',
  border: '2px solid rgba(255,255,255,0.28)',
  backdropFilter: 'blur(4px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  touchAction: 'none', pointerEvents: 'auto', userSelect: 'none',
};

const joystickKnobStyle: CSSProperties = {
  width: JOY_KNOB, height: JOY_KNOB, borderRadius: '50%',
  background: 'rgba(255,255,255,0.82)',
  border: '1px solid rgba(0,0,0,0.12)',
  boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
  pointerEvents: 'none',
};

const cameraZoneStyle: CSSProperties = {
  position: 'absolute', inset: 0,
  touchAction: 'none', pointerEvents: 'auto',
  background: 'transparent',
};
