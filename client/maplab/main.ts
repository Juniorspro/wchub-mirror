/// <reference types="vite/client" />
// ══════════════════════════════════════════════════════════════════════
// PATIO v2 — laboratorio de remodelación del patio del World Cup Hub.
// HTML aparte, escena propia desde cero: NO importa código del juego,
// solo las MISMAS texturas (pasto, madera, piedra, sprites). Cuando el
// layout convenza, se portan las coordenadas/constantes a world.ts.
//
// Layout: patio central de pasto (verde, abierto) + paseo de lajas en
// anillo + 10 tiendas con toldo a dos aguas RODEANDO el patio mirando
// hacia adentro + monumento con copa al centro + mástiles con banderas
// + banderines entre tiendas + portal de entrada al sur + robles y
// matas de pasto alrededor (billboards cruzados, mismo estilo del juego).
// ══════════════════════════════════════════════════════════════════════
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  GlowLayer,
  HemisphericLight,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
} from '@babylonjs/core';

// Mismas texturas del juego (imports directos para que el bundle del lab
// NO arrastre el catálogo completo de assets.ts — solo lo que usa).
import grassUrl from '../src/assets/sprite/sprite_ground-grass_1813ec.png';
import grassTuftUrl from '../src/assets/sprite/sprite_grass-tuft_665842.png';
import oakTreeUrl from '../src/assets/sprite/sprite_oak-tree_154b7e.png';
import flagstoneUrl from '../src/assets/sprite/sprite_tex-flagstone_14c15b.webp';
import woodPlanksUrl from '../src/assets/sprite/sprite_tex-wood-planks_656cc1.webp';
import cutStoneUrl from '../src/assets/sprite/sprite_tex-cut-stone_525147.webp';
import turfUrl from '../src/assets/sprite/sprite_stadium-turf_f0a345.png';
import crowdUrl from '../src/assets/sprite/sprite_stadium-crowd_1c49a4.png';
import bannerUrl from '../src/assets/bg/bg_poster-worldcup-banner_e92888.webp';
// carteles del juego original (covers de portales + lámina del mundial)
import coverCardsUrl from '../src/assets/sprite/sprite_portal-cover-cards_abc1fd.webp';
import coverDribblerUrl from '../src/assets/sprite/sprite_portal-cover-dribbler_3b541b.webp';
import coverGoalieUrl from '../src/assets/sprite/sprite_portal-cover-goalie_0695f6.webp';
import coverJugglerUrl from '../src/assets/sprite/sprite_portal-cover-juggler_fe5b6e.webp';
import coverRacingUrl from '../src/assets/sprite/sprite_portal-cover-racing_c7b1b5.webp';
import portraitUrl from '../src/assets/portrait/portrait_poster-worldcup-portrait_69e0b1.webp';
// el humanoide esculpido del viewer (figlab) porteado: malla por frame
import { FIG, buildFigure, J0, poseCartoon, poseSit, mixJoints, paintOutfit, decalPositions, type Joints } from './figura';

// ─── Constantes del layout (portables a world.ts) ───────────────────────
const RING_RADIUS = 17.5;        // radio del anillo de tiendas
const PROM_INNER = 13.8;         // paseo de lajas: borde interno
const PROM_OUTER = 21.4;         // paseo de lajas: borde externo
const GATE_ANGLE = -Math.PI / 2; // entrada al sur (-Z)
const GATE_HALF_GAP = 0.30;      // medio-hueco angular del portal (rad)
const FLAG_RADIUS = 6.5;         // mástiles alrededor del monumento
const GROUND_SIZE = 300;
// POIs fuera del anillo (los caminitos salen por los huecos entre tiendas)
const CANCHA = { x: 44, z: -5 };      // este — cancha de práctica 18×26
const COPAS = { x: 20.5, z: 32 };     // noreste — sector de copas + podio
const MUNECO = { x: -31.7, z: -4.3 }; // oeste — el muñeco (mascota fan #1)
// Estadio al norte (mitad de escala del juego: oval 1.4, portón al sur)
const ESTADIO = { x: 0, z: 68 };
const EST_B = 26;                  // semieje z (el juego: 52.5)
const EST_A = EST_B * 1.4;         // semieje x (mismo ratio oval)
const EST_WALL_H = 15;             // alto de pared (el juego: 26)
// Cerca perimetral del parque (como buildParkFence del juego)
const FENCE = { x0: -52, z0: -44, x1: 58, z1: 98 };

interface TiendaDef {
  id: string;
  nombre: string;
  rubro: string;
  color: string;
}

// Las 7 tiendas REALES del juego (STALL_LAYOUT de entities.ts) — nada inventado.
const TIENDAS: TiendaDef[] = [
  { id: 'shirts',    nombre: "Sasha's Shirts",   rubro: 'SHIRTS & JERSEYS', color: '#c14444' },
  { id: 'pants',     nombre: 'Pants Pavilion',   rubro: 'PANTS & SHORTS',   color: '#3a6ea5' },
  { id: 'shoes',     nombre: 'Sneaker Stand',    rubro: 'SHOES',            color: '#e8c84a' },
  { id: 'hats',      nombre: 'The Hattery',      rubro: 'HATS',             color: '#9bd96b' },
  { id: 'glasses',   nombre: 'Glasses + Bags',   rubro: 'GLASSES & BAGS',   color: '#d96bc4' },
  { id: 'scarves',   nombre: 'Cozy Scarves',     rubro: 'SCARVES',          color: '#e89c4a' },
  { id: 'customize', nombre: 'The Design Bench', rubro: 'DESIGN YOUR OWN',  color: '#a85dd9' },
];

