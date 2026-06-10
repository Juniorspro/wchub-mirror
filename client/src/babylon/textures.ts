// ══════════════════════════════════════════════
// Procedural pattern textures for the dress-up wardrobe.
//
// SEWING-PATTERN LAYOUT — every garment texture is treated as an unfolded
// pattern of cloth panels. The 512² texture is divided into a 2×2 grid:
//
//   +────────────────────+────────────────────+
//   │                    │                    │
//   │   TOP-LEFT panel   │   TOP-RIGHT panel  │   v ∈ [0.5, 1.0]
//   │                    │                    │
//   +────────────────────+────────────────────+
//   │                    │                    │
//   │  BOTTOM-LEFT panel │  BOTTOM-RIGHT panel│   v ∈ [0.0, 0.5]
//   │                    │                    │
//   +────────────────────+────────────────────+
//      u ∈ [0.0, 0.5]      u ∈ [0.5, 1.0]
//
// PER-PANEL DESIGNS — each garment now passes a GarmentDesign (4 Patterns,
// one per quadrant). Shirts read the quadrants as back / front / sleeve-L /
// sleeve-R; pants read the SAME four slots as front-L / front-R / back-L /
// back-R (the type field names match the shirt mapping; pants builders alias
// them at call time). Thin dark stitching lines at u=0.5 and v=0.5 fall on
// the panel boundaries so when the texture is wrapped onto the avatar's
// half-cylinder panels + sleeve tubes the seams land on real geometry edges.
//
// IMAGE patterns (AI-generated fabric textures) get the same treatment —
// the source image is loaded once into an off-screen <img>, then drawn into
// the panel(s) and re-composited. This way an AI fabric still looks like
// stitched panels rather than a single tube of stretched cloth.
//
// Each design is rasterised once into a 512² DynamicTexture and cached by
// a stable string key (slot + JSON of the design). Disposed via
// disposePatternTextureCache() when the scene tears down.
// ══════════════════════════════════════════════

import { DynamicTexture, Texture, type Scene } from '@babylonjs/core';

export type Pattern =
  | { kind: 'solid'; color: string }
  | { kind: 'hStripes'; colors: string[]; thickness?: number }
  | { kind: 'vStripes'; colors: string[]; thickness?: number }
  | { kind: 'dots'; bg: string; dot: string; size?: number }
  | { kind: 'twoTone'; top: string; bottom: string }
  | { kind: 'hatch'; bg: string; line: string; spacing?: number }
  | { kind: 'checker'; colorA: string; colorB: string; size?: number }
  | { kind: 'image'; url: string; fallbackColor?: string };

// A garment's four-panel design. Field names match the SHIRT mapping; the
// pants builders reuse the same fields with a documented alias:
//   shirts:  back     ↔ back-body
//            front    ↔ front-body
//            sleeveL  ↔ sleeve-L
//            sleeveR  ↔ sleeve-R
//   pants:   back     ↔ front-L leg
//            front    ↔ front-R leg
//            sleeveL  ↔ back-L leg
//            sleeveR  ↔ back-R leg
// The alias for pants is implicit — it depends on which faceUV region each
// half-cylinder picks up in items.ts. See PANTS_UV there.
export interface GarmentDesign {
  kind: 'garment';
  back: Pattern;
  front: Pattern;
  sleeveL: Pattern;
  sleeveR: Pattern;
  /** Optional jersey overlay — crest/number/name + sleeve stripes + hem
   * trim baked into the texture on top of the base patterns. */
  overlay?: JerseyOverlay;
  /** Optional vertical side-stripe color, drawn at the outer-seam UV
   * positions of all four panels. For pants this lands as a single
   * stripe down the outer side of each leg (adidas-style track pants).
   * For shirts it shows up on the body side seam + sleeve seam. */
  sideStripeColor?: string;
  /** Optional freehand pixel-art layer drawn by the player at the
   * Design Bench. Rendered as a chest print on the FRONT and BACK
   * body panels, on top of the base patterns, under the jersey
   * overlay. Compact wire format — see PixelArt. */
  pixelArt?: PixelArt;
}

