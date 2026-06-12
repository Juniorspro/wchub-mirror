// ══════════════════════════════════════════════════════════════════════
// FIGURA (port Babylon) — núcleo [PURO] del humanoide esculpido del
// figlab (figura_goty_v3): lofts superelípticos + FK por ángulos.
// Sin huesos: la malla se REGENERA por frame (diseño original del v1).
// Acá vive solo la matemática; main.ts arma el Mesh/material/decal.
// ══════════════════════════════════════════════════════════════════════

function clamp(v: number, a: number, b: number): number { return v < a ? a : (v > b ? b : v); }
function lerp(t: number, a: number, b: number): number { return a + (b - a) * t; }
function sstep(a: number, b: number, t: number): number { t = clamp((t - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function gauss(x: number, s: number): number { return Math.exp(-(x * x) / (2 * s * s)); }
function angDist(a: number, b: number): number { const d = Math.abs(a - b) % 6.2832; return d > 3.1416 ? 6.2832 - d : d; }

type V3 = [number, number, number];
const vset = (o: V3, x: number, y: number, z: number): V3 => { o[0] = x; o[1] = y; o[2] = z; return o; };
const vsub = (o: V3, a: V3, b: V3): V3 => vset(o, a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const vscale = (o: V3, a: V3, s: number): V3 => vset(o, a[0] * s, a[1] * s, a[2] * s);
const vmadd = (o: V3, a: V3, b: V3, s: number): V3 => vset(o, a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s);
const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vcross = (o: V3, a: V3, b: V3): V3 => {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  return vset(o, x, y, z);
};
const vlen = (a: V3): number => Math.sqrt(vdot(a, a));
const vnorm = (o: V3, a: V3): V3 => vscale(o, a, 1 / (vlen(a) || 1));
function vrotAxis(o: V3, v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kv = vdot(k, v);
  const cr: V3 = [0, 0, 0];
  vcross(cr, k, v);
  return vset(o,
    v[0] * c + cr[0] * s + k[0] * kv * (1 - c),
    v[1] * c + cr[1] * s + k[1] * kv * (1 - c),
    v[2] * c + cr[2] * s + k[2] * kv * (1 - c));
}
const vrotX = (o: V3, v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vset(o, v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c);
};
const vrotZ = (o: V3, v: V3, a: number): V3 => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return vset(o, v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]);
};

// ─── proporciones PETISO (v3 chibi) + tablas de secciones ───────────────
export const HUM = {
  SEG: { torso: 22, head: 30, arm: 14, leg: 14, foot: 12 },
  L: { upper: 0.21, fore: 0.19, hand: 0.135, thigh: 0.27, shin: 0.26, foot: 0.21, shH: 0.165, hipH: 0.082, torso: 0.44, head: 0.26 },
  TORSO: [[0.00, 0.118, 0.080, 0.098, 2.6], [0.10, 0.158, 0.103, 0.126, 2.4], [0.28, 0.138, 0.100, 0.108, 2.2],
    [0.45, 0.146, 0.110, 0.110, 2.2], [0.62, 0.160, 0.124, 0.113, 2.3], [0.74, 0.176, 0.117, 0.110, 2.5],
    [0.84, 0.188, 0.103, 0.103, 2.8], [0.92, 0.118, 0.082, 0.088, 2.4], [1.00, 0.056, 0.054, 0.058, 2.0]],
  HEAD: [[0.00, 0.046, 0.046, 0.048, 2.0], [0.06, 0.0386, 0.0386, 0.040, 2.05], [0.12, 0.0528, 0.0528, 0.054, 2.05],
    [0.18, 0.0625, 0.0625, 0.064, 2.1], [0.24, 0.0694, 0.0694, 0.071, 2.1], [0.30, 0.0745, 0.0745, 0.077, 2.1],
    [0.36, 0.0780, 0.0780, 0.080, 2.1], [0.42, 0.0803, 0.0803, 0.083, 2.1], [0.48, 0.0812, 0.0812, 0.084, 2.1],
    [0.54, 0.0810, 0.0810, 0.083, 2.1], [0.60, 0.0797, 0.0797, 0.082, 2.1], [0.66, 0.0770, 0.0770, 0.079, 2.1],
    [0.72, 0.0730, 0.0730, 0.075, 2.1], [0.80, 0.0650, 0.0650, 0.067, 2.1], [0.86, 0.0564, 0.0564, 0.058, 2.05],
    [0.93, 0.0415, 0.0415, 0.043, 2.0], [0.97, 0.0277, 0.0277, 0.029, 2.0], [0.995, 0.0115, 0.0115, 0.012, 2.0]],
  ARM: [[0.00, 0.062, 0.062, 0.062, 2.2], [0.10, 0.058, 0.056, 0.056, 2.2], [0.22, 0.048, 0.046, 0.046, 2.2],
    [0.40, 0.040, 0.038, 0.038, 2.2], [0.52, 0.046, 0.042, 0.042, 2.2], [0.68, 0.033, 0.030, 0.030, 2.2],
    [0.76, 0.027, 0.019, 0.019, 2.6], [0.85, 0.043, 0.015, 0.015, 3.0], [0.93, 0.038, 0.013, 0.013, 2.6],
    [1.00, 0.020, 0.009, 0.009, 2.2]],
  LEG: [[0.00, 0.082, 0.078, 0.094, 2.3], [0.12, 0.079, 0.082, 0.090, 2.3], [0.30, 0.066, 0.070, 0.074, 2.2],
    [0.47, 0.054, 0.058, 0.058, 2.2], [0.60, 0.056, 0.060, 0.072, 2.2], [0.76, 0.043, 0.046, 0.050, 2.2],
    [0.92, 0.031, 0.033, 0.033, 2.1], [1.00, 0.029, 0.030, 0.030, 2.1]],
  FOOT: [[0.00, 0.040, 0.050, 2.6, -0.022], [0.18, 0.044, 0.046, 2.7, -0.028], [0.42, 0.050, 0.040, 2.8, -0.034],
    [0.66, 0.054, 0.031, 2.9, -0.043], [0.85, 0.050, 0.024, 2.8, -0.050], [1.00, 0.040, 0.016, 2.5, -0.056]],
};
// engorde chibi (mismos factores que el figlab)
(() => {
  const sc = (tab: number[][], f: number): void => { for (const r of tab) { r[1] *= f; r[2] *= f; r[3] *= f; } };
  sc(HUM.TORSO, 1.10);
  sc(HUM.ARM, 1.12);
  sc(HUM.LEG, 1.14);
  sc(HUM.HEAD, 1.60);
  for (const r of HUM.FOOT) { r[1] *= 1.10; r[2] *= 1.05; }
})();
const FOOTL: number[][] = HUM.FOOT.map((r) => [r[0], r[1], r[2], r[2], r[3]]);

function sampleRow(tab: number[][], t: number): number[] {
  if (t <= tab[0][0]) return tab[0].slice();
  for (let i = 0; i < tab.length - 1; i++) {
    if (t <= tab[i + 1][0]) {
      const a = tab[i];
      const b = tab[i + 1];
      const u = (t - a[0]) / (b[0] - a[0]);
      return a.map((v, k) => lerp(u, v, b[k]));
    }
  }
  return tab[tab.length - 1].slice();
}

// camino Catmull-Rom + marcos por transporte paralelo (port 1:1)
interface SPath { at(t: number, oP: V3, oT: V3, oN: V3, oB: V3): void }
function smoothPath(ctrl: V3[], M: number, hint: V3): SPath {
  const pts: V3[] = [];
  const seg = ctrl.length - 1;
  const ext = [ctrl[0]].concat(ctrl).concat([ctrl[ctrl.length - 1]]);
  for (let i = 0; i < M; i++) {
    const tt = i / (M - 1) * seg;
    const si = Math.min(seg - 1, Math.floor(tt));
    const u = tt - si;
    const p0 = ext[si];
    const p1 = ext[si + 1];
    const p2 = ext[si + 2];
    const p3 = ext[si + 3];
    const u2 = u * u;
    const u3 = u2 * u;
    pts.push([
      0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
      0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3),
      0.5 * ((2 * p1[2]) + (-p0[2] + p2[2]) * u + (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * u2 + (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * u3),
    ]);
  }
  const T: V3[] = [];
  const N: V3[] = [];
  const B: V3[] = [];
  const cum = [0];
  const tmp: V3 = [0, 0, 0];
  for (let i = 0; i < M; i++) {
    const a2 = pts[Math.max(0, i - 1)];
    const b2 = pts[Math.min(M - 1, i + 1)];
    const tg: V3 = [b2[0] - a2[0], b2[1] - a2[1], b2[2] - a2[2]];
    vnorm(tg, tg);
    T.push(tg);
    if (i > 0) cum.push(cum[i - 1] + vlen(vsub(tmp, pts[i], pts[i - 1])));
  }
  let h = hint.slice() as V3;
  if (Math.abs(vdot(h, T[0])) > 0.9) h = [0, 0, 1];
  const n0: V3 = [0, 0, 0];
  vmadd(n0, h, T[0], -vdot(h, T[0]));
  vnorm(n0, n0);
  N.push(n0);
  for (let i = 1; i < M; i++) {
    const pn = N[i - 1].slice() as V3;
    vmadd(pn, pn, T[i], -vdot(pn, T[i]));
    vnorm(pn, pn);
    N.push(pn);
  }
  for (let i = 0; i < M; i++) {
    const bb: V3 = [0, 0, 0];
    vcross(bb, T[i], N[i]);
    vnorm(bb, bb);
    B.push(bb);
  }
  const tot = cum[M - 1];
  return {
    at(t: number, oP: V3, oT: V3, oN: V3, oB: V3): void {
      const d = clamp(t, 0, 1) * tot;
      let j = 0;
      while (j < M - 2 && cum[j + 1] < d) j++;
      const uu = (d - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
      for (let k = 0; k < 3; k++) {
        oP[k] = lerp(uu, pts[j][k], pts[j + 1][k]);
        oT[k] = lerp(uu, T[j][k], T[j + 1][k]);
        oN[k] = lerp(uu, N[j][k], N[j + 1][k]);
      }
      vnorm(oT, oT);
      vmadd(oN, oN, oT, -vdot(oN, oT));
      vnorm(oN, oN);
      vcross(oB, oT, oN);
    },
  };
}

// ─── cara base (cara 0 del figlab) en modo DIBUJADA: nariz/mentón/
// cachetes/orejas en 3D; ojos/boca/ceja van pintados en el decal ───────
// v2: cabeza FULL REDONDA — sin esculpido (la cara va dibujada en el
// decal y cualquier bump deformaba el dibujo en el Poco).
export function headDisp(_th: number, _t: number): number {
  return 0;
}

// ─── escritor de figura ──────────────────────────────────────────────────
export interface Joints {
  breath: number; pelvisY: number; swayX: number; swayZ: number; twist: number;
  spineFwd: number; spineSide: number; headNod: number; headTurn: number; headTilt: number;
  shAbdL: number; shAbdR: number; shFwdL: number; shFwdR: number; elbowL: number; elbowR: number;
  hipFwdL: number; hipFwdR: number; hipAbdL: number; hipAbdR: number;
  kneeL: number; kneeR: number; ankleL: number; ankleR: number; toeL: number; toeR: number; jaw: number;
}
export function J0(): Joints {
  return {
    breath: 0, pelvisY: 0, swayX: 0, swayZ: 0, twist: 0, spineFwd: 0, spineSide: 0,
    headNod: 0, headTurn: 0, headTilt: 0,
    shAbdL: 0, shAbdR: 0, shFwdL: 0, shFwdR: 0, elbowL: 0, elbowR: 0,
    hipFwdL: 0, hipFwdR: 0, hipAbdL: 0, hipAbdR: 0, kneeL: 0, kneeR: 0,
    ankleL: 0, ankleR: 0, toeL: 0, toeR: 0, jaw: 0,
  };
}

export const FIG: {
  pos: Float32Array | null; idx: Uint16Array | null;
  parts: Array<{ segs: number; rings: number[]; p0: number; p1: number }> | null;
  meta: number[] | null; vc: number; cur: number;
} = { pos: null, idx: null, parts: null, meta: null, vc: 0, cur: 0 };

function wV(x: number, y: number, z: number): void {
  if (FIG.pos) {
    const c = FIG.cur * 3;
    FIG.pos[c] = x;
    FIG.pos[c + 1] = y;
    FIG.pos[c + 2] = z;
  }
  FIG.cur++;
}

interface LoftOpts {
  capStart?: boolean; capEnd?: boolean; capScale?: number;
  twist?: (t: number) => number;
  disp?: (th: number, t: number) => number;
  mod?: (row: number[]) => void;
}
function loft(sp: SPath, tab: number[][], segs: number, opts: LoftOpts = {}): void {
  const rec = !FIG.pos;
  let part: { segs: number; rings: number[]; p0: number; p1: number } | null = null;
  if (rec) {
    part = { segs, rings: [], p0: -1, p1: -1 };
    (FIG.parts as NonNullable<typeof FIG.parts>).push(part);
  }
  const P: V3 = [0, 0, 0];
  const T: V3 = [0, 0, 0];
  const N: V3 = [0, 0, 0];
  const B: V3 = [0, 0, 0];
  for (let i = 0; i < tab.length; i++) {
    const row = sampleRow(tab, tab[i][0]);
    if (opts.mod) opts.mod(row);
    sp.at(row[0], P, T, N, B);
    if (opts.twist) {
      const a = opts.twist(row[0]);
      const NN = N.slice() as V3;
      vrotAxis(N, NN, T, a);
      vcross(B, T, N);
    }
    if (rec && part) part.rings.push(FIG.cur);
    const w = row[1];
    const dF = row[2];
    const dB = row[3];
    const ex = row[4];
    for (let s = 0; s < segs; s++) {
      const th = s / segs * 6.2832;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      if (rec) (FIG.meta as number[]).push((FIG.parts as NonNullable<typeof FIG.parts>).length - 1, row[0], th);
      const x = (cs < 0 ? -1 : 1) * Math.pow(Math.abs(cs), 2 / ex);
      const z = (sn < 0 ? -1 : 1) * Math.pow(Math.abs(sn), 2 / ex);
      const dE = lerp(sstep(-0.35, 0.35, sn), dB, dF);
      let px = P[0] + N[0] * x * w + B[0] * z * dE;
      let py = P[1] + N[1] * x * w + B[1] * z * dE;
      let pz = P[2] + N[2] * x * w + B[2] * z * dE;
      if (opts.disp) {
        const rr = opts.disp(th, row[0]);
        if (rr) {
          const rx = N[0] * cs + B[0] * sn;
          const ry = N[1] * cs + B[1] * sn;
          const rz = N[2] * cs + B[2] * sn;
          const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
          px += rx / rl * rr;
          py += ry / rl * rr;
          pz += rz / rl * rr;
        }
      }
      wV(px, py, pz);
    }
  }
  const capS = opts.capScale ?? 0.7;
  if (opts.capStart) {
    sp.at(tab[0][0], P, T, N, B);
    const r0 = sampleRow(tab, tab[0][0]);
    const c0 = Math.min(r0[1], r0[2]) * capS;
    if (rec && part) {
      part.p0 = FIG.cur;
      (FIG.meta as number[]).push((FIG.parts as NonNullable<typeof FIG.parts>).length - 1, 0, -1);
    }
    wV(P[0] - T[0] * c0, P[1] - T[1] * c0, P[2] - T[2] * c0);
  }
  if (opts.capEnd) {
    sp.at(1, P, T, N, B);
    const r1 = sampleRow(tab, 1);
    const c1 = Math.min(r1[1], r1[2]) * capS;
    if (rec && part) {
      part.p1 = FIG.cur;
      (FIG.meta as number[]).push((FIG.parts as NonNullable<typeof FIG.parts>).length - 1, 1, -1);
    }
    wV(P[0] + T[0] * c1, P[1] + T[1] * c1, P[2] + T[2] * c1);
  }
}

function buildIndices(): void {
  const idx: number[] = [];
  const parts = FIG.parts as NonNullable<typeof FIG.parts>;
  for (let p = 0; p < parts.length; p++) {
    const pa = parts[p];
    const S = pa.segs;
    for (let i = 0; i < pa.rings.length - 1; i++) {
      const r0 = pa.rings[i];
      const r1 = pa.rings[i + 1];
      for (let s = 0; s < S; s++) {
        const s1 = (s + 1) % S;
        idx.push(r0 + s, r0 + s1, r1 + s1, r0 + s, r1 + s1, r1 + s);
      }
    }
    if (pa.p0 >= 0) {
      const rf = pa.rings[0];
      for (let s = 0; s < S; s++) idx.push(rf + (s + 1) % S, rf + s, pa.p0);
    }
    if (pa.p1 >= 0) {
      const rl = pa.rings[pa.rings.length - 1];
      for (let s = 0; s < S; s++) idx.push(rl + s, rl + (s + 1) % S, pa.p1);
    }
  }
  FIG.idx = new Uint16Array(idx);
}

// marco de la cabeza para el decal moldeado (misma cuenta que buildFigure)
export function headFrame(J: Joints): { neckTop: V3; hax: V3 } {
  const L = HUM.L;
  const pel: V3 = [J.swayX, 0.56 + J.pelvisY, J.swayZ];
  const axF: V3 = [0, 1, 0];
  vrotX(axF, axF, J.spineFwd);
  vrotZ(axF, axF, J.spineSide);
  const neckTop: V3 = [0, 0, 0];
  vmadd(neckTop, pel, axF, L.torso);
  const hax = axF.slice() as V3;
  vrotX(hax, hax, J.headNod);
  vrotZ(hax, hax, J.headTilt);
  return { neckTop, hax };
}

export function buildFigure(J: Joints): void {
  FIG.cur = 0;
  if (!FIG.parts) FIG.parts = [];
  const rec = !FIG.pos;
  if (rec) {
    FIG.parts.length = 0;
    FIG.meta = [];
  }
  const L = HUM.L;
  const pel: V3 = [J.swayX, 0.56 + J.pelvisY, J.swayZ];
  const axF: V3 = [0, 1, 0];
  const axM: V3 = [0, 1, 0];
  vrotX(axF, axF, J.spineFwd);
  vrotZ(axF, axF, J.spineSide);
  vrotX(axM, axM, J.spineFwd * 0.45);
  vrotZ(axM, axM, J.spineSide * 0.45);
  const cT: V3[] = [pel.slice() as V3, vmadd([0, 0, 0], pel, axM, L.torso * 0.5), vmadd([0, 0, 0], pel, axF, L.torso)];
  const spT = smoothPath(cT, 40, [-1, 0, 0]);
  loft(spT, HUM.TORSO, HUM.SEG.torso, {
    capStart: true,
    twist: (t) => J.twist * t,
    mod: (row) => {
      const g = gauss(row[0] - 0.62, 0.18) * J.breath;
      row[1] *= 1 + 0.020 * g;
      row[2] *= 1 + 0.032 * g;
    },
  });
  // marco de hombros (con twist)
  const P: V3 = [0, 0, 0];
  const T: V3 = [0, 0, 0];
  const N: V3 = [0, 0, 0];
  const B: V3 = [0, 0, 0];
  spT.at(0.855, P, T, N, B);
  const NN = N.slice() as V3;
  vrotAxis(N, NN, T, J.twist * 0.855);
  vcross(B, T, N);
  const lat: V3 = [-N[0], -N[1], -N[2]];
  const shP = P.slice() as V3;
  const shB = B.slice() as V3;
  const arm = (s: number, abd: number, fwd: number, elb: number): void => {
    const S: V3 = [
      shP[0] + lat[0] * L.shH * s - shB[0] * 0.010,
      shP[1] + lat[1] * L.shH * s - shB[1] * 0.010 - 0.014,
      shP[2] + lat[2] * L.shH * s - shB[2] * 0.010,
    ];
    const d1: V3 = [0, -1, 0];
    vrotZ(d1, d1, s * abd);
    vrotX(d1, d1, fwd);
    const ab = Math.min(1, Math.abs(Math.sin(abd)));
    const bt: V3 = [0, ab, 1 - ab];
    vnorm(bt, bt);
    const ax: V3 = [0, 0, 0];
    vcross(ax, d1, bt);
    if (vlen(ax) < 0.15) vset(ax, -1, 0, 0);
    vnorm(ax, ax);
    const d2: V3 = [0, 0, 0];
    vrotAxis(d2, d1, ax, elb);
    const E = vmadd([0, 0, 0], S, d1, L.upper);
    const W = vmadd([0, 0, 0], E, d2, L.fore);
    const TIP = vmadd([0, 0, 0], W, d2, L.hand);
    const sp = smoothPath([S, E, W, TIP], 40, [1, 0, 0]);
    loft(sp, HUM.ARM, HUM.SEG.arm, { capEnd: true });
  };
  arm(1, J.shAbdL, J.shFwdL, J.elbowL);
  arm(-1, J.shAbdR, J.shFwdR, J.elbowR);
  const leg = (s: number, hf: number, ha: number, kn: number, an: number): void => {
    const Hp: V3 = [pel[0] + s * L.hipH, pel[1] + 0.04, pel[2]];
    const d1: V3 = [0, -1, 0];
    vrotZ(d1, d1, s * ha);
    vrotX(d1, d1, hf);
    const ax: V3 = [0, 0, 0];
    vcross(ax, d1, [0, 0, 1]);
    if (vlen(ax) < 0.15) vset(ax, -1, 0, 0);
    vnorm(ax, ax);
    const d2: V3 = [0, 0, 0];
    vrotAxis(d2, d1, ax, -kn);
    const K = vmadd([0, 0, 0], Hp, d1, L.thigh);
    const A = vmadd([0, 0, 0], K, d2, L.shin);
    const spL = smoothPath([Hp, K, A], 40, [1, 0, 0]);
    loft(spL, HUM.LEG, HUM.SEG.leg, {});
    const fd: V3 = [0, 0, 1];
    const c = Math.cos(s * 0.10);
    const sn2 = Math.sin(s * 0.10);
    vset(fd, sn2, 0, c); // rotY(0.10*s) de [0,0,1]
    vrotX(fd, fd, an);
    const fc = (t: number): V3 => {
      const dr = sampleRow(HUM.FOOT, t)[4];
      const o = vmadd([0, 0, 0], A, fd, -0.045 + t * 0.21);
      o[1] += dr;
      return o;
    };
    const spF = smoothPath([fc(0), fc(0.5), fc(1)], 24, [1, 0, 0]);
    loft(spF, FOOTL, HUM.SEG.foot, { capStart: true, capEnd: true });
  };
  leg(1, J.hipFwdL, J.hipAbdL, J.kneeL, J.ankleL);
  leg(-1, J.hipFwdR, J.hipAbdR, J.kneeR, J.ankleR);
  const hf = headFrame(J);
  const cH: V3[] = [
    vmadd([0, 0, 0], hf.neckTop, hf.hax, -0.02),
    vmadd([0, 0, 0], hf.neckTop, hf.hax, L.head * 0.5),
    vmadd([0, 0, 0], hf.neckTop, hf.hax, L.head),
  ];
  const spH = smoothPath(cH, 30, [-1, 0, 0]);
  loft(spH, HUM.HEAD, HUM.SEG.head, {
    capEnd: true, capScale: 0.4, disp: headDisp,
    twist: (t) => J.headTurn * sstep(0.05, 0.35, t),
  });
  if (rec) {
    FIG.vc = FIG.cur;
    FIG.pos = new Float32Array(FIG.vc * 3);
    buildIndices();
    buildFigure(J);
  }
}

// ─── osciladores cartoon (idle ↔ caminar, mezcla por m=0..1) ────────────
export function poseCartoon(t: number, walkPh: number, m: number): Joints {
  const J = J0();
  // base quieto
  J.shAbdL = 0.06; J.shAbdR = 0.06; J.shFwdL = 0.04; J.shFwdR = 0.04;
  J.elbowL = 0.16; J.elbowR = 0.16; J.hipAbdL = 0.05; J.hipAbdR = 0.05;
  const i = 1 - m;
  // idle hamacado
  J.breath = 0.5 + 0.5 * Math.sin(t * 1.05);
  J.swayX += Math.sin(t * 0.5) * 0.020 * i;
  J.spineSide += Math.sin(t * 0.5) * 0.035 * i;
  J.twist += Math.sin(t * 0.31) * 0.07 * i;
  J.headTurn += (Math.sin(t * 0.23) * 0.30 + Math.sin(t * 0.57) * 0.10) * i;
  J.headNod += Math.sin(t * 0.41) * 0.05 * i;
  J.headTilt += Math.sin(t * 0.37) * 0.05 * i;
  J.pelvisY += (Math.abs(Math.sin(t * 1.05)) * 0.010 - 0.005) * i;
  J.jaw = 0.045 + 0.035 * Math.sin(t * 1.05 + 1.3);
  // marcha dibujito
  const p = walkPh;
  J.spineFwd += 0.10 * m;
  J.hipFwdL += Math.sin(p) * 0.72 * m;
  J.hipFwdR += -Math.sin(p) * 0.72 * m;
  J.kneeL += (Math.max(0, Math.sin(p - 1.85)) * 1.30 + 0.08) * m;
  J.kneeR += (Math.max(0, Math.sin(p + 3.1416 - 1.85)) * 1.30 + 0.08) * m;
  J.ankleL += Math.sin(p - 0.4) * 0.30 * m;
  J.ankleR += -Math.sin(p - 0.4) * 0.30 * m;
  J.shFwdL += -Math.sin(p) * 0.62 * m;
  J.shFwdR += Math.sin(p) * 0.62 * m;
  J.elbowL += Math.max(0, -Math.sin(p)) * 0.38 * m;
  J.elbowR += Math.max(0, Math.sin(p)) * 0.38 * m;
  J.pelvisY += (-0.030 + 0.030 * Math.cos(2 * p)) * m;
  J.twist += Math.sin(p) * 0.14 * m;
  J.spineSide += Math.sin(p) * 0.05 * m;
  J.headNod += Math.sin(2 * p) * 0.035 * m;
  J.headTilt += Math.sin(p) * 0.04 * m;
  J.toeL = -Math.max(0, Math.sin(p + 2.2)) * 0.7 * m;
  J.toeR = -Math.max(0, Math.sin(p + 3.1416 + 2.2)) * 0.7 * m;
  return J;
}

// decal de cara MOLDEADO: muestrea la misma superficie de la cabeza
// (superelipse + headDisp) +6mm, siguiendo headNod/Turn/Tilt del frame.
export function decalPositions(J: Joints, out: Float32Array,
  U: number, Vv: number, PHI: number, T0: number, T1: number): void {
  const F = 1.5708;
  const hf = headFrame(J);
  const T = hf.hax;
  const Nb: V3 = [-1, 0, 0];
  vmadd(Nb, Nb, T, -vdot(Nb, T));
  vnorm(Nb, Nb);
  const span = HUM.L.head + 0.02;
  const N: V3 = [0, 0, 0];
  const B: V3 = [0, 0, 0];
  const P: V3 = [0, 0, 0];
  let n = 0;
  for (let j = 0; j <= Vv; j++) {
    const t = T1 - (j / Vv) * (T1 - T0);
    const row = sampleRow(HUM.HEAD, t);
    vrotAxis(N, Nb, T, J.headTurn * sstep(0.05, 0.35, t));
    vcross(B, T, N);
    const w = row[1];
    const dF = row[2];
    const dB = row[3];
    const ex = row[4];
    vmadd(P, hf.neckTop, T, -0.02 + t * span);
    for (let i = 0; i <= U; i++) {
      const th = F - PHI + (i / U) * 2 * PHI;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const x = (cs < 0 ? -1 : 1) * Math.pow(Math.abs(cs), 2 / ex);
      const z = (sn < 0 ? -1 : 1) * Math.pow(Math.abs(sn), 2 / ex);
      const dE = lerp(sstep(-0.35, 0.35, sn), dB, dF);
      const rr = headDisp(th, t) + 0.006;
      const rx = N[0] * cs + B[0] * sn;
      const ry = N[1] * cs + B[1] * sn;
      const rz = N[2] * cs + B[2] * sn;
      const rl = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
      out[n++] = P[0] + N[0] * x * w + B[0] * z * dE + rx / rl * rr;
      out[n++] = P[1] + N[1] * x * w + B[1] * z * dE + ry / rl * rr;
      out[n++] = P[2] + N[2] * x * w + B[2] * z * dE + rz / rl * rr;
    }
  }
}

// mezcla de poses articulación por articulación
export function mixJoints(a: Joints, b: Joints, m: number): Joints {
  const o = J0();
  for (const k of Object.keys(o) as Array<keyof Joints>) {
    o[k] = a[k] * (1 - m) + b[k] * m;
  }
  return o;
}

// pose SENTADO (banco ~0.45 de alto): muslos horizontales, canillas
// abajo, leve reclinado, manos al regazo, mirada paseandera.
export function poseSit(t: number): Joints {
  const J = J0();
  J.breath = 0.5 + 0.5 * Math.sin(t * 1.05);
  // OJO: en este FK hipFwd POSITIVO manda la pierna para ATRÁS (-Z);
  // sentado = muslos ADELANTE → negativo
  J.hipFwdL = -1.25;
  J.hipFwdR = -1.25;
  // piernitas colgando que se hamacan alternadas (el petiso no llega al piso)
  J.kneeL = 1.45 + Math.sin(t * 1.6) * 0.16;
  J.kneeR = 1.45 + Math.sin(t * 1.6 + 2.4) * 0.16;
  J.ankleL = 0.25;
  J.ankleR = 0.25;
  J.pelvisY = -0.04;
  J.spineFwd = -0.05;
  J.spineSide = Math.sin(t * 0.45) * 0.03;
  J.shFwdL = -0.32; // manos al regazo (adelante)
  J.shFwdR = -0.32;
  J.elbowL = 0.6;
  J.elbowR = 0.6;
  J.headTurn = Math.sin(t * 0.3) * 0.3 + Math.sin(t * 0.7) * 0.08;
  J.headNod = Math.sin(t * 0.5) * 0.05;
  J.headTilt = Math.sin(t * 0.4) * 0.04;
  J.jaw = 0.04 + 0.03 * Math.sin(t * 1.05);
  return J;
}

// posiciones (locales al root) de las 11 articulaciones del esqueleto
// para la pose J — el ragdoll arranca EXACTAMENTE desde acá.
// Orden: pelvis, pecho, cabeza, rodillaL, pieL, rodillaR, pieR,
//        codoL, manoL, codoR, manoR
export function skeletonPoints(J: Joints): V3[] {
  const L = HUM.L;
  const pel: V3 = [J.swayX, 0.56 + J.pelvisY, J.swayZ];
  const axF: V3 = [0, 1, 0];
  vrotX(axF, axF, J.spineFwd);
  vrotZ(axF, axF, J.spineSide);
  const chest = vmadd([0, 0, 0], pel, axF, L.torso * 0.86);
  const neckTop = vmadd([0, 0, 0], pel, axF, L.torso);
  const hax = axF.slice() as V3;
  vrotX(hax, hax, J.headNod);
  vrotZ(hax, hax, J.headTilt);
  const head = vmadd([0, 0, 0], neckTop, hax, L.head * 0.55);
  const arm = (s: number, abd: number, fwd: number, elb: number): { E: V3; H: V3 } => {
    const S: V3 = [0, 0, 0];
    vmadd(S, pel, axF, L.torso * 0.855);
    S[0] += s * L.shH;
    S[1] -= 0.014;
    const d1: V3 = [0, -1, 0];
    vrotZ(d1, d1, s * abd);
    vrotX(d1, d1, fwd);
    const ab = Math.min(1, Math.abs(Math.sin(abd)));
    const bt: V3 = [0, ab, 1 - ab];
    vnorm(bt, bt);
    const ax: V3 = [0, 0, 0];
    vcross(ax, d1, bt);
    if (vlen(ax) < 0.15) vset(ax, -1, 0, 0);
    vnorm(ax, ax);
    const d2: V3 = [0, 0, 0];
    vrotAxis(d2, d1, ax, elb);
    const E = vmadd([0, 0, 0], S, d1, L.upper);
    const H = vmadd([0, 0, 0], E, d2, L.fore + L.hand * 0.5);
    return { E, H };
  };
  const leg = (s: number, hf: number, ha: number, kn: number): { K: V3; A: V3 } => {
    const Hp: V3 = [pel[0] + s * L.hipH, pel[1] + 0.04, pel[2]];
    const d1: V3 = [0, -1, 0];
    vrotZ(d1, d1, s * ha);
    vrotX(d1, d1, hf);
    const ax: V3 = [0, 0, 0];
    vcross(ax, d1, [0, 0, 1]);
    if (vlen(ax) < 0.15) vset(ax, -1, 0, 0);
    vnorm(ax, ax);
    const d2: V3 = [0, 0, 0];
    vrotAxis(d2, d1, ax, -kn);
    const K = vmadd([0, 0, 0], Hp, d1, L.thigh);
    const A = vmadd([0, 0, 0], K, d2, L.shin);
    return { K, A };
  };
  const aL = arm(1, J.shAbdL, J.shFwdL, J.elbowL);
  const aR = arm(-1, J.shAbdR, J.shFwdR, J.elbowR);
  const lL = leg(1, J.hipFwdL, J.hipAbdL, J.kneeL);
  const lR = leg(-1, J.hipFwdR, J.hipAbdR, J.kneeR);
  return [
    [pel[0], pel[1] + 0.04, pel[2]], chest, head,
    lL.K, lL.A, lR.K, lR.A,
    aL.E, aL.H, aR.E, aR.H,
  ];
}

// outfit por vértice (remera blanca / pantalón negro / zapas verdes)
export function paintOutfit(colors: Float32Array, remera: V3, pantalon: V3, zapas: V3, piel: V3): void {
  const meta = FIG.meta as number[];
  for (let i = 0; i < FIG.vc; i++) {
    const part = meta[i * 3];
    const t = meta[i * 3 + 1];
    let c: V3;
    if (part === 0) c = t < 0.92 ? remera : piel;            // torso (cuello piel)
    else if (part === 1 || part === 2) c = t < 0.30 ? remera : piel; // brazos: manga corta
    else if (part === 3 || part === 5) c = pantalon;          // piernas: pantalón largo
    else if (part === 4 || part === 6) c = zapas;             // pies: zapas
    else c = piel;                                            // cabeza
    colors[i * 4] = c[0];
    colors[i * 4 + 1] = c[1];
    colors[i * 4 + 2] = c[2];
    colors[i * 4 + 3] = 1;
  }
}