// Banderas simplificadas (franjas pintadas a mano en DynamicTexture).
type FlagPaint = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
const FLAGS: Array<{ id: string; paint: FlagPaint }> = [
  { id: 'ar', paint: (c, w, h) => { c.fillStyle = '#74acdf'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.fillRect(0, h / 3, w, h / 3); c.fillStyle = '#f6b40e'; c.beginPath(); c.arc(w / 2, h / 2, h / 9, 0, 7); c.fill(); } },
  { id: 'br', paint: (c, w, h) => { c.fillStyle = '#009c3b'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffdf00'; c.beginPath(); c.moveTo(w / 2, h * 0.12); c.lineTo(w * 0.88, h / 2); c.lineTo(w / 2, h * 0.88); c.lineTo(w * 0.12, h / 2); c.fill(); c.fillStyle = '#002776'; c.beginPath(); c.arc(w / 2, h / 2, h / 5.4, 0, 7); c.fill(); } },
  { id: 'de', paint: (c, w, h) => { c.fillStyle = '#000'; c.fillRect(0, 0, w, h / 3); c.fillStyle = '#dd0000'; c.fillRect(0, h / 3, w, h / 3); c.fillStyle = '#ffce00'; c.fillRect(0, 2 * h / 3, w, h / 3); } },
  { id: 'fr', paint: (c, w, h) => { c.fillStyle = '#0055a4'; c.fillRect(0, 0, w / 3, h); c.fillStyle = '#fff'; c.fillRect(w / 3, 0, w / 3, h); c.fillStyle = '#ef4135'; c.fillRect(2 * w / 3, 0, w / 3, h); } },
  { id: 'it', paint: (c, w, h) => { c.fillStyle = '#009246'; c.fillRect(0, 0, w / 3, h); c.fillStyle = '#fff'; c.fillRect(w / 3, 0, w / 3, h); c.fillStyle = '#ce2b37'; c.fillRect(2 * w / 3, 0, w / 3, h); } },
  { id: 'es', paint: (c, w, h) => { c.fillStyle = '#aa151b'; c.fillRect(0, 0, w, h); c.fillStyle = '#f1bf00'; c.fillRect(0, h / 4, w, h / 2); } },
  { id: 'uy', paint: (c, w, h) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#0038a8'; for (let i = 1; i < 9; i += 2) c.fillRect(0, (i * h) / 9, w, h / 9); c.fillStyle = '#fff'; c.fillRect(0, 0, w / 2.6, h / 2.05); c.fillStyle = '#f6b40e'; c.beginPath(); c.arc(w / 5.2, h / 4.1, h / 8, 0, 7); c.fill(); } },
  { id: 'mx', paint: (c, w, h) => { c.fillStyle = '#006847'; c.fillRect(0, 0, w / 3, h); c.fillStyle = '#fff'; c.fillRect(w / 3, 0, w / 3, h); c.fillStyle = '#ce1126'; c.fillRect(2 * w / 3, 0, w / 3, h); c.fillStyle = '#8c6239'; c.beginPath(); c.arc(w / 2, h / 2, h / 10, 0, 7); c.fill(); } },
];

// RNG determinista (mulberry32) — el deco queda igual en cada carga.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stdMat(scene: Scene, name: string, hex: string, emissiveHex?: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.06, 0.06, 0.06);
  if (emissiveHex) m.emissiveColor = Color3.FromHexString(emissiveHex);
  return m;
}

function texMat(scene: Scene, name: string, url: string, repeat: number, tintHex = '#ffffff'): StandardMaterial {
  const m = stdMat(scene, name, tintHex);
  const t = new Texture(url, scene);
  t.uScale = repeat;
  t.vScale = repeat;
  t.anisotropicFilteringLevel = 4;
  m.diffuseTexture = t;
  return m;
}

// Material neón: emissive puro sin iluminación — el GlowLayer lo hace brillar.
function neonMat(scene: Scene, name: string, hex: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.emissiveColor = Color3.FromHexString(hex);
  m.diffuseColor = Color3.Black();
  m.specularColor = Color3.Black();
  m.disableLighting = true;
  return m;
}

// Ícono 3D neón por rubro, flotando sobre el toldo (gira + rebota).
interface Spinner { node: TransformNode; baseY: number; phase: number }
function buildNeonIcon(scene: Scene, id: string, spinners: Spinner[], parent: TransformNode, y: number): void {
  const root = new TransformNode(`icon-${id}`, scene);
  root.parent = parent;
  root.position.set(0, y, 0);
  const part = (mesh: Mesh, mat: StandardMaterial, x: number, py: number, z: number, rx = 0, ry = 0, rz = 0): Mesh => {
    mesh.parent = root;
    mesh.position.set(x, py, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  };
  const B = MeshBuilder;
  switch (id) {
    case 'hats': { // galera: ala + copa cónica + cinta
      const magenta = neonMat(scene, 'neon-hat', '#ff4dff');
      const cyan = neonMat(scene, 'neon-hat-band', '#4dfff0');
      part(B.CreateCylinder('i-brim', { diameter: 1.5, height: 0.09, tessellation: 28 }, scene), magenta, 0, 0, 0);
      part(B.CreateCylinder('i-crown', { diameterBottom: 0.92, diameterTop: 0.8, height: 0.85, tessellation: 24 }, scene), magenta, 0, 0.47, 0);
      part(B.CreateCylinder('i-band', { diameter: 0.95, height: 0.16, tessellation: 24 }, scene), cyan, 0, 0.17, 0);
      part(B.CreateCylinder('i-top', { diameter: 0.84, height: 0.05, tessellation: 24 }, scene), cyan, 0, 0.92, 0);
      root.rotation.z = 0.14; // canchereada
      break;
    }
    case 'glasses': { // dos aros + puente + patillas
      const cyan = neonMat(scene, 'neon-glasses', '#4dfff0');
      for (const sx of [-0.42, 0.42]) {
        part(B.CreateTorus('i-lens', { diameter: 0.62, thickness: 0.08, tessellation: 22 }, scene), cyan, sx, 0.3, 0, Math.PI / 2);
      }
      part(B.CreateBox('i-bridge', { width: 0.24, height: 0.07, depth: 0.07 }, scene), cyan, 0, 0.34, 0);
      for (const sx of [-0.72, 0.72]) {
        part(B.CreateBox('i-temple', { width: 0.07, height: 0.07, depth: 0.55 }, scene), cyan, sx, 0.34, -0.28);
      }
      break;
    }
    case 'shirts': { // camiseta: torso + mangas + cuello
      const red = neonMat(scene, 'neon-shirt', '#ff4d6d');
      const white = neonMat(scene, 'neon-shirt-trim', '#fff6e8');
      part(B.CreateBox('i-torso', { width: 0.85, height: 0.85, depth: 0.2 }, scene), red, 0, 0.2, 0);
      part(B.CreateBox('i-sleeve-l', { width: 0.4, height: 0.32, depth: 0.2 }, scene), red, -0.58, 0.5, 0, 0, 0, 0.45);
      part(B.CreateBox('i-sleeve-r', { width: 0.4, height: 0.32, depth: 0.2 }, scene), red, 0.58, 0.5, 0, 0, 0, -0.45);
      part(B.CreateBox('i-collar', { width: 0.34, height: 0.1, depth: 0.22 }, scene), white, 0, 0.68, 0);
      break;
    }
    case 'pants': { // cintura + dos piernas
      const blue = neonMat(scene, 'neon-pants', '#4dc9ff');
      part(B.CreateBox('i-waist', { width: 0.72, height: 0.26, depth: 0.22 }, scene), blue, 0, 0.78, 0);
      part(B.CreateBox('i-leg-l', { width: 0.3, height: 0.78, depth: 0.22 }, scene), blue, -0.21, 0.28, 0);
      part(B.CreateBox('i-leg-r', { width: 0.3, height: 0.78, depth: 0.22 }, scene), blue, 0.21, 0.28, 0);
      break;
    }
    case 'shoes': { // zapatilla: suela + cuerpo + puntera
      const yellow = neonMat(scene, 'neon-shoe', '#ffe44d');
      const white = neonMat(scene, 'neon-shoe-sole', '#fff6e8');
      part(B.CreateBox('i-sole', { width: 1.0, height: 0.14, depth: 0.4 }, scene), white, 0, 0.07, 0);
      part(B.CreateBox('i-body', { width: 0.62, height: 0.36, depth: 0.38 }, scene), yellow, -0.17, 0.32, 0);
      part(B.CreateSphere('i-toe', { diameter: 0.42, segments: 10 }, scene), yellow, 0.36, 0.22, 0).scaling.set(1.1, 0.7, 0.9);
      break;
    }
    case 'scarves': { // bufanda: aro al cuello + dos puntas colgando
      const orange = neonMat(scene, 'neon-scarf', '#ff9a4d');
      part(B.CreateTorus('i-loop', { diameter: 0.62, thickness: 0.14, tessellation: 22 }, scene), orange, 0, 0.62, 0);
      part(B.CreateBox('i-tail-1', { width: 0.22, height: 0.6, depth: 0.1 }, scene), orange, -0.12, 0.22, 0.24, 0, 0, 0.12);
      part(B.CreateBox('i-tail-2', { width: 0.22, height: 0.44, depth: 0.1 }, scene), orange, 0.16, 0.32, 0.24, 0, 0, -0.1);
      break;
    }
    case 'customize': { // pincel: mango + virola + punta
      const violet = neonMat(scene, 'neon-brush', '#b84dff');
      const white = neonMat(scene, 'neon-brush-tip', '#fff6e8');
      part(B.CreateCylinder('i-handle', { diameter: 0.12, height: 0.85, tessellation: 10 }, scene), violet, 0, 0.3, 0, 0, 0, 0.5);
      part(B.CreateCylinder('i-ferrule', { diameter: 0.16, height: 0.18, tessellation: 10 }, scene), white, 0.27, 0.76, 0, 0, 0, 0.5);
      part(B.CreateCylinder('i-tip', { diameterBottom: 0.15, diameterTop: 0.02, height: 0.3, tessellation: 10 }, scene), violet, 0.38, 0.95, 0, 0, 0, 0.5);
      break;
    }
    default:
      break; // las 7 tiendas reales están cubiertas arriba
  }
  spinners.push({ node: root, baseY: y, phase: Math.random() * Math.PI * 2 });
}

// Farol de caminito: poste de madera + cabeza cálida que brilla.
function buildLamp(scene: Scene, x: number, z: number, woodDarkMat: StandardMaterial, warmMat: StandardMaterial): void {
  const post = MeshBuilder.CreateCylinder('lamp-post', { diameter: 0.16, height: 3.4, tessellation: 8 }, scene);
  post.position.set(x, 1.7, z);
  post.material = woodDarkMat;
  post.isPickable = false;
  const head = MeshBuilder.CreateSphere('lamp-head', { diameter: 0.42, segments: 10 }, scene);
  head.position.set(x, 3.55, z);
  head.material = warmMat;
  head.isPickable = false;
}

// Caminito curvo de lajas (bezier cuadrática) + faroles alternados.
function buildCaminito(scene: Scene, p0: { x: number; z: number }, p1: { x: number; z: number },
  ctrlOffset: number, woodDarkMat: StandardMaterial, warmMat: StandardMaterial, halfWidth = 1.3): void {
  const mx = (p0.x + p1.x) / 2;
  const mz = (p0.z + p1.z) / 2;
  const dx = p1.x - p0.x;
  const dz = p1.z - p0.z;
  const len = Math.hypot(dx, dz) || 1;
  const cx = mx + (-dz / len) * ctrlOffset;
  const cz = mz + (dx / len) * ctrlOffset;
  const HALF = halfWidth;
  const N = 24;
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * cx + t * t * p1.x;
    const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * cz + t * t * p1.z;
    const tx = 2 * (1 - t) * (cx - p0.x) + 2 * t * (p1.x - cx);
    const tz = 2 * (1 - t) * (cz - p0.z) + 2 * t * (p1.z - cz);
    const tl = Math.hypot(tx, tz) || 1;
    left.push(new Vector3(x - (tz / tl) * HALF, 0.022, z + (tx / tl) * HALF));
    right.push(new Vector3(x + (tz / tl) * HALF, 0.022, z - (tx / tl) * HALF));
  }
  const rib = MeshBuilder.CreateRibbon('caminito', { pathArray: [left, right] }, scene);
  const mat = stdMat(scene, `caminito-mat-${p1.x}-${p1.z}`, '#ffffff');
  const tex = new Texture(flagstoneUrl, scene);
  tex.uScale = Math.max(2, Math.round(len / 3.2));
  tex.vScale = 1;
  tex.anisotropicFilteringLevel = 8;
  mat.diffuseTexture = tex;
  mat.backFaceCulling = false;
  rib.material = mat;
  rib.isPickable = false;
  // faroles a los costados, alternados
  for (const [t, side] of [[0.35, 1], [0.7, -1]] as const) {
    const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * cx + t * t * p1.x;
    const z = (1 - t) * (1 - t) * p0.z + 2 * (1 - t) * t * cz + t * t * p1.z;
    const tx = 2 * (1 - t) * (cx - p0.x) + 2 * t * (p1.x - cx);
    const tz = 2 * (1 - t) * (cz - p0.z) + 2 * t * (p1.z - cz);
    const tl = Math.hypot(tx, tz) || 1;
    buildLamp(scene, x - (tz / tl) * (HALF + 0.9) * side, z + (tx / tl) * (HALF + 0.9) * side, woodDarkMat, warmMat);
  }
}

// Cancha de práctica: césped de estadio + líneas + arcos + banderines.
function buildCancha(scene: Scene, cx: number, cz: number, woodMat: StandardMaterial, woodDarkMat: StandardMaterial): void {
  const W = 18;
  const D = 26;
  const turfMat = stdMat(scene, 'turf-mat', '#ffffff');
  const turfTex = new Texture(turfUrl, scene);
  turfTex.uScale = 5;
  turfTex.vScale = 7;
  turfTex.anisotropicFilteringLevel = 8;
  turfMat.diffuseTexture = turfTex;
  const pitch = MeshBuilder.CreateBox('cancha', { width: W, height: 0.06, depth: D }, scene);
  pitch.position.set(cx, 0.03, cz);
  pitch.material = turfMat;
  pitch.isPickable = false;

  const lineMat = stdMat(scene, 'cancha-line', '#f4f4ee', '#3a3a38');
  const line = (w: number, d: number, dx: number, dz: number): void => {
    const l = MeshBuilder.CreateBox('cancha-l', { width: w, height: 0.03, depth: d }, scene);
    l.position.set(cx + dx, 0.075, cz + dz);
    l.material = lineMat;
    l.isPickable = false;
  };
  line(W, 0.2, 0, D / 2);    // fondo norte
  line(W, 0.2, 0, -D / 2);   // fondo sur
  line(0.2, D, W / 2, 0);    // lateral este
  line(0.2, D, -W / 2, 0);   // lateral oeste
  line(W, 0.18, 0, 0);       // mitad de cancha
  // áreas penales (7.3 × 2.75 en cada fondo)
  for (const sign of [1, -1] as const) {
    line(7.3, 0.16, 0, sign * (D / 2 - 2.75));
    line(0.16, 2.75, 3.65, sign * (D / 2 - 1.375));
    line(0.16, 2.75, -3.65, sign * (D / 2 - 1.375));
  }
  const circle = MeshBuilder.CreateTorus('cancha-circle', { diameter: 5, thickness: 0.18, tessellation: 32 }, scene);
  circle.position.set(cx, 0.07, cz);
  circle.material = lineMat;
  circle.isPickable = false;

  // arcos procedurales (mismas proporciones que el juego)
  const goalMat = stdMat(scene, 'cancha-goal', '#f4f4ee');
  for (const sign of [1, -1] as const) {
    const gz = cz + sign * (D / 2 + 0.4);
    const bar = MeshBuilder.CreateBox('goal-bar', { width: 5, height: 0.15, depth: 0.15 }, scene);
    bar.position.set(cx, 2.2, gz);
    bar.material = goalMat;
    const barB = MeshBuilder.CreateBox('goal-bar-b', { width: 5, height: 0.12, depth: 0.12 }, scene);
    barB.position.set(cx, 2.2, gz + sign * 1.0);
    barB.material = goalMat;
    for (const px of [-2.4, 2.4]) {
      for (const [bz, dia] of [[0, 0.18], [sign * 1.0, 0.15]] as const) {
        const post = MeshBuilder.CreateCylinder('goal-post', { height: 2.3, diameter: dia, tessellation: 8 }, scene);
        post.position.set(cx + px, 1.15, gz + bz);
        post.material = goalMat;
      }
    }
  }

  // pelota al centro: blanca con parches negros
  const ballMat = stdMat(scene, 'cancha-ball', '#f4f4ee');
  const patchMat = stdMat(scene, 'cancha-ball-patch', '#1a1a1d');
  const ball = MeshBuilder.CreateSphere('cancha-ball', { diameter: 0.55, segments: 14 }, scene);
  ball.position.set(cx + 1.2, 0.34, cz - 1.5);
  ball.material = ballMat;
  for (const [lon, lat] of [[0, 0.2], [2.1, 0.5], [-2.1, 0.5], [Math.PI, 0.1], [1.0, -0.6]] as const) {
    const patch = MeshBuilder.CreateDisc('ball-patch', { radius: 0.085, tessellation: 6 }, scene);
    const r = 0.28;
    const px = ball.position.x + Math.cos(lat) * Math.cos(lon) * r;
    const py = ball.position.y + Math.sin(lat) * r;
    const pz = ball.position.z + Math.cos(lat) * Math.sin(lon) * r;
    patch.position.set(px, py, pz);
    patch.lookAt(new Vector3(
      ball.position.x + (px - ball.position.x) * 100,
      ball.position.y + (py - ball.position.y) * 100,
      ball.position.z + (pz - ball.position.z) * 100,
    ));
    patch.material = patchMat;
    patch.isPickable = false;
  }

  // banderines de córner neón + banco de suplentes
  const cornerMat = neonMat(scene, 'corner-flag', '#ff4d6d');
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const pole = MeshBuilder.CreateCylinder('corner-pole', { diameter: 0.06, height: 1.5, tessellation: 6 }, scene);
    pole.position.set(cx + sx * (W / 2), 0.75, cz + sz * (D / 2));
    pole.material = goalMat;
    pole.isPickable = false;
    const tri = new Mesh('corner-tri', scene);
    const vd = new VertexData();
    vd.positions = [0, 0, 0, 0.42, -0.1, 0, 0, -0.28, 0];
    vd.indices = [0, 1, 2];
    vd.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1];
    vd.applyToMesh(tri);
    tri.position.set(cx + sx * (W / 2), 1.48, cz + sz * (D / 2));
    tri.rotation.y = Math.atan2(-sx, -sz);
    tri.material = cornerMat;
    tri.isPickable = false;
  }
  for (const bz of [-3.5, 3.5]) {
    BENCHES.push({ x: cx - W / 2 - 1.6, z: cz + bz, yaw: Math.PI / 2 });
    const seat = MeshBuilder.CreateBox('cancha-bench', { width: 0.5, height: 0.1, depth: 2.4 }, scene);
    seat.position.set(cx - W / 2 - 1.6, 0.45, cz + bz);
    seat.material = woodMat;
    seat.isPickable = false;
    for (const lz of [-0.9, 0.9]) {
      const leg = MeshBuilder.CreateBox('cancha-bench-leg', { width: 0.42, height: 0.45, depth: 0.12 }, scene);
      leg.position.set(cx - W / 2 - 1.6, 0.22, cz + bz + lz);
      leg.material = woodDarkMat;
      leg.isPickable = false;
    }
  }
}