/** Player-drawn pixel art. `data` is a row-major hex-nibble string of
 * w*h chars; each nibble indexes into `palette` (so palettes are capped
 * at 15 colors), with 'f' meaning transparent / skip. A 24×24 grid is
 * 576 chars — small enough that the whole design still fits the
 * look:<slot>:<b64> wire format the server relays. */
export interface PixelArt {
  palette: string[];
  data: string;
  w: number;
  h: number;
}

// Jersey-specific overlay rendered ON TOP of the base panel patterns.
// Crest sits on the FRONT panel (small shield with an initial inside);
// name + number sit on the BACK panel (text drawn directly on the cloth
// with a soft contrast halo — no enclosing boxes).
//
// Sleeve stripes + hem trim add the recognisable jersey detailing: three
// adidas-style vertical bars on each sleeve panel, and a thin band along
// the bottom of the body panels.
export interface JerseyOverlay {
  crestColor?: string;        // shield fill color (the team's accent)
  crestInitial?: string;      // single letter rendered inside the shield
  sleeveStripeColor?: string; // 3-stripe accent down each sleeve panel
  hemColor?: string;          // thin band along body-panel bottom edges
  numberColor?: string;       // back number text color
  numberText?: string;        // 1-3 digit number
  nameColor?: string;         // back name text color
  nameText?: string;          // 1-16 char player name (uppercased on render)
}

export function uniformDesign(p: Pattern): GarmentDesign {
  return { kind: 'garment', back: p, front: p, sleeveL: p, sleeveR: p };
}

const TEXTURE_SIZE = 1024;
const PANEL_SIZE = TEXTURE_SIZE / 2; // 512 — each of the 4 sewing-pattern quadrants.
// Reference size that pattern pixel-params (thickness, dot size, hatch
// spacing) were authored against. When `size != PATTERN_REFERENCE_SIZE`
// we multiply pixel-space pattern params by `size / PATTERN_REFERENCE_SIZE`
// so the visual scale of stripes/dots stays consistent across the 1024²
// 3D texture and the 160² / 56² HUD preview canvases.
const PATTERN_REFERENCE_SIZE = 512;
// Subtle seam — barely visible, just a hint that panels are stitched.
const SEAM_COLOR = 'rgba(20, 20, 24, 0.18)';
const SEAM_THICKNESS = 1;

const TEXTURE_CACHE = new Map<string, DynamicTexture>();
const IMAGE_HTML_CACHE = new Map<string, Promise<HTMLImageElement>>();

export function patternKey(scope: string, design: GarmentDesign | Pattern): string {
  return `${scope}|${JSON.stringify(design)}`;
}

// Backwards-compat: the actor's body-region paint code paints solid skin
// patterns via diffuseColor and image patterns via this raw texture path —
// no seam compositing on skin (skin isn't an unfolded garment).
const IMAGE_TEXTURE_CACHE = new Map<string, Texture>();
export function getImageTexture(scene: Scene, url: string): Texture {
  const cached = IMAGE_TEXTURE_CACHE.get(url);
  if (cached) return cached;
  const tex = new Texture(url, scene);
  tex.anisotropicFilteringLevel = 8;
  // Self-healing cache: actor.clearGarments() disposes garment meshes
  // with dispose(false, /*disposeMaterialAndTextures*/ true), which can
  // kill this SHARED cached texture in place. Evict the cache entry the
  // moment the texture is disposed so a later re-equip rebuilds it
  // instead of handing back a dead texture (the "avatar got stripped"
  // bug). Babylon fires onDisposeObservable from dispose().
  tex.onDisposeObservable.addOnce(() => {
    if (IMAGE_TEXTURE_CACHE.get(url) === tex) IMAGE_TEXTURE_CACHE.delete(url);
  });
  // If the URL 404s or fails CORS, Babylon silently leaves diffuseTexture
  // in a broken state — surface as black/white on most drivers. Drop the
  // failed texture so a later equip can re-fetch (e.g. after the user
  // refreshes the underlying CDN object), and the material falls back to
  // diffuseColor which the caller has already set to white.
  tex.onLoadObservable.addOnce(() => { /* keep cached on success */ });
  const ie = tex.getInternalTexture();
  if (ie) {
    ie.onErrorObservable.addOnce(() => {
      try { tex.dispose(); } catch { /* ignore */ }
      IMAGE_TEXTURE_CACHE.delete(url);
    });
  }
  IMAGE_TEXTURE_CACHE.set(url, tex);
  return tex;
}

