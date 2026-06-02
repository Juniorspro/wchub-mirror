// ══════════════════════════════════════════════
// Procedural pattern textures for the dress-up wardrobe.
// Each Pattern is rasterised once into a 256² DynamicTexture and cached by a
// stable string key (slot + JSON of the pattern), so repeat equips of the same
// item don't redraw. Disposed via disposePatternTextureCache() in
// actor.dispose() / game.ts when the scene tears down.
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

const TEXTURE_SIZE = 256;
const TEXTURE_CACHE = new Map<string, DynamicTexture>();
const IMAGE_TEXTURE_CACHE = new Map<string, Texture>();

export function getImageTexture(scene: Scene, url: string): Texture {
  const cached = IMAGE_TEXTURE_CACHE.get(url);
  if (cached) return cached;
  const tex = new Texture(url, scene);
  tex.anisotropicFilteringLevel = 8;
  IMAGE_TEXTURE_CACHE.set(url, tex);
  return tex;
}

export function patternKey(scope: string, pattern: Pattern): string {
  return `${scope}|${JSON.stringify(pattern)}`;
}

export function getPatternTexture(scene: Scene, key: string, pattern: Pattern): DynamicTexture {
  const cached = TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const tex = new DynamicTexture(`pattern-${key}`, TEXTURE_SIZE, scene, false);
  const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
  drawPattern(ctx, TEXTURE_SIZE, TEXTURE_SIZE, pattern);
  tex.update();
  // Slight texture filtering tweak so pixel-art patterns stay crisp on closeup.
  tex.anisotropicFilteringLevel = 4;
  TEXTURE_CACHE.set(key, tex);
  return tex;
}

export function disposePatternTextureCache(): void {
  for (const tex of TEXTURE_CACHE.values()) tex.dispose();
  TEXTURE_CACHE.clear();
  for (const tex of IMAGE_TEXTURE_CACHE.values()) tex.dispose();
  IMAGE_TEXTURE_CACHE.clear();
}

function drawPattern(ctx: CanvasRenderingContext2D, w: number, h: number, p: Pattern): void {
  switch (p.kind) {
    case 'solid': {
      ctx.fillStyle = p.color;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    case 'hStripes': {
      const t = p.thickness ?? 28;
      const colors = p.colors;
      let i = 0;
      for (let y = 0; y < h; y += t) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(0, y, w, t);
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
        ctx.fillRect(x, 0, t, h);
        i += 1;
      }
      return;
    }
    case 'dots': {
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = p.dot;
      const s = p.size ?? 28;
      const r = s * 0.32;
      for (let row = 0; row * s * 1.5 < h + s; row += 1) {
        const y = row * s * 1.5 + s * 0.75;
        const xOffset = row % 2 === 0 ? 0 : s * 0.75;
        for (let col = 0; col * s * 1.5 + xOffset < w + s; col += 1) {
          const x = col * s * 1.5 + xOffset + s * 0.5;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }
    case 'twoTone': {
      ctx.fillStyle = p.top;
      ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = p.bottom;
      ctx.fillRect(0, h / 2, w, h / 2);
      return;
    }
    case 'hatch': {
      ctx.fillStyle = p.bg;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 2;
      const spacing = p.spacing ?? 14;
      for (let i = -h; i < w + h; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.stroke();
      }
      return;
    }
    case 'checker': {
      const s = p.size ?? 32;
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          const ix = Math.floor(x / s);
          const iy = Math.floor(y / s);
          ctx.fillStyle = (ix + iy) % 2 === 0 ? p.colorA : p.colorB;
          ctx.fillRect(x, y, s, s);
        }
      }
      return;
    }
    case 'image': {
      // Image patterns are loaded by getImageTexture(), not rasterised here.
      // Fallback fill so this branch can't accidentally render transparent.
      ctx.fillStyle = p.fallbackColor ?? '#888';
      ctx.fillRect(0, 0, w, h);
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