// El muñeco: mascota fan (cuerpo bola de nieve + cabeza pelota) mejorada.
function buildMuneco(scene: Scene, cx: number, cz: number, stoneMat: StandardMaterial,
  spinners: Spinner[]): void {
  const white = stdMat(scene, 'mu-white', '#f4f4f2');
  const dark = stdMat(scene, 'mu-dark', '#1a1a1d');
  const red = stdMat(scene, 'mu-red', '#c14444');
  const gold = stdMat(scene, 'mu-gold', '#e8c84a');

  // plataforma de lajas + pedestal de piedra de 2 tambores + placa
  const disc = MeshBuilder.CreateDisc('mu-disc', { radius: 4.2, tessellation: 36 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(cx, 0.025, cz);
  const discMat = stdMat(scene, 'mu-disc-mat', '#ffffff');
  const discTex = new Texture(flagstoneUrl, scene);
  discTex.uScale = 3;
  discTex.vScale = 3;
  discMat.diffuseTexture = discTex;
  disc.material = discMat;
  disc.isPickable = false;
  const ped1 = MeshBuilder.CreateCylinder('mu-ped1', { height: 0.6, diameter: 3.4, tessellation: 24 }, scene);
  ped1.position.set(cx, 0.3, cz);
  ped1.material = stoneMat;
  const ped2 = MeshBuilder.CreateCylinder('mu-ped2', { height: 0.5, diameter: 2.8, tessellation: 24 }, scene);
  ped2.position.set(cx, 0.85, cz);
  ped2.material = dark;
  const plaque = MeshBuilder.CreateBox('mu-plaque', { width: 1.5, height: 0.5, depth: 0.1 }, scene);
  plaque.position.set(cx, 0.55, cz - 1.45);
  plaque.material = gold;

  // cuerpo bola de nieve + botones + faja
  const body = MeshBuilder.CreateSphere('mu-body', { diameter: 2.0, segments: 16 }, scene);
  body.position.set(cx, 2.4, cz);
  body.scaling.set(0.95, 1.1, 0.95);
  body.material = white;
  for (let i = 0; i < 3; i++) {
    const btn = MeshBuilder.CreateSphere('mu-btn', { diameter: 0.16, segments: 8 }, scene);
    btn.position.set(cx, 2.0 + i * 0.45, cz - (0.93 - Math.abs(i - 1) * 0.06));
    btn.material = dark;
  }
  const sash = MeshBuilder.CreateBox('mu-sash', { width: 2.0, height: 0.35, depth: 0.05 }, scene);
  sash.position.set(cx, 2.45, cz - 0.95);
  sash.rotation.z = 0.3;
  sash.material = red;

  // bufanda al cuello + cola colgando
  const scarf = MeshBuilder.CreateTorus('mu-scarf', { diameter: 1.15, thickness: 0.22, tessellation: 20 }, scene);
  scarf.position.set(cx, 3.32, cz);
  scarf.material = red;
  const scarfTail = MeshBuilder.CreateBox('mu-scarf-tail', { width: 0.34, height: 0.8, depth: 0.1 }, scene);
  scarfTail.position.set(cx + 0.45, 3.0, cz - 0.55);
  scarfTail.rotation.z = 0.15;
  scarfTail.material = red;

  // cabeza pelota: esfera blanca + hexágonos negros + ojos + sonrisa
  const head = MeshBuilder.CreateSphere('mu-head', { diameter: 1.6, segments: 18 }, scene);
  head.position.set(cx, 4.15, cz);
  head.material = white;
  for (const [lon, lat] of [[0.7, 0.25], [-0.7, 0.45], [Math.PI, 0], [2.2, -0.15], [0, 0.85]] as const) {
    const hex = MeshBuilder.CreateDisc('mu-hex', { radius: 0.22, tessellation: 6 }, scene);
    const r = 0.83;
    const px = cx + Math.cos(lat) * Math.cos(lon) * r;
    const py = 4.15 + Math.sin(lat) * r;
    const pz = cz + Math.cos(lat) * Math.sin(lon) * r;
    hex.position.set(px, py, pz);
    hex.lookAt(new Vector3(cx + (px - cx) * 100, 4.15 + (py - 4.15) * 100, cz + (pz - cz) * 100));
    hex.material = dark;
    hex.isPickable = false;
  }
  for (const sign of [-1, 1] as const) {
    const eyeW = MeshBuilder.CreateSphere('mu-eye-w', { diameter: 0.4, segments: 10 }, scene);
    eyeW.position.set(cx + sign * 0.28, 4.3, cz - 0.6);
    eyeW.material = white;
    const pupil = MeshBuilder.CreateSphere('mu-eye-p', { diameter: 0.18, segments: 8 }, scene);
    pupil.position.set(cx + sign * 0.28, 4.3, cz - 0.75);
    pupil.material = dark;
  }
  for (let i = 0; i < 5; i++) { // sonrisa: arco de bolitas
    const a = -0.5 + (i / 4) * 1.0;
    const sm = MeshBuilder.CreateSphere('mu-smile', { diameter: 0.09, segments: 6 }, scene);
    sm.position.set(cx + Math.sin(a) * 0.42, 3.92 - Math.cos(a) * 0.12 + 0.12, cz - 0.72);
    sm.material = dark;
  }

  // brazos en "¡vamos!" + guantes rojos
  for (const sign of [-1, 1] as const) {
    const arm = MeshBuilder.CreateCylinder('mu-arm', { height: 1.2, diameter: 0.35, tessellation: 10 }, scene);
    arm.position.set(cx + sign * 1.0, 3.1, cz);
    arm.rotation.z = -sign * 0.7;
    arm.material = white;
    const glove = MeshBuilder.CreateSphere('mu-glove', { diameter: 0.5, segments: 10 }, scene);
    glove.position.set(cx + sign * (1.0 + Math.sin(0.7) * 0.6), 3.1 + Math.cos(0.7) * 0.6, cz);
    glove.material = red;
  }

  // halo neón girando sobre la cabeza
  const halo = new TransformNode('mu-halo-root', scene);
  halo.position.set(cx, 0, cz);
  const ring = MeshBuilder.CreateTorus('mu-halo', { diameter: 1.3, thickness: 0.07, tessellation: 26 }, scene);
  ring.parent = halo;
  ring.position.y = 5.35;
  ring.material = neonMat(scene, 'mu-halo-mat', '#4dfff0');
  ring.isPickable = false;
  spinners.push({ node: halo, baseY: 0, phase: 1.3 });

  // cartel pintado al pie
  const nameTex = new DynamicTexture('mu-name', { width: 512, height: 128 }, scene, true);
  const nc = nameTex.getContext() as unknown as CanvasRenderingContext2D;
  nc.fillStyle = '#28406b';
  nc.fillRect(0, 0, 512, 128);
  nc.strokeStyle = '#e8c84a';
  nc.lineWidth = 8;
  nc.strokeRect(4, 4, 504, 120);
  nc.fillStyle = '#f3ecd9';
  nc.textAlign = 'center';
  nc.textBaseline = 'middle';
  nc.font = 'bold 56px ui-monospace, monospace';
  nc.fillText('EL MUÑECO · FAN N°1', 256, 64, 480);
  nameTex.update();
  const nameMat = new StandardMaterial('mu-name-mat', scene);
  nameMat.diffuseTexture = nameTex;
  nameMat.emissiveTexture = nameTex;
  nameMat.emissiveColor = new Color3(0.5, 0.5, 0.5);
  nameMat.specularColor = new Color3(0, 0, 0);
  const namePlane = MeshBuilder.CreatePlane('mu-name-plane', { width: 2.6, height: 0.65 }, scene);
  namePlane.position.set(cx, 1.6, cz - 1.5);
  namePlane.material = nameMat;
  namePlane.isPickable = false;
}

// Sector de copas: copa gigante + 4 mini copas + podio 1-2-3 + estrella neón.
function buildCopas(scene: Scene, cx: number, cz: number, stoneMat: StandardMaterial,
  spinners: Spinner[]): void {
  const gold = stdMat(scene, 'cp-gold', '#e8c84a');
  gold.specularColor = new Color3(0.9, 0.75, 0.3);
  gold.specularPower = 64;
  const silver = stdMat(scene, 'cp-silver', '#c8c8d0');
  silver.specularColor = new Color3(0.7, 0.7, 0.75);
  const charcoal = stdMat(scene, 'cp-charcoal', '#3a3a40');

  // plataforma de lajas
  const disc = MeshBuilder.CreateDisc('cp-disc', { radius: 7, tessellation: 40 }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(cx, 0.025, cz);
  const discMat = stdMat(scene, 'cp-disc-mat', '#ffffff');
  const discTex = new Texture(flagstoneUrl, scene);
  discTex.uScale = 5;
  discTex.vScale = 5;
  discMat.diffuseTexture = discTex;
  disc.material = discMat;
  disc.isPickable = false;

  // copa gigante central sobre pedestal de 2 niveles
  const trophy = (px: number, pz: number, scale: number, mat: StandardMaterial, pedH: number): void => {
    const ped = MeshBuilder.CreateCylinder('cp-ped', { height: pedH, diameterTop: 1.4 * scale, diameterBottom: 1.6 * scale, tessellation: 20 }, scene);
    ped.position.set(px, pedH / 2, pz);
    ped.material = stoneMat;
    const baseY = pedH;
    const ring = MeshBuilder.CreateCylinder('cp-ring', { height: 0.18 * scale, diameter: 0.95 * scale, tessellation: 16 }, scene);
    ring.position.set(px, baseY + 0.09 * scale, pz);
    ring.material = mat;
    const stem = MeshBuilder.CreateCylinder('cp-stem', { height: 0.6 * scale, diameter: 0.4 * scale, tessellation: 16 }, scene);
    stem.position.set(px, baseY + 0.45 * scale, pz);
    stem.material = mat;
    const cup = MeshBuilder.CreateCylinder('cp-cup', { height: 1.2 * scale, diameterTop: 1.3 * scale, diameterBottom: 0.7 * scale, tessellation: 20 }, scene);
    cup.position.set(px, baseY + 1.35 * scale, pz);
    cup.material = mat;
    for (const sign of [-1, 1] as const) {
      const handle = MeshBuilder.CreateTorus('cp-handle', { diameter: 0.55 * scale, thickness: 0.1 * scale, tessellation: 14 }, scene);
      handle.position.set(px + sign * 0.75 * scale, baseY + 1.35 * scale, pz);
      handle.rotation.z = Math.PI / 2;
      handle.material = mat;
    }
    const rim = MeshBuilder.CreateTorus('cp-rim', { diameter: 1.3 * scale, thickness: 0.08 * scale, tessellation: 20 }, scene);
    rim.position.set(px, baseY + 1.95 * scale, pz);
    rim.material = mat;
  };
  trophy(cx, cz, 1.35, gold, 1.8);
  for (const [dx, dz] of [[3.8, 1.5], [-3.8, 1.5], [2.6, -3.4], [-2.6, -3.4]] as const) {
    trophy(cx + dx, cz + dz, 0.62, silver, 0.9);
  }

  // podio 1-2-3 al frente (lado sur, hacia el caminito)
  const podiumSpec: Array<[number, number, string]> = [[0, 1.0, '1'], [-1.5, 0.7, '2'], [1.5, 0.5, '3']];
  for (const [dx, h, num] of podiumSpec) {
    const box = MeshBuilder.CreateBox(`cp-pod-${num}`, { width: 1.4, height: h, depth: 1.4 }, scene);
    box.position.set(cx + dx, h / 2, cz - 5.6);
    box.material = charcoal;
    const numTex = new DynamicTexture(`cp-num-${num}`, { width: 128, height: 128 }, scene, true);
    const c = numTex.getContext() as unknown as CanvasRenderingContext2D;
    c.fillStyle = '#3a3a40';
    c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#e8c84a';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = 'bold 88px ui-monospace, monospace';
    c.fillText(num, 64, 68);
    numTex.update();
    const numMat = new StandardMaterial(`cp-num-mat-${num}`, scene);
    numMat.diffuseTexture = numTex;
    numMat.emissiveTexture = numTex;
    numMat.emissiveColor = new Color3(0.45, 0.45, 0.45);
    numMat.specularColor = new Color3(0, 0, 0);
    const face = MeshBuilder.CreatePlane(`cp-face-${num}`, { width: 1.1, height: Math.min(h - 0.1, 0.9) }, scene);
    face.position.set(cx + dx, h / 2, cz - 5.6 - 0.71);
    face.material = numMat;
    face.isPickable = false;
  }

  // cerquita de postes + soga alrededor (deja abierta la entrada sur)
  const ropeMat = stdMat(scene, 'cp-rope', '#8a2b2b');
  const postPts: Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    // arco de 300° abierto al sur (gap 240°→300° donde están podio y caminito)
    const a = -Math.PI / 3 + (i / 8) * Math.PI * (5 / 3);
    const px = cx + Math.cos(a) * 6.6;
    const pz = cz + Math.sin(a) * 6.6;
    const post = MeshBuilder.CreateCylinder('cp-post', { diameter: 0.18, height: 0.8, tessellation: 8 }, scene);
    post.position.set(px, 0.4, pz);
    post.material = stoneMat;
    post.isPickable = false;
    postPts.push(new Vector3(px, 0.62, pz));
  }
  for (let i = 0; i < postPts.length - 1; i++) {
    const a = postPts[i];
    const b = postPts[i + 1];
    const segLen = Vector3.Distance(a, b);
    const rope = MeshBuilder.CreateCylinder('cp-rope-seg', { diameter: 0.06, height: segLen, tessellation: 6 }, scene);
    rope.position.copyFrom(a.add(b).scale(0.5));
    rope.position.y -= 0.06; // pancita
    const dir = b.subtract(a);
    rope.rotation.y = Math.atan2(dir.x, dir.z);
    rope.rotation.x = Math.PI / 2;
    rope.material = ropeMat;
    rope.isPickable = false;
  }

  // estrella neón girando sobre la copa grande
  const starRoot = new TransformNode('cp-star-root', scene);
  starRoot.position.set(cx, 0, cz);
  const starTex = new DynamicTexture('cp-star-tex', { width: 128, height: 128 }, scene, true);
  const sc = starTex.getContext() as unknown as CanvasRenderingContext2D;
  sc.clearRect(0, 0, 128, 128);
  sc.fillStyle = '#ffe44d';
  sc.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 58 : 24;
    sc.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  sc.closePath();
  sc.fill();
  starTex.update();
  starTex.hasAlpha = true;
  const starMat = new StandardMaterial('cp-star-mat', scene);
  starMat.diffuseTexture = starTex;
  starMat.emissiveTexture = starTex;
  starMat.emissiveColor = new Color3(1, 1, 1);
  starMat.useAlphaFromDiffuseTexture = true;
  starMat.disableLighting = true;
  starMat.backFaceCulling = false;
  const star = MeshBuilder.CreatePlane('cp-star', { width: 1.5, height: 1.5 }, scene);
  star.parent = starRoot;
  star.position.y = 6.4;
  star.material = starMat;
  star.isPickable = false;
  spinners.push({ node: starRoot, baseY: 0, phase: 2.6 });
}

// Cerca perimetral del parque: 4 rieles + postes cada 8u (buildParkFence).
function buildCerca(scene: Scene): void {
  const railMat = stdMat(scene, 'fence-rail-mat', '#8a6435');
  const postMat = stdMat(scene, 'fence-post-mat', '#6b4e26');
  const { x0, z0, x1, z1 } = FENCE;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const xLen = x1 - x0;
  const zLen = z1 - z0;
  const rail = (w: number, d: number, px: number, pz: number): void => {
    const r = MeshBuilder.CreateBox('fence-rail', { width: w, height: 1.1, depth: d }, scene);
    r.position.set(px, 0.55, pz);
    r.material = railMat;
    r.isPickable = false;
  };
  rail(xLen, 0.18, cx, z0);
  rail(xLen, 0.18, cx, z1);
  rail(0.18, zLen, x0, cz);
  rail(0.18, zLen, x1, cz);
  for (let x = x0; x <= x1; x += 8) {
    for (const z of [z0, z1]) {
      const p = MeshBuilder.CreateBox('fence-post', { width: 0.32, height: 1.4, depth: 0.32 }, scene);
      p.position.set(x, 0.7, z);
      p.material = postMat;
      p.isPickable = false;
    }
  }
  for (let z = z0; z <= z1; z += 8) {
    for (const x of [x0, x1]) {
      const p = MeshBuilder.CreateBox('fence-post', { width: 0.32, height: 1.4, depth: 0.32 }, scene);
      p.position.set(x, 0.7, z);
      p.material = postMat;
      p.isPickable = false;
    }
  }
}

// Estadio del juego a media escala: oval con portón al sur, tribunas
// escalonadas, anillo de público, techo con borde dorado, pilares y
// cartel REZONA WORLD CUP al frente (misma receta que buildStadium).
function buildEstadio(scene: Scene): void {
  const cx = ESTADIO.x;
  const cz = ESTADIO.z;
  const ax = EST_A;
  const bz = EST_B;
  const beige = stdMat(scene, 'est-beige', '#d8c4a5');
  const gray = stdMat(scene, 'est-gray', '#8a8a86');
  const white = stdMat(scene, 'est-white', '#ededea');
  const seat = stdMat(scene, 'est-seat', '#5a4030');
  const roofM = stdMat(scene, 'est-roof', '#aeb1b4');
  const goldTrim = stdMat(scene, 'est-gold', '#e6c34a');

  // piso de césped interior (asoma por el portón)
  const turfMat = stdMat(scene, 'est-turf', '#ffffff');
  const turfTex = new Texture(turfUrl, scene);
  turfTex.uScale = 8;
  turfTex.vScale = 8;
  turfMat.diffuseTexture = turfTex;
  const floor = MeshBuilder.CreateDisc('est-floor', { radius: 1, tessellation: 56 }, scene);
  floor.rotation.x = Math.PI / 2;
  floor.scaling.set(ax - 7, bz - 7, 1);
  floor.position.set(cx, 0.02, cz);
  floor.material = turfMat;
  floor.isPickable = false;

  // pared en DOS ribbons: la inferior con corte de portón al sur, la
  // superior cerrada (sin "ventana de cielo" sobre el dintel)
  const GATE_H = 4.6;
  const GATE_HALF_ANGLE = 0.14;
  const SEGS = 56;
  const aStart = -Math.PI / 2 + GATE_HALF_ANGLE;
  const aEnd = -Math.PI / 2 + Math.PI * 2 - GATE_HALF_ANGLE;
  const ring = (radA: number, radB: number, yLo: number, yHi: number, closed: boolean, mat: StandardMaterial, name: string): void => {
    const lo: Vector3[] = [];
    const hi: Vector3[] = [];
    for (let i = 0; i <= SEGS; i++) {
      const t = i / SEGS;
      const a = closed ? t * Math.PI * 2 : aStart + (aEnd - aStart) * t;
      const x = cx + radA * Math.cos(a);
      const z = cz + radB * Math.sin(a);
      lo.push(new Vector3(x, yLo, z));
      hi.push(new Vector3(x, yHi, z));
    }
    const rib = MeshBuilder.CreateRibbon(name, {
      pathArray: [lo, hi], sideOrientation: Mesh.DOUBLESIDE, closeArray: false, closePath: closed,
    }, scene);
    rib.material = mat;
    rib.isPickable = false;
  };
  ring(ax, bz, 0, GATE_H, false, beige, 'est-wall-lo');
  ring(ax, bz, GATE_H, EST_WALL_H, true, beige, 'est-wall-hi');

  // tribunas: 4 niveles que suben hacia afuera (riser + estante)
  const TIERS = 4;
  const RISE = 1.5;
  const INSET = 1.5;
  const inA = ax - TIERS * INSET;
  const inB = bz - TIERS * INSET;
  for (let tier = 0; tier < TIERS; tier++) {
    const yLo = tier * RISE;
    const yHi = yLo + RISE;
    const tIn = tier / TIERS;
    const tOut = (tier + 1) / TIERS;
    const iA = inA + (ax - inA) * tIn;
    const iB = inB + (bz - inB) * tIn;
    const oA = inA + (ax - inA) * tOut;
    const oB = inB + (bz - inB) * tOut;
    ring(iA, iB, yLo, yHi, false, seat, `est-riser-${tier}`);
    // estante horizontal del nivel
    const shIn: Vector3[] = [];
    const shOut: Vector3[] = [];
    for (let i = 0; i <= SEGS; i++) {
      const t = i / SEGS;
      const a = aStart + (aEnd - aStart) * t;
      shIn.push(new Vector3(cx + iA * Math.cos(a), yHi, cz + iB * Math.sin(a)));
      shOut.push(new Vector3(cx + oA * Math.cos(a), yHi, cz + oB * Math.sin(a)));
    }
    const shelf = MeshBuilder.CreateRibbon(`est-shelf-${tier}`, {
      pathArray: [shIn, shOut], sideOrientation: Mesh.DOUBLESIDE, closeArray: false, closePath: false,
    }, scene);
    shelf.material = gray;
    shelf.isPickable = false;
    // tapas laterales en el corte del portón (perfil escalonado)
    for (const a of [aStart, aEnd]) {
      const xi = cx + iA * Math.cos(a);
      const zi = cz + iB * Math.sin(a);
      const xo = cx + oA * Math.cos(a);
      const zo = cz + oB * Math.sin(a);
      const cap = MeshBuilder.CreateRibbon(`est-cap-${tier}`, {
        pathArray: [
          [new Vector3(xi, 0, zi), new Vector3(xo, 0, zo)],
          [new Vector3(xi, yHi, zi), new Vector3(xo, yHi, zo)],
        ],
        sideOrientation: Mesh.DOUBLESIDE, closeArray: false, closePath: false,
      }, scene);
      cap.material = seat;
      cap.isPickable = false;
    }
  }

  // anillo de público (textura del juego) entre tribunas y techo
  const crowdMat = new StandardMaterial('est-crowd', scene);
  const crowdTex = new Texture(crowdUrl, scene);
  crowdTex.uScale = 12;
  crowdTex.vScale = 1;
  crowdTex.anisotropicFilteringLevel = 8;
  crowdMat.diffuseTexture = crowdTex;
  crowdMat.emissiveTexture = crowdTex;
  crowdMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
  crowdMat.specularColor = new Color3(0, 0, 0);
  crowdMat.backFaceCulling = false;
  ring(ax - 0.4, bz - 0.4, TIERS * RISE, EST_WALL_H - 1, false, crowdMat, 'est-crowd-ring');

  // techo plano anular + borde dorado
  const ROOF_Y = EST_WALL_H + 0.8;
  const roofIn: Vector3[] = [];
  const roofOut: Vector3[] = [];
  for (let i = 0; i <= SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    roofIn.push(new Vector3(cx + (ax - 3) * Math.cos(a), ROOF_Y, cz + (bz - 3) * Math.sin(a)));
    roofOut.push(new Vector3(cx + (ax + 1.2) * Math.cos(a), ROOF_Y, cz + (bz + 1.2) * Math.sin(a)));
  }
  const roof = MeshBuilder.CreateRibbon('est-roof', {
    pathArray: [roofIn, roofOut], sideOrientation: Mesh.DOUBLESIDE, closeArray: false, closePath: true,
  }, scene);
  roof.material = roofM;
  roof.isPickable = false;
  ring(ax + 1.4, bz + 1.4, ROOF_Y - 0.25, ROOF_Y + 0.3, true, goldTrim, 'est-roof-rim');

  // pilares perimetrales (salteando el arco del portón)
  const N_PILLARS = 22;
  for (let i = 0; i < N_PILLARS; i++) {
    const angle = (i / N_PILLARS) * Math.PI * 2;
    let na = angle;
    while (na > Math.PI) na -= 2 * Math.PI;
    if (Math.abs(na - (-Math.PI / 2)) < GATE_HALF_ANGLE + 0.06) continue;
    const pillar = MeshBuilder.CreateBox(`est-pillar-${i}`, { width: 0.9, height: EST_WALL_H + 1.4, depth: 0.9 }, scene);
    pillar.position.set(cx + Math.cos(angle) * ax, (EST_WALL_H + 1.4) / 2, cz + Math.sin(angle) * bz);
    pillar.material = white;
    pillar.isPickable = false;
  }

  // portón: dos pilones + dintel dorado (esencia de buildStadiumGate)
  const gateX = Math.sin(GATE_HALF_ANGLE) * ax;
  for (const sx of [-1, 1]) {
    const pylon = MeshBuilder.CreateBox('est-pylon', { width: 1.5, height: GATE_H + 1.2, depth: 1.5 }, scene);
    pylon.position.set(sx * (gateX + 0.4), (GATE_H + 1.2) / 2, cz - bz + 0.4);
    pylon.material = beige;
    pylon.isPickable = false;
  }
  const lintel = MeshBuilder.CreateBox('est-lintel', { width: gateX * 2 + 2.6, height: 0.5, depth: 1.7 }, scene);
  lintel.position.set(0, GATE_H + 1.5, cz - bz + 0.4);
  lintel.material = goldTrim;
  lintel.isPickable = false;

  // cartel REZONA WORLD CUP sobre postes, al frente del portón
  const signZ = cz - bz - 5;
  const sign = MeshBuilder.CreateBox('est-sign', { width: 16, height: 3.2, depth: 0.6 }, scene);
  sign.position.set(cx, 11, signZ);
  sign.material = stdMat(scene, 'est-sign-mat', '#3a6ea5');
  sign.isPickable = false;
  const bannerMat = new StandardMaterial('est-banner-mat', scene);
  const bannerTex = new Texture(bannerUrl, scene);
  bannerMat.diffuseTexture = bannerTex;
  bannerMat.emissiveTexture = bannerTex;
  bannerMat.emissiveColor = new Color3(0.45, 0.45, 0.45);
  bannerMat.specularColor = new Color3(0, 0, 0);
  const banner = MeshBuilder.CreatePlane('est-banner', { width: 15.4, height: 2.7 }, scene);
  banner.position.set(cx, 11, signZ - 0.32);
  banner.material = bannerMat;
  banner.isPickable = false;
  for (const px of [-7, 7]) {
    const pole = MeshBuilder.CreateCylinder('est-sign-pole', { diameter: 0.35, height: 9.4, tessellation: 10 }, scene);
    pole.position.set(cx + px, 4.7, signZ);
    pole.material = gray;
    pole.isPickable = false;
  }
}

// Cartel enmarcado sobre postes (pósters del juego original).
function buildCartel(scene: Scene, url: string, w: number, h: number,
  x: number, z: number, yaw: number, woodDarkMat: StandardMaterial): void {
  const root = new TransformNode('cartel', scene);
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  const frame = MeshBuilder.CreateBox('cartel-frame', { width: w + 0.3, height: h + 0.3, depth: 0.09 }, scene);
  frame.parent = root;
  frame.position.y = h / 2 + 1.1;
  frame.material = stdMat(scene, 'cartel-frame-mat', '#2e2a24');
  frame.isPickable = false;
  const mat = new StandardMaterial('cartel-mat', scene);
  const tex = new Texture(url, scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.4, 0.4, 0.4);
  mat.specularColor = new Color3(0, 0, 0);
  const plano = MeshBuilder.CreatePlane('cartel-img', { width: w, height: h }, scene);
  plano.parent = root;
  // el frente del plano es -Z local → girarlo π para que mire al parque
  // (el yaw del root apunta +Z local al centro del mapa)
  plano.rotation.y = Math.PI;
  plano.position.set(0, h / 2 + 1.1, 0.06);
  plano.material = mat;
  plano.isPickable = false;
  for (const sx of [-1, 1]) {
    const post = MeshBuilder.CreateCylinder('cartel-post', { diameter: 0.14, height: 1.3, tessellation: 8 }, scene);
    post.parent = root;
    post.position.set(sx * (w / 2 - 0.2), 0.65, 0);
    post.material = woodDarkMat;
    post.isPickable = false;
  }
}

// Tablón de fixtures (el fixture board del original, pintado a mano).
function buildFixtureBoard(scene: Scene, x: number, z: number, yaw: number,
  woodDarkMat: StandardMaterial): void {
  const tex = new DynamicTexture('fixture-tex', { width: 512, height: 320 }, scene, true);
  const c = tex.getContext() as unknown as CanvasRenderingContext2D;
  c.fillStyle = '#10204a';
  c.fillRect(0, 0, 512, 320);
  c.strokeStyle = '#e8c84a';
  c.lineWidth = 8;
  c.strokeRect(4, 4, 504, 312);
  c.fillStyle = '#e8c84a';
  c.textAlign = 'center';
  c.font = 'bold 40px ui-monospace, monospace';
  c.fillText('★ FIXTURE · COPA ★', 256, 48);
  c.font = 'bold 28px ui-monospace, monospace';
  c.fillStyle = '#f3ecd9';
  const rows = ['ARG 2-1 BRA', 'GER 0-0 FRA', 'URU 3-2 MEX', 'ITA 1-1 ESP', 'CRO 2-0 ???'];
  for (let i = 0; i < rows.length; i++) c.fillText(rows[i], 256, 100 + i * 44);
  tex.update();
  const root = new TransformNode('fixture-board', scene);
  root.position.set(x, 0, z);
  root.rotation.y = yaw;
  const board = MeshBuilder.CreateBox('fixture-box', { width: 5.2, height: 3.2, depth: 0.12 }, scene);
  board.parent = root;
  board.position.y = 2.7;
  board.material = stdMat(scene, 'fixture-back', '#1d2540');
  board.isPickable = false;
  const mat = new StandardMaterial('fixture-mat', scene);
  mat.diffuseTexture = tex;
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.45, 0.45, 0.45);
  mat.specularColor = new Color3(0, 0, 0);
  const plano = MeshBuilder.CreatePlane('fixture-img', { width: 5.0, height: 3.0 }, scene);
  plano.parent = root;
  plano.rotation.y = Math.PI; // frente (-Z) girado hacia el parque
  plano.position.set(0, 2.7, 0.08);
  plano.material = mat;
  plano.isPickable = false;
  for (const sx of [-1.9, 1.9]) {
    const post = MeshBuilder.CreateCylinder('fixture-post', { diameter: 0.18, height: 2.4, tessellation: 8 }, scene);
    post.parent = root;
    post.position.set(sx, 1.2, 0);
    post.material = woodDarkMat;
    post.isPickable = false;
  }
}

// ─── Tienda: toldo a dos aguas rayado + mostrador + cartel + faroles ────
function buildTienda(scene: Scene, def: TiendaDef, x: number, z: number, facing: number,
  woodMat: StandardMaterial, woodDarkMat: StandardMaterial, spinners: Spinner[]): void {
  const root = new TransformNode(`tienda-${def.id}`, scene);
  root.position.set(x, 0, z);
  root.rotation.y = facing; // local +Z mira al centro del patio

  const add = (mesh: Mesh, mat: StandardMaterial, lx: number, ly: number, lz: number): Mesh => {
    mesh.parent = root;
    mesh.position.set(lx, ly, lz);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  };

  // Mostrador ancho + tapa oscura
  add(MeshBuilder.CreateBox(`${def.id}-counter`, { width: 3.2, height: 0.95, depth: 0.8 }, scene), woodMat, 0, 0.475, 0.9);
  add(MeshBuilder.CreateBox(`${def.id}-counter-top`, { width: 3.4, height: 0.08, depth: 0.95 }, scene), woodDarkMat, 0, 0.99, 0.9);

  // 4 postes
  const POST_H = 3.0;
  for (const [px, pz] of [[-1.7, 1.1], [1.7, 1.1], [-1.7, -1.1], [1.7, -1.1]]) {
    add(MeshBuilder.CreateBox(`${def.id}-post`, { width: 0.16, height: POST_H, depth: 0.16 }, scene), woodDarkMat, px, POST_H / 2, pz);
  }

  // Pared trasera crema + paneles laterales a media altura
  const wallMat = stdMat(scene, `${def.id}-wall`, '#ece0c2');
  add(MeshBuilder.CreateBox(`${def.id}-back`, { width: 3.5, height: 2.1, depth: 0.08 }, scene), wallMat, 0, 1.25, -1.12);
  add(MeshBuilder.CreateBox(`${def.id}-side-l`, { width: 0.07, height: 1.3, depth: 2.1 }, scene), wallMat, -1.72, 0.65, 0);
  add(MeshBuilder.CreateBox(`${def.id}-side-r`, { width: 0.07, height: 1.3, depth: 2.1 }, scene), wallMat, 1.72, 0.65, 0);

  // Toldo a dos aguas RAYADO (DynamicTexture: franjas color/crema)
  const stripeTex = new DynamicTexture(`${def.id}-stripes`, { width: 256, height: 128 }, scene, true);
  const sc = stripeTex.getContext() as unknown as CanvasRenderingContext2D;
  for (let i = 0; i < 8; i++) {
    sc.fillStyle = i % 2 === 0 ? def.color : '#f3ecd9';
    sc.fillRect(i * 32, 0, 32, 128);
  }
  stripeTex.update();
  const roofMat = new StandardMaterial(`${def.id}-roof-mat`, scene);
  roofMat.diffuseTexture = stripeTex;
  roofMat.specularColor = new Color3(0.05, 0.05, 0.05);
  roofMat.backFaceCulling = false;
  const RIDGE_Y = POST_H + 1.0;
  for (const sign of [1, -1] as const) {
    const panel = MeshBuilder.CreatePlane(`${def.id}-roof-${sign}`, { width: 4.0, height: 1.75 }, scene);
    panel.parent = root;
    panel.position.set(0, (POST_H + RIDGE_Y) / 2, sign * 0.72);
    // borde superior hacia la cumbrera (centro): pendiente A dos aguas
    panel.rotation.x = sign === 1 ? -(Math.PI / 2 - 0.62) : (Math.PI / 2 - 0.62);
    panel.material = roofMat;
    panel.isPickable = false;
  }

  // Cenefa festoneada al frente (semicírculos alternados con alpha)
  const valTex = new DynamicTexture(`${def.id}-valance`, { width: 256, height: 64 }, scene, true);
  const vc = valTex.getContext() as unknown as CanvasRenderingContext2D;
  vc.clearRect(0, 0, 256, 64);
  for (let i = 0; i < 8; i++) {
    vc.fillStyle = i % 2 === 0 ? def.color : '#f3ecd9';
    vc.fillRect(i * 32, 0, 32, 40);
    vc.beginPath();
    vc.arc(i * 32 + 16, 40, 16, 0, Math.PI);
    vc.fill();
  }
  valTex.update();
  valTex.hasAlpha = true;
  const valMat = new StandardMaterial(`${def.id}-val-mat`, scene);
  valMat.diffuseTexture = valTex;
  valMat.useAlphaFromDiffuseTexture = true;
  valMat.backFaceCulling = false;
  valMat.specularColor = new Color3(0, 0, 0);
  const valance = MeshBuilder.CreatePlane(`${def.id}-val`, { width: 4.0, height: 0.62 }, scene);
  valance.parent = root;
  valance.position.set(0, POST_H - 0.1, 1.28);
  valance.material = valMat;
  valance.isPickable = false;

  // Cartel pintado: nombre + rubro (mira al patio = local +Z → girar π)
  const signTex = new DynamicTexture(`${def.id}-sign`, { width: 512, height: 224 }, scene, true);
  const ctx = signTex.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = def.color;
  ctx.fillRect(0, 0, 512, 224);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, 136, 512, 88);
  ctx.strokeStyle = '#f3ecd9';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 214);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 52px ui-monospace, monospace';
  ctx.fillText(def.nombre, 256, 74, 470);
  ctx.font = 'bold 38px ui-monospace, monospace';
  ctx.fillText(def.rubro, 256, 180, 470);
  signTex.update();
  const signMat = new StandardMaterial(`${def.id}-sign-mat`, scene);
  signMat.diffuseTexture = signTex;
  signMat.emissiveTexture = signTex;
  signMat.emissiveColor = new Color3(0.55, 0.55, 0.55);
  signMat.specularColor = new Color3(0, 0, 0);
  const sign = MeshBuilder.CreatePlane(`${def.id}-sign-plane`, { width: 2.9, height: 1.25 }, scene);
  sign.parent = root;
  sign.rotation.y = Math.PI;
  sign.position.set(0, 2.1, -1.06);
  sign.material = signMat;
  sign.isPickable = false;
  // cartel exterior (espalda de la tienda): se lee llegando desde afuera
  const signOut = MeshBuilder.CreatePlane(`${def.id}-sign-out`, { width: 2.9, height: 1.25 }, scene);
  signOut.parent = root;
  signOut.position.set(0, 2.1, -1.18);
  signOut.material = signMat;
  signOut.isPickable = false;

  // Faroles colgando de los postes delanteros
  const lanternMat = stdMat(scene, `${def.id}-lantern`, '#f6d76a', '#7a5210');
  for (const lx of [-1.7, 1.7]) {
    add(MeshBuilder.CreateSphere(`${def.id}-lant`, { diameter: 0.26, segments: 8 }, scene), lanternMat, lx, POST_H - 0.45, 1.1);
  }

  // Cajones de mercadería detrás del mostrador
  for (const [cx, cy, cz] of [[-1.0, 0.3, -0.45], [-0.45, 0.3, -0.55], [-0.75, 0.85, -0.5]]) {
    const crate = MeshBuilder.CreateBox(`${def.id}-crate`, { size: 0.55 }, scene);
    add(crate, woodMat, cx, cy, cz);
    crate.rotation.y = cx * 1.7;
  }

  // Ícono neón 3D del rubro flotando sobre el techo (gira + rebota)
  buildNeonIcon(scene, def.id, spinners, root, RIDGE_Y + 0.55);
}