export function getPatternTexture(scene: Scene, key: string, design: GarmentDesign): DynamicTexture {
  const cached = TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const tex = new DynamicTexture(`pattern-${key}`, TEXTURE_SIZE, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  drawSewingPattern(ctx, design, tex);
  tex.anisotropicFilteringLevel = 4;
  // Self-healing cache: actor.clearGarments() disposes garment meshes
  // with dispose(false, /*disposeMaterialAndTextures*/ true), which
  // kills this SHARED cached texture while it's still registered here.
  // A re-equip with the SAME design then got a cache hit on a dead
  // texture → the garment rendered invisible ("the avatar got
  // stripped"). Evict on dispose so the next call rebuilds it.
  tex.onDisposeObservable.addOnce(() => {
    if (TEXTURE_CACHE.get(key) === tex) TEXTURE_CACHE.delete(key);
  });
  TEXTURE_CACHE.set(key, tex);
  return tex;
}

export function disposePatternTextureCache(): void {
  for (const tex of TEXTURE_CACHE.values()) tex.dispose();
  TEXTURE_CACHE.clear();
  for (const tex of IMAGE_TEXTURE_CACHE.values()) tex.dispose();
  IMAGE_TEXTURE_CACHE.clear();
  IMAGE_HTML_CACHE.clear();
}

// ─── Sewing-pattern compositor ──────────────────────────────────────────────

// Quadrant origins (top-left corner in canvas-pixel space) for the four
// panels. v-axis is flipped vs. canvas-y, so the design.back panel (UV
// v=0.5..1.0 = top half) draws at canvas y=0..PANEL_SIZE.
const QUAD = {
  back:    { x: 0,          y: 0,          panel: 'back'    as const },
  front:   { x: PANEL_SIZE, y: 0,          panel: 'front'   as const },
  sleeveL: { x: 0,          y: PANEL_SIZE, panel: 'sleeveL' as const },
  sleeveR: { x: PANEL_SIZE, y: PANEL_SIZE, panel: 'sleeveR' as const },
};

export function drawSewingPattern(ctx: CanvasRenderingContext2D, design: GarmentDesign, tex: DynamicTexture): void {
  // Synchronous pass: solid + procedural panels + seam overlay. Image panels
  // render their fallback fill here; their async <img> draw is kicked off
  // below and calls tex.update() again when the bitmap arrives.
  drawDesignPanelsSync(ctx, design);
  tex.update();

  // Image panels resolve at their own pace; redraw THAT panel + seams when
  // each one lands. Re-apply the overlay each time so it doesn't disappear
  // under a late-arriving image.
  for (const q of [QUAD.back, QUAD.front, QUAD.sleeveL, QUAD.sleeveR]) {
    const pattern = design[q.panel];
    if (pattern.kind !== 'image') continue;
    loadImage(pattern.url).then((img) => {
      ctx.drawImage(img, q.x, q.y, PANEL_SIZE, PANEL_SIZE);
      drawSeams(ctx);
      if (design.overlay) drawJerseyOverlay(ctx, design.overlay, TEXTURE_SIZE);
      tex.update();
    }).catch(() => { /* keep fallback fill */ });
  }
}

// Synchronous-only render — for HUD preview canvases that don't have a
// DynamicTexture. Image panels render as their fallbackColor (the customize
// palette doesn't offer image patterns, so this is mostly fine).
export function drawDesignPanelsSync(ctx: CanvasRenderingContext2D, design: GarmentDesign, size = TEXTURE_SIZE): void {
  // Scale all coordinates by size/TEXTURE_SIZE so a smaller canvas still gets
  // the right layout. Each panel is half the canvas; seams scale with it.
  const half = size / 2;
  // patternScale governs how big pattern primitives (stripe thickness, dot
  // size, hatch spacing) render. They were authored against a 512² canvas;
  // at 1024² they need 2× scaling to keep visual parity, at 160² ~0.31× so
  // the HUD thumbnail reads proportionally to the 3D texture.
  const patternScale = size / PATTERN_REFERENCE_SIZE;
  const seamPx = Math.max(2, Math.round(SEAM_THICKNESS * (size / TEXTURE_SIZE)));
  const panelOrigins: Array<[Pattern, number, number]> = [
    [design.back,    0,    0   ],
    [design.front,   half, 0   ],
    [design.sleeveL, 0,    half],
    [design.sleeveR, half, half],
  ];
  for (const [pattern, x, y] of panelOrigins) {
    if (pattern.kind === 'image') {
      ctx.fillStyle = pattern.fallbackColor ?? '#888';
      ctx.fillRect(x, y, half, half);
    } else {
      drawPanelPattern(ctx, x, y, half, half, pattern, patternScale);
    }
  }
  // Subtle fabric noise underneath the overlay — deterministic so the
  // texture cache stays stable per design key.
  drawFabricNoise(ctx, size);
  // Seams — vertical at u=0.5, horizontal at v=0.5.
  ctx.fillStyle = SEAM_COLOR;
  ctx.fillRect(half - seamPx / 2, 0, seamPx, size);
  ctx.fillRect(0, half - seamPx / 2, size, seamPx);

  // Optional side-stripe: vertical band on the outer-seam U position of
  // each panel. For pants this lands on the outer side of each leg.
  if (design.sideStripeColor) drawSideStripes(ctx, size, design.sideStripeColor);

  // Player-drawn pixel art — chest print on the front + back body
  // panels, above base patterns, below the jersey overlay text.
  if (design.pixelArt) drawPixelArtPanels(ctx, design.pixelArt, size);

  // Jersey overlay last so it sits ON TOP of the panel patterns + seams.
  if (design.overlay) drawJerseyOverlay(ctx, design.overlay, size);
}

// Paint the player's pixel grid into the FRONT (top-right) and BACK
// (top-left) body quadrants, centred with a margin so it reads as a
// printed chest graphic. Nibbles outside the palette range (including
// the explicit 'f' eraser value) are transparent — the base pattern
// shows through.
function drawPixelArtPanels(ctx: CanvasRenderingContext2D, art: PixelArt, size: number): void {
  if (!art.data || art.w <= 0 || art.h <= 0) return;
  const half = size / 2;
  const margin = half * 0.14;
  const area = half - margin * 2;
  const cell = area / Math.max(art.w, art.h);
  for (const [ox, oy] of [[half, 0], [0, 0]] as ReadonlyArray<readonly [number, number]>) {
    for (let py = 0; py < art.h; py++) {
      for (let px = 0; px < art.w; px++) {
        const ch = art.data[py * art.w + px];
        if (ch === undefined || ch === 'f') continue;
        const nib = parseInt(ch, 16);
        if (!Number.isFinite(nib) || nib >= art.palette.length) continue;
        ctx.fillStyle = art.palette[nib];
        // Ceil the cell size so adjacent pixels never leave hairline
        // gaps from fractional rounding.
        ctx.fillRect(ox + margin + px * cell, oy + margin + py * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }
  }
}

// Vertical side stripes on the outer-seam UV positions:
//   - Top row (body / front-leg panels): stripe at u=0.5 (canvas centre).
//     For the front cylinder pair this lands on the outer side of each leg.
//   - Bottom row (sleeve / back-leg panels): stripes at u=0 + u=1 (canvas
//     edges). For the back cylinder pair these land on the outer sides too.
function drawSideStripes(ctx: CanvasRenderingContext2D, size: number, color: string): void {
  const half = size / 2;
  const k = size / TEXTURE_SIZE;
  const w = 10 * k;
  ctx.save();
  ctx.fillStyle = color;
  // Top row, centred at u=0.5.
  ctx.fillRect(half - w / 2, 0, w, half);
  // Bottom row, at u=0 and u=1.
  ctx.fillRect(0, half, w, half);
  ctx.fillRect(size - w, half, w, half);
  // Thin outline so the stripe reads against same-coloured cloth.
  ctx.strokeStyle = 'rgba(20,20,24,0.25)';
  ctx.lineWidth = Math.max(1, 1 * k);
  ctx.strokeRect(half - w / 2 + 0.5, 0.5, w - 1, half - 1);
  ctx.strokeRect(0.5, half + 0.5, w - 1, half - 1);
  ctx.strokeRect(size - w + 0.5, half + 0.5, w - 1, half - 1);
  ctx.restore();
}

// Draws crest + sleeve stripes + hem trim + name + number overlay directly
// onto the composited texture. Coordinates are normalized to `size` so the
// helper works for both the 1024² Babylon texture and the smaller HUD
// preview (160² / 56²).
//
// Layout (matches the panel quadrant origins):
//   front panel (top-right quadrant, u 0.5-1.0 × v 0.5-1.0):
//     - shield-shaped crest with an INITIAL letter inside, near the chest
//   back panel  (top-left quadrant, u 0.0-0.5 × v 0.5-1.0):
//     - player NAME and NUMBER drawn directly on the cloth (no boxes)
//   sleeve quadrants (bottom row):
//     - 3 adidas-style stripes down each sleeve panel
//   bottom edge of body panels (v just above 0.5):
//     - thin hem trim band across both back + front
//
// Back-panel text is drawn HORIZONTALLY MIRRORED so it reads correctly on
// the cylinder (Babylon's MeshBuilder generates side-u with cos(-angle),
// reversing canvas writing direction; mirroring here cancels that out).
function drawJerseyOverlay(ctx: CanvasRenderingContext2D, o: JerseyOverlay, size: number): void {
  const half = size / 2;
  const k = size / TEXTURE_SIZE;

  // ─── HEM TRIM ───────────────────────────────────────────────────────────
  // Thin band along the bottom edge of BOTH body panels (canvas y just
  // above `half` in invertY space — that's the v=0.5 line on the cylinder,
  // which lands at the shirt hem). Width matches the body panel row.
  if (o.hemColor || o.crestColor) {
    const hemColor = o.hemColor ?? shadeColor(o.crestColor ?? '#1a1a1d', -0.25);
    const hemH = 10 * k;
    ctx.fillStyle = hemColor;
    ctx.fillRect(0, half - hemH, size, hemH);
  }

  // ─── SLEEVE STRIPES — bottom row (canvas y ∈ [half, size]) ──────────────
  if (o.sleeveStripeColor) {
    // SleeveL = bottom-left quadrant, SleeveR = bottom-right.
    drawSleeveStripes(ctx, 0,    half, half, half, o.sleeveStripeColor, k, 'l');
    drawSleeveStripes(ctx, half, half, half, half, o.sleeveStripeColor, k, 'r');
  }

  // ─── FRONT panel: shield crest with initial near the wearer's chest ────
  // The front cylinder's UV mapping has the SAME mirroring quirk as the
  // back one — letters drawn left-to-right on the canvas read right-to-
  // left on the avatar, so "N" becomes "И". The shield SHAPE is symmetric
  // so mirroring the whole drawShield call only ends up flipping the
  // letter inside it, which is exactly what we want.
  const FRONT_X0 = half, FRONT_Y0 = 0;
  if (o.crestColor) {
    const cx = FRONT_X0 + 140 * k;
    const cy = FRONT_Y0 + 160 * k;
    ctx.save();
    ctx.translate(cx * 2, 0);
    ctx.scale(-1, 1);
    drawShield(ctx, cx, cy, 50 * k, o.crestColor, o.crestInitial, k);
    ctx.restore();
  }

  // ─── BACK panel: name + number, mirrored, no backgrounds ───────────────
  const BACK_X0 = 0, BACK_Y0 = 0;
  ctx.save();
  ctx.translate(BACK_X0 + half, 0);
  ctx.scale(-1, 1);

  if (o.nameText) {
    drawCentredText(
      ctx, o.nameText.toUpperCase(),
      half / 2,
      BACK_Y0 + 64 * k,
      half - 64 * k,
      44 * k, o.nameColor ?? '#1a1a1d',
      false, true,
    );
  }
  if (o.numberText) {
    drawCentredText(
      ctx, o.numberText,
      half / 2,
      BACK_Y0 + 260 * k,
      half - 48 * k,
      210 * k, o.numberColor ?? '#1a1a1d',
      true, true,
    );
  }
  ctx.restore();
}

// Shield with a letter inside. Bigger than the prior shield-and-dot, and
// the letter sells the "this is a crest" idea without needing real art.
function drawShield(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string, initial: string | undefined, k: number): void {
  ctx.save();
  // Outer shield path — wider at the top, point at the bottom.
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx + r, cy - r);
  ctx.lineTo(cx + r, cy + r * 0.3);
  ctx.quadraticCurveTo(cx + r * 0.85, cy + r * 1.2, cx, cy + r * 1.45);
  ctx.quadraticCurveTo(cx - r * 0.85, cy + r * 1.2, cx - r, cy + r * 0.3);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(20,20,24,0.5)';
  ctx.lineWidth = Math.max(1.5, 2.5 * k);
  ctx.stroke();
  // Divider band across the top third — common crest motif (e.g. football
  // shield with a colored top band over the lower field).
  const bandColor = shadeColor(color, -0.32);
  ctx.fillStyle = bandColor;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx + r, cy - r);
  ctx.lineTo(cx + r, cy - r * 0.35);
  ctx.lineTo(cx - r, cy - r * 0.35);
  ctx.closePath();
  ctx.fill();
  // Initial letter inside the lower field. Contrast against `color`.
  if (initial) {
    const textColor = textOutlineFor(color) === 'rgba(20,20,24,0.55)' ? '#1a1a1d' : '#f5f5f5';
    drawCentredText(
      ctx, initial.toUpperCase().slice(0, 1),
      cx, cy + r * 0.45,
      r * 1.4, r * 1.4,
      textColor, true, false,
    );
  }
  ctx.restore();
}

// Three short vertical bars on the OUTER side of each sleeve panel.
// Both sleeve cylinders share their faceUV mapping, but they sit at
// opposite world-X positions, so the SAME canvas-u maps to OUTER for the
// left arm and INNER for the right arm. We position the stripes
// side-aware so they always wrap onto the outer face of the arm:
//   L sleeve panel: canvas-u 0.25 (panel centre) = cylinder angle π =
//                   world -X = OUTER of left arm.
//   R sleeve panel: canvas-u 0.50 (panel left edge) = cylinder angle 0 =
//                   world +X = OUTER of right arm. Inset slightly from
//                   the edge so the stripes don't straddle the texture
//                   seam at u=0.5.
function drawSleeveStripes(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, _h: number, color: string, k: number, side: 'l' | 'r'): void {
  const stripeW = 14 * k;
  const stripeH = 110 * k;
  const gap = 12 * k;
  const totalW = stripeW * 3 + gap * 2;
  let x: number;
  if (side === 'l') {
    // Centre on the L panel — that's canvas-u 0.25 → angle π → OUTER for L.
    x = ox + w / 2 - totalW / 2;
  } else {
    // Bias toward the LEFT edge of the R panel — canvas-u 0.5 → angle 0
    // → OUTER for R. A small inset keeps the stripes off the seam.
    x = ox + 60 * k;
  }
  const y = oy + 32 * k;
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    ctx.fillRect(x + i * (stripeW + gap), y, stripeW, stripeH);
  }
  // Subtle outline so the stripes don't blend into same-colour fabric.
  ctx.strokeStyle = 'rgba(20,20,24,0.25)';
  ctx.lineWidth = Math.max(1, 1 * k);
  for (let i = 0; i < 3; i++) {
    ctx.strokeRect(x + i * (stripeW + gap) + 0.5, y + 0.5, stripeW - 1, stripeH - 1);
  }
  ctx.restore();
}

