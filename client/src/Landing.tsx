// ──────────────────────────────────────────────
// Landing.tsx — pre-game title screen. The game does NOT boot until the
// player presses "Enter the Fair": the click is a real user gesture (so
// the audio context unlocks legally), proves the tab is foregrounded (so
// the render loop — where avatars spawn — is actually ticking), and gives
// App.tsx one clean moment to hydrate persisted state before connecting.
//
// Rendered INSIDE .game-shell so the landscape-in-portrait rotation
// (html.game-rotated, see index.css) applies to it for free.
// ──────────────────────────────────────────────

import { useState, type CSSProperties } from 'react';
import { ensureAudioReady } from '@rezona/core/3d';

const wrap: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  textAlign: 'center',
  padding: 24,
  overflow: 'hidden',
  // Sky → turf, echoing the in-game palette.
  background: 'linear-gradient(180deg, #6ec1f5 0%, #9fdcf9 45%, #7ecb6f 72%, #5cb85c 100%)',
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  color: '#fff',
};

const titleStyle: CSSProperties = {
  fontSize: 'clamp(34px, 8vw, 64px)',
  fontWeight: 900,
  letterSpacing: 1,
  textShadow: '0 3px 0 rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.25)',
  lineHeight: 1.05,
};

const subtitleStyle: CSSProperties = {
  fontSize: 'clamp(14px, 2.6vw, 18px)',
  fontWeight: 600,
  maxWidth: 460,
  textShadow: '0 1px 2px rgba(0,0,0,0.25)',
  opacity: 0.95,
};

const buttonStyle: CSSProperties = {
  marginTop: 6,
  padding: '16px 42px',
  fontSize: 'clamp(18px, 3.4vw, 24px)',
  fontWeight: 800,
  color: '#fff',
  background: 'linear-gradient(180deg, #ffb344 0%, #f5862d 100%)',
  border: '3px solid rgba(255,255,255,0.85)',
  borderRadius: 999,
  cursor: 'pointer',
  boxShadow: '0 6px 0 rgba(160,80,10,0.45), 0 10px 28px rgba(0,0,0,0.25)',
  textShadow: '0 1px 2px rgba(0,0,0,0.25)',
  animation: 'landing-bob 2.2s ease-in-out infinite',
};

const hintStyle: CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  opacity: 0.85,
  textShadow: '0 1px 2px rgba(0,0,0,0.25)',
};

// Decorative floaters — positioned around the title, drifting gently.
const FLOATERS: Array<{ emoji: string; top: string; left: string; size: number; delay: number }> = [
  { emoji: '⚽', top: '12%', left: '12%', size: 42, delay: 0 },
  { emoji: '🎪', top: '18%', left: '82%', size: 46, delay: 0.6 },
  { emoji: '🏆', top: '72%', left: '14%', size: 38, delay: 1.1 },
  { emoji: '🎉', top: '70%', left: '84%', size: 40, delay: 0.3 },
  { emoji: '👕', top: '40%', left: '6%', size: 34, delay: 0.9 },
  { emoji: '🥅', top: '38%', left: '90%', size: 36, delay: 1.4 },
];

export function Landing({ onEnter }: { onEnter: () => void }) {
  const handleEnter = () => {
    // Unlock the shared audio context inside the gesture. Must never
    // block entering — the fair works fine muted.
    try { ensureAudioReady(); } catch { /* ignore */ }
    onEnter();
  };

  return (
    <div style={wrap}>
      {FLOATERS.map((f) => (
        <span
          key={f.emoji}
          style={{
            position: 'absolute',
            top: f.top,
            left: f.left,
            fontSize: f.size,
            animation: `landing-bob 3s ease-in-out ${f.delay}s infinite`,
            pointerEvents: 'none',
          }}
          aria-hidden
        >
          {f.emoji}
        </span>
      ))}
      <div style={titleStyle}>⚽ Stadium Fair</div>
      <div style={subtitleStyle}>
        A multiplayer football fairground — dress up your avatar, kick the ball
        around, and step through the stadium gates into minigames.
      </div>
      <button type="button" className="btn-press" style={buttonStyle} onClick={handleEnter}>
        Enter the Fair
      </button>
      <div style={hintStyle}>
        Entering loads the stadium, connects you to the lounge, and turns on sound.
        <br />
        Move with WASD / joystick · G to use a glowing gate
      </div>
    </div>
  );
}

// Brief veil shown right AFTER entering, while the Babylon world builds its
// first frames — masks the empty-canvas flash, then fades itself out and
// unmounts. Pointer-events none throughout so it can never trap input.
export function EnteringVeil() {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #6ec1f5 0%, #9fdcf9 45%, #7ecb6f 72%, #5cb85c 100%)',
        color: '#fff',
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 'clamp(18px, 3.6vw, 26px)',
        fontWeight: 800,
        textShadow: '0 2px 6px rgba(0,0,0,0.3)',
        pointerEvents: 'none',
        animation: 'landing-veil-out 1.6s ease-in forwards',
      }}
      onAnimationEnd={() => setGone(true)}
    >
      Entering the fair…
    </div>
  );
}