// ─── Jugador: LA FIGURA (humanoide esculpido del viewer) ───────────────
// Outfit DEFAULT de todos: remera blanca + pantalón negro + zapas verdes,
// pintado por COLOR DE VÉRTICE sobre la malla esculpida. La cara dibujada
// va en un decal MOLDEADO a la cabeza (misma técnica del figlab).
interface Player {
  root: TransformNode;
  mesh: Mesh;
  decal: Mesh;
  decalPos: Float32Array;
  normals: Float32Array;
  walkPh: number;
  moveAmt: number;
  yaw: number;
}
let PLAYER: Player | null = null;
const INPUT = { kx: 0, ky: 0, jx: 0, jy: 0 };
// puertas-portal del estadio (hint de cercanía + pulso)
const PORTAL_DOORS: Array<{ x: number; z: number; url: string; label: string; mat: StandardMaterial }> = [];
let PHINT: HTMLElement | null = null;
// bancos con animación de sentarse
const BENCHES: Array<{ x: number; z: number; yaw: number }> = [];
let NEAR_BENCH: { x: number; z: number; yaw: number } | null = null;
const SIT = { amt: 0, target: 0 };
// emotes: 24 emojis con gesto + globito sobre la cabeza
const EMOTES = ['😀','😂','😍','😎','🤔','😭','😡','🥳','👍','👎','👏','🙌','💪','🫡','❤️','🔥','⚽','🏆','🎉','😴','🤯','🙏','💃','🤝'];
const EMOTE = { start: -10, type: 0 };
let emoPlane: Mesh | null = null;
let emoTex: DynamicTexture | null = null;