// Deterministic fabric-noise wash. Painted underneath the seams + overlay
// so it adds woven-cloth texture without obscuring text or the crest.
// Uses an LCG seeded by `size` so the same texture always renders the same
// noise — the design cache key stays valid.
function drawFabricNoise(ctx: CanvasRenderingContext2D, size: number): void {
  // ~2500 dots over the canvas regardless of size — density scales with
  // canvas size so larger textures aren't sparser.
  const count = Math.round((size * size) / 420);
  // Park-Miller-style LCG. Seed = size so callers with different canvas
  // sizes get different noise (but each is stable across redraws).
  let seed = size * 1103515245 + 12345;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  ctx.save();
  for (let i = 0; i < count; i++) {
    // Random dark or light speck, very low alpha.
    const dark = rng() < 0.5;
    ctx.fillStyle = dark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
    const x = rng() * size;
    const y = rng() * size;
    const w = 1 + rng() * 1.5;
    ctx.fillRect(x, y, w, w);
  }
  ctx.restore();
}

// Darken/lighten a hex colour by an amount in [-1, 1]; negative = darker.
function shadeColor(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const adj = (c: number) => {
    const v = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  const hex2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${hex2(adj(r))}${hex2(adj(g))}${hex2(adj(b))}`;
}

function drawCentredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  fontSize: number,
  color: string,
  bold = false,
  withOutline = false,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = fontSize;
  ctx.font = `${bold ? '900 ' : '700 '}${size}px Inter, system-ui, sans-serif`;
  // Shrink the font until it fits maxWidth.
  const metrics = ctx.measureText(text);
  if (metrics.width > maxWidth) {
    size = Math.floor(size * (maxWidth / metrics.width));
    ctx.font = `${bold ? '900 ' : '700 '}${size}px Inter, system-ui, sans-serif`;
  }
  // Contrast outline so text stays legible against patterned bases (stripes,
  // checker, etc.). Black text gets a light halo; light text gets a dark one.
  if (withOutline) {
    const outline = textOutlineFor(color);
    ctx.strokeStyle = outline;
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeText(text, cx, cy);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, cx, cy);
  ctx.restore();
}

function textOutlineFor(color: string): string {
  // Outline is the OPPOSITE luminance — light text gets a dark halo, dark
  // text gets a light halo. Soft alpha so the halo doesn't dominate.
  const h = color.replace('#', '');
  if (h.length < 6) return 'rgba(255,255,255,0.5)';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 140 ? 'rgba(20,20,24,0.55)' : 'rgba(245,245,245,0.7)';
}

// Thin dark stitching lines along the panel boundaries. When the texture
// is wrapped onto the half-cylinder body panels and sleeve cylinders, the
// u=0.5 line falls on the side-seam edges and the v=0.5 line falls on the
// hem-band — reading as visible stitching where panels join.
function drawSeams(ctx: CanvasRenderingContext2D): void {
  // Thin vertical + horizontal stitch lines at the panel boundaries. No
  // dashed outer-border outline — that read as a wireframe ray-trace
  // overlay on the finished garment, not as fabric stitching.
  ctx.fillStyle = SEAM_COLOR;
  ctx.fillRect(PANEL_SIZE - SEAM_THICKNESS / 2, 0, SEAM_THICKNESS, TEXTURE_SIZE);
  ctx.fillRect(0, PANEL_SIZE - SEAM_THICKNESS / 2, TEXTURE_SIZE, SEAM_THICKNESS);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const cached = IMAGE_HTML_CACHE.get(url);
  if (cached) return cached;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
  IMAGE_HTML_CACHE.set(url, p);
  return p;
}

// ─── Single-panel pattern renderer (called 4× by drawSewingPattern) ────────

function drawPanelPattern(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, p: Pattern, scale = 1): void {
  // Pattern pixel-params (thickness / size / spacing / lineWidth) were
  // authored against a 512² canvas. At larger or smaller canvases we
  // multiply by `scale = size / 512` to keep their visual proportion.
  switch (p.kind) {
    case 'solid': {
      ctx.fillStyle = p.color;
      ctx.fillRect(ox, oy, w, h);
      return;
    }
    case 'hStripes': {
      const t = (p.thickness ?? 28) * scale;
      const colors = p.colors;
      let i = 0;
      for (let y = 0; y < h; y += t) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(ox, oy + y, w, Math.min(t, h - y));
        i += 1;
      }
      return;
    }
    case 'vStripes': {
      const t = (p.thickness ?? 28) * scale;
      const colors = p.colors;
      let i = 0;
      for (let x = 0; x < w; x += t) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(ox + x, oy, Math.min(t, w - x), h);
        i += 1;
      }
      return;
    }
    case 'dots': {
      ctx.fillStyle = p.bg;
      ctx.fillRect(ox, oy, w, h);
      ctx.fillStyle = p.dot;
      const s = (p.size ?? 28) * scale;
      const r = s * 0.32;
      for (let row = 0; row * s * 1.5 < h + s; row += 1) {
        const y = row * s * 1.5 + s * 0.75;
        const xOffset = row % 2 === 0 ? 0 : s * 0.75;
        for (let col = 0; col * s * 1.5 + xOffset < w + s; col += 1) {
          const x = col * s * 1.5 + xOffset + s * 0.5;
          ctx.beginPath();
          ctx.arc(ox + x, oy + y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    case 'twoTone': {
      ctx.fillStyle = p.top;
      ctx.fillRect(ox, oy, w, h / 2);
      ctx.fillStyle = p.bottom;
      ctx.fillRect(ox, oy + h / 2, w, h / 2);
      return;
    }
    case 'hatch': {
      ctx.fillStyle = p.bg;
      ctx.fillRect(ox, oy, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, w, h);
      ctx.clip();
      ctx.strokeStyle = p.line;
      ctx.lineWidth = Math.max(1, 2 * scale);
      const spacing = (p.spacing ?? 14) * scale;
      for (let i = -h; i < w + h; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(ox + i, oy);
        ctx.lineTo(ox + i + h, oy + h);
        ctx.stroke();
      }
      ctx.restore();
      return;
    }
    case 'checker': {
      const s = (p.size ?? 32) * scale;
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          const ix = Math.floor(x / s);
          const iy = Math.floor(y / s);
          ctx.fillStyle = (ix + iy) % 2 === 0 ? p.colorA : p.colorB;
          ctx.fillRect(ox + x, oy + y, Math.min(s, w - x), Math.min(s, h - y));
        }
      }
      return;
    }
    case 'image': {
      // Handled by drawSewingPattern's async path. Synchronous fallback fill
      // so the canvas isn't transparent if this is somehow called directly.
      ctx.fillStyle = p.fallbackColor ?? '#888';
      ctx.fillRect(ox, oy, w, h);
      return;
    }
  }
}

// Pattern → dominant CSS color for HUD swatches (so the tile hints at the look).
export function patternDominantColor(p: Pattern): string {
  switch (p.kind) {
    case 'solid': return p.color;
    case 'hStripes':
    case 'vStripes': return p.colors[0];
    case 'dots': return p.bg;
    case 'twoTone': return p.top;
    case 'hatch': return p.bg;
    case 'checker': return p.colorA;
    case 'image': return p.fallbackColor ?? '#888';
  }
}

// Pattern → CSS background string for HUD swatches (so striped items render
// striped tiles, dotted items render dotted tiles, etc.). Falls through to
// solid colors for patterns CSS can't cleanly mimic.
export function patternSwatchCss(p: Pattern): string {
  switch (p.kind) {
    case 'solid': return p.color;
    case 'hStripes': {
      const c = p.colors;
      if (c.length < 2) return c[0] ?? '#888';
      return `repeating-linear-gradient(0deg, ${c[0]} 0 8px, ${c[1]} 8px 16px)`;
    }
    case 'vStripes': {
      const c = p.colors;
      if (c.length < 2) return c[0] ?? '#888';
      return `repeating-linear-gradient(90deg, ${c[0]} 0 8px, ${c[1]} 8px 16px)`;
    }
    case 'dots':
      return `radial-gradient(circle at 4px 4px, ${p.dot} 2.5px, transparent 3px) 0 0/12px 12px, ${p.bg}`;
    case 'twoTone':
      return `linear-gradient(to bottom, ${p.top} 0 50%, ${p.bottom} 50% 100%)`;
    case 'hatch':
      return `repeating-linear-gradient(45deg, ${p.bg} 0 6px, ${p.line} 6px 8px)`;
    case 'checker':
      return `conic-gradient(${p.colorA} 0 25%, ${p.colorB} 0 50%, ${p.colorA} 0 75%, ${p.colorB} 0) 0 0/14px 14px`;
    case 'image':
      return `url("${p.url}") center/cover, ${p.fallbackColor ?? '#888'}`;
  }
}

// HUD-friendly 4-panel swatch (for the Customize panel diagram + saved-look
// tiles). Returns a 2×2 grid CSS using patternSwatchCss for each quadrant —
// approximates the actual rendered texture without needing a real canvas.
export function designSwatchCss(d: GarmentDesign): string {
  // Use CSS grid via background-image + background-position. Simpler: caller
  // can render four divs in a 2×2 layout. Keep this helper as a tiny string
  // for solid-fallback cases.
  return patternSwatchCss(d.front);
}
