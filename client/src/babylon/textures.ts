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
}

export function uniformDesign(p: Pattern): GarmentDesign {
  return { kind: 'garment', back: p, front: p, sleeveL: p, sleeveR: p };
}

const TEXTURE_SIZE = 512;
const PANEL_SIZE = TEXTURE_SIZE / 2; // 256 — each of the 4 sewing-pattern quadrants.
const SEAM_COLOR = 'rgba(20, 20, 24, 0.55)';
const SEAM_THICKNESS = 3;

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
  // If the URL 404s or fails CORS, Babylon silently leaves diffuseTexture
  // in a broken state — surface as black/white on most drivers. Drop the
  // failed texture so a later equip can re-fetch (e.g. after the user
  // refreshes the underlying CDN object), and the material falls back to
  // diffuseColor which the caller has already set to white.
  tex.onLoadObservable.addOnce(() => { /* keep cached on success */ });
  // Babylon's Texture exposes a Loaded/Error observable on the underlying
  // _texture in some versions, but the public surface is onLoadObservable
  // for success only — we instead listen for the engine-level error event.
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
  // each one lands.
  for (const q of [QUAD.back, QUAD.front, QUAD.sleeveL, QUAD.sleeveR]) {
    const pattern = design[q.panel];
    if (pattern.kind !== 'image') continue;
    loadImage(pattern.url).then((img) => {
      ctx.drawImage(img, q.x, q.y, PANEL_SIZE, PANEL_SIZE);
      drawSeams(ctx);
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
      drawPanelPattern(ctx, x, y, half, half, pattern);
    }
  }
  // Seams — vertical at u=0.5, horizontal at v=0.5, dashed outer hem.
  ctx.fillStyle = SEAM_COLOR;
  ctx.fillRect(half - seamPx / 2, 0, seamPx, size);
  ctx.fillRect(0, half - seamPx / 2, size, seamPx);
  ctx.save();
  ctx.strokeStyle = SEAM_COLOR;
  ctx.lineWidth = Math.max(1, 1.5 * (size / TEXTURE_SIZE));
  ctx.setLineDash([6 * (size / TEXTURE_SIZE), 6 * (size / TEXTURE_SIZE)]);
  ctx.strokeRect(4 * (size / TEXTURE_SIZE), 4 * (size / TEXTURE_SIZE), size - 8 * (size / TEXTURE_SIZE), size - 8 * (size / TEXTURE_SIZE));
  ctx.restore();
}

// Thin dark stitching lines along the panel boundaries. When the texture
// is wrapped onto the half-cylinder body panels and sleeve cylinders, the
// u=0.5 line falls on the side-seam edges and the v=0.5 line falls on the
// hem-band — reading as visible stitching where panels join.
function drawSeams(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = SEAM_COLOR;
  // Vertical seam at u=0.5
  ctx.fillRect(PANEL_SIZE - SEAM_THICKNESS / 2, 0, SEAM_THICKNESS, TEXTURE_SIZE);
  // Horizontal seam at v=0.5
  ctx.fillRect(0, PANEL_SIZE - SEAM_THICKNESS / 2, TEXTURE_SIZE, SEAM_THICKNESS);
  // Subtle outer hem stitching — a dashed border that reads as a finished edge.
  ctx.strokeStyle = SEAM_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.strokeRect(4, 4, TEXTURE_SIZE - 8, TEXTURE_SIZE - 8);
  ctx.setLineDash([]);
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

function drawPanelPattern(ctx: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, p: Pattern): void {
  switch (p.kind) {
    case 'solid': {
      ctx.fillStyle = p.color;
      ctx.fillRect(ox, oy, w, h);
      return;
    }
    case 'hStripes': {
      const t = p.thickness ?? 28;
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
      const t = p.thickness ?? 28;
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
      const s = p.size ?? 28;
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
      ctx.lineWidth = 2;
      const spacing = p.spacing ?? 14;
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
      const s = p.size ?? 32;
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