// gesto del emote sobre la pose (envolvente con entrada/salida suave)
function applyGesture(J: Joints, type: number, e: number, t: number): void {
  const env = Math.min(1, e / 0.25, (2.4 - e) / 0.45);
  if (env <= 0) return;
  switch (type) {
    case 0: // saludo
      J.shAbdR += 2.1 * env;
      J.elbowR += (0.5 + 0.5 * Math.sin(t * 13)) * env;
      break;
    case 1: // salto festejo
      J.pelvisY += Math.abs(Math.sin(e * 9)) * 0.14 * env;
      J.shAbdL += 2.2 * env;
      J.shAbdR += 2.2 * env;
      break;
    case 2: // aplauso
      J.shFwdL += 1.1 * env;
      J.shFwdR += 1.1 * env;
      J.elbowL += (0.9 + 0.35 * Math.sin(t * 14)) * env;
      J.elbowR += (0.9 - 0.35 * Math.sin(t * 14)) * env;
      break;
    case 3: // bailecito
      J.twist += Math.sin(t * 7) * 0.5 * env;
      J.swayX += Math.sin(t * 7) * 0.05 * env;
      J.shAbdL += 0.9 * env;
      J.shAbdR += 0.9 * env;
      J.elbowL += 0.8 * env;
      J.elbowR += 0.8 * env;
      break;
    case 4: // reverencia
      J.spineFwd += 0.75 * env;
      J.headNod += 0.3 * env;
      break;
    default: // brazos arriba
      J.shAbdL += 2.3 * env;
      J.shAbdR += 2.3 * env;
      J.headNod -= 0.15 * env;
      break;
  }
}

// globito de emoji sobre la cabeza (textura repintable)
function showEmote(scene: Scene, idx: number): void {
  if (!PLAYER) return;
  if (!emoPlane) {
    emoTex = new DynamicTexture('emo-tex', { width: 128, height: 128 }, scene, false);
    emoTex.hasAlpha = true;
    const m = new StandardMaterial('emo-mat', scene);
    m.diffuseTexture = emoTex;
    m.emissiveColor = new Color3(1, 1, 1);
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    emoPlane = MeshBuilder.CreatePlane('emo-plane', { width: 0.85, height: 0.85 }, scene);
    emoPlane.parent = PLAYER.root;
    emoPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    emoPlane.material = m;
    emoPlane.isPickable = false;
    emoPlane.isVisible = false;
  }
  const c = (emoTex as DynamicTexture).getContext() as unknown as CanvasRenderingContext2D;
  c.save();
  c.clearRect(0, 0, 128, 128);
  c.translate(0, 128);
  c.scale(1, -1); // flip Y de DynamicTexture sin mipmaps
  c.font = '96px serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(EMOTES[idx], 64, 70);
  c.restore();
  (emoTex as DynamicTexture).update(false);
  EMOTE.start = performance.now() / 1000;
  EMOTE.type = idx % 6;
}
const DEC_U = 32;
const DEC_V = 24;
const DEC_PHI = 1.1;
const DEC_T0 = 0.16;
const DEC_T1 = 0.74;

function buildPlayer(scene: Scene, faceCv: HTMLCanvasElement, nombre: string): Player {
  const root = new TransformNode('player', scene);
  // figura esculpida: primera pasada graba layout, después solo posiciones
  buildFigure(J0());
  const mesh = new Mesh('player-fig', scene);
  const vd = new VertexData();
  vd.positions = FIG.pos as Float32Array;
  vd.indices = FIG.idx as Uint16Array;
  const normals = new Float32Array(FIG.vc * 3);
  VertexData.ComputeNormals(FIG.pos, FIG.idx, normals);
  vd.normals = normals;
  const colors = new Float32Array(FIG.vc * 4);
  paintOutfit(colors,
    [0.95, 0.95, 0.93],   // remera blanca
    [0.10, 0.10, 0.13],   // pantalón negro
    [0.24, 0.75, 0.35],   // zapas verdes
    [0.91, 0.72, 0.56]);  // piel
  vd.colors = colors;
  vd.applyToMesh(mesh, true);
  const mat = new StandardMaterial('player-mat', scene);
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = false; // el port viene de un mundo diestro
  mesh.material = mat;
  mesh.parent = root;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true; // la malla se regenera por frame

  // decal de la cara dibujada, moldeado a la cabeza
  const decalPos = new Float32Array((DEC_U + 1) * (DEC_V + 1) * 3);
  decalPositions(J0(), decalPos, DEC_U, DEC_V, DEC_PHI, DEC_T0, DEC_T1);
  const dvd = new VertexData();
  dvd.positions = decalPos;
  const uvs = new Float32Array((DEC_U + 1) * (DEC_V + 1) * 2);
  const didx: number[] = [];
  let k = 0;
  for (let j = 0; j <= DEC_V; j++) {
    for (let i = 0; i <= DEC_U; i++) {
      uvs[k++] = i / DEC_U;
      uvs[k++] = 1 - j / DEC_V;
    }
  }
  for (let j = 0; j < DEC_V; j++) {
    for (let i = 0; i < DEC_U; i++) {
      const a = j * (DEC_U + 1) + i;
      const b = a + 1;
      const c = a + DEC_U + 1;
      didx.push(a, c, b, b, c, c + 1);
    }
  }
  dvd.uvs = uvs;
  dvd.indices = didx;
  const dnormals = new Float32Array(decalPos.length);
  VertexData.ComputeNormals(decalPos, didx, dnormals);
  dvd.normals = dnormals;
  const decal = new Mesh('player-cara', scene);
  dvd.applyToMesh(decal, true);
  const faceTex = new DynamicTexture('pl-face', { width: 256, height: 256 }, scene, false);
  // las DynamicTexture sin mipmaps salen espejadas en Y → copiar dado vuelta
  const fc2 = faceTex.getContext() as unknown as CanvasRenderingContext2D;
  fc2.save();
  fc2.translate(0, 256);
  fc2.scale(1, -1);
  fc2.drawImage(faceCv, 0, 0, 256, 256);
  fc2.restore();
  faceTex.update(false);
  faceTex.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
  const dmat = new StandardMaterial('pl-face-mat', scene);
  dmat.diffuseTexture = faceTex;
  dmat.emissiveColor = new Color3(0.28, 0.28, 0.28);
  dmat.specularColor = new Color3(0, 0, 0);
  dmat.backFaceCulling = false;
  decal.material = dmat;
  decal.parent = root;
  decal.isPickable = false;
  decal.alwaysSelectAsActiveMesh = true;

  // nombre flotante (billboard)
  const nameTex = new DynamicTexture('pl-name', { width: 256, height: 64 }, scene, true);
  const nc = nameTex.getContext() as unknown as CanvasRenderingContext2D;
  nc.clearRect(0, 0, 256, 64);
  nc.font = 'bold 38px ui-monospace, monospace';
  nc.textAlign = 'center';
  nc.textBaseline = 'middle';
  nc.lineWidth = 7;
  nc.strokeStyle = '#10204a';
  nc.strokeText(nombre, 128, 32, 240);
  nc.fillStyle = '#ffffff';
  nc.fillText(nombre, 128, 32, 240);
  nameTex.update();
  nameTex.hasAlpha = true;
  const nameMat = new StandardMaterial('pl-name-mat', scene);
  nameMat.diffuseTexture = nameTex;
  nameMat.emissiveTexture = nameTex;
  nameMat.emissiveColor = new Color3(1, 1, 1);
  nameMat.useAlphaFromDiffuseTexture = true;
  nameMat.disableLighting = true;
  nameMat.backFaceCulling = false;
  const nameP = MeshBuilder.CreatePlane('pl-name-plane', { width: 1.3, height: 0.34 }, scene);
  nameP.parent = root;
  nameP.position.y = 1.72;
  nameP.billboardMode = Mesh.BILLBOARDMODE_Y;
  nameP.material = nameMat;
  nameP.isPickable = false;

  root.position.set(0, 0, -27); // spawn en el sendero sur
  return { root, mesh, decal, decalPos, normals, walkPh: 0, moveAmt: 0, yaw: 0 };
}

