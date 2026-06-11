// ============================================================================
// @rezona/core/3d — OFFLINE STUB (local file: package).
// Mirrors the small API surface this template consumes:
//   ensureAudioReady, bgm, sfx, useInput, useScreen, useGameConfig
// Real package lives in Rezona's private registry; this stub keeps the
// original client building + running outside that registry.
// ============================================================================
import { useRef, useEffect } from 'react';

/* ---------- audio ---------- */
let _actx = null;
let _ready = false;
const _pendingBgm = { url: null, opts: null };
export function ensureAudioReady() {
  try {
    if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    _ready = true;
    if (_pendingBgm.url) {
      const u = _pendingBgm.url, o = _pendingBgm.opts;
      _pendingBgm.url = null;
      void bgm.play(u, o);
    }
  } catch (e) { /* never block the scene on audio */ }
  return Promise.resolve();
}
let _bgmEl = null;
let _bgmUrl = null;
export const bgm = {
  async play(url, opts) {
    const o = opts || {};
    if (!_ready) { _pendingBgm.url = url; _pendingBgm.opts = o; return; }
    if (_bgmUrl === url && _bgmEl && !_bgmEl.paused) return;
    if (_bgmEl) { try { _bgmEl.pause(); } catch (e) {} }
    _bgmUrl = url;
    _bgmEl = new Audio(url);
    _bgmEl.loop = o.loop !== false;
    _bgmEl.volume = typeof o.volume === 'number' ? o.volume : 0.5;
    try { await _bgmEl.play(); } catch (e) { /* autoplay block: retried on next unlock */ }
  },
  stop() {
    _bgmUrl = null;
    if (_bgmEl) { try { _bgmEl.pause(); } catch (e) {} _bgmEl = null; }
  },
};
function _blip(freq, dur, vol) {
  if (!_actx) return;
  try {
    const o = _actx.createOscillator(), g = _actx.createGain(), t = _actx.currentTime;
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(_actx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (e) {}
}
export const sfx = {
  collect() { _blip(880, 0.09, 0.08); _blip(1320, 0.12, 0.05); },
};

/* ---------- input ---------- */
class InputImpl {
  constructor() {
    this.keys = new Set();
    this._mx = 0; this._my = 0; this._mobile = false;
    this._tap = false;
    this._wired = false;
  }
  _wire() {
    if (this._wired || typeof window === 'undefined') return;
    this._wired = true;
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)) this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); });
    window.addEventListener('blur', () => { this.keys.clear(); this._mx = 0; this._my = 0; this._mobile = false; });
    window.addEventListener('pointerdown', () => { this._tap = true; }, { capture: true });
  }
  get dir() {
    if (this._mobile) return { x: this._mx, y: this._my };
    let x = 0, y = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) x -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) x += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) y -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) y += 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }
  setMobileMove(x, y) {
    this._mx = x; this._my = y;
    this._mobile = (x !== 0 || y !== 0);
  }
  consumeTap() { const t = this._tap; this._tap = false; return t; }
}
const _input = new InputImpl();
export function useInput() {
  _input._wire();
  return _input;
}

/* ---------- screen ---------- */
export function useScreen() {
  const screenRef = useRef({ width: 0, height: 0, dpr: 1 });
  const containerRef = useRef(null);
  useEffect(() => {
    const update = () => {
      screenRef.current = {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      };
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return { screenRef, containerRef };
}

/* ---------- editable config ---------- */
export function useGameConfig(schema) {
  const configRef = useRef(null);
  if (!configRef.current) {
    const cfg = {};
    for (const k of Object.keys(schema || {})) {
      const e = schema[k];
      cfg[k] = e && typeof e === 'object' && 'default' in e ? e.default : undefined;
      if (e && e.cssVar && typeof document !== 'undefined') {
        try { document.documentElement.style.setProperty(e.cssVar, String(cfg[k])); } catch (err) {}
      }
    }
    configRef.current = cfg;
  }
  return { configRef };
}