// ─── Escena completa ────────────────────────────────────────────────────
function buildScene(engine: Engine, canvas: HTMLCanvasElement): Scene {
  const scene = new Scene(engine);
  const SKY = '#aecbe8';
  scene.clearColor = Color4.FromHexString(`${SKY}ff`);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0048; // el estadio al norte tiene que leerse desde el patio
  scene.fogColor = Color3.FromHexString(SKY);

  const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.12, 30, new Vector3(0, 1.4, 0), scene);
  camera.lowerRadiusLimit = 7;
  camera.upperRadiusLimit = 95; // mapa completo con estadio en cuadro
  camera.lowerBetaLimit = 0.25;
  camera.upperBetaLimit = 1.46;
  camera.minZ = 0.1;
  camera.maxZ = 500;
  camera.wheelDeltaPercentage = 0.02;
  camera.pinchDeltaPercentage = 0.012;
  camera.attachControl(canvas, true);

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.78;
  hemi.groundColor = new Color3(0.5, 0.58, 0.42);
  const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, -0.35), scene);
  sun.intensity = 0.9;
  sun.diffuse = new Color3(1.0, 0.96, 0.86);

  // Glow para los neones (ratio bajo = barato en el Mali); intensidad
  // contenida: el neón se nota pero no come la silueta del ícono.
  const glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 24 });
  glow.intensity = 0.42;
  const spinners: Spinner[] = [];

  // Piso verde: la MISMA textura de pasto del juego, tileada igual (~7u/tile)
  const ground = MeshBuilder.CreateGround('patio-ground', { width: GROUND_SIZE, height: GROUND_SIZE, subdivisions: 1 }, scene);
  ground.material = texMat(scene, 'patio-ground-mat', grassUrl, GROUND_SIZE / 7, '#74a05f');
  ground.isPickable = false;

  // Paseo de lajas en anillo (ribbon: círculo interno + externo)
  const SEGS = 72;
  const inner: Vector3[] = [];
  const outer: Vector3[] = [];
  for (let i = 0; i <= SEGS; i++) {
    const a = (i / SEGS) * Math.PI * 2;
    inner.push(new Vector3(Math.cos(a) * PROM_INNER, 0.02, Math.sin(a) * PROM_INNER));
    outer.push(new Vector3(Math.cos(a) * PROM_OUTER, 0.02, Math.sin(a) * PROM_OUTER));
  }
  const prom = MeshBuilder.CreateRibbon('paseo', { pathArray: [inner, outer] }, scene);
  const promMat = stdMat(scene, 'paseo-mat', '#ffffff');
  // u corre A LO LARGO del anillo, v cruza el ancho del paseo
  const promTex = new Texture(flagstoneUrl, scene);
  promTex.uScale = 18;
  promTex.vScale = 1;
  promTex.anisotropicFilteringLevel = 8;
  promMat.diffuseTexture = promTex;
  promMat.backFaceCulling = false;
  prom.material = promMat;
  prom.isPickable = false;

  // Sendero de entrada (sur): del portal al centro + acceso exterior
  const pathMat = texMat(scene, 'path-mat', flagstoneUrl, 1);
  (pathMat.diffuseTexture as Texture).vScale = 5;
  for (const [pz, len] of [[-(PROM_INNER) / 2, PROM_INNER], [-(PROM_OUTER + 9), 18]] as const) {
    const path = MeshBuilder.CreateGround('sendero', { width: 2.6, height: len }, scene);
    path.position.set(0, 0.02, pz);
    path.material = pathMat;
    path.isPickable = false;
  }

  // ─── Materiales compartidos de madera/piedra ─────────────────────────
  const woodMat = texMat(scene, 'wood-mat', woodPlanksUrl, 2, '#d8b88a');
  const woodDarkMat = texMat(scene, 'wood-dark-mat', woodPlanksUrl, 1, '#6e4a26');
  const stoneMat = texMat(scene, 'stone-mat', cutStoneUrl, 2, '#cfc8b8');

  // ─── Anillo de 10 tiendas rodeando el patio (hueco al sur = portal) ──
  const span = Math.PI * 2 - GATE_HALF_GAP * 2;
  for (let i = 0; i < TIENDAS.length; i++) {
    const a = GATE_ANGLE + GATE_HALF_GAP + (span * (i + 0.5)) / TIENDAS.length;
    const x = Math.cos(a) * RING_RADIUS;
    const z = Math.sin(a) * RING_RADIUS;
    // local +Z debe apuntar al centro: yaw = atan2 hacia el origen
    const facing = Math.atan2(-x, -z);
    buildTienda(scene, TIENDAS[i], x, z, facing, woodMat, woodDarkMat, spinners);
  }

  // ─── Monumento central: base escalonada de piedra + copa dorada ──────
  for (const [r, y, h] of [[2.6, 0.175, 0.35], [2.0, 0.5, 0.3], [1.4, 0.78, 0.26]]) {
    const tier = MeshBuilder.CreateCylinder('mon-tier', { diameter: r * 2, height: h, tessellation: 28 }, scene);
    tier.position.y = y;
    tier.material = stoneMat;
    tier.isPickable = false;
  }
  const goldMat = stdMat(scene, 'gold-mat', '#e8c84a', '#604d12');
  goldMat.specularColor = new Color3(0.9, 0.85, 0.5);
  const stem = MeshBuilder.CreateCylinder('mon-stem', { diameterTop: 0.35, diameterBottom: 0.7, height: 1.6, tessellation: 16 }, scene);
  stem.position.y = 1.7;
  stem.material = goldMat;
  const cup = MeshBuilder.CreateCylinder('mon-cup', { diameterTop: 1.5, diameterBottom: 0.4, height: 1.1, tessellation: 16 }, scene);
  cup.position.y = 3.0;
  cup.material = goldMat;
  const ball = MeshBuilder.CreateSphere('mon-ball', { diameter: 0.9, segments: 12 }, scene);
  ball.position.y = 3.8;
  ball.material = goldMat;

  // Bancos de madera alrededor del monumento (mirando al centro)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bx = Math.cos(a) * 4.6;
    const bz = Math.sin(a) * 4.6;
    const bench = new TransformNode(`bench-${i}`, scene);
    bench.position.set(bx, 0, bz);
    bench.rotation.y = Math.atan2(-bx, -bz);
    BENCHES.push({ x: bx, z: bz, yaw: Math.atan2(-bx, -bz) });
    const seat = MeshBuilder.CreateBox('bench-seat', { width: 1.8, height: 0.1, depth: 0.45 }, scene);
    seat.parent = bench;
    seat.position.y = 0.45;
    seat.material = woodMat;
    for (const lx of [-0.7, 0.7]) {
      const leg = MeshBuilder.CreateBox('bench-leg', { width: 0.12, height: 0.45, depth: 0.4 }, scene);
      leg.parent = bench;
      leg.position.set(lx, 0.22, 0);
      leg.material = woodDarkMat;
    }
  }

  // ─── Mástiles con banderas animadas alrededor del monumento ──────────
  const poleMat = stdMat(scene, 'pole-mat', '#e8e4da');
  const flags: Mesh[] = [];
  for (let i = 0; i < FLAGS.length; i++) {
    const a = (i / FLAGS.length) * Math.PI * 2 + Math.PI / 8;
    const fx = Math.cos(a) * FLAG_RADIUS;
    const fz = Math.sin(a) * FLAG_RADIUS;
    const pole = MeshBuilder.CreateCylinder(`pole-${i}`, { diameter: 0.1, height: 5.2, tessellation: 8 }, scene);
    pole.position.set(fx, 2.6, fz);
    pole.material = poleMat;
    pole.isPickable = false;

    const ftex = new DynamicTexture(`flag-${FLAGS[i].id}`, { width: 128, height: 80 }, scene, true);
    FLAGS[i].paint(ftex.getContext() as unknown as CanvasRenderingContext2D, 128, 80);
    ftex.update();
    const fmat = new StandardMaterial(`flag-mat-${FLAGS[i].id}`, scene);
    fmat.diffuseTexture = ftex;
    fmat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    fmat.specularColor = new Color3(0, 0, 0);
    fmat.backFaceCulling = false;
    const flag = MeshBuilder.CreatePlane(`flag-${i}`, { width: 1.25, height: 0.8 }, scene);
    flag.position.set(fx, 4.55, fz);
    flag.material = fmat;
    flag.isPickable = false;
    // pivote en el borde del mástil: corro el plano medio ancho
    flag.setPivotPoint(new Vector3(-0.625, 0, 0));
    flag.position.x += 0.625 * Math.cos(a + Math.PI / 2);
    flag.position.z += 0.625 * Math.sin(a + Math.PI / 2);
    flag.rotation.y = -a + Math.PI / 2;
    flags.push(flag);
  }

  // ─── Banderines (thin instances de triángulos, 4 colores) ────────────
  const triPositions = [-0.15, 0, 0, 0.15, 0, 0, 0, -0.36, 0];
  const triIndices = [0, 1, 2];
  const buntingColors = ['#c14444', '#e8c84a', '#3a6ea5', '#9bd96b'];
  const buntingMeshes = buntingColors.map((hex, i) => {
    const tri = new Mesh(`bunting-${i}`, scene);
    const vd = new VertexData();
    vd.positions = triPositions;
    vd.indices = triIndices;
    vd.normals = [0, 0, -1, 0, 0, -1, 0, 0, -1];
    vd.applyToMesh(tri);
    const m = stdMat(scene, `bunting-mat-${i}`, hex, '#222222');
    m.backFaceCulling = false;
    tri.material = m;
    tri.isPickable = false;
    return tri;
  });
  const buntingMatrices: number[][] = [[], [], [], []];
  const scratchQ = Quaternion.Identity();
  const scratchM = Matrix.Identity();
  let buntingCount = 0;
  // guirnaldas entre los frentes de tiendas contiguas (misma separación angular)
  const N_FLAGS_PER_SPAN = 9;
  for (let i = 0; i < TIENDAS.length - 1; i++) {
    const a0 = GATE_ANGLE + GATE_HALF_GAP + (span * (i + 0.5)) / TIENDAS.length;
    const a1 = GATE_ANGLE + GATE_HALF_GAP + (span * (i + 1.5)) / TIENDAS.length;
    const r = RING_RADIUS - 1.3; // frente de las tiendas
    const p0 = new Vector3(Math.cos(a0) * r, 2.9, Math.sin(a0) * r);
    const p1 = new Vector3(Math.cos(a1) * r, 2.9, Math.sin(a1) * r);
    for (let k = 1; k <= N_FLAGS_PER_SPAN; k++) {
      const t = k / (N_FLAGS_PER_SPAN + 1);
      const px = p0.x + (p1.x - p0.x) * t;
      const pz = p0.z + (p1.z - p0.z) * t;
      const py = 2.9 - Math.sin(Math.PI * t) * 0.55; // panza de catenaria
      const yaw = Math.atan2(-px, -pz); // triángulo de cara al patio
      Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, scratchQ);
      Matrix.ComposeToRef(new Vector3(1, 1, 1), scratchQ, new Vector3(px, py, pz), scratchM);
      const bucket = buntingCount % 4;
      for (let j = 0; j < 16; j++) buntingMatrices[bucket].push(scratchM.m[j]);
      buntingCount++;
    }
  }
  buntingMeshes.forEach((mesh, i) => {
    if (buntingMatrices[i].length === 0) return;
    mesh.thinInstanceSetBuffer('matrix', new Float32Array(buntingMatrices[i]), 16, true);
  });

  // ─── Portal de entrada (sur): pilares de piedra + cartel + globos ────
  const GATE_R = RING_RADIUS;
  const gateHalfWidth = Math.sin(GATE_HALF_GAP) * GATE_R + 1.2;
  for (const sx of [-1, 1]) {
    const pillar = MeshBuilder.CreateBox('gate-pillar', { width: 0.9, height: 3.6, depth: 0.9 }, scene);
    pillar.position.set(sx * gateHalfWidth, 1.8, -GATE_R);
    pillar.material = stoneMat;
    pillar.isPickable = false;
    const cap = MeshBuilder.CreateBox('gate-cap', { width: 1.15, height: 0.22, depth: 1.15 }, scene);
    cap.position.set(sx * gateHalfWidth, 3.7, -GATE_R);
    cap.material = stoneMat;
    cap.isPickable = false;
    // globos festivos sobre cada pilar
    const balloonColors = ['#c14444', '#e8c84a', '#3a6ea5'];
    for (let b = 0; b < 3; b++) {
      const balloon = MeshBuilder.CreateSphere('gate-balloon', { diameterX: 0.42, diameterY: 0.52, diameterZ: 0.42, segments: 8 }, scene);
      balloon.position.set(sx * gateHalfWidth + (b - 1) * 0.34, 4.45 + (b % 2) * 0.3, -GATE_R + (b - 1) * 0.18);
      balloon.material = stdMat(scene, `balloon-${sx}-${b}`, balloonColors[b], '#1c1c1c');
      balloon.isPickable = false;
    }
  }
  const archTex = new DynamicTexture('arch-sign', { width: 1024, height: 192 }, scene, true);
  const ac = archTex.getContext() as unknown as CanvasRenderingContext2D;
  ac.fillStyle = '#28406b';
  ac.fillRect(0, 0, 1024, 192);
  ac.strokeStyle = '#e8c84a';
  ac.lineWidth = 14;
  ac.strokeRect(7, 7, 1010, 178);
  ac.fillStyle = '#f3ecd9';
  ac.textAlign = 'center';
  ac.textBaseline = 'middle';
  ac.font = 'bold 96px ui-monospace, monospace';
  ac.fillText('★ PATIO MUNDIAL ★', 512, 96, 980);
  archTex.update();
  const archMat = new StandardMaterial('arch-mat', scene);
  archMat.diffuseTexture = archTex;
  archMat.emissiveTexture = archTex;
  archMat.emissiveColor = new Color3(0.5, 0.5, 0.5);
  archMat.specularColor = new Color3(0, 0, 0);
  // dos planos espalda con espalda → el cartel se lee desde afuera Y adentro
  for (const flip of [0, Math.PI]) {
    const arch = MeshBuilder.CreatePlane(`arch-${flip ? 'in' : 'out'}`, { width: gateHalfWidth * 2 + 0.9, height: 1.1 }, scene);
    arch.position.set(0, 3.35, -GATE_R + (flip ? 0.02 : -0.02));
    arch.rotation.y = flip;
    arch.material = archMat;
    arch.isPickable = false;
  }

  // ─── Caminitos a los sectores nuevos + faroles ────────────────────────
  // Salen por los huecos ENTRE tiendas (mitad angular de cada gap).
  const warmMat = neonMat(scene, 'lamp-warm', '#ffca6a');
  const gapExit = (gapIdx: number): { x: number; z: number } => {
    const a = GATE_ANGLE + GATE_HALF_GAP + (span * gapIdx) / TIENDAS.length;
    return { x: Math.cos(a) * PROM_OUTER, z: Math.sin(a) * PROM_OUTER };
  };
  buildCaminito(scene, gapExit(1), { x: CANCHA.x - 9.2, z: CANCHA.z }, 2.2, woodDarkMat, warmMat);
  buildCaminito(scene, gapExit(3), { x: COPAS.x - 1.5, z: COPAS.z - 6.8 }, -2.5, woodDarkMat, warmMat);
  // al estadio: bien ancho y rematando en una explanada que cubre el portón
  buildCaminito(scene, gapExit(4), { x: ESTADIO.x, z: ESTADIO.z - EST_B - 7.5 }, 3.0, woodDarkMat, warmMat, 2.4);
  const apron = MeshBuilder.CreateGround('est-apron', { width: 13.5, height: 8.5 }, scene);
  apron.position.set(ESTADIO.x, 0.024, ESTADIO.z - EST_B - 3.2); // pega contra la pared, pylons incluidos
  const apronMat = stdMat(scene, 'est-apron-mat', '#ffffff');
  const apronTex = new Texture(flagstoneUrl, scene);
  apronTex.uScale = 4.2;
  apronTex.vScale = 2.6;
  apronTex.anisotropicFilteringLevel = 8;
  apronMat.diffuseTexture = apronTex;
  apron.material = apronMat;
  apron.isPickable = false;
  buildCaminito(scene, gapExit(6), { x: MUNECO.x + 4.4, z: MUNECO.z }, 2.0, woodDarkMat, warmMat);
  // faroles en el sendero de entrada sur
  buildLamp(scene, 2.1, -26, woodDarkMat, warmMat);
  buildLamp(scene, -2.1, -33, woodDarkMat, warmMat);

  // ─── Sectores: cancha + muñeco + copas + estadio + cerca ─────────────
  buildCancha(scene, CANCHA.x, CANCHA.z, woodMat, woodDarkMat);
  buildMuneco(scene, MUNECO.x, MUNECO.z, stoneMat, spinners);
  buildCopas(scene, COPAS.x, COPAS.z, stoneMat, spinners);
  buildEstadio(scene);
  buildCerca(scene);

  // bancos extra en el césped del patio, mirando al monumento
  for (const a of [0.35, 1.25, 1.9, 2.8]) {
    const bx = Math.cos(a) * 10.6;
    const bz = Math.sin(a) * 10.6;
    const yaw = Math.atan2(-bx, -bz);
    BENCHES.push({ x: bx, z: bz, yaw });
    const node = new TransformNode('bench-lawn', scene);
    node.position.set(bx, 0, bz);
    node.rotation.y = yaw;
    const seat = MeshBuilder.CreateBox('bench-lawn-seat', { width: 1.8, height: 0.1, depth: 0.45 }, scene);
    seat.parent = node;
    seat.position.y = 0.45;
    seat.material = woodMat;
    seat.isPickable = false;
    for (const lx of [-0.7, 0.7]) {
      const leg = MeshBuilder.CreateBox('bench-lawn-leg', { width: 0.12, height: 0.45, depth: 0.4 }, scene);
      leg.parent = node;
      leg.position.set(lx, 0.22, 0);
      leg.material = woodDarkMat;
      leg.isPickable = false;
    }
  }

  // ─── Carteles del juego original ──────────────────────────────────────
  // Tablón de fixtures camino a la cancha + láminas del mundial en stands.
  buildFixtureBoard(scene, 28, 11, Math.atan2(-28, -11), woodDarkMat);
  buildCartel(scene, portraitUrl, 2.2, 3.0, -13, 22, Math.atan2(13, -22), woodDarkMat);
  buildCartel(scene, bannerUrl, 4.6, 1.7, -25, -14, Math.atan2(25, 14), woodDarkMat);
  buildCartel(scene, portraitUrl, 2.2, 3.0, 33, -20, Math.atan2(-33, 20), woodDarkMat);
  // ─── PUERTAS-PORTAL del estadio (como el original: te llevan a otros
  // juegos de Rezona). Tocá la puerta para abrir el link. Las dos sin
  // gameId todavía quedan como "COMING SOON" (igual que en world.ts).
  const PORTALES: Array<{ url: string; label: string; cover: string }> = [
    { url: '', label: 'Festejo GOTY', cover: coverCardsUrl },
    { url: 'https://web.rezona.ai/share/game/OTMzMzI4NA', label: 'Ball Juggler', cover: coverJugglerUrl },
    { url: 'https://web.rezona.ai/share/game/OTMzMjQ5NA', label: 'Catching These Balls', cover: coverGoalieUrl },
    { url: 'https://web.rezona.ai/share/game/OTMzMTc0NQ', label: 'Master Dribbler', cover: coverDribblerUrl },
    { url: '', label: 'Coming Soon', cover: coverRacingUrl },
  ];
  const coverOffs = [-1.55, -1.0, -0.5, 0.5, 1.0];
  for (let i = 0; i < PORTALES.length; i++) {
    const a = -Math.PI / 2 + coverOffs[i];
    let nx = Math.cos(a) / EST_A;
    let nz = Math.sin(a) / EST_B;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const px = ESTADIO.x + Math.cos(a) * EST_A + nx * 0.3;
    const pz = ESTADIO.z + Math.sin(a) * EST_B + nz * 0.3;
    const root = new TransformNode(`portal-${i}`, scene);
    root.position.set(px, 0, pz);
    root.rotation.y = Math.atan2(nx, nz); // +Z local hacia AFUERA de la pared
    // marco de puerta: jambas + dintel + fondo oscuro
    for (const sx of [-1.25, 1.25]) {
      const jamb = MeshBuilder.CreateBox('portal-jamb', { width: 0.3, height: 3.5, depth: 0.5 }, scene);
      jamb.parent = root;
      jamb.position.set(sx, 1.75, 0);
      jamb.material = stoneMat;
      jamb.isPickable = false;
    }
    const lintel = MeshBuilder.CreateBox('portal-lintel', { width: 2.9, height: 0.35, depth: 0.55 }, scene);
    lintel.parent = root;
    lintel.position.set(0, 3.6, 0);
    lintel.material = stdMat(scene, `portal-lintel-${i}`, '#e6c34a');
    lintel.isPickable = false;
    const fondo = MeshBuilder.CreateBox('portal-fondo', { width: 2.3, height: 3.4, depth: 0.18 }, scene);
    fondo.parent = root;
    fondo.position.set(0, 1.7, -0.1);
    fondo.material = stdMat(scene, 'portal-fondo-mat', '#15151c');
    fondo.isPickable = false;
    // cover del juego = la puerta en sí (tocable)
    const cmat = new StandardMaterial(`portal-cover-${i}`, scene);
    const ctex = new Texture(PORTALES[i].cover, scene);
    cmat.diffuseTexture = ctex;
    cmat.emissiveTexture = ctex;
    cmat.emissiveColor = new Color3(0.42, 0.42, 0.42);
    cmat.specularColor = new Color3(0, 0, 0);
    const puerta = MeshBuilder.CreatePlane(`portal-img-${i}`, { width: 2.1, height: 3.1 }, scene);
    puerta.parent = root;
    puerta.rotation.y = Math.PI; // frente (-Z) hacia afuera
    puerta.position.set(0, 1.72, 0.04);
    puerta.material = cmat;
    puerta.isPickable = true;
    puerta.metadata = { portalUrl: PORTALES[i].url, portalLabel: PORTALES[i].label };
    PORTAL_DOORS.push({ x: px, z: pz, url: PORTALES[i].url, label: PORTALES[i].label, mat: cmat });
    // cartelito con el nombre del juego sobre el dintel
    const ltex = new DynamicTexture(`portal-label-${i}`, { width: 512, height: 96 }, scene, true);
    const lc = ltex.getContext() as unknown as CanvasRenderingContext2D;
    lc.fillStyle = '#10204a';
    lc.fillRect(0, 0, 512, 96);
    lc.strokeStyle = '#e8c84a';
    lc.lineWidth = 6;
    lc.strokeRect(3, 3, 506, 90);
    lc.fillStyle = PORTALES[i].url ? '#f3ecd9' : '#8a90a8';
    lc.textAlign = 'center';
    lc.textBaseline = 'middle';
    lc.font = 'bold 44px ui-monospace, monospace';
    lc.fillText(PORTALES[i].url ? PORTALES[i].label : PORTALES[i].label.toUpperCase(), 256, 50, 490);
    ltex.update();
    const lmat = new StandardMaterial(`portal-label-mat-${i}`, scene);
    lmat.diffuseTexture = ltex;
    lmat.emissiveTexture = ltex;
    lmat.emissiveColor = new Color3(0.5, 0.5, 0.5);
    lmat.specularColor = new Color3(0, 0, 0);
    const lplane = MeshBuilder.CreatePlane(`portal-label-pl-${i}`, { width: 2.7, height: 0.5 }, scene);
    lplane.parent = root;
    lplane.rotation.y = Math.PI;
    lplane.position.set(0, 4.1, 0.05);
    lplane.material = lmat;
    lplane.isPickable = false;
  }
  // tocar una puerta abre el juego (si tiene link)
  scene.onPointerDown = (_evt, pick) => {
    const md = pick?.pickedMesh?.metadata as { portalUrl?: string; portalLabel?: string } | undefined;
    if (pick?.hit && md && md.portalUrl) {
      window.open(md.portalUrl, '_blank');
    }
  };


  // ─── Robles y matas de pasto (billboards cruzados, estilo del juego) ──
  // Despejado alrededor de los POIs nuevos y sus caminitos.
  const nearPOI = (x: number, z: number): boolean => {
    if (Math.abs(x - CANCHA.x) < 13.5 && Math.abs(z - CANCHA.z) < 17.5) return true; // cancha + arcos
    if (Math.hypot(x - COPAS.x, z - COPAS.z) < 10.5) return true;
    if (Math.hypot(x - MUNECO.x, z - MUNECO.z) < 8.5) return true;
    // óvalo del estadio (+ margen) y su cartel al frente
    const ex = (x - ESTADIO.x) / (EST_A + 5);
    const ez = (z - ESTADIO.z) / (EST_B + 5);
    if (ex * ex + ez * ez < 1) return true;
    if (Math.abs(x) < 10 && Math.abs(z - (ESTADIO.z - EST_B - 5)) < 4) return true;
    // afuera de la cerca no va deco
    if (x < FENCE.x0 + 2 || x > FENCE.x1 - 2 || z < FENCE.z0 + 2 || z > FENCE.z1 - 2) return true;
    for (const [mx, mz] of [[28, -4], [16, 21.5], [-24.5, -3.5], [-5, 31]]) {  // corredores de caminitos
      if (Math.hypot(x - mx, z - mz) < 5.5) return true;
    }
    return false;
  };
  const rand = rng(20260611);
  const oakMat = new StandardMaterial('oak-mat', scene);
  const oakTex = new Texture(oakTreeUrl, scene);
  oakTex.hasAlpha = true;
  oakMat.diffuseTexture = oakTex;
  oakMat.useAlphaFromDiffuseTexture = true;
  oakMat.backFaceCulling = false;
  oakMat.specularColor = new Color3(0, 0, 0);
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2;
    const r = PROM_OUTER + 6 + rand() * 22;
    const tx = Math.cos(a) * r;
    const tz = Math.sin(a) * r;
    if (Math.abs(tx) < 3.5 && tz < -PROM_INNER) continue; // no tapar el sendero sur
    if (nearPOI(tx, tz)) continue;
    const s = 7.2 + rand() * 3.8; // robles grandes (piden presencia)
    for (const yaw of [0, Math.PI / 2]) {
      const plane = MeshBuilder.CreatePlane(`oak-${i}-${yaw > 0 ? 'b' : 'a'}`, { width: s, height: s }, scene);
      plane.position.set(tx, s / 2 - 0.05, tz);
      plane.rotation.y = a + yaw; // orientación variada
      plane.material = oakMat;
      plane.isPickable = false;
    }
  }

  // matas: thin instances de 2 planos cruzados
  const tuftMat = new StandardMaterial('tuft-mat', scene);
  const tuftTex = new Texture(grassTuftUrl, scene);
  tuftTex.hasAlpha = true;
  tuftMat.diffuseTexture = tuftTex;
  tuftMat.useAlphaFromDiffuseTexture = true;
  tuftMat.backFaceCulling = false;
  tuftMat.specularColor = new Color3(0, 0, 0);
  const tuftA = MeshBuilder.CreatePlane('tuft-a', { width: 1, height: 1 }, scene);
  const tuftB = MeshBuilder.CreatePlane('tuft-b', { width: 1, height: 1 }, scene);
  tuftA.material = tuftMat;
  tuftB.material = tuftMat;
  tuftA.isPickable = false;
  tuftB.isPickable = false;
  const tm: number[] = [];
  const tm2: number[] = [];
  for (let i = 0; i < 140; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * 46;
    if (r > PROM_INNER - 0.8 && r < PROM_OUTER + 2.6) continue; // no en el paseo ni tiendas
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    if (Math.abs(px) < 2.2 && pz < 0) continue;                 // no en el sendero
    if (r < 7.6) continue;                                      // no entre banderas/monumento
    if (nearPOI(px, pz)) continue;
    const s = 0.75 + rand() * 0.6;
    const yaw = rand() * Math.PI;
    Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, scratchQ);
    Matrix.ComposeToRef(new Vector3(s, s, s), scratchQ, new Vector3(px, s / 2 - 0.04, pz), scratchM);
    for (let j = 0; j < 16; j++) tm.push(scratchM.m[j]);
    Quaternion.RotationYawPitchRollToRef(yaw + Math.PI / 2, 0, 0, scratchQ);
    Matrix.ComposeToRef(new Vector3(s, s, s), scratchQ, new Vector3(px, s / 2 - 0.04, pz), scratchM);
    for (let j = 0; j < 16; j++) tm2.push(scratchM.m[j]);
  }
  if (tm.length) tuftA.thinInstanceSetBuffer('matrix', new Float32Array(tm), 16, true);
  if (tm2.length) tuftB.thinInstanceSetBuffer('matrix', new Float32Array(tm2), 16, true);

  // ─── Glow SOLO en los neones (los carteles/banderas usan emissive para
  // legibilidad y no deben bloomear; neonMat marca disableLighting) ──────
  for (const mesh of scene.meshes) {
    const m = mesh.material;
    if (m instanceof StandardMaterial && m.disableLighting) {
      glow.addIncludedOnlyMesh(mesh as Mesh);
    }
  }

  // ─── Animación: banderas flameando + auto-órbita en reposo ───────────
  let lastInteract = performance.now();
  canvas.addEventListener('pointerdown', () => { lastInteract = performance.now(); }, { passive: true });
  canvas.addEventListener('wheel', () => { lastInteract = performance.now(); }, { passive: true });
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000;
    const dt = scene.getEngine().getDeltaTime() / 1000;
    for (let i = 0; i < flags.length; i++) {
      flags[i].rotation.y = (-((i / FLAGS.length) * Math.PI * 2 + Math.PI / 8) + Math.PI / 2) + Math.sin(t * 2.2 + i * 1.7) * 0.16;
    }
    for (const s of spinners) { // íconos neón: giran + rebotan
      s.node.rotation.y = t * 0.8 + s.phase;
      s.node.position.y = s.baseY + Math.sin(t * 1.6 + s.phase) * 0.08;
    }
    // ─── jugador (LA FIGURA): caminar + malla regenerada por frame ───────
    if (PLAYER) {
      let dx = INPUT.kx + INPUT.jx;
      let dy = INPUT.ky + INPUT.jy;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      const moving = len > 0.08;
      if (moving && SIT.target === 1) SIT.target = 0; // moverse = pararse
      if (moving && SIT.amt < 0.3) {
        const fx = camera.target.x - camera.position.x;
        const fz = camera.target.z - camera.position.z;
        const fl = Math.hypot(fx, fz) || 1;
        const fwx = fx / fl;
        const fwz = fz / fl;
        const mx = fwx * (-dy) + fwz * dx;   // derecha = (fwz, -fwx)
        const mz = fwz * (-dy) + (-fwx) * dx;
        const SPEED = 4.2;
        const p = PLAYER.root.position;
        p.x = Math.max(-50, Math.min(56, p.x + mx * SPEED * dt));
        p.z = Math.max(-42, Math.min(95, p.z + mz * SPEED * dt));
        const targetYaw = Math.atan2(mx, mz); // la figura mira a +Z local
        let dYaw = targetYaw - PLAYER.yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        PLAYER.yaw += dYaw * Math.min(1, dt * 12);
        PLAYER.root.rotation.y = PLAYER.yaw;
        PLAYER.walkPh += dt * 7.5 * Math.min(1, len);
      }
      // bancos: detectar cercanía + botón de sentarse
      NEAR_BENCH = null;
      for (const b of BENCHES) {
        if (Math.hypot(PLAYER.root.position.x - b.x, PLAYER.root.position.z - b.z) < 1.9) {
          NEAR_BENCH = b;
          break;
        }
      }
      const sitBtn = document.getElementById('sitbtn');
      if (sitBtn) sitBtn.style.display = (NEAR_BENCH && SIT.target === 0) ? 'flex' : 'none';
      // sentarse: imán al asiento + mezcla de pose
      SIT.amt += (SIT.target - SIT.amt) * Math.min(1, dt * 6);
      if (SIT.target === 1 && NEAR_BENCH) {
        const k = Math.min(1, dt * 8);
        PLAYER.root.position.x += (NEAR_BENCH.x - PLAYER.root.position.x) * k;
        PLAYER.root.position.z += (NEAR_BENCH.z - PLAYER.root.position.z) * k;
        let dY = NEAR_BENCH.yaw - PLAYER.yaw;
        while (dY > Math.PI) dY -= Math.PI * 2;
        while (dY < -Math.PI) dY += Math.PI * 2;
        PLAYER.yaw += dY * k;
        PLAYER.root.rotation.y = PLAYER.yaw;
      }
      // mezcla idle↔caminata suave + FK → regenerar la malla esculpida
      PLAYER.moveAmt += ((moving && SIT.amt < 0.3 ? Math.min(1, len) : 0) - PLAYER.moveAmt) * Math.min(1, dt * 8);
      let J: Joints = poseCartoon(t, PLAYER.walkPh, PLAYER.moveAmt);
      if (SIT.amt > 0.01) J = mixJoints(J, poseSit(t), SIT.amt);
      // emote: gesto + globito sobre la cabeza
      const eT = t - EMOTE.start;
      if (eT >= 0 && eT < 2.4) {
        applyGesture(J, EMOTE.type, eT, t);
        if (emoPlane) {
          emoPlane.isVisible = true;
          emoPlane.position.y = 1.95 + eT * 0.22 - (SIT.amt > 0.5 ? 0.45 : 0);
        }
      } else if (emoPlane) {
        emoPlane.isVisible = false;
      }
      buildFigure(J);
      PLAYER.mesh.updateVerticesData('position', FIG.pos as Float32Array);
      VertexData.ComputeNormals(FIG.pos, FIG.idx, PLAYER.normals);
      PLAYER.mesh.updateVerticesData('normal', PLAYER.normals);
      decalPositions(J, PLAYER.decalPos, DEC_U, DEC_V, DEC_PHI, DEC_T0, DEC_T1);
      PLAYER.decal.updateVerticesData('position', PLAYER.decalPos);
      // puertas-portal: pulso + hint al acercarse
      let nearPortal: { url: string; label: string; mat: StandardMaterial } | null = null;
      for (const d of PORTAL_DOORS) {
        d.mat.emissiveColor.set(0.42, 0.42, 0.42);
        if (!nearPortal && Math.hypot(PLAYER.root.position.x - d.x, PLAYER.root.position.z - d.z) < 5) {
          nearPortal = d;
        }
      }
      if (nearPortal) {
        const pulse = 0.55 + 0.18 * Math.sin(t * 5);
        nearPortal.mat.emissiveColor.set(pulse, pulse, pulse);
      }
      if (!PHINT) PHINT = document.getElementById('phint');
      if (PHINT) {
        if (nearPortal) {
          PHINT.style.display = 'block';
          PHINT.textContent = nearPortal.url
            ? '⚽ ' + nearPortal.label + ' — tocá la puerta para jugar'
            : '🚧 ' + nearPortal.label;
        } else {
          PHINT.style.display = 'none';
        }
      }
      camera.target.x += (PLAYER.root.position.x - camera.target.x) * 0.12;
      camera.target.z += (PLAYER.root.position.z - camera.target.z) * 0.12;
      camera.target.y += (PLAYER.root.position.y + 1.0 - camera.target.y) * 0.12;
    } else if (performance.now() - lastInteract > 6000) {
      camera.alpha += 0.00011 * scene.getEngine().getDeltaTime();
    }
  });

  return scene;
}

// ─── Boot blindado: si no hay WebGL (jsdom/harness) avisa sin crashear ──
function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const err = document.getElementById('err');
  const fail = (msg: string): void => {
    if (err) { err.style.display = 'block'; err.textContent = '[maplab] ' + msg; }
  };
  if (!canvas) { fail('no canvas'); return; }
  try {
    const engine = new Engine(canvas, true, { stencil: false, powerPreference: 'high-performance' });
    // nitidez en mobile sin reventar el fill-rate del Mali (DPR cap 1.75)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    engine.setHardwareScalingLevel(1 / dpr);
    const scene = buildScene(engine, canvas);
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());

    // ─── ENTRADA OBLIGATORIA: dibujá tu cara + nombre ──────────────────
    const $id = (s: string): HTMLElement => document.getElementById(s) as HTMLElement;
    const facecv = $id('facecv') as HTMLCanvasElement;
    const iname = $id('iname') as HTMLInputElement;
    const ienter = $id('ienter') as HTMLButtonElement;
    const fctx = facecv.getContext('2d') as CanvasRenderingContext2D;
    const SKINBG = '#e8b88f';
    fctx.fillStyle = SKINBG;
    fctx.fillRect(0, 0, 256, 256);
    let ink = '#2b1c12';
    let drew = 0;
    let drawing = false;
    let lx = 0;
    let ly = 0;
    const validate = (): void => {
      ienter.disabled = !(iname.value.trim().length >= 2 && drew > 0);
    };
    const cvPos = (e: PointerEvent): [number, number] => {
      const r = facecv.getBoundingClientRect();
      return [(e.clientX - r.left) * 256 / r.width, (e.clientY - r.top) * 256 / r.height];
    };
    facecv.addEventListener('pointerdown', (e) => {
      drawing = true;
      [lx, ly] = cvPos(e);
      facecv.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    facecv.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const [x, y] = cvPos(e);
      fctx.strokeStyle = ink === 'ERASE' ? SKINBG : ink;
      fctx.lineWidth = ink === 'ERASE' ? 24 : 9;
      fctx.lineCap = 'round';
      fctx.beginPath();
      fctx.moveTo(lx, ly);
      fctx.lineTo(x, y);
      fctx.stroke();
      lx = x;
      ly = y;
      drew++;
      validate();
    });
    window.addEventListener('pointerup', () => { drawing = false; });
    document.querySelectorAll('#tools .tool').forEach((el) => {
      el.addEventListener('click', () => {
        const c = (el as HTMLElement).dataset.c as string;
        if (c === 'CLEAR') {
          fctx.fillStyle = SKINBG;
          fctx.fillRect(0, 0, 256, 256);
          drew = 0;
          validate();
          return;
        }
        ink = c;
        document.querySelectorAll('#tools .tool').forEach((t2) => t2.classList.remove('on'));
        el.classList.add('on');
      });
    });
    iname.addEventListener('input', validate);
    // cara/nombre guardados: precarga (igual te muestra la entrada)
    try {
      const sn = localStorage.getItem('maplab_name');
      const sf = localStorage.getItem('maplab_face');
      if (sn) iname.value = sn;
      if (sf) {
        const img = new Image();
        img.onload = () => {
          fctx.drawImage(img, 0, 0, 256, 256);
          drew = Math.max(drew, 1);
          validate();
        };
        img.src = sf;
      }
    } catch { /* sin storage, no pasa nada */ }
    validate();

    const enterGame = (): void => {
      if (PLAYER) return;
      const nombre = iname.value.trim().slice(0, 14) || 'WACHO';
      try {
        localStorage.setItem('maplab_name', nombre);
        localStorage.setItem('maplab_face', facecv.toDataURL('image/png'));
      } catch { /* ídem */ }
      PLAYER = buildPlayer(scene, facecv, nombre);
      $id('intro').style.display = 'none';
      $id('joy').style.display = 'block';
      $id('emobtn').style.display = 'flex';
      const cam = scene.activeCamera as ArcRotateCamera;
      cam.alpha = -Math.PI / 2;
      cam.beta = 1.22;
      cam.radius = 9;
      cam.lowerRadiusLimit = 4;
      const hint = document.getElementById('hint');
      if (hint) {
        hint.textContent = 'joystick para caminar · arrastrá para girar';
        hint.style.opacity = '1';
        setTimeout(() => { hint.style.opacity = '0'; }, 7000);
      }
    };
    ienter.addEventListener('click', enterGame);

    // ─── joystick táctil ────────────────────────────────────────────────
    const joy = $id('joy');
    const knob = $id('knob');
    let jid = -1;
    const joyMove = (e: PointerEvent): void => {
      const r = joy.getBoundingClientRect();
      let vx = e.clientX - (r.left + r.width / 2);
      let vy = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(vx, vy);
      const MAX = 44;
      if (l > MAX) { vx = vx / l * MAX; vy = vy / l * MAX; }
      INPUT.jx = vx / MAX;
      INPUT.jy = vy / MAX;
      knob.style.transform = `translate(calc(-50% + ${vx}px), calc(-50% + ${vy}px))`;
    };
    joy.addEventListener('pointerdown', (e) => {
      jid = e.pointerId;
      joy.setPointerCapture(jid);
      joyMove(e);
      e.preventDefault();
      e.stopPropagation();
    });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === jid) joyMove(e); });
    const joyEnd = (): void => {
      jid = -1;
      INPUT.jx = 0;
      INPUT.jy = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    };
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);

    // ─── sentarse + panel de 24 emotes ──────────────────────────────────
    const sitBtn = $id('sitbtn');
    sitBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (NEAR_BENCH) SIT.target = 1;
      sitBtn.style.display = 'none';
    });
    const emoBtn = $id('emobtn');
    const emoPanel = $id('emopanel');
    for (let i = 0; i < EMOTES.length; i++) {
      const b = document.createElement('div');
      b.className = 'emo';
      b.textContent = EMOTES[i];
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showEmote(scene, i);
        emoPanel.style.display = 'none';
      });
      emoPanel.appendChild(b);
    }
    emoBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      emoPanel.style.display = emoPanel.style.display === 'grid' ? 'none' : 'grid';
    });

    // ─── teclado (desktop) ──────────────────────────────────────────────
    const keys = new Set<string>();
    const updKeys = (): void => {
      INPUT.kx = ((keys.has('d') || keys.has('arrowright')) ? 1 : 0) - ((keys.has('a') || keys.has('arrowleft')) ? 1 : 0);
      INPUT.ky = ((keys.has('s') || keys.has('arrowdown')) ? 1 : 0) - ((keys.has('w') || keys.has('arrowup')) ? 1 : 0);
    };
    window.addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); updKeys(); });
    window.addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); updKeys(); });

    // handle de dev para capturas/automatización (shot-maplab.mjs)
    (window as unknown as Record<string, unknown>).__maplab = {
      scene, camera: scene.activeCamera, enterGame,
      getPlayer: () => PLAYER, input: INPUT, facecv,
    };
    // ocultar el hint a los 7s
    setTimeout(() => {
      const hint = document.getElementById('hint');
      if (hint) hint.style.opacity = '0';
    }, 7000);
  } catch (e) {
    fail((e as Error)?.message ?? String(e));
  }
}

boot();
