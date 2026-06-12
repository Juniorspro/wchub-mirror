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
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  GlowLayer,
  ImageProcessingConfiguration,
  PointLight,
  ShadowGenerator,
  SSAO2RenderingPipeline,
  VolumetricLightScatteringPostProcess,
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
import grassUrl from '../assets/sprite/sprite_ground-grass_1813ec.png';
import grassTuftUrl from '../assets/sprite/sprite_grass-tuft_665842.png';
import oakTreeUrl from '../assets/sprite/sprite_oak-tree_154b7e.png';
import flagstoneUrl from '../assets/sprite/sprite_tex-flagstone_14c15b.webp';
import woodPlanksUrl from '../assets/sprite/sprite_tex-wood-planks_656cc1.webp';
import cutStoneUrl from '../assets/sprite/sprite_tex-cut-stone_525147.webp';
import turfUrl from '../assets/sprite/sprite_stadium-turf_f0a345.png';
import crowdUrl from '../assets/sprite/sprite_stadium-crowd_1c49a4.png';
import bannerUrl from '../assets/bg/bg_poster-worldcup-banner_e92888.webp';
// estampados de remera (assets del original)
import shirtGalaxyUrl from '../assets/sprite/sprite_shirt-galaxy_f0ec76.png';
import shirtGeoUrl from '../assets/sprite/sprite_shirt-geometric_82bec3.png';
import shirtTropUrl from '../assets/sprite/sprite_shirt-tropical_a99ba7.png';
// música del original (loop de feria + calma de estadio, switch por zona)
import bgmFairUrl from '../assets/bgm/bgm_bgm-fair-loop_2f7397.mp3';
import bgmCalmUrl from '../assets/bgm/bgm_bgm-stadium-calm_060593.mp3';
// carteles del juego original (covers de portales + lámina del mundial)
import coverCardsUrl from '../assets/sprite/sprite_portal-cover-cards_abc1fd.webp';
import coverDribblerUrl from '../assets/sprite/sprite_portal-cover-dribbler_3b541b.webp';
import coverGoalieUrl from '../assets/sprite/sprite_portal-cover-goalie_0695f6.webp';
import coverJugglerUrl from '../assets/sprite/sprite_portal-cover-juggler_fe5b6e.webp';
import coverRacingUrl from '../assets/sprite/sprite_portal-cover-racing_c7b1b5.webp';
import portraitUrl from '../assets/portrait/portrait_poster-worldcup-portrait_69e0b1.webp';
// el humanoide esculpido del viewer (figlab) porteado: malla por frame
import { FIG, buildFigure, J0, poseCartoon, poseSit, mixJoints, paintOutfit, decalPositions, headFrame, skeletonPoints, type Joints } from './figura';
// física REAL (ragdoll + pelota): cannon-es
import * as CANNON from 'cannon-es';
// ONLINE (como el original): cliente Colyseus — se activa con ?ws=URL
// o localStorage 'maplab_ws' (la sala está en server/src/maplab-room.ts)
import { Client as ColyseusClient, type Room as ColyseusRoom } from 'colyseus.js';

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
const EST_IN_A = EST_A - 6.4;      // borde interior de tribunas
const EST_IN_B = EST_B - 6.4;
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
  COLLIDERS.push({ x, z, r: 0.25 });
  LAMP_POS.push({ x, z });
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
  pitch.receiveShadows = true;

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

  // arcos DE VERDAD: postes + travesaño + RED + marcador arriba
  const goalMat = stdMat(scene, 'cancha-goal', '#f4f4ee');
  const netTex = new DynamicTexture('net-tex', { width: 128, height: 128 }, scene, true);
  const nc2 = netTex.getContext() as unknown as CanvasRenderingContext2D;
  nc2.clearRect(0, 0, 128, 128);
  nc2.strokeStyle = 'rgba(244,244,238,0.95)';
  nc2.lineWidth = 3;
  for (let i = 0; i <= 8; i++) {
    nc2.beginPath(); nc2.moveTo(i * 16, 0); nc2.lineTo(i * 16, 128); nc2.stroke();
    nc2.beginPath(); nc2.moveTo(0, i * 16); nc2.lineTo(128, i * 16); nc2.stroke();
  }
  netTex.update();
  netTex.hasAlpha = true;
  const netMat = new StandardMaterial('net-mat', scene);
  netMat.diffuseTexture = netTex;
  netMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
  netMat.specularColor = new Color3(0, 0, 0);
  netMat.backFaceCulling = false;
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
    // RED: fondo + techo + costados (rejilla con alpha)
    const nb = MeshBuilder.CreatePlane('net-back', { width: 5, height: 2.3 }, scene);
    nb.position.set(cx, 1.15, gz + sign * 1.0);
    nb.material = netMat;
    nb.isPickable = false;
    const nt = MeshBuilder.CreatePlane('net-top', { width: 5, height: 1.0 }, scene);
    nt.position.set(cx, 2.28, gz + sign * 0.5);
    nt.rotation.x = Math.PI / 2;
    nt.material = netMat;
    nt.isPickable = false;
    for (const px of [-2.4, 2.4]) {
      const ns = MeshBuilder.CreatePlane('net-side', { width: 1.0, height: 2.3 }, scene);
      ns.position.set(cx + px, 1.15, gz + sign * 0.5);
      ns.rotation.y = Math.PI / 2;
      ns.material = netMat;
      ns.isPickable = false;
    }
    // MARCADOR sobre el arco (se resetea cada 3 minutos)
    const btex = new DynamicTexture(`board-${sign}`, { width: 256, height: 128 }, scene, true);
    const bmat2 = new StandardMaterial(`board-mat-${sign}`, scene);
    bmat2.diffuseTexture = btex;
    bmat2.emissiveTexture = btex;
    bmat2.emissiveColor = new Color3(0.55, 0.55, 0.55);
    bmat2.specularColor = new Color3(0, 0, 0);
    const bplane = MeshBuilder.CreatePlane(`board-${sign}`, { width: 2.6, height: 1.3 }, scene);
    bplane.position.set(cx, 3.75, gz + sign * 0.9);
    bplane.rotation.y = sign > 0 ? 0 : Math.PI; // de cara a la cancha
    bplane.material = bmat2;
    bplane.isPickable = false;
    for (const px of [-1.0, 1.0]) {
      const bpost = MeshBuilder.CreateCylinder('board-post', { diameter: 0.1, height: 1.0, tessellation: 8 }, scene);
      bpost.position.set(cx + px, 2.75, gz + sign * 0.9);
      bpost.material = goalMat;
      bpost.isPickable = false;
    }
    const g: GoalBoard = { sign, score: 0, tex: btex, cool: false };
    GOALS.push(g);
    paintBoard(g);
  }

  // pelota PATEABLE: root sincronizado con el cuerpo físico
  const ballRoot = new TransformNode('cancha-ball-root', scene);
  ballRoot.position.set(cx + 1.2, 0.34, cz - 1.5);
  BALLST = { root: ballRoot, home: { x: cx + 1.2, y: 0.45, z: cz - 1.5 } };
  const ballMat = stdMat(scene, 'cancha-ball', '#f4f4ee');
  const patchMat = stdMat(scene, 'cancha-ball-patch', '#1a1a1d');
  const ball = MeshBuilder.CreateSphere('cancha-ball', { diameter: 0.55, segments: 14 }, scene);
  ball.position.set(cx + 1.2, 0.34, cz - 1.5);
  ball.material = ballMat;
  SHADOW_CASTERS.push(ball);
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
    patch.setParent(ballRoot);
  }
  ball.setParent(ballRoot);

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
    registerBench(cx - W / 2 - 1.6, cz + bz, Math.PI / 2);
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
  COLLIDERS.push({ x: cx, z: cz, r: 2.2 }); // pedestal del muñeco
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
  SHADOW_CASTERS.push(body);
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
  COLLIDERS.push({ x: cx, z: cz, r: 2.1 }); // copa gigante
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

// Tablón de fixtures EN VIVO (misma fuente que el original: openfootball)
let FIXTURE_TEX: DynamicTexture | null = null;
function paintFixtureBoard(rows: string[]): void {
  if (!FIXTURE_TEX) return;
  const c = FIXTURE_TEX.getContext() as unknown as CanvasRenderingContext2D;
  c.fillStyle = '#10204a';
  c.fillRect(0, 0, 512, 320);
  c.strokeStyle = '#e8c84a';
  c.lineWidth = 8;
  c.strokeRect(4, 4, 504, 312);
  c.fillStyle = '#e8c84a';
  c.textAlign = 'center';
  c.font = 'bold 38px Inter, system-ui, sans-serif';
  c.fillText('★ WORLD CUP 2026 ★', 256, 48);
  c.font = 'bold 27px Inter, system-ui, sans-serif';
  c.fillStyle = '#f3ecd9';
  for (let i = 0; i < Math.min(5, rows.length); i++) c.fillText(rows[i], 256, 100 + i * 44, 480);
  FIXTURE_TEX.update();
}
function buildFixtureBoard(scene: Scene, x: number, z: number, yaw: number,
  woodDarkMat: StandardMaterial): void {
  const tex = new DynamicTexture('fixture-tex', { width: 512, height: 320 }, scene, true);
  FIXTURE_TEX = tex;
  paintFixtureBoard(['cargando…']);
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
  SHADOW_CASTERS.push(add(MeshBuilder.CreateBox(`${def.id}-counter`, { width: 3.2, height: 0.95, depth: 0.8 }, scene), woodMat, 0, 0.475, 0.9));
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
    SHADOW_CASTERS.push(panel);
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
  vx: number;
  vz: number;
}
let PLAYER: Player | null = null;
let LASTJ: Joints | null = null; // última pose construida (para el ragdoll)
let PAUSED = false;
// jugadores remotos de CUERPO ENTERO: figura + outfit + cara + anims
interface Remote {
  root: TransformNode;
  mesh: Mesh;
  decal: Mesh;
  decalPos: Float32Array;
  outfitTex: DynamicTexture;
  faceTex: DynamicTexture;
  st: OutfitSt;
  hat: TransformNode | null;
  scarf: TransformNode | null;
  bubble: Mesh | null;
  bubbleTex: DynamicTexture | null;
  bubbleUntil: number;
  tx: number; tz: number; tyaw: number;
  sy: number; m: number; sit: number; sitAmt: number;
  walkPh: number; emoIdx: number; emoStart: number;
}
const REMOTES = new Map<string, Remote>();
let NETROOM: ColyseusRoom | null = null;
let lastNetSend = 0;
let NORM_SCRATCH: Float32Array | null = null;
let BALL_OWN = false;
let lastBallSend = 0;
function netSendState(): void {
  if (NETROOM) NETROOM.send('state', { outfit: OUTFIT_ST, name: (localStorage.getItem('maplab_name') || 'wacho') });
}
function netSendFace(): void {
  if (!NETROOM || !FACECV) return;
  // composito + anteojos a jpeg chico (viaja una vez)
  const tmp = document.createElement('canvas');
  tmp.width = 512;
  tmp.height = 256;
  const tc = tmp.getContext('2d') as CanvasRenderingContext2D;
  tc.drawImage(FACECV, 0, 0, 512, 256);
  NETROOM.send('face', { jpg: tmp.toDataURL('image/jpeg', 0.65) });
}
function remoteFor(scene: Scene, id: string, name: string): Remote {
  let r = REMOTES.get(id);
  if (r) return r;
  const root = new TransformNode('remote-' + id, scene);
  root.scaling.setAll(PSCALE);
  // figura completa (mismos índices/uvs que el jugador)
  buildFigure(J0());
  const mesh = new Mesh('rem-fig-' + id, scene);
  const vd = new VertexData();
  vd.positions = new Float32Array(FIG.pos as Float32Array);
  vd.indices = FIG.idx as Uint16Array;
  const nor = new Float32Array(FIG.vc * 3);
  VertexData.ComputeNormals(FIG.pos, FIG.idx, nor);
  vd.normals = nor;
  const meta = FIG.meta as number[];
  const ouvs = new Float32Array(FIG.vc * 2);
  for (let i = 0; i < FIG.vc; i++) {
    const b = BANDS[meta[i * 3]] || BANDS[7];
    ouvs[i * 2] = meta[i * 3 + 2] < 0 ? 0.5 : meta[i * 3 + 2] / 6.2832;
    ouvs[i * 2 + 1] = b[0] + meta[i * 3 + 1] * (b[1] - b[0]);
  }
  vd.uvs = ouvs;
  vd.applyToMesh(mesh, true);
  const outfitTex = new DynamicTexture('rem-outfit-' + id, { width: 256, height: 512 }, scene, true);
  const st: OutfitSt = { remera: '#f2f2ee', remeraPat: -1, pantalon: '#1d1d22', zapas: '#3dbf5a', piel: '#e8b88f', hat: -1, glasses: -1, scarf: -1 };
  paintOutfitTexInto(outfitTex, st);
  const mat = new StandardMaterial('rem-mat-' + id, scene);
  mat.diffuseTexture = outfitTex;
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = false;
  mesh.material = mat;
  mesh.parent = root;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  // decal de cara (carita default hasta que llegue la suya)
  const decalPos = new Float32Array((DEC_U + 1) * (DEC_V + 1) * 3);
  decalPositions(J0(), decalPos, DEC_U, DEC_V, DEC_PHI, DEC_T0, DEC_T1);
  const dvd = new VertexData();
  dvd.positions = decalPos;
  const uvs2 = new Float32Array((DEC_U + 1) * (DEC_V + 1) * 2);
  const didx2: number[] = [];
  let k4 = 0;
  for (let j = 0; j <= DEC_V; j++) {
    for (let i = 0; i <= DEC_U; i++) {
      uvs2[k4++] = i / DEC_U;
      uvs2[k4++] = 1 - j / DEC_V;
    }
  }
  for (let j = 0; j < DEC_V; j++) {
    for (let i = 0; i < DEC_U; i++) {
      const a = j * (DEC_U + 1) + i;
      didx2.push(a, a + DEC_U + 1, a + 1, a + 1, a + DEC_U + 1, a + DEC_U + 2);
    }
  }
  dvd.uvs = uvs2;
  dvd.indices = didx2;
  const decal = new Mesh('rem-cara-' + id, scene);
  dvd.applyToMesh(decal, true);
  const faceTex = new DynamicTexture('rem-face-' + id, { width: 1024, height: 512 }, scene, true);
  const fc3 = faceTex.getContext() as unknown as CanvasRenderingContext2D;
  fc3.fillStyle = '#e8b88f';
  fc3.fillRect(0, 0, 1024, 512);
  faceTex.update();
  const dmat2 = new StandardMaterial('rem-face-mat-' + id, scene);
  dmat2.diffuseTexture = faceTex;
  dmat2.emissiveColor = new Color3(0.28, 0.28, 0.28);
  dmat2.specularColor = new Color3(0, 0, 0);
  dmat2.backFaceCulling = false;
  decal.material = dmat2;
  decal.parent = root;
  decal.isPickable = false;
  decal.alwaysSelectAsActiveMesh = true;
  // nombre flotante
  const ntex = new DynamicTexture('rem-name-' + id, { width: 256, height: 64 }, scene, true);
  const nc2 = ntex.getContext() as unknown as CanvasRenderingContext2D;
  nc2.clearRect(0, 0, 256, 64);
  nc2.lineWidth = 7;
  nc2.strokeStyle = '#10204a';
  nc2.textAlign = 'center';
  nc2.textBaseline = 'middle';
  nc2.font = 'bold 36px Inter, system-ui, sans-serif';
  nc2.strokeText(name, 128, 32, 240);
  nc2.fillStyle = '#ffffff';
  nc2.fillText(name, 128, 32, 240);
  ntex.update();
  ntex.hasAlpha = true;
  const nmat = new StandardMaterial('rem-name-mat-' + id, scene);
  nmat.diffuseTexture = ntex;
  nmat.emissiveColor = new Color3(1, 1, 1);
  nmat.useAlphaFromDiffuseTexture = true;
  nmat.disableLighting = true;
  nmat.backFaceCulling = false;
  const np = MeshBuilder.CreatePlane('rem-name-pl', { width: 1.3, height: 0.34 }, scene);
  np.parent = root;
  np.position.y = 1.72;
  np.billboardMode = Mesh.BILLBOARDMODE_Y;
  np.material = nmat;
  np.isPickable = false;
  r = {
    root, mesh, decal, decalPos, outfitTex, faceTex, st,
    hat: null, scarf: null, bubble: null, bubbleTex: null, bubbleUntil: 0,
    tx: 0, tz: 0, tyaw: 0, sy: 0, m: 0, sit: 0, sitAmt: 0,
    walkPh: 0, emoIdx: -1, emoStart: -10,
  };
  REMOTES.set(id, r);
  return r;
}
function connectNet(scene: Scene, nombre: string): void {
  // ONLINE AUTOMÁTICO al entrar. Resolución del endpoint (en orden):
  //   1. ?ws=wss://...        (override manual)
  //   2. localStorage maplab_ws
  //   3. window.WCHUB_WS      (lo inyecta la app al hostear el HTML)
  //   4. servido por http(s) → mismo host (patrón Worker del original)
  //   5. file:// → ws://localhost:2567 (dev local)
  let url = '';
  try {
    url = new URLSearchParams(location.search).get('ws')
      || localStorage.getItem('maplab_ws')
      || ((window as unknown as Record<string, unknown>).WCHUB_WS as string)
      || '';
  } catch { /* sin storage */ }
  if (!url) {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
    } else {
      url = 'ws://localhost:2567';
    }
  }
  try {
    const client = new ColyseusClient(url);
    // joinOrCreate llena la sala "patio" que tenga lugar y si están todas
    // completas (30 c/u) crea una nueva — matchmaking automático
    client.joinOrCreate('patio', { name: nombre }).then((room) => {
      NETROOM = room as ColyseusRoom;
      netSendState();
      netSendFace();
      room.onMessage('pos', (d: { id: string; x: number; z: number; yaw: number; name: string; m: number; sy: number; sit: number; wph: number }) => {
        const r = remoteFor(scene, d.id, d.name || 'wacho');
        r.tx = d.x;
        r.tz = d.z;
        r.tyaw = d.yaw;
        r.m = d.m || 0;
        r.sy = d.sy || 0;
        r.sit = d.sit || 0;
        r.walkPh = d.wph || r.walkPh;
      });
      room.onMessage('state', (d: { id: string; outfit: OutfitSt; name: string }) => {
        const r = remoteFor(scene, d.id, d.name || 'wacho');
        Object.assign(r.st, d.outfit);
        paintOutfitTexInto(r.outfitTex, r.st);
        if (r.hat) { r.hat.dispose(false, true); r.hat = null; }
        if (r.scarf) { r.scarf.dispose(false, true); r.scarf = null; }
        r.hat = buildHatNode(scene, r.st.hat, r.root);
        r.scarf = buildScarfNode(scene, r.st.scarf, r.root);
      });
      room.onMessage('face', (d: { id: string; jpg: string }) => {
        const r = REMOTES.get(d.id);
        if (!r) return;
        const img = new Image();
        img.onload = () => {
          const c = r.faceTex.getContext() as unknown as CanvasRenderingContext2D;
          c.save();
          c.translate(0, 512);
          c.scale(1, -1);
          c.drawImage(img, 0, 0, 1024, 512);
          c.restore();
          r.faceTex.update(false);
        };
        img.src = d.jpg;
      });
      room.onMessage('emote', (d: { id: string; i: number }) => {
        const r = REMOTES.get(d.id);
        if (r) {
          r.emoIdx = d.i;
          r.emoStart = performance.now() / 1000;
        }
      });
      room.onMessage('chat', (d: { id: string; txt: string }) => {
        const r = REMOTES.get(d.id);
        if (r) remoteBubble(scene, r, d.txt);
      });
      room.onMessage('ball', (d: { x: number; y: number; z: number; vx: number; vy: number; vz: number }) => {
        if (BALLB) { // pelota COMPARTIDA: el que patea manda
          BALLB.position.set(d.x, d.y, d.z);
          BALLB.velocity.set(d.vx, d.vy, d.vz);
          BALL_OWN = false;
        }
      });
      room.onMessage('leave', (id: string) => {
        const r = REMOTES.get(id);
        if (r) {
          r.root.dispose(false, true);
          REMOTES.delete(id);
        }
      });
    }).catch(() => { /* server caído: seguimos offline */ });
  } catch { /* ídem */ }
}
function remoteBubble(scene: Scene, r: Remote, txt: string): void {
  if (!r.bubble) {
    r.bubbleTex = new DynamicTexture('rem-bub', { width: 512, height: 160 }, scene, true);
    r.bubbleTex.hasAlpha = true;
    const m = new StandardMaterial('rem-bub-mat', scene);
    m.diffuseTexture = r.bubbleTex;
    m.emissiveColor = new Color3(1, 1, 1);
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    r.bubble = MeshBuilder.CreatePlane('rem-bub-pl', { width: 2.0, height: 0.62 }, scene);
    r.bubble.parent = r.root;
    r.bubble.billboardMode = Mesh.BILLBOARDMODE_ALL;
    r.bubble.position.y = 2.05;
    r.bubble.material = m;
    r.bubble.isPickable = false;
  }
  const c = (r.bubbleTex as DynamicTexture).getContext() as unknown as CanvasRenderingContext2D;
  c.save();
  c.clearRect(0, 0, 512, 160);
  c.translate(0, 160);
  c.scale(1, -1);
  c.fillStyle = '#ffffff';
  c.beginPath();
  (c as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, rr: number) => void }).roundRect(8, 8, 496, 116, 26);
  c.fill();
  c.fillStyle = '#1b2030';
  fitText(c, txt.slice(0, 48), 256, 66, 460, 34, '600');
  c.restore();
  (r.bubbleTex as DynamicTexture).update(false);
  r.bubble.isVisible = true;
  r.bubbleUntil = performance.now() / 1000 + 5;
}
let BGM_FAIR: HTMLAudioElement | null = null;
let BGM_CALM: HTMLAudioElement | null = null;
// dino pixel art (el guía y los pósters de la mascota)
const DINO_PX = [
  '..........ooooooo.',
  '..........obwoooo.',
  '..........ooooooo.',
  '..........oooo....',
  '..........ooooooo.',
  'o........ooooo....',
  'oo......oooooo....',
  'ooo....ooooooodd..',
  'oooo..ooooooooo...',
  'ooooooooooooooo...',
  'oooooooooooooo....',
  '.oooooooooooo.....',
  '..oooooooooo......',
  '...oooooooo.......',
  '....ooo..oo.......',
  '....oo....oo......',
  '....oo.....oo.....',
  '....ooo....ooo....',
];
const DCOLS: Record<string, string> = { o: '#ff7a2d', d: '#d95f1e', w: '#ffffff', b: '#14171f' };
function drawDino(c: CanvasRenderingContext2D, px: number, ox: number, oy: number): void {
  for (let y = 0; y < DINO_PX.length; y++) {
    for (let x = 0; x < DINO_PX[y].length; x++) {
      const ch = DINO_PX[y][x];
      if (ch === '.') continue;
      c.fillStyle = DCOLS[ch];
      c.fillRect(ox + x * px, oy + y * px, px, px);
    }
  }
}
// texto centrado SIN cortes: achica la fuente hasta que entre
function fitText(c: CanvasRenderingContext2D, txt: string, cx: number, cy: number, maxW: number, size: number, weight = '800'): void {
  let s = size;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  do {
    c.font = `${weight} ${s}px Inter, system-ui, sans-serif`;
    s -= 2;
  } while (c.measureText(txt).width > maxW && s > 10);
  c.fillText(txt, cx, cy);
}
const INPUT = { kx: 0, ky: 0, jx: 0, jy: 0 };
// puertas-portal del estadio (hint de cercanía + pulso)
const PORTAL_DOORS: Array<{ x: number; z: number; url: string; label: string; mat: StandardMaterial }> = [];
let PHINT: HTMLElement | null = null;
// bancos con animación de sentarse
const BENCHES: Array<{ x: number; z: number; yaw: number }> = [];
function registerBench(x: number, z: number, yaw: number): void {
  // dos asientos por banca: corridos ±0.45 sobre el eje largo (X local)
  const ax = Math.cos(yaw);
  const az = -Math.sin(yaw);
  BENCHES.push({ x: x + ax * 0.45, z: z + az * 0.45, yaw });
  BENCHES.push({ x: x - ax * 0.45, z: z - az * 0.45, yaw });
}
let NEAR_BENCH: { x: number; z: number; yaw: number } | null = null;
const SIT = { amt: 0, target: 0 };
// emotes: 24 emojis con gesto + globito sobre la cabeza
const EMOTES = ['😀','😂','😍','😎','🤔','😭','😡','🥳','👍','👎','👏','🙌','💪','🫡','❤️','🔥','⚽','🏆','🎉','😴','🤯','🙏','💃','🤝'];
const EMOTE = { start: -10, type: 0 };
let emoPlane: Mesh | null = null;
let emoTex: DynamicTexture | null = null;

// 24 GESTOS ÚNICOS, uno por emote (envolvente con entrada/salida suave)
function applyGesture(J: Joints, type: number, e: number, t: number): void {
  const env = Math.min(1, e / 0.25, (2.4 - e) / 0.45);
  if (env <= 0) return;
  const o = Math.sin(t * 12);
  switch (type) {
    case 0: J.shAbdR += 2.1 * env; J.elbowR += (0.5 + 0.5 * o) * env; break;                              // 😀 saludo
    case 1: J.spineFwd += Math.abs(Math.sin(t * 8)) * 0.3 * env; J.headNod -= 0.25 * env; J.jaw += 0.06 * env; break; // 😂 carcajada
    case 2: J.shFwdL -= 1.25 * env; J.shFwdR -= 1.25 * env; J.elbowL += 1.6 * env; J.elbowR += 1.6 * env; J.headTilt += 0.18 * env; break; // 😍 manos al corazón
    case 3: J.shFwdL -= 0.9 * env; J.shFwdR -= 0.9 * env; J.elbowL += 1.35 * env; J.elbowR += 1.35 * env; J.headTilt -= 0.15 * env; J.spineFwd -= 0.08 * env; break; // 😎 canchero
    case 4: J.shFwdR -= 1.3 * env; J.elbowR += 1.9 * env; J.headTilt += 0.2 * env; J.headTurn += Math.sin(t * 1.5) * 0.3 * env; break; // 🤔 pensando
    case 5: J.shFwdL -= 1.35 * env; J.shFwdR -= 1.35 * env; J.elbowL += 1.85 * env; J.elbowR += 1.85 * env; J.headNod += 0.35 * env; J.spineFwd += 0.2 * env; break; // 😭 llanto
    case 6: J.elbowL += 0.5 * env; J.elbowR += 0.5 * env; J.twist += Math.sin(t * 16) * 0.18 * env; J.headNod += 0.15 * env; break; // 😡 furia temblando
    case 7: J.pelvisY += Math.abs(Math.sin(e * 9)) * 0.14 * env; J.shAbdL += 2.2 * env; J.shAbdR += 2.2 * env; break; // 🥳 salto festejo
    case 8: J.shFwdR -= 1.25 * env; J.elbowR += 0.25 * env; break;                                          // 👍 pulgar
    case 9: J.shFwdR -= 1.1 * env; J.elbowR += 0.3 * env; J.headTurn += Math.sin(t * 7) * 0.3 * env; break; // 👎 no no
    case 10: J.shFwdL -= 1.1 * env; J.shFwdR -= 1.1 * env; J.elbowL += (0.9 + 0.35 * Math.sin(t * 14)) * env; J.elbowR += (0.9 - 0.35 * Math.sin(t * 14)) * env; break; // 👏 aplauso
    case 11: J.shAbdL += (2.2 + 0.25 * Math.sin(t * 9)) * env; J.shAbdR += (2.2 - 0.25 * Math.sin(t * 9)) * env; J.pelvisY += Math.abs(Math.sin(t * 4.5)) * 0.04 * env; break; // 🙌 olé olé
    case 12: J.shAbdR += 1.25 * env; J.elbowR += 2.05 * env; J.headTurn -= 0.45 * env; break;               // 💪 músculo
    case 13: J.shAbdR += 1.4 * env; J.shFwdR -= 0.85 * env; J.elbowR += 2.3 * env; J.spineFwd -= 0.05 * env; break; // 🫡 saludo militar
    case 14: J.shAbdL += 1.6 * env; J.shAbdR += 1.6 * env; J.elbowL += 1.5 * env; J.elbowR += 1.5 * env; J.headNod -= 0.12 * env; break; // ❤️ corazón arriba
    case 15: J.twist += Math.sin(t * 9) * 0.55 * env; J.shAbdL += 1.1 * env; J.shAbdR += 1.1 * env; J.elbowL += 0.9 * env; J.elbowR += 0.9 * env; break; // 🔥 prendido fuego
    case 16: J.hipFwdR -= Math.max(0, Math.sin(e * 5.5)) * 1.25 * env; J.kneeR += Math.max(0, -Math.sin(e * 5.5)) * 0.8 * env; J.shFwdL -= 0.7 * env; J.spineFwd += 0.1 * env; break; // ⚽ patada
    case 17: J.shAbdL += 0.5 * env; J.shAbdR += 0.5 * env; J.shFwdL -= 1.55 * env; J.shFwdR -= 1.55 * env; J.elbowL += 0.8 * env; J.elbowR += 0.8 * env; J.headNod -= 0.25 * env; break; // 🏆 levantar la copa
    case 18: J.shAbdL += (1.8 + 0.5 * Math.sin(t * 8)) * env; J.shAbdR += (1.8 - 0.5 * Math.sin(t * 8)) * env; J.pelvisY += Math.abs(Math.sin(t * 8)) * 0.06 * env; J.twist += Math.sin(t * 4) * 0.2 * env; break; // 🎉 fiesta
    case 19: J.headTilt += 0.5 * env; J.headNod += 0.3 * env; J.spineSide += 0.18 * env; J.spineFwd += 0.12 * env; J.jaw += 0.05 * env; break; // 😴 mimido
    case 20: J.shAbdL += 1.2 * env; J.shAbdR += 1.2 * env; J.shFwdL -= 1.1 * env; J.shFwdR -= 1.1 * env; J.elbowL += 2.2 * env; J.elbowR += 2.2 * env; J.headNod -= 0.2 * env; break; // 🤯 manos a la cabeza
    case 21: J.shFwdL -= 1.15 * env; J.shFwdR -= 1.15 * env; J.elbowL += 1.7 * env; J.elbowR += 1.7 * env; J.headNod += 0.28 * env; break; // 🙏 plegaria
    case 22: J.swayX += Math.sin(t * 6.5) * 0.09 * env; J.twist += Math.sin(t * 6.5) * 0.4 * env; J.shAbdL += 2.1 * env; J.elbowL += 0.6 * env; J.pelvisY += Math.abs(Math.sin(t * 6.5)) * 0.03 * env; break; // 💃 baile
    default: J.shFwdR -= 1.15 * env; J.elbowR += 0.15 * env; J.spineFwd += 0.16 * env; J.headNod += 0.1 * env; break; // 🤝 trato hecho
  }
}

// ─── outfit equipable (tiendas como el original) ────────────────────────
const PALETA = ['#f2f2ee', '#c14444', '#3a6ea5', '#e8c84a', '#9bd96b', '#d96bc4', '#e89c4a', '#a85dd9', '#1d1d22', '#4aa3a3', '#ff7a5c', '#6bd0ff'];
const OUTFIT_ST = { remera: '#f2f2ee', remeraPat: -1, pantalon: '#1d1d22', zapas: '#3dbf5a', piel: '#e8b88f', hat: -1, glasses: -1, scarf: -1 };
// bandas v de la textura de outfit por parte del cuerpo
const BANDS: Record<number, [number, number]> = {
  0: [0.02, 0.22],  // torso
  1: [0.26, 0.36],  // brazo L
  2: [0.38, 0.48],  // brazo R
  3: [0.52, 0.62],  // pierna L
  5: [0.64, 0.74],  // pierna R
  4: [0.78, 0.84],  // pie L
  6: [0.86, 0.92],  // pie R
  7: [0.94, 0.995], // cabeza
};
let OUTFIT_TEX: DynamicTexture | null = null;
const PAT_IMGS: Record<number, HTMLImageElement> = {};
function patImg(idx: number, url: string): HTMLImageElement {
  if (!PAT_IMGS[idx]) {
    const im = new Image();
    im.onload = () => paintOutfitTex();
    im.src = url;
    PAT_IMGS[idx] = im;
  }
  return PAT_IMGS[idx];
}
type OutfitSt = { remera: string; remeraPat: number; pantalon: string; zapas: string; piel: string; hat: number; glasses: number; scarf: number };
function paintOutfitTexInto(tex: DynamicTexture, st: OutfitSt): void {
  const c = tex.getContext() as unknown as CanvasRenderingContext2D;
  const W = 256;
  const H = 512;
  // franja [v0,v1] → píxeles (v=1 arriba de la textura)
  const strip = (v0: number, v1: number): [number, number] => [(1 - v1) * H, (v1 - v0) * H];
  const fill = (v0: number, v1: number, col: string): void => {
    const [y, h] = strip(v0, v1);
    c.fillStyle = col;
    c.fillRect(0, y, W, h);
  };
  c.fillStyle = st.piel;
  c.fillRect(0, 0, W, H);
  // TORSO: estampado o color (el cuello t>=0.92 queda piel)
  const tb = BANDS[0];
  const tTop = tb[0] + 0.92 * (tb[1] - tb[0]);
  const [ty, th] = strip(tb[0], tTop);
  if (st.remeraPat >= 3) { // assets reales del juego
    const urls = [shirtGalaxyUrl, shirtGeoUrl, shirtTropUrl];
    const im = patImg(st.remeraPat, urls[st.remeraPat - 3]);
    c.fillStyle = st.remera;
    c.fillRect(0, ty, W, th);
    if (im.complete && im.naturalWidth > 0) c.drawImage(im, 0, ty, W, th);
  } else if (st.remeraPat === 0) { // rayas verticales
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 === 0 ? st.remera : '#f4f1e6';
      c.fillRect(i * (W / 8), ty, W / 8, th);
    }
  } else if (st.remeraPat === 1) { // aros horizontales
    for (let i = 0; i < 6; i++) {
      c.fillStyle = i % 2 === 0 ? st.remera : '#f4f1e6';
      c.fillRect(0, ty + i * (th / 6), W, th / 6);
    }
  } else if (st.remeraPat === 2) { // mitades
    c.fillStyle = st.remera;
    c.fillRect(0, ty, W / 2, th);
    c.fillStyle = '#f4f1e6';
    c.fillRect(W / 2, ty, W / 2, th);
  } else {
    c.fillStyle = st.remera;
    c.fillRect(0, ty, W, th);
  }
  // MANGAS: t<0.30 de cada brazo con el color de la remera
  for (const part of [1, 2]) {
    const b = BANDS[part];
    const vS = b[0] + 0.30 * (b[1] - b[0]);
    fill(b[0], vS, st.remera);
  }
  // PIERNAS pantalón, PIES zapas
  fill(BANDS[3][0], BANDS[3][1], st.pantalon);
  fill(BANDS[5][0], BANDS[5][1], st.pantalon);
  fill(BANDS[4][0], BANDS[4][1], st.zapas);
  fill(BANDS[6][0], BANDS[6][1], st.zapas);
  tex.update();
}
let FACETEX: DynamicTexture | null = null;
let FACECV: HTMLCanvasElement | null = null;
let HATNODE: TransformNode | null = null;
let SCARFNODE: TransformNode | null = null;
const SHOPS: Array<{ x: number; z: number; id: string; nombre: string }> = [];
let NEAR_SHOP: { x: number; z: number; id: string; nombre: string } | null = null;
// salto + ragdoll FÍSICO (verlet: partículas + palitos, piso de verdad)
const JUMP = { y: 0, vy: 0, active: false };
interface RagP { x: number; y: number; z: number; r: number; body: CANNON.Body | null }
const RAGD = { on: false, t0: -10, P: [] as RagP[], cons: [] as CANNON.Constraint[] };
const RAG_LINKS: Array<[number, number, number]> = [
  // esqueleto de 11 huesos: 0 pelvis, 1 pecho, 2 cabeza,
  // 3 rodillaL, 4 pieL, 5 rodillaR, 6 pieR,
  // 7 codoL, 8 manoL, 9 codoR, 10 manoR
  [0, 1, 0.40], [1, 2, 0.30],
  [0, 3, 0.27], [3, 4, 0.26],
  [0, 5, 0.27], [5, 6, 0.26],
  [1, 7, 0.24], [7, 8, 0.26],
  [1, 9, 0.24], [9, 10, 0.26],
  [3, 5, 0.16], [7, 9, 0.34],
];
// mundo cannon compartido (ragdoll + pelota); se crea al entrar al juego
let PHYS: CANNON.World | null = null;
let PHYS_MAT: CANNON.Material | null = null;
function initPhysics(): void {
  if (PHYS) return;
  PHYS = new CANNON.World({ gravity: new CANNON.Vec3(0, -13, 0) });
  PHYS_MAT = new CANNON.Material('suelo');
  PHYS.defaultContactMaterial.friction = 0.35;
  PHYS.defaultContactMaterial.restitution = 0.42;
  const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: PHYS_MAT });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  PHYS.addBody(ground);
}
function ragStart(vx: number, vz: number): void {
  if (!PLAYER || !PHYS) return;
  ragClear();
  SIT.target = 0;
  // [radio, masa, patada] por hueso (mismo orden que skeletonPoints)
  const spec: Array<[number, number, number]> = [
    [0.14, 3, 0.3], [0.14, 3, 0.9], [0.16, 2, 1.5],
    [0.06, 0.8, 0.1], [0.07, 0.7, -0.3], [0.06, 0.8, 0.1], [0.07, 0.7, -0.3],
    [0.06, 0.6, 0.7], [0.06, 0.5, 1.1], [0.06, 0.6, 0.7], [0.06, 0.5, 1.1],
  ];
  // pose ACTUAL → posiciones de mundo (el ragdoll arranca tal cual estabas)
  const J = LASTJ ?? J0();
  const pts = skeletonPoints(J);
  PLAYER.root.computeWorldMatrix(true);
  const wm = PLAYER.root.getWorldMatrix();
  const yaw = PLAYER.yaw;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  RAGD.P = spec.map(([r, mass, kick], i) => {
    const w = Vector3.TransformCoordinates(_rv.set(pts[i][0], pts[i][1], pts[i][2]), wm);
    const body = new CANNON.Body({
      mass,
      shape: new CANNON.Sphere(r),
      position: new CANNON.Vec3(w.x, Math.max(r + 0.01, w.y), w.z),
      velocity: new CANNON.Vec3(vx * 1.4 + fx * kick, 1.2 + kick * 0.6, vz * 1.4 + fz * kick),
      linearDamping: 0.25,
      angularDamping: 0.4,
      material: PHYS_MAT as CANNON.Material,
    });
    (PHYS as CANNON.World).addBody(body);
    return { x: w.x, y: w.y, z: w.z, r, body };
  });
  RAGD.cons = RAG_LINKS.map(([a, b, L]) => {
    const c = new CANNON.DistanceConstraint(
      RAGD.P[a].body as CANNON.Body, RAGD.P[b].body as CANNON.Body, L * PSCALE, 90);
    (PHYS as CANNON.World).addConstraint(c);
    return c;
  });
  RAGD.on = true;
  RAGD.t0 = performance.now() / 1000;
}
function ragClear(): void {
  if (!PHYS) return;
  for (const c of RAGD.cons) PHYS.removeConstraint(c);
  for (const q of RAGD.P) if (q.body) PHYS.removeBody(q.body);
  RAGD.cons = [];
  RAGD.P = [];
}
function ragSync(): void {
  for (const q of RAGD.P) {
    if (!q.body) continue;
    q.x = q.body.position.x;
    q.y = q.body.position.y;
    q.z = q.body.position.z;
  }
}
// RAGDOLL 100% físico: las articulaciones salen de los CUERPOS de
// cannon por IK inversa de las fórmulas FK de la figura (cero animación)
const _rv = new Vector3();
function ragdollPose(invM: import('@babylonjs/core').Matrix): Joints {
  const J = J0();
  J.breath = 0.5;
  const loc = (i: number): { x: number; y: number; z: number } => {
    Vector3.TransformCoordinatesToRef(_rv.set(RAGD.P[i].x, RAGD.P[i].y, RAGD.P[i].z), invM, _rv);
    return { x: _rv.x, y: _rv.y, z: _rv.z };
  };
  const clampA = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
  // ángulo entre dos segmentos físicos (mundo: invariante)
  const bend = (a: number, b: number, c: number): number => {
    const v1x = RAGD.P[b].x - RAGD.P[a].x;
    const v1y = RAGD.P[b].y - RAGD.P[a].y;
    const v1z = RAGD.P[b].z - RAGD.P[a].z;
    const v2x = RAGD.P[c].x - RAGD.P[b].x;
    const v2y = RAGD.P[c].y - RAGD.P[b].y;
    const v2z = RAGD.P[c].z - RAGD.P[b].z;
    const l1 = Math.hypot(v1x, v1y, v1z) || 1e-4;
    const l2 = Math.hypot(v2x, v2y, v2z) || 1e-4;
    return Math.acos(clampA((v1x * v2x + v1y * v2y + v1z * v2z) / (l1 * l2), 0.999));
  };
  // dirección del PRIMER hueso (hombro→codo / cadera→rodilla) fija
  // abducción y avance; el doblez es el ángulo físico en codo/rodilla
  const limb = (s: 1 | -1, anchorX: number, anchorY: number, midIdx: number): { abd: number; fwd: number } => {
    const M = loc(midIdx);
    const dx = M.x - s * anchorX;
    const dy = M.y - anchorY;
    const dz = M.z;
    const d = Math.hypot(dx, dy, dz) || 1e-4;
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    const a1 = Math.asin(clampA(ux, 0.999));
    const ca = Math.max(0.08, Math.cos(a1));
    return { abd: clampA(a1 * s, 2.6), fwd: clampA(Math.atan2(-uz / ca, -uy / ca), 2.6) };
  };
  const aL = limb(1, 0.165, 0.922, 7);
  J.shAbdL = aL.abd; J.shFwdL = aL.fwd; J.elbowL = bend(1, 7, 8);
  const aR = limb(-1, 0.165, 0.922, 9);
  J.shAbdR = aR.abd; J.shFwdR = aR.fwd; J.elbowR = bend(1, 9, 10);
  const lL = limb(1, 0.082, 0.60, 3);
  J.hipAbdL = clampA(lL.abd, 1.4); J.hipFwdL = clampA(lL.fwd, 2.2); J.kneeL = bend(0, 3, 4);
  const lR = limb(-1, 0.082, 0.60, 5);
  J.hipAbdR = clampA(lR.abd, 1.4); J.hipFwdR = clampA(lR.fwd, 2.2); J.kneeR = bend(0, 5, 6);
  // cabeza: pecho→cabeza
  const H = loc(2);
  const hx = H.x;
  const hy = H.y - 0.95;
  const hz = H.z;
  const hl = Math.hypot(hx, hy, hz) || 1e-4;
  J.headNod = clampA(Math.atan2(hz / hl, Math.max(0.15, hy / hl)), 0.9);
  J.headTilt = clampA(-Math.atan2(hx / hl, Math.max(0.15, hy / hl)), 0.8);
  return J;
}
// ─── MONEDAS (como el original): se ganan con goles, se gastan en
// tiendas y apuestas; persisten en localStorage ───────────────────────
let COINS = 100;
try { COINS = parseFloat(localStorage.getItem('maplab_coins') || '100'); } catch { /* sin storage */ }
function updCoins(): void {
  const el = document.getElementById('coins');
  if (el) el.textContent = '🪙 ' + (Number.isInteger(COINS) ? COINS : COINS.toFixed(1));
  try { localStorage.setItem('maplab_coins', String(COINS)); } catch { /* ídem */ }
}
function flashCoins(): void {
  const el = document.getElementById('coins');
  if (!el) return;
  el.classList.add('nofunds');
  setTimeout(() => el.classList.remove('nofunds'), 600);
}
let POOL = 0;
try { POOL = parseFloat(localStorage.getItem('maplab_pool') || '0'); } catch { /* sin storage */ }
let OB_TEX: DynamicTexture | null = null;
function paintObelisk(): void {
  if (!OB_TEX) return;
  const oc2 = OB_TEX.getContext() as unknown as CanvasRenderingContext2D;
  const pct = Math.min(100, Math.round((POOL / 200) * 100));
  oc2.fillStyle = '#10204a';
  oc2.fillRect(0, 0, 256, 384);
  oc2.strokeStyle = '#ffd34d';
  oc2.lineWidth = 8;
  oc2.strokeRect(4, 4, 248, 376);
  oc2.fillStyle = '#ffd34d';
  fitText(oc2, 'TOP HERO', 128, 56, 220, 38);
  oc2.fillStyle = '#2a3a64';
  oc2.fillRect(38, 120, 180, 36);
  oc2.fillStyle = '#ffd34d';
  oc2.fillRect(38, 120, 180 * (pct / 100), 36);
  oc2.fillStyle = '#f3ecd9';
  fitText(oc2, pct + '%', 128, 210, 200, 32, '700');
  fitText(oc2, POOL.toFixed(0) + ' / 200 🪙', 128, 262, 220, 24, '600');
  OB_TEX.update();
}
function tryBuy(price: number, fn: () => void): void {
  if (price <= 0 || COINS >= price) {
    COINS -= Math.max(0, price);
    updCoins();
    if (price > 0) { // lo gastado alimenta el POOL del obelisco
      POOL += price;
      try { localStorage.setItem('maplab_pool', String(POOL)); } catch { /* ídem */ }
      paintObelisk();
    }
    fn();
  } else {
    flashCoins();
  }
}
// apuesta activa (fixture board)
const BET = { active: false, team: '', amount: 0, resolveAt: 0 };
// globo de chat sobre el jugador
let chatPlane: Mesh | null = null;
let chatTex: DynamicTexture | null = null;
let chatUntil = 0;
function showChat(scene: Scene, txt: string): void {
  if (!PLAYER) return;
  if (!chatPlane) {
    chatTex = new DynamicTexture('chat-tex', { width: 512, height: 160 }, scene, true);
    chatTex.hasAlpha = true;
    const m = new StandardMaterial('chat-mat', scene);
    m.diffuseTexture = chatTex;
    m.emissiveColor = new Color3(1, 1, 1);
    m.useAlphaFromDiffuseTexture = true;
    m.disableLighting = true;
    m.backFaceCulling = false;
    chatPlane = MeshBuilder.CreatePlane('chat-plane', { width: 2.3, height: 0.72 }, scene);
    chatPlane.parent = PLAYER.root;
    chatPlane.billboardMode = Mesh.BILLBOARDMODE_ALL;
    chatPlane.position.y = 2.45;
    chatPlane.material = m;
    chatPlane.isPickable = false;
  }
  const c = (chatTex as DynamicTexture).getContext() as unknown as CanvasRenderingContext2D;
  c.save();
  c.clearRect(0, 0, 512, 160);
  c.translate(0, 160);
  c.scale(1, -1);
  c.fillStyle = '#ffffff';
  c.beginPath();
  (c as CanvasRenderingContext2D & { roundRect: (x: number, y: number, w: number, h: number, r: number) => void }).roundRect(8, 8, 496, 116, 26);
  c.fill();
  c.beginPath();
  c.moveTo(236, 122);
  c.lineTo(276, 122);
  c.lineTo(256, 152);
  c.closePath();
  c.fill();
  c.fillStyle = '#1b2030';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '600 34px Inter, system-ui, sans-serif';
  const words = txt.split(' ');
  let l1 = '';
  let l2 = '';
  for (const w of words) {
    if (l2 === '' && c.measureText(l1 + ' ' + w).width < 440) l1 = (l1 + ' ' + w).trim();
    else l2 = (l2 + ' ' + w).trim();
  }
  if (l2) {
    c.fillText(l1, 256, 46, 460);
    c.fillText(l2.length > 30 ? l2.slice(0, 29) + '…' : l2, 256, 90, 460);
  } else {
    c.fillText(l1, 256, 66, 460);
  }
  c.restore();
  (chatTex as DynamicTexture).update(false);
  chatPlane.isVisible = true;
  chatUntil = performance.now() / 1000 + 5;
}
// pelota pateable + arcos con marcador (reset cada 3 minutos)
let BALLST: { root: TransformNode; home: { x: number; y: number; z: number } } | null = null;
let BALLB: CANNON.Body | null = null;
interface GoalBoard { sign: 1 | -1; score: number; tex: DynamicTexture; cool: boolean }
const GOALS: GoalBoard[] = [];
let SCORE_RESET_AT = Infinity;
let lastKick = 0;
let lastBoardT = 0;
function paintBoard(g: GoalBoard): void {
  const c = g.tex.getContext() as unknown as CanvasRenderingContext2D;
  c.fillStyle = '#10204a';
  c.fillRect(0, 0, 256, 128);
  c.strokeStyle = '#ffd34d';
  c.lineWidth = 6;
  c.strokeRect(3, 3, 250, 122);
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = '800 64px Inter, system-ui, sans-serif';
  c.fillText(String(g.score), 128, 52);
  const rem = Math.max(0, SCORE_RESET_AT - performance.now() / 1000);
  const mm = Math.floor(rem / 60);
  const ss = Math.floor(rem % 60);
  c.font = '600 26px Inter, system-ui, sans-serif';
  c.fillStyle = '#ffd34d';
  c.fillText('⏱ ' + mm + ':' + String(ss).padStart(2, '0'), 128, 102);
  g.tex.update();
}
function resetBall(): void {
  if (!BALLB || !BALLST) return;
  BALLB.position.set(BALLST.home.x, BALLST.home.y, BALLST.home.z);
  BALLB.velocity.set(0, 0, 0);
  BALLB.angularVelocity.set(0, 0, 0);
}
// colisiones del mapa (círculos) + luces para día/noche
const COLLIDERS: Array<{ x: number; z: number; r: number }> = [];
let LIGHTS: { hemi: HemisphericLight; sun: DirectionalLight } | null = null;
// cartel del arco de entrada: repintable según idioma
let ARCH_TEX: DynamicTexture | null = null;
function paintArch(txt: string): void {
  if (!ARCH_TEX) return;
  const ac = ARCH_TEX.getContext() as unknown as CanvasRenderingContext2D;
  ac.fillStyle = '#28406b';
  ac.fillRect(0, 0, 1024, 192);
  ac.strokeStyle = '#e8c84a';
  ac.lineWidth = 14;
  ac.strokeRect(7, 7, 1010, 178);
  ac.fillStyle = '#f3ecd9';
  ac.textAlign = 'center';
  ac.textBaseline = 'middle';
  ac.font = 'bold 88px Inter, system-ui, sans-serif';
  ac.fillText('★ ' + txt + ' ★', 512, 96, 980);
  ARCH_TEX.update();
}
// CIELO: domo gradiente + sol que se mueve con la hora real + luna/estrellas
let SKY: { dome: Mesh; domeTex: DynamicTexture; sun: Mesh; moon: Mesh; stars: Mesh } | null = null;
let GODRAYS_MESH: Mesh | null = null;
function applySky(h: number): void {
  if (!SKY || !LIGHTS) return;
  const day = h >= 6 && h < 18;
  const a = day ? ((h - 6) / 12) * Math.PI : (((h >= 18 ? h - 18 : h + 6)) / 12) * Math.PI;
  const R = 230;
  const px = -Math.cos(a) * R;
  const py = Math.sin(a) * R * 0.8 + 8;
  const pz = 70;
  if (day) {
    SKY.sun.position.set(px, py, pz);
    SKY.sun.isVisible = true;
    SKY.moon.isVisible = false;
  } else {
    SKY.moon.position.set(px, py, pz);
    SKY.moon.isVisible = true;
    SKY.sun.isVisible = false;
  }
  SKY.stars.isVisible = !day;
  if (GODRAYS_MESH) GODRAYS_MESH.position.set(px, py, pz);
  // luz direccional DESDE el astro (punto de luz de verdad)
  const dl = Math.hypot(px, py, pz) || 1;
  LIGHTS.sun.direction.set(-px / dl, -py / dl, -pz / dl);
  const elev = Math.max(0, Math.sin(a));
  const alto = Math.min(1, elev * 2.5); // 0 = horizonte (atardecer), 1 = alto
  LIGHTS.sun.intensity = day ? 0.35 + 0.6 * elev : 0.18;
  LIGHTS.sun.diffuse = day
    ? Color3.Lerp(new Color3(1, 0.6, 0.36), new Color3(1, 0.96, 0.86), alto)
    : new Color3(0.6, 0.68, 1);
  LIGHTS.hemi.intensity = day ? 0.5 + 0.3 * elev : 0.32;
  // domo: gradiente cenit→horizonte (celeste de día, profundo de noche)
  const top = day
    ? Color3.Lerp(new Color3(0.2, 0.38, 0.7), new Color3(0.4, 0.66, 0.93), alto)
    : new Color3(0.04, 0.06, 0.15);
  const hor = day
    ? Color3.Lerp(new Color3(0.97, 0.62, 0.4), new Color3(0.74, 0.86, 0.97), alto)
    : new Color3(0.1, 0.13, 0.25);
  const c = SKY.domeTex.getContext() as unknown as CanvasRenderingContext2D;
  const grad = c.createLinearGradient(0, 0, 0, 256);
  const hx = (cc: Color3): string => '#' + cc.toHexString().slice(1);
  grad.addColorStop(0, hx(hor));
  grad.addColorStop(0.45, hx(hor));
  grad.addColorStop(1, hx(top));
  c.fillStyle = grad;
  c.fillRect(0, 0, 16, 256);
  SKY.domeTex.update(false);
  if (LIGHTS) {
    const sc2 = SKY.dome.getScene();
    sc2.fogColor = hor;
    sc2.clearColor = Color4.FromColor3(hor, 1);
  }
}
// sombras dinámicas: emisores registrados al construir el mapa
const SHADOW_CASTERS: Mesh[] = [];
const TREE_CASTERS: Mesh[] = [];
const LAMP_POS: Array<{ x: number; z: number }> = [];

function hex2v3(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
}
function saveOutfit(): void {
  try { localStorage.setItem('maplab_outfit', JSON.stringify(OUTFIT_ST)); } catch { /* sin storage */ }
}
function paintOutfitTex(): void {
  if (OUTFIT_TEX) paintOutfitTexInto(OUTFIT_TEX, OUTFIT_ST as OutfitSt);
}
function repaintOutfit(): void {
  paintOutfitTex();
  saveOutfit();
  netSendState(); // el outfit viaja a los demás
}
// cara del jugador: el compuesto pintado en la bola mapea 1:1 + anteojos
function paintPlayerFace(): void {
  if (!FACETEX || !FACECV) return;
  const c = FACETEX.getContext() as unknown as CanvasRenderingContext2D;
  c.save();
  c.translate(0, 512);
  c.scale(1, -1);
  c.drawImage(FACECV, 0, 0, 1024, 512);
  if (OUTFIT_ST.glasses >= 0) { // anteojos pintados sobre la cara (frente u=0.5)
    const g = OUTFIT_ST.glasses;
    const ey = 196;
    c.strokeStyle = ['#1d1d22', '#c1272d', '#3a6ea5', '#e8c84a'][g];
    c.lineWidth = 9;
    if (g === 2) { // banda deportiva
      c.fillStyle = '#1d1d22cc';
      c.fillRect(512 - 140, ey - 26, 280, 52);
    } else {
      const rx = g === 1 ? 46 : 40;
      for (const sx of [-1, 1]) {
        c.beginPath();
        if (g === 3) c.rect(512 + sx * 74 - rx, ey - 30, rx * 2, 58);
        else c.arc(512 + sx * 74, ey, rx, 0, 7);
        c.stroke();
      }
      c.beginPath();
      c.moveTo(512 - 32, ey);
      c.lineTo(512 + 32, ey);
      c.stroke();
    }
  }
  c.restore();
  FACETEX.update(false);
}
// sombreros procedurales (se siguen del marco de la cabeza por frame)
function buildHatNode(scene: Scene, idx: number, parent: TransformNode): TransformNode | null {
  if (idx < 0) return null;
  const n = new TransformNode('hat', scene);
  n.parent = parent;
  const col = ['#3a6ea5', '#1d1d22', '#9bd96b', '#e8c84a', '#e8c84a', '#c14444'][idx];
  const m = stdMat(scene, `hat-mat-${idx}`, col);
  const add = (mesh: Mesh, y: number, z = 0): Mesh => {
    mesh.parent = n;
    mesh.position.set(0, y, z);
    mesh.material = m;
    mesh.isPickable = false;
    return mesh;
  };
  const B = MeshBuilder;
  if (idx === 0) { // gorra
    add(B.CreateSphere('h', { diameter: 0.34, segments: 10 }, scene), 0.02).scaling.set(1, 0.62, 1);
    add(B.CreateBox('h', { width: 0.26, height: 0.035, depth: 0.18 }, scene), -0.015, -0.21);
  } else if (idx === 1) { // galera
    add(B.CreateCylinder('h', { diameter: 0.42, height: 0.05, tessellation: 18 }, scene), 0);
    add(B.CreateCylinder('h', { diameter: 0.27, height: 0.3, tessellation: 16 }, scene), 0.17);
  } else if (idx === 2) { // vincha
    add(B.CreateTorus('h', { diameter: 0.31, thickness: 0.05, tessellation: 18 }, scene), 0.0);
  } else if (idx === 3) { // piluso
    add(B.CreateCylinder('h', { diameterTop: 0.28, diameterBottom: 0.44, height: 0.17, tessellation: 16 }, scene), 0.05);
  } else if (idx === 4) { // corona
    const c1 = add(B.CreateCylinder('h', { diameter: 0.3, height: 0.13, tessellation: 12 }, scene), 0.04);
    c1.material = m;
    for (let i = 0; i < 4; i++) {
      const spike = B.CreateCylinder('h', { diameterTop: 0.01, diameterBottom: 0.06, height: 0.1, tessellation: 6 }, scene);
      spike.parent = n;
      spike.position.set(Math.cos(i * Math.PI / 2) * 0.12, 0.14, Math.sin(i * Math.PI / 2) * 0.12);
      spike.material = m;
      spike.isPickable = false;
    }
  } else { // beanie
    add(B.CreateSphere('h', { diameter: 0.34, segments: 10 }, scene), 0.03).scaling.set(1, 0.6, 1);
    add(B.CreateTorus('h', { diameter: 0.32, thickness: 0.05, tessellation: 16 }, scene), -0.03);
  }
  return n;
}
function equipHat(scene: Scene, idx: number): void {
  if (HATNODE) { HATNODE.dispose(false, true); HATNODE = null; }
  OUTFIT_ST.hat = idx;
  saveOutfit();
  netSendState();
  if (!PLAYER) return;
  HATNODE = buildHatNode(scene, idx, PLAYER.root);
}
function buildScarfNode(scene: Scene, idx: number, parent: TransformNode): TransformNode | null {
  if (idx < 0) return null;
  const n = new TransformNode('scarf', scene);
  n.parent = parent;
  const m = stdMat(scene, `scarf-mat-${idx}`, PALETA[(idx * 2 + 1) % PALETA.length]);
  const loop = MeshBuilder.CreateTorus('sc', { diameter: 0.27, thickness: 0.075, tessellation: 16 }, scene);
  loop.parent = n;
  loop.material = m;
  loop.isPickable = false;
  const tail = MeshBuilder.CreateBox('sc', { width: 0.11, height: 0.26, depth: 0.05 }, scene);
  tail.parent = n;
  tail.position.set(0.07, -0.15, -0.13);
  tail.material = m;
  tail.isPickable = false;
  return n;
}
function equipScarf(scene: Scene, idx: number): void {
  if (SCARFNODE) { SCARFNODE.dispose(false, true); SCARFNODE = null; }
  OUTFIT_ST.scarf = idx;
  saveOutfit();
  netSendState();
  if (!PLAYER) return;
  SCARFNODE = buildScarfNode(scene, idx, PLAYER.root);
}
// ragdoll: rotación del root + manoteo de extremidades
function ragRotX(e: number): number {
  if (e < 0 || e >= 3.0) return 0;
  if (e < 0.45) return -(e / 0.45) * 1.52;
  if (e < 2.2) return -1.52 + Math.sin((e - 0.45) * 9) * 0.07 * Math.exp(-(e - 0.45) * 2);
  const u = (e - 2.2) / 0.8;
  return -1.52 * (1 - u * u * (3 - 2 * u));
}
function ragdollJ(J: Joints, e: number, t: number): void {
  const flail = e < 0.6 ? 1 : Math.exp(-(e - 0.6) * 2.2);
  if (e < 2.2) {
    J.shAbdL += Math.sin(t * 11 + 1) * 1.2 * flail + 0.5;
    J.shAbdR += Math.sin(t * 13 + 2) * 1.2 * flail + 0.5;
    J.elbowL += Math.abs(Math.sin(t * 9)) * 1.1 * flail;
    J.elbowR += Math.abs(Math.sin(t * 10 + 1)) * 1.1 * flail;
    J.hipFwdL += Math.sin(t * 8) * 0.7 * flail + 0.25;
    J.hipFwdR += Math.sin(t * 9.5 + 1) * 0.7 * flail + 0.25;
    J.kneeL += Math.abs(Math.sin(t * 7)) * 0.9 * flail + 0.2;
    J.kneeR += Math.abs(Math.sin(t * 8 + 2)) * 0.9 * flail + 0.2;
    J.headNod += Math.sin(t * 6) * 0.3 * flail;
    J.twist += Math.sin(t * 5) * 0.4 * flail;
  } else {
    const u = (e - 2.2) / 0.8;
    J.kneeL += (1 - u) * 1.2;
    J.kneeR += (1 - u) * 1.2;
    J.spineFwd += Math.sin(u * Math.PI) * 0.6;
  }
}

// globito de emoji sobre la cabeza (textura repintable)// globito de emoji sobre la cabeza (textura repintable)
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
  EMOTE.type = idx; // 24 gestos únicos, uno por emoji
  if (NETROOM) NETROOM.send('emote', idx); // el gesto lo ven todos
}
const PSCALE = 1.22; // personaje más grande
const DEC_U = 48;
const DEC_V = 28;
const DEC_PHI = Math.PI; // wrap completo: la pintura cubre TODA la cabeza
const DEC_T0 = 0.03;     // (la costura cae atrás, en θ = F±π)
const DEC_T1 = 0.985;

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
  try { // outfit guardado de sesiones anteriores
    const saved = localStorage.getItem('maplab_outfit');
    if (saved) Object.assign(OUTFIT_ST, JSON.parse(saved));
  } catch { /* sin storage */ }
  // UVs: u = vuelta alrededor (θ/2π), v = banda por parte del cuerpo
  const meta = FIG.meta as number[];
  const ouvs = new Float32Array(FIG.vc * 2);
  for (let i = 0; i < FIG.vc; i++) {
    const part = meta[i * 3];
    const tt = meta[i * 3 + 1];
    const th = meta[i * 3 + 2];
    const b = BANDS[part] || BANDS[7];
    ouvs[i * 2] = th < 0 ? 0.5 : th / 6.2832;
    ouvs[i * 2 + 1] = b[0] + tt * (b[1] - b[0]);
  }
  vd.uvs = ouvs;
  vd.applyToMesh(mesh, true);
  OUTFIT_TEX = new DynamicTexture('outfit-tex', { width: 256, height: 512 }, scene, true);
  paintOutfitTex();
  const mat = new StandardMaterial('player-mat', scene);
  mat.diffuseTexture = OUTFIT_TEX;
  mat.diffuseColor = new Color3(1, 1, 1);
  mat.specularColor = new Color3(0.05, 0.05, 0.05);
  mat.backFaceCulling = false; // el port viene de un mundo diestro
  mesh.material = mat;
  mesh.parent = root;
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true; // la malla se regenera por frame
  SHADOW_CASTERS.push(mesh);

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
  // textura de cara 512 con filtrado suave (chau pixelado feo del Poco)
  FACECV = faceCv;
  FACETEX = new DynamicTexture('pl-face', { width: 1024, height: 512 }, scene, true);
  paintPlayerFace();
  const dmat = new StandardMaterial('pl-face-mat', scene);
  dmat.diffuseTexture = FACETEX;
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
  root.scaling.setAll(PSCALE);
  const player: Player = { root, mesh, decal, decalPos, normals, walkPh: 0, moveAmt: 0, yaw: 0, vx: 0, vz: 0 };
  PLAYER = player; // visible para equipHat/equipScarf
  if (OUTFIT_ST.hat >= 0) equipHat(scene, OUTFIT_ST.hat);
  if (OUTFIT_ST.scarf >= 0) equipScarf(scene, OUTFIT_ST.scarf);
  return player;
}

// ─── Escena completa ────────────────────────────────────────────────────
function buildScene(engine: Engine, canvas: HTMLCanvasElement): Scene {
  const scene = new Scene(engine);
  const SKYCOL = '#aecbe8';
  scene.clearColor = Color4.FromHexString(`${SKYCOL}ff`);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0048; // el estadio al norte tiene que leerse desde el patio
  scene.fogColor = Color3.FromHexString(SKYCOL);

  // ─── CIELO: domo + sol + luna + estrellas (se mueven con la hora) ────
  const domeTex = new DynamicTexture('sky-tex', { width: 16, height: 256 }, scene, false);
  const dome = MeshBuilder.CreateSphere('sky-dome', { diameter: 560, segments: 16, sideOrientation: Mesh.BACKSIDE }, scene);
  const domeMat = new StandardMaterial('sky-mat', scene);
  domeMat.emissiveTexture = domeTex;
  domeMat.diffuseColor = Color3.Black();
  domeMat.specularColor = Color3.Black();
  domeMat.disableLighting = true;
  dome.material = domeMat;
  dome.isPickable = false;
  dome.applyFog = false;
  const sunMesh = MeshBuilder.CreateSphere('sky-sun', { diameter: 17, segments: 12 }, scene);
  sunMesh.material = neonMat(scene, 'sky-sun-mat', '#fff3c0');
  sunMesh.isPickable = false;
  sunMesh.applyFog = false;
  const moonMesh = MeshBuilder.CreateSphere('sky-moon', { diameter: 12, segments: 12 }, scene);
  moonMesh.material = neonMat(scene, 'sky-moon-mat', '#dfe7f4');
  moonMesh.isPickable = false;
  moonMesh.applyFog = false;
  moonMesh.isVisible = false;
  // estrellas: thin instances de un puntito sobre el domo
  const star = MeshBuilder.CreatePlane('sky-stars', { size: 0.9 }, scene);
  star.material = neonMat(scene, 'sky-star-mat', '#ffffff');
  star.billboardMode = Mesh.BILLBOARDMODE_ALL;
  star.isPickable = false;
  star.applyFog = false;
  const srand = rng(99);
  const smats: number[] = [];
  const sq = Quaternion.Identity();
  const sm2 = Matrix.Identity();
  for (let i = 0; i < 240; i++) {
    const az = srand() * Math.PI * 2;
    const el2 = 0.15 + srand() * 1.3;
    const sr = 262;
    const sx = Math.cos(az) * Math.cos(el2) * sr;
    const sy = Math.sin(el2) * sr;
    const sz = Math.sin(az) * Math.cos(el2) * sr;
    const ss = 0.5 + srand() * 1.1;
    Matrix.ComposeToRef(new Vector3(ss, ss, ss), sq, new Vector3(sx, sy, sz), sm2);
    for (let j = 0; j < 16; j++) smats.push(sm2.m[j]);
  }
  star.thinInstanceSetBuffer('matrix', new Float32Array(smats), 16, true);
  star.isVisible = false;
  SKY = { dome, domeTex, sun: sunMesh, moon: moonMesh, stars: star };
  applySky(12);

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
  LIGHTS = { hemi, sun };

  // Glow para los neones (ratio bajo = barato en el Mali); intensidad
  // contenida: el neón se nota pero no come la silueta del ícono.
  const glow = new GlowLayer('glow', scene, { mainTextureRatio: 0.5, blurKernelSize: 24 });
  glow.intensity = 0.42;
  const spinners: Spinner[] = [];

  // Piso verde: la MISMA textura de pasto del juego, tileada igual (~7u/tile)
  const ground = MeshBuilder.CreateGround('patio-ground', { width: GROUND_SIZE, height: GROUND_SIZE, subdivisions: 1 }, scene);
  ground.material = texMat(scene, 'patio-ground-mat', grassUrl, GROUND_SIZE / 7, '#74a05f');
  ground.isPickable = false;
  ground.receiveShadows = true;

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
  prom.receiveShadows = true;

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
    SHOPS.push({ x, z, id: TIENDAS[i].id, nombre: TIENDAS[i].nombre });
    COLLIDERS.push({ x, z, r: 2.0 });
  }

  // ─── Monumento central: base escalonada de piedra + copa dorada ──────
  for (const [r, y, h] of [[2.6, 0.175, 0.35], [2.0, 0.5, 0.3], [1.4, 0.78, 0.26]]) {
    const tier = MeshBuilder.CreateCylinder('mon-tier', { diameter: r * 2, height: h, tessellation: 28 }, scene);
    tier.position.y = y;
    tier.material = stoneMat;
    tier.isPickable = false;
    SHADOW_CASTERS.push(tier);
  }
  COLLIDERS.push({ x: 0, z: 0, r: 2.9 }); // monumento central
  const goldMat = stdMat(scene, 'gold-mat', '#e8c84a', '#604d12');
  goldMat.specularColor = new Color3(0.9, 0.85, 0.5);
  const stem = MeshBuilder.CreateCylinder('mon-stem', { diameterTop: 0.35, diameterBottom: 0.7, height: 1.6, tessellation: 16 }, scene);
  stem.position.y = 1.7;
  stem.material = goldMat;
  const cup = MeshBuilder.CreateCylinder('mon-cup', { diameterTop: 1.5, diameterBottom: 0.4, height: 1.1, tessellation: 16 }, scene);
  cup.position.y = 3.0;
  cup.material = goldMat;
  SHADOW_CASTERS.push(cup);
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
    registerBench(bx, bz, Math.atan2(-bx, -bz));
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
  const flags: TransformNode[] = [];
  for (let i = 0; i < FLAGS.length; i++) {
    const a = (i / FLAGS.length) * Math.PI * 2 + Math.PI / 8;
    const fx = Math.cos(a) * FLAG_RADIUS;
    const fz = Math.sin(a) * FLAG_RADIUS;
    COLLIDERS.push({ x: fx, z: fz, r: 0.2 });
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
    // raíz EN el poste: el borde interno de la bandera queda clavado al
    // mástil y el flameo gira alrededor del palo (sin atravesarlo)
    const froot = new TransformNode(`flag-root-${i}`, scene);
    froot.position.set(fx, 4.55, fz);
    froot.rotation.y = -a + Math.PI / 2;
    const flag = MeshBuilder.CreatePlane(`flag-${i}`, { width: 1.25, height: 0.8 }, scene);
    flag.parent = froot;
    flag.position.x = 0.638; // borde -x del plano sobre el poste
    flag.material = fmat;
    flag.isPickable = false;
    flags.push(froot);
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
    COLLIDERS.push({ x: sx * gateHalfWidth, z: -GATE_R, r: 0.9 });
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
  ARCH_TEX = archTex;
  paintArch('PATIO MUNDIAL'); // applyLang lo repinta según idioma
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
    registerBench(bx, bz, yaw);
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

  // ─── Anfiteatro (del original): 3 gradas en arco + escenario ─────────
  const ANF = { x: -36, z: 26 };
  COLLIDERS.push({ x: ANF.x, z: ANF.z, r: 7.5 });
  for (let tier = 0; tier < 3; tier++) {
    const rad = 4.6 + tier * 1.7;
    const hh2 = 0.42 + tier * 0.38;
    for (let s2 = 0; s2 < 7; s2++) {
      const a2 = -Math.PI / 3 + (s2 / 6) * (Math.PI * 2 / 3) + Math.PI; // arco mirando al este
      const gx = ANF.x + Math.cos(a2) * rad;
      const gz = ANF.z + Math.sin(a2) * rad;
      const grada = MeshBuilder.CreateBox('anf-grada', { width: 1.9, height: hh2, depth: 1.3 }, scene);
      grada.position.set(gx, hh2 / 2, gz);
      grada.rotation.y = Math.atan2(ANF.x - gx, ANF.z - gz);
      grada.material = stoneMat;
      grada.isPickable = false;
      SHADOW_CASTERS.push(grada);
    }
  }
  const anfStage = MeshBuilder.CreateDisc('anf-stage', { radius: 2.6, tessellation: 28 }, scene);
  anfStage.rotation.x = Math.PI / 2;
  anfStage.position.set(ANF.x + 1.2, 0.025, ANF.z);
  const anfMat = stdMat(scene, 'anf-stage-mat', '#ffffff');
  const anfTex = new Texture(flagstoneUrl, scene);
  anfTex.uScale = 2.5;
  anfTex.vScale = 2.5;
  anfMat.diffuseTexture = anfTex;
  anfStage.material = anfMat;
  anfStage.isPickable = false;

  // ─── Photo spot (del original): marco de foto + disco ───────────────
  const PHO = { x: 50, z: 22 };
  COLLIDERS.push({ x: PHO.x, z: PHO.z, r: 1.3 });
  const phoDisc = MeshBuilder.CreateDisc('pho-disc', { radius: 2.2, tessellation: 24 }, scene);
  phoDisc.rotation.x = Math.PI / 2;
  phoDisc.position.set(PHO.x, 0.025, PHO.z);
  phoDisc.material = anfMat;
  phoDisc.isPickable = false;
  for (const sx of [-1.3, 1.3]) {
    const pp = MeshBuilder.CreateCylinder('pho-post', { diameter: 0.16, height: 2.6, tessellation: 8 }, scene);
    pp.position.set(PHO.x + sx, 1.3, PHO.z);
    pp.material = woodDarkMat;
    pp.isPickable = false;
  }
  const phoTop = MeshBuilder.CreateBox('pho-top', { width: 2.9, height: 0.16, depth: 0.16 }, scene);
  phoTop.position.set(PHO.x, 2.5, PHO.z);
  phoTop.material = woodDarkMat;
  phoTop.isPickable = false;
  const phoTex = new DynamicTexture('pho-tex', { width: 512, height: 96 }, scene, true);
  const ph2 = phoTex.getContext() as unknown as CanvasRenderingContext2D;
  ph2.fillStyle = '#e8c84a';
  ph2.fillRect(0, 0, 512, 96);
  ph2.fillStyle = '#10204a';
  fitText(ph2, '📸 PHOTO SPOT', 256, 50, 470, 52);
  phoTex.update();
  const phoMat2 = new StandardMaterial('pho-sign-mat', scene);
  phoMat2.diffuseTexture = phoTex;
  phoMat2.emissiveTexture = phoTex;
  phoMat2.emissiveColor = new Color3(0.5, 0.5, 0.5);
  phoMat2.specularColor = new Color3(0, 0, 0);
  phoMat2.backFaceCulling = false;
  const phoSign = MeshBuilder.CreatePlane('pho-sign', { width: 2.9, height: 0.55 }, scene);
  phoSign.position.set(PHO.x, 2.95, PHO.z);
  phoSign.material = phoMat2;
  phoSign.isPickable = false;

  // ─── Pósters de la MASCOTA (como el original, arte procedural) ───────
  const POSES_DINO: Array<[number, number, number, string, string]> = [
    [12, 24, Math.atan2(-12, -24), '¡VAMOS!', '#3a6ea5'],
    [30, -4, Math.atan2(-30, 4), '¡GOLAZO!', '#c14444'],
    [-8, -22, Math.atan2(8, 22), '¡HOLA! 👋', '#1d7a3a'],
  ];
  for (const [mx2, mz2, myaw, frase, bg2] of POSES_DINO) {
    const ptex = new DynamicTexture('mascot-poster', { width: 384, height: 512 }, scene, true);
    const pc3 = ptex.getContext() as unknown as CanvasRenderingContext2D;
    pc3.fillStyle = bg2;
    pc3.fillRect(0, 0, 384, 512);
    pc3.strokeStyle = '#ffd34d';
    pc3.lineWidth = 12;
    pc3.strokeRect(6, 6, 372, 500);
    drawDino(pc3, 16, 44, 70);
    pc3.fillStyle = '#ffffff';
    fitText(pc3, frase, 192, 430, 340, 56);
    ptex.update();
    const root2 = new TransformNode('mascot-stand', scene);
    root2.position.set(mx2, 0, mz2);
    root2.rotation.y = myaw;
    COLLIDERS.push({ x: mx2, z: mz2, r: 0.9 });
    const fr2 = MeshBuilder.CreateBox('mp-frame', { width: 2.0, height: 2.7, depth: 0.09 }, scene);
    fr2.parent = root2;
    fr2.position.y = 2.35;
    fr2.material = stdMat(scene, 'mp-frame-mat', '#2e2a24');
    fr2.isPickable = false;
    const pm3 = new StandardMaterial('mp-mat', scene);
    pm3.diffuseTexture = ptex;
    pm3.emissiveTexture = ptex;
    pm3.emissiveColor = new Color3(0.42, 0.42, 0.42);
    pm3.specularColor = new Color3(0, 0, 0);
    const pp3 = MeshBuilder.CreatePlane('mp-img', { width: 1.8, height: 2.5 }, scene);
    pp3.parent = root2;
    pp3.rotation.y = Math.PI;
    pp3.position.set(0, 2.35, 0.06);
    pp3.material = pm3;
    pp3.isPickable = false;
    for (const sx of [-0.7, 0.7]) {
      const post3 = MeshBuilder.CreateCylinder('mp-post', { diameter: 0.13, height: 1.1, tessellation: 8 }, scene);
      post3.parent = root2;
      post3.position.set(sx, 0.55, 0);
      post3.material = woodDarkMat;
      post3.isPickable = false;
    }
  }

  // ─── Picnic (como el plot del original): mantel a cuadros + canasta ──
  const picTex = new DynamicTexture('picnic-tex', { width: 128, height: 128 }, scene, true);
  const pc2 = picTex.getContext() as unknown as CanvasRenderingContext2D;
  for (let i = 0; i < 8; i++) {
    for (let j2 = 0; j2 < 8; j2++) {
      pc2.fillStyle = (i + j2) % 2 === 0 ? '#c14444' : '#f2efe6';
      pc2.fillRect(i * 16, j2 * 16, 16, 16);
    }
  }
  picTex.update();
  const picMat = new StandardMaterial('picnic-mat', scene);
  picMat.diffuseTexture = picTex;
  picMat.specularColor = new Color3(0, 0, 0);
  const mantel = MeshBuilder.CreateGround('picnic', { width: 2.4, height: 2.4 }, scene);
  mantel.position.set(14, 0.03, -18);
  mantel.material = picMat;
  mantel.isPickable = false;
  const canasta = MeshBuilder.CreateBox('picnic-canasta', { width: 0.5, height: 0.32, depth: 0.36 }, scene);
  canasta.position.set(14.5, 0.19, -18.4);
  canasta.material = woodMat;
  canasta.isPickable = false;
  const asa = MeshBuilder.CreateTorus('picnic-asa', { diameter: 0.4, thickness: 0.04, tessellation: 12 }, scene);
  asa.position.set(14.5, 0.42, -18.4);
  asa.rotation.z = Math.PI / 2;
  asa.material = woodDarkMat;
  asa.isPickable = false;

  // ─── Obelisco Top-Hero (monumento del pool, como el original) ────────
  const obBase = MeshBuilder.CreateCylinder('ob-base', { diameter: 2.4, height: 0.5, tessellation: 20 }, scene);
  obBase.position.set(-16, 0.25, -20);
  obBase.material = stoneMat;
  obBase.isPickable = false;
  const obelisco = MeshBuilder.CreateCylinder('ob-shaft', { diameterTop: 0.35, diameterBottom: 0.8, height: 4.6, tessellation: 8 }, scene);
  obelisco.position.set(-16, 2.8, -20);
  obelisco.material = stoneMat;
  obelisco.isPickable = false;
  SHADOW_CASTERS.push(obelisco);
  COLLIDERS.push({ x: -16, z: -20, r: 1.4 });
  const obTex = new DynamicTexture('ob-tex', { width: 256, height: 384 }, scene, true);
  OB_TEX = obTex;
  paintObelisk(); // FUNCIONAL: muestra el pool real de lo gastado
  const obMat = new StandardMaterial('ob-mat', scene);
  obMat.diffuseTexture = obTex;
  obMat.emissiveTexture = obTex;
  obMat.emissiveColor = new Color3(0.45, 0.45, 0.45);
  obMat.specularColor = new Color3(0, 0, 0);
  const obPlane = MeshBuilder.CreatePlane('ob-face', { width: 1.3, height: 1.95 }, scene);
  obPlane.position.set(-16, 1.7, -20 + 0.62);
  obPlane.rotation.y = Math.PI; // mira al sendero / spawn
  obPlane.material = obMat;
  obPlane.isPickable = false;

  // ─── Carteles del juego original ──────────────────────────────────────
  // Tablón de fixtures camino a la cancha + láminas del mundial en stands.
  buildFixtureBoard(scene, 28, 11, Math.atan2(-28, -11), woodDarkMat);
  COLLIDERS.push({ x: 28, z: 11, r: 1.4 });
  COLLIDERS.push({ x: -13, z: 22, r: 0.9 });
  COLLIDERS.push({ x: -25, z: -14, r: 1.1 });
  COLLIDERS.push({ x: 33, z: -20, r: 0.9 });
  buildCartel(scene, portraitUrl, 2.2, 3.0, -13, 22, Math.atan2(13, -22), woodDarkMat);
  buildCartel(scene, bannerUrl, 4.6, 1.7, -25, -14, Math.atan2(25, 14), woodDarkMat);
  buildCartel(scene, portraitUrl, 2.2, 3.0, 33, -20, Math.atan2(-33, 20), woodDarkMat);
  // ─── PUERTAS-PORTAL del estadio (como el original: te llevan a otros
  // juegos de Rezona). Tocá la puerta para abrir el link. Las dos sin
  // gameId todavía quedan como "COMING SOON" (igual que en world.ts).
  // ADENTRO del estadio, rodeando el campo como los túneles del original
  // (mismos ángulos de _stadiumPortalSpec: SE, E-NE, N, W-NW, SW; el arco
  // sur queda libre para el portón). Miran al centro de la cancha.
  const PORTALES: Array<{ url: string; label: string; cover: string; angle: number }> = [
    { url: 'https://web.rezona.ai/share/game/OTMzMjQ5NA', label: 'Catching These Balls', cover: coverGoalieUrl, angle: -Math.PI / 4 },
    { url: 'https://web.rezona.ai/share/game/OTMzMTc0NQ', label: 'Master Dribbler', cover: coverDribblerUrl, angle: Math.PI / 6 },
    { url: '', label: 'Coming Soon', cover: coverRacingUrl, angle: Math.PI / 2 },
    { url: 'https://web.rezona.ai/share/game/OTMzMzI4NA', label: 'Ball Juggler', cover: coverJugglerUrl, angle: Math.PI - Math.PI / 6 },
    { url: '', label: 'Festejo GOTY', cover: coverCardsUrl, angle: Math.PI + Math.PI / 4 },
  ];
  const IN_A = EST_IN_A;
  const IN_B = EST_IN_B;
  for (let i = 0; i < PORTALES.length; i++) {
    const a = PORTALES[i].angle;
    const px = ESTADIO.x + Math.cos(a) * IN_A;
    const pz = ESTADIO.z + Math.sin(a) * IN_B;
    // mirando al centro del campo
    let nx = ESTADIO.x - px;
    let nz = ESTADIO.z - pz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const root = new TransformNode(`portal-${i}`, scene);
    root.position.set(px, 0, pz);
    root.rotation.y = Math.atan2(nx, nz); // +Z local hacia el campo
    // marco de puerta GRANDE (a escala de las tribunas): jambas + dintel + fondo
    for (const sx of [-2.0, 2.0]) {
      const jamb = MeshBuilder.CreateBox('portal-jamb', { width: 0.45, height: 5.5, depth: 0.6 }, scene);
      jamb.parent = root;
      jamb.position.set(sx, 2.75, 0);
      jamb.material = stoneMat;
      jamb.isPickable = false;
    }
    const lintel = MeshBuilder.CreateBox('portal-lintel', { width: 4.6, height: 0.5, depth: 0.65 }, scene);
    lintel.parent = root;
    lintel.position.set(0, 5.75, 0);
    lintel.material = stdMat(scene, `portal-lintel-${i}`, '#e6c34a');
    lintel.isPickable = false;
    const fondo = MeshBuilder.CreateBox('portal-fondo', { width: 3.7, height: 5.4, depth: 0.18 }, scene);
    fondo.parent = root;
    fondo.position.set(0, 2.7, -0.1);
    fondo.material = stdMat(scene, 'portal-fondo-mat', '#15151c');
    fondo.isPickable = false;
    // cover del juego = la puerta en sí (tocable)
    const cmat = new StandardMaterial(`portal-cover-${i}`, scene);
    const ctex = new Texture(PORTALES[i].cover, scene);
    cmat.diffuseTexture = ctex;
    cmat.emissiveTexture = ctex;
    cmat.emissiveColor = new Color3(0.42, 0.42, 0.42);
    cmat.specularColor = new Color3(0, 0, 0);
    const puerta = MeshBuilder.CreatePlane(`portal-img-${i}`, { width: 3.4, height: 5.0 }, scene);
    puerta.parent = root;
    puerta.rotation.y = Math.PI; // frente (-Z) hacia el campo
    puerta.position.set(0, 2.72, 0.04);
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
    const lplane = MeshBuilder.CreatePlane(`portal-label-pl-${i}`, { width: 4.2, height: 0.78 }, scene);
    lplane.parent = root;
    lplane.rotation.y = Math.PI;
    lplane.position.set(0, 6.45, 0.05);
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
  oakTex.hasAlpha = true; // SIN useAlphaFromDiffuseTexture → alpha TEST:
  oakMat.diffuseTexture = oakTex; // recorte nítido, sin halos ni problemas de orden
  oakMat.backFaceCulling = false;
  oakMat.specularColor = new Color3(0, 0, 0);
  for (let i = 0; i < 38; i++) { // parque bien arbolado
    const a = rand() * Math.PI * 2;
    const r = PROM_OUTER + 5 + rand() * 27;
    const tx = Math.cos(a) * r;
    const tz = Math.sin(a) * r;
    if (Math.abs(tx) < 3.5 && tz < -PROM_INNER) continue; // no tapar el sendero sur
    if (nearPOI(tx, tz)) continue;
    const s = 7.2 + rand() * 3.8; // robles grandes (piden presencia)
    COLLIDERS.push({ x: tx, z: tz, r: 0.85 }); // tronco
    for (const yaw of [0, Math.PI / 2]) {
      const plane = MeshBuilder.CreatePlane(`oak-${i}-${yaw > 0 ? 'b' : 'a'}`, { width: s, height: s }, scene);
      TREE_CASTERS.push(plane);
      plane.position.set(tx, s / 2 - s * 0.07, tz); // hundido: el tronco toca el piso
      plane.rotation.y = a + yaw; // orientación variada
      plane.material = oakMat;
      plane.isPickable = false;
    }
  }

  // ─── ZONA "COMING SOON": cuadro cercado lleno de árboles al costado
  // de la cancha, del otro lado de la cerca perimetral, con su puerta
  // (cerrada — la zona todavía no abre) ─────────────────────────────────
  const ZX0 = FENCE.x1;       // comparte el lado este de la cerca
  const ZX1 = FENCE.x1 + 26;
  const ZZ0 = -22;
  const ZZ1 = 8;
  const zRail = stdMat(scene, 'cs-rail', '#8a6435');
  const zPost = stdMat(scene, 'cs-post', '#6b4e26');
  const zSide = (w: number, d: number, px: number, pz: number): void => {
    const r2 = MeshBuilder.CreateBox('cs-rail', { width: w, height: 1.1, depth: d }, scene);
    r2.position.set(px, 0.55, pz);
    r2.material = zRail;
    r2.isPickable = false;
  };
  zSide(ZX1 - ZX0, 0.18, (ZX0 + ZX1) / 2, ZZ0);
  zSide(ZX1 - ZX0, 0.18, (ZX0 + ZX1) / 2, ZZ1);
  zSide(0.18, ZZ1 - ZZ0, ZX1, (ZZ0 + ZZ1) / 2);
  for (let zz = ZZ0; zz <= ZZ1; zz += 8) {
    for (const xx of [ZX1]) {
      const p2 = MeshBuilder.CreateBox('cs-post', { width: 0.32, height: 1.4, depth: 0.32 }, scene);
      p2.position.set(xx, 0.7, zz);
      p2.material = zPost;
      p2.isPickable = false;
    }
  }
  // puerta en la cerca compartida (marco + hoja de madera + cartel)
  const GATE_Z = -7;
  for (const gz2 of [GATE_Z - 1.6, GATE_Z + 1.6]) {
    const jamb2 = MeshBuilder.CreateBox('cs-jamb', { width: 0.4, height: 2.6, depth: 0.4 }, scene);
    jamb2.position.set(ZX0, 1.3, gz2);
    jamb2.material = zPost;
    jamb2.isPickable = false;
  }
  const lint2 = MeshBuilder.CreateBox('cs-lintel', { width: 0.5, height: 0.3, depth: 3.6 }, scene);
  lint2.position.set(ZX0, 2.7, GATE_Z);
  lint2.material = zRail;
  lint2.isPickable = false;
  const hoja = MeshBuilder.CreateBox('cs-door', { width: 0.14, height: 2.4, depth: 3.0 }, scene);
  hoja.position.set(ZX0, 1.2, GATE_Z);
  hoja.material = texMat(scene, 'cs-door-mat', woodPlanksUrl, 2, '#b08a5a');
  hoja.isPickable = false;
  const csTex = new DynamicTexture('cs-sign', { width: 512, height: 128 }, scene, true);
  const cc2 = csTex.getContext() as unknown as CanvasRenderingContext2D;
  cc2.fillStyle = '#10204a';
  cc2.fillRect(0, 0, 512, 128);
  cc2.strokeStyle = '#ffd34d';
  cc2.lineWidth = 8;
  cc2.strokeRect(4, 4, 504, 120);
  cc2.fillStyle = '#f3ecd9';
  fitText(cc2, '🌲 COMING SOON 🌲', 256, 64, 470, 52);
  csTex.update();
  const csMat = new StandardMaterial('cs-sign-mat', scene);
  csMat.diffuseTexture = csTex;
  csMat.emissiveTexture = csTex;
  csMat.emissiveColor = new Color3(0.5, 0.5, 0.5);
  csMat.specularColor = new Color3(0, 0, 0);
  const csPlane = MeshBuilder.CreatePlane('cs-sign-pl', { width: 3.4, height: 0.85 }, scene);
  csPlane.position.set(ZX0 - 0.3, 3.3, GATE_Z);
  csPlane.rotation.y = Math.PI / 2; // de cara al parque
  csPlane.material = csMat;
  csPlane.isPickable = false;
  // bosque tupido adentro (zona inaccesible: la cerca del mapa te frena)
  const rng2 = rng(777);
  for (let i = 0; i < 16; i++) {
    const tx2 = ZX0 + 3 + rng2() * (ZX1 - ZX0 - 6);
    const tz2 = ZZ0 + 2.5 + rng2() * (ZZ1 - ZZ0 - 5);
    const s2 = 6.5 + rng2() * 3.5;
    for (const yaw2 of [0, Math.PI / 2]) {
      const pl2 = MeshBuilder.CreatePlane('cs-oak', { width: s2, height: s2 }, scene);
      pl2.position.set(tx2, s2 / 2 - s2 * 0.07, tz2);
      pl2.rotation.y = rng2() * Math.PI + yaw2;
      pl2.material = oakMat;
      pl2.isPickable = false;
    }
  }

  // matas: thin instances de 2 planos cruzados
  const tuftMat = new StandardMaterial('tuft-mat', scene);
  const tuftTex = new Texture(grassTuftUrl, scene);
  tuftTex.hasAlpha = true; // alpha test, igual que los robles
  tuftMat.diffuseTexture = tuftTex;
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
    Matrix.ComposeToRef(new Vector3(s, s, s), scratchQ, new Vector3(px, s / 2 - s * 0.1, pz), scratchM);
    for (let j = 0; j < 16; j++) tm.push(scratchM.m[j]);
    Quaternion.RotationYawPitchRollToRef(yaw + Math.PI / 2, 0, 0, scratchQ);
    Matrix.ComposeToRef(new Vector3(s, s, s), scratchQ, new Vector3(px, s / 2 - s * 0.1, pz), scratchM);
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
      let dx = PAUSED ? 0 : INPUT.kx + INPUT.jx;
      let dy = PAUSED ? 0 : INPUT.ky + INPUT.jy;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      const moving = len > 0.08;
      if (!moving) { PLAYER.vx *= 0.8; PLAYER.vz *= 0.8; }
      if (moving && SIT.target === 1) SIT.target = 0; // moverse = pararse
      if (moving && SIT.amt < 0.3 && !RAGD.on) {
        const fx = camera.target.x - camera.position.x;
        const fz = camera.target.z - camera.position.z;
        const fl = Math.hypot(fx, fz) || 1;
        const fwx = fx / fl;
        const fwz = fz / fl;
        const mx = fwx * (-dy) + fwz * dx;   // derecha = (fwz, -fwx)
        const mz = fwz * (-dy) + (-fwx) * dx;
        // joystick al centro = caminar, al límite = CORRER
        const runT0 = Math.min(1, Math.max(0, (len - 0.5) / 0.45));
        const runT = runT0 * runT0 * (3 - 2 * runT0);
        const SPEED = 2.3 + 3.4 * runT;
        const p = PLAYER.root.position;
        PLAYER.vx = mx * SPEED;
        PLAYER.vz = mz * SPEED;
        p.x = Math.max(-50, Math.min(56, p.x + mx * SPEED * dt));
        p.z = Math.max(-42, Math.min(95, p.z + mz * SPEED * dt));
        // COLISIONES: círculos de las estructuras
        for (const c of COLLIDERS) {
          const ddx = p.x - c.x;
          const ddz = p.z - c.z;
          const d = Math.hypot(ddx, ddz);
          const min = c.r + 0.32;
          if (d < min && d > 1e-4) {
            p.x = c.x + ddx / d * min;
            p.z = c.z + ddz / d * min;
          }
        }
        // banda de tribunas/pared del estadio (salvo el túnel del portón)
        const ex2 = p.x - ESTADIO.x;
        const ez2 = p.z - ESTADIO.z;
        const fi = (ex2 / EST_IN_A) ** 2 + (ez2 / EST_IN_B) ** 2;
        const fo = (ex2 / EST_A) ** 2 + (ez2 / EST_B) ** 2;
        const inTunnel = Math.abs(p.x) < 2.6 && p.z > ESTADIO.z - EST_B - 3 && p.z < ESTADIO.z - EST_IN_B + 2;
        if (fi > 1 && fo < 1.1 && !inTunnel) {
          if (fi < 1.55) { // cerca del campo → empujar adentro
            const ang = Math.atan2(ez2 / EST_IN_B, ex2 / EST_IN_A);
            p.x = ESTADIO.x + Math.cos(ang) * EST_IN_A * 0.985;
            p.z = ESTADIO.z + Math.sin(ang) * EST_IN_B * 0.985;
          } else { // del lado del parque → empujar afuera
            const ang = Math.atan2(ez2 / EST_B, ex2 / EST_A);
            p.x = ESTADIO.x + Math.cos(ang) * EST_A * 1.035;
            p.z = ESTADIO.z + Math.sin(ang) * EST_B * 1.035;
          }
        }
        const targetYaw = Math.atan2(mx, mz); // la figura mira a +Z local
        let dYaw = targetYaw - PLAYER.yaw;
        while (dYaw > Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        PLAYER.yaw += dYaw * Math.min(1, dt * 12);
        PLAYER.root.rotation.y = PLAYER.yaw;
        PLAYER.walkPh += dt * (5.2 + 4.0 * runT) * Math.min(1, len);
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
      // salto (arco con física simple)
      if (JUMP.active) {
        JUMP.y += JUMP.vy * dt;
        JUMP.vy -= 14 * dt;
        if (JUMP.y <= 0) {
          JUMP.y = 0;
          JUMP.active = false;
        }
      }
      const ragE = t - RAGD.t0;
      const ragOn = RAGD.on;
      // mezcla idle↔caminata suave + FK → regenerar la malla esculpida
      PLAYER.moveAmt += ((moving && SIT.amt < 0.3 && !ragOn ? Math.min(1, len) : 0) - PLAYER.moveAmt) * Math.min(1, dt * 8);
      let J: Joints = poseCartoon(t, PLAYER.walkPh, PLAYER.moveAmt);
      if (SIT.amt > 0.01) {
        J = mixJoints(J, poseSit(t), SIT.amt);
        J.pelvisY -= 0.085 * SIT.amt; // compensa PSCALE: cola a altura de banco
      }
      if (JUMP.active) { // piernas recogidas + brazos arriba en el aire
        const air = Math.min(1, JUMP.y / 0.5);
        J.kneeL += 1.1 * air;
        J.kneeR += 1.1 * air;
        J.hipFwdL -= 0.5 * air;
        J.hipFwdR -= 0.5 * air;
        J.shAbdL += 0.9 * air;
        J.shAbdR += 0.9 * air;
      }
      if (PHYS) {
        PHYS.step(1 / 60, Math.min(dt, 0.05), 3);
        if (BALLB && BALLST) {
          BALLST.root.position.set(BALLB.position.x, BALLB.position.y, BALLB.position.z);
          if (!BALLST.root.rotationQuaternion) BALLST.root.rotationQuaternion = new Quaternion();
          BALLST.root.rotationQuaternion.set(BALLB.quaternion.x, BALLB.quaternion.y, BALLB.quaternion.z, BALLB.quaternion.w);
          // PATEAR: pasás por encima y sale disparada
          const kdx = BALLB.position.x - PLAYER.root.position.x;
          const kdz = BALLB.position.z - PLAYER.root.position.z;
          const kd = Math.hypot(kdx, kdz);
          if (kd < 1.0 && t - lastKick > 0.35 && !RAGD.on) {
            const sp = Math.hypot(PLAYER.vx, PLAYER.vz);
            const nx2 = kd > 0.01 ? kdx / kd : Math.sin(PLAYER.yaw);
            const nz2 = kd > 0.01 ? kdz / kd : Math.cos(PLAYER.yaw);
            BALLB.applyImpulse(new CANNON.Vec3(
              nx2 * (2.4 + sp * 1.2) + PLAYER.vx * 0.6,
              1.5 + sp * 0.45,
              nz2 * (2.4 + sp * 1.2) + PLAYER.vz * 0.6));
            lastKick = t;
            BALL_OWN = true; // mi patada manda la pelota a la red
          }
          // GOL: la pelota entra al arco → suma el marcador de ese arco
          for (const g of GOALS) {
            const gz = CANCHA.z + g.sign * 13.4;
            const inX = Math.abs(BALLB.position.x - CANCHA.x) < 2.35;
            const inZ = g.sign > 0
              ? BALLB.position.z > gz - 0.05 && BALLB.position.z < gz + 1.15
              : BALLB.position.z < gz + 0.05 && BALLB.position.z > gz - 1.15;
            if (!g.cool && inX && inZ && BALLB.position.y < 2.2) {
              g.score++;
              g.cool = true;
              paintBoard(g);
              COINS += 0.5; // ¡GOLAZO paga!
              updCoins();
              showChat(scene, '⚽ ¡GOLAZO! +0.5 🪙');
              setTimeout(() => { resetBall(); g.cool = false; }, 900);
            }
          }
          if (Math.abs(BALLB.position.x - CANCHA.x) > 16 || Math.abs(BALLB.position.z - CANCHA.z) > 22) resetBall();
        }
        // reset de marcadores cada 3 minutos + countdown vivo
        if (t > SCORE_RESET_AT) {
          SCORE_RESET_AT = t + 180;
          for (const g of GOALS) { g.score = 0; paintBoard(g); }
        }
        if (t - lastBoardT > 1) {
          lastBoardT = t;
          for (const g of GOALS) paintBoard(g);
        }
      }
      if (ragOn) {
        ragSync();
        const P0 = RAGD.P[0];
        const P1 = RAGD.P[1];
        let ux = P1.x - P0.x;
        let uy = P1.y - P0.y;
        let uz = P1.z - P0.z;
        const ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const cy2 = Math.cos(PLAYER.yaw);
        const sy2 = Math.sin(PLAYER.yaw);
        const lx2 = ux * cy2 - uz * sy2; // up en frame local del root
        const lz2 = ux * sy2 + uz * cy2;
        let rx = Math.atan2(lz2, Math.max(0.05, uy));
        let rz = -Math.atan2(lx2, Math.max(0.05, uy));
        let pyy = Math.max(0, P0.y - uy * 0.56 * PSCALE);
        let ppx = P0.x - ux * 0.56 * PSCALE;
        let ppz = P0.z - uz * 0.56 * PSCALE;
        if (ragE > 2.6) { // levantarse suave
          const u = Math.min(1, (ragE - 2.6) / 0.6);
          const k = 1 - u * u * (3 - 2 * u);
          rx *= k; rz *= k; pyy *= k;
          ppx = ppx + (PLAYER.root.position.x - ppx) * (1 - k);
          ppz = ppz + (PLAYER.root.position.z - ppz) * (1 - k);
          if (u >= 1) {
            RAGD.on = false;
            ragClear();
          }
        }
        PLAYER.root.rotation.x = rx;
        PLAYER.root.rotation.z = rz;
        PLAYER.root.position.x = ppx;
        PLAYER.root.position.z = ppz;
        PLAYER.root.position.y = pyy;
        // articulaciones desde la física (IK), mezcla al levantarse
        if (RAGD.P.length === 11) { // (al final ragClear vacía los cuerpos)
          PLAYER.root.computeWorldMatrix(true);
          const invM = PLAYER.root.getWorldMatrix().clone().invert();
          let ragJ = ragdollPose(invM);
          if (ragE > 2.6) {
            const u2 = Math.min(1, (ragE - 2.6) / 0.6);
            ragJ = mixJoints(ragJ, J, u2 * u2 * (3 - 2 * u2));
          }
          J = ragJ;
        }
      } else {
        PLAYER.root.rotation.x = 0;
        PLAYER.root.rotation.z = 0;
        PLAYER.root.position.y = JUMP.y;
      }
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
      LASTJ = J;
      buildFigure(J);
      PLAYER.mesh.updateVerticesData('position', FIG.pos as Float32Array);
      VertexData.ComputeNormals(FIG.pos, FIG.idx, PLAYER.normals);
      PLAYER.mesh.updateVerticesData('normal', PLAYER.normals);
      decalPositions(J, PLAYER.decalPos, DEC_U, DEC_V, DEC_PHI, DEC_T0, DEC_T1);
      PLAYER.decal.updateVerticesData('position', PLAYER.decalPos);
      // sombrero y bufanda enganchados al marco de la cabeza
      if (HATNODE || SCARFNODE) {
        const hf = headFrame(J);
        const tiltX = Math.atan2(hf.hax[2], hf.hax[1]);
        const tiltZ = -Math.atan2(hf.hax[0], hf.hax[1]);
        if (HATNODE) {
          HATNODE.position.set(
            hf.neckTop[0] + hf.hax[0] * 0.27,
            hf.neckTop[1] + hf.hax[1] * 0.27,
            hf.neckTop[2] + hf.hax[2] * 0.27);
          HATNODE.rotation.set(tiltX, J.headTurn * 0.5, tiltZ);
        }
        if (SCARFNODE) {
          SCARFNODE.position.set(hf.neckTop[0], hf.neckTop[1] + 0.01, hf.neckTop[2]);
          SCARFNODE.rotation.set(tiltX, 0, tiltZ);
        }
      }
      // ONLINE: pos+anim a 10Hz, remotos de CUERPO ENTERO animados
      if (NETROOM) {
        if (t - lastNetSend > 0.1) {
          lastNetSend = t;
          NETROOM.send('pos', {
            x: PLAYER.root.position.x, z: PLAYER.root.position.z, yaw: PLAYER.yaw,
            m: PLAYER.moveAmt, sy: JUMP.y, sit: SIT.amt > 0.5 ? 1 : 0, wph: PLAYER.walkPh,
            name: (localStorage.getItem('maplab_name') || 'wacho'),
          });
        }
        // pelota compartida: el último que pateó es la autoridad
        if (BALL_OWN && BALLB && t - lastBallSend > 0.1) {
          lastBallSend = t;
          NETROOM.send('ball', {
            x: BALLB.position.x, y: BALLB.position.y, z: BALLB.position.z,
            vx: BALLB.velocity.x, vy: BALLB.velocity.y, vz: BALLB.velocity.z,
          });
        }
        if (!NORM_SCRATCH) NORM_SCRATCH = new Float32Array(FIG.vc * 3);
        for (const r of REMOTES.values()) {
          const k3 = Math.min(1, dt * 8);
          r.root.position.x += (r.tx - r.root.position.x) * k3;
          r.root.position.z += (r.tz - r.root.position.z) * k3;
          r.root.position.y += (r.sy - r.root.position.y) * k3;
          let dY3 = r.tyaw - r.root.rotation.y;
          while (dY3 > Math.PI) dY3 -= Math.PI * 2;
          while (dY3 < -Math.PI) dY3 += Math.PI * 2;
          r.root.rotation.y += dY3 * k3;
          // su figura ENTERA: caminata/sentado/emote como la propia
          r.walkPh += dt * (5.2 + 4.0 * r.m) * r.m;
          r.sitAmt += (r.sit - r.sitAmt) * Math.min(1, dt * 6);
          let Jr = poseCartoon(t, r.walkPh, r.m);
          if (r.sitAmt > 0.01) {
            Jr = mixJoints(Jr, poseSit(t), r.sitAmt);
            Jr.pelvisY -= 0.085 * r.sitAmt;
          }
          const eT2 = t - r.emoStart;
          if (r.emoIdx >= 0 && eT2 >= 0 && eT2 < 2.4) applyGesture(Jr, r.emoIdx, eT2, t);
          buildFigure(Jr);
          r.mesh.updateVerticesData('position', FIG.pos as Float32Array);
          VertexData.ComputeNormals(FIG.pos, FIG.idx, NORM_SCRATCH);
          r.mesh.updateVerticesData('normal', NORM_SCRATCH);
          decalPositions(Jr, r.decalPos, DEC_U, DEC_V, DEC_PHI, DEC_T0, DEC_T1);
          r.decal.updateVerticesData('position', r.decalPos);
          if (r.hat || r.scarf) {
            const hfr = headFrame(Jr);
            const tX = Math.atan2(hfr.hax[2], hfr.hax[1]);
            const tZ = -Math.atan2(hfr.hax[0], hfr.hax[1]);
            if (r.hat) {
              r.hat.position.set(hfr.neckTop[0] + hfr.hax[0] * 0.27, hfr.neckTop[1] + hfr.hax[1] * 0.27, hfr.neckTop[2] + hfr.hax[2] * 0.27);
              r.hat.rotation.set(tX, Jr.headTurn * 0.5, tZ);
            }
            if (r.scarf) {
              r.scarf.position.set(hfr.neckTop[0], hfr.neckTop[1] + 0.01, hfr.neckTop[2]);
              r.scarf.rotation.set(tX, 0, tZ);
            }
          }
          if (r.bubble && t > r.bubbleUntil) r.bubble.isVisible = false;
        }
      }
      // BGM: crossfade feria ↔ estadio según dónde estés
      if (BGM_FAIR && BGM_CALM) {
        const exb = (PLAYER.root.position.x - ESTADIO.x) / EST_A;
        const ezb = (PLAYER.root.position.z - ESTADIO.z) / EST_B;
        const adentro = exb * exb + ezb * ezb < 1;
        const k2 = Math.min(1, dt * 1.2);
        BGM_FAIR.volume += ((adentro ? 0 : 0.5) - BGM_FAIR.volume) * k2;
        BGM_CALM.volume += ((adentro ? 0.5 : 0) - BGM_CALM.volume) * k2;
      }
      // globo de chat: se esconde al vencer
      if (chatPlane && t > chatUntil) chatPlane.isVisible = false;
      // apuesta activa: se resuelve a los 45s (50/50, paga doble)
      if (BET.active && t > BET.resolveAt) {
        BET.active = false;
        if (Math.random() < 0.5) {
          COINS += BET.amount * 2;
          updCoins();
          showChat(scene, '🎲 ¡Ganó ' + BET.team + '! +' + (BET.amount * 2) + ' 🪙');
        } else {
          showChat(scene, '🎲 Perdió ' + BET.team + '… la próxima');
        }
      }
      // fixture board cerca → botón de apostar
      const betBtn = document.getElementById('betbtn');
      if (betBtn) {
        const nearBoard = Math.hypot(PLAYER.root.position.x - 28, PLAYER.root.position.z - 11) < 5;
        betBtn.style.display = nearBoard && !BET.active ? 'flex' : 'none';
      }
      // tienda cercana → botón de abrir
      NEAR_SHOP = null;
      for (const s of SHOPS) {
        if (Math.hypot(PLAYER.root.position.x - s.x, PLAYER.root.position.z - s.z) < 3.2) {
          NEAR_SHOP = s;
          break;
        }
      }
      const shopBtn = document.getElementById('shopbtn');
      if (shopBtn) shopBtn.style.display = NEAR_SHOP ? 'flex' : 'none';
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
            ? '⚽ ' + nearPortal.label + (((window as unknown as Record<string, unknown>).__doorTxt as string) || ' — tocá la puerta para jugar')
            : '🚧 ' + nearPortal.label;
        } else {
          PHINT.style.display = 'none';
        }
      }
      camera.target.x += (PLAYER.root.position.x - camera.target.x) * 0.12;
      camera.target.z += (PLAYER.root.position.z - camera.target.z) * 0.12;
      camera.target.y += (PLAYER.root.position.y + 1.0 * PSCALE - camera.target.y) * 0.12;
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

    const $id = (s: string): HTMLElement => document.getElementById(s) as HTMLElement;

    // ─── idiomas (ES / EN / PT) ─────────────────────────────────────────
    const I18N: Record<string, Record<string, string>> = {
      es: {
        play: 'JUGAR', lang: 'Idioma', res: 'Resolución', low: 'Baja', med: 'Media', high: 'Alta',
        gfx: 'Gráficos', classic: 'Clásico', shadows: 'Sombras', paint: '🎨 pintá tu propia cara',
        isub: 'pintá tu cabeza en la bola 3D<br/>(girala con el 🔄) y poné tu nombre',
        isubName: 'poné tu nombre y entrá<br/>(la cara la podés pintar desde el menú)',
        name: 'tu nombre…', enter: 'ENTRAR AL PATIO',
        hintCam: 'arrastrá para girar · pellizcá para zoom',
        hintJoy: 'joystick para caminar (al límite corrés) · arrastrá para girar',
        door: ' — tocá la puerta para jugar',
        arch: 'PATIO MUNDIAL',
        fixprev: 'PRÓXIMOS PARTIDOS · MUNDIAL',
        dino: '¡Eaa, bienvenido al patio! 🦖⚽<br/>¿Querés jugar <b>minijuegos</b>? Metete al <b>ESTADIO</b> — está lleno de puertas-portal con juegos. <span style="opacity:0.55">(tocá para cerrar)</span>',
        remove: '✕ sacar', close: 'cerrar',
      },
      en: {
        play: 'PLAY', lang: 'Language', res: 'Resolution', low: 'Low', med: 'Medium', high: 'High',
        gfx: 'Graphics', classic: 'Classic', shadows: 'Shadows', paint: '🎨 paint your own face',
        isub: 'paint your head on the 3D ball<br/>(spin it with 🔄) and type your name',
        isubName: 'type your name and jump in<br/>(you can paint your face from the menu)',
        name: 'your name…', enter: 'ENTER THE PLAZA',
        hintCam: 'drag to look around · pinch to zoom',
        hintJoy: 'joystick to walk (push to the edge to run) · drag to look',
        door: ' — tap the door to play',
        arch: 'WORLD CUP PLAZA',
        fixprev: 'UPCOMING WORLD CUP MATCHES',
        dino: 'Heyo, welcome to the plaza! 🦖⚽<br/>Want to play <b>minigames</b>? Head into the <b>STADIUM</b> — it is packed with game portals. <span style="opacity:0.55">(tap to close)</span>',
        remove: '✕ remove', close: 'close',
      },
      pt: {
        play: 'JOGAR', lang: 'Idioma', res: 'Resolução', low: 'Baixa', med: 'Média', high: 'Alta',
        gfx: 'Gráficos', classic: 'Clássico', shadows: 'Sombras', paint: '🎨 pinte seu próprio rosto',
        isub: 'pinte sua cabeça na bola 3D<br/>(gire com o 🔄) e digite seu nome',
        isubName: 'digite seu nome e entre<br/>(você pode pintar o rosto no menu)',
        name: 'seu nome…', enter: 'ENTRAR NO PÁTIO',
        hintCam: 'arraste para girar · belisque para zoom',
        hintJoy: 'joystick para andar (no limite você corre) · arraste para girar',
        door: ' — toque na porta para jogar',
        arch: 'PÁTIO MUNDIAL',
        fixprev: 'PRÓXIMOS JOGOS · COPA',
        dino: 'Eaí, bem-vindo ao pátio! 🦖⚽<br/>Quer jogar <b>minigames</b>? Entre no <b>ESTÁDIO</b> — está cheio de portais com jogos. <span style="opacity:0.55">(toque para fechar)</span>',
        remove: '✕ tirar', close: 'fechar',
      },
    };
    let LANG = 'es';
    try { LANG = localStorage.getItem('maplab_lang') || 'es'; } catch { /* sin storage */ }
    const T = (k: string): string => (I18N[LANG] && I18N[LANG][k]) || I18N.es[k] || k;
    const applyLang = (): void => {
      $id('mplay').textContent = T('play');
      $id('llang').textContent = T('lang');
      $id('lres').textContent = T('res');
      $id('lgfx').textContent = T('gfx');
      $id('paintbtn').textContent = T('paint');
      const resBs = document.querySelectorAll('#resopt b');
      resBs[0].textContent = T('low');
      resBs[1].textContent = T('med');
      resBs[2].textContent = T('high');
      (document.querySelectorAll('#gfxopt b')[0] as HTMLElement).textContent = T('classic'); // PBR y RTX son marcas fijas
      $id('lsha').textContent = T('shadows');
      const plsha = document.getElementById('plsha');
      if (plsha) plsha.textContent = T('shadows');
      document.querySelectorAll('#shaopt b, #pshaopt b').forEach((el, i) => {
        el.textContent = [T('low'), T('med'), T('high')][i % 3];
      });
      $id('iname').setAttribute('placeholder', T('name'));
      $id('ienter').textContent = T('enter');
      $id('dinobub').innerHTML = T('dino');
      paintArch(T('arch')); // el cartel del arco cambia con el idioma
      const hint0 = document.getElementById('hint');
      if (hint0 && !PLAYER) hint0.textContent = T('hintCam');
    };
    document.querySelectorAll('#langopt b').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#langopt b').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        LANG = (el as HTMLElement).dataset.l as string;
        try { localStorage.setItem('maplab_lang', LANG); } catch { /* ídem */ }
        applyLang();
      });
    });
    document.querySelectorAll('#langopt b').forEach((el) => {
      if ((el as HTMLElement).dataset.l === LANG) {
        document.querySelectorAll('#langopt b').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
      }
    });
    applyLang();

    // ─── MENÚ DE INICIO: cinemática de fondo + ajustes + reloj ──────────
    let CINE = true;
    const cam0 = scene.activeCamera as ArcRotateCamera;
    const SHOTS = [
      { tx: 0, ty: 2, tz: 12, a: -1.25, b: 1.12, r: 26 },        // patio
      { tx: 0, ty: 7, tz: 52, a: -Math.PI / 2, b: 1.18, r: 46 }, // estadio
      { tx: 44, ty: 1.5, tz: -5, a: 2.4, b: 1.0, r: 22 },        // cancha
      { tx: 20.5, ty: 3, tz: 32, a: -1.7, b: 1.05, r: 15 },      // copas
      { tx: -31.7, ty: 2.5, tz: -4.3, a: -2.1, b: 1.15, r: 12 }, // muñeco
      { tx: 0, ty: 3, tz: -17.5, a: 1.35, b: 1.28, r: 16 },      // portal
    ];
    let shotI = 0;
    let shotT = performance.now();
    const applyShot = (s: typeof SHOTS[0]): void => {
      cam0.target.set(s.tx, s.ty, s.tz);
      cam0.alpha = s.a;
      cam0.beta = s.b;
      cam0.radius = s.r;
    };
    applyShot(SHOTS[0]);
    scene.onBeforeRenderObservable.add(() => {
      if (!CINE) return;
      cam0.alpha += 0.00005 * scene.getEngine().getDeltaTime(); // paneo lento
      if (performance.now() - shotT > 7000) {
        shotI = (shotI + 1) % SHOTS.length;
        shotT = performance.now();
        applyShot(SHOTS[shotI]);
      }
    });
    // ajustes: resolución
    document.querySelectorAll('#resopt b').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#resopt b').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        const r = parseFloat((el as HTMLElement).dataset.r as string);
        const eff = r >= 1.5 ? Math.min(window.devicePixelRatio || 1, 1.75) : r;
        engine.setHardwareScalingLevel(1 / eff);
      });
    });
    // ajustes: gráficos en 3 niveles
    //   Clásico: pelado, SIN sombras (rinde en cualquier lado)
    //   PBR: tonemapping ACES + bloom + FXAA + viñeta + sombras SIMPLES
    //   RTX: sombras dinámicas PCF (jugador + tiendas + ÁRBOLES) + SSAO +
    //        rayos de sol volumétricos + puntos de luz en faroles + bloom bajito
    let pipeline: DefaultRenderingPipeline | null = null;
    let shadowGen: ShadowGenerator | null = null;
    let SHADOWRES = 1024; // ajustable en Ajustes (vale en PBR y RTX)
    let CURG = '0';
    let ssao: SSAO2RenderingPipeline | null = null;
    let godrays: VolumetricLightScatteringPostProcess | null = null;
    let lampLights: PointLight[] = [];
    const gfxTeardown = (): void => {
      if (LIGHTS) {
        LIGHTS.hemi.intensity = 0.78;
        LIGHTS.hemi.groundColor = new Color3(0.5, 0.58, 0.42);
      }
      if (pipeline) { pipeline.dispose(); pipeline = null; }
      if (shadowGen) { shadowGen.dispose(); shadowGen = null; }
      if (ssao) { ssao.dispose(); ssao = null; }
      if (godrays) { godrays.dispose(cam0); godrays = null; GODRAYS_MESH = null; }
      for (const l of lampLights) l.dispose();
      lampLights = [];
    };
    const mkPipeline = (bloom: number): void => {
      pipeline = new DefaultRenderingPipeline('cine', true, scene, [cam0]);
      pipeline.fxaaEnabled = true;
      pipeline.bloomEnabled = bloom > 0;
      pipeline.bloomThreshold = 0.75;
      pipeline.bloomWeight = bloom;
      pipeline.imageProcessing.toneMappingEnabled = true;
      pipeline.imageProcessing.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
      pipeline.imageProcessing.contrast = 1.18;
      pipeline.imageProcessing.exposure = 1.12;
      pipeline.imageProcessing.vignetteEnabled = true;
      pipeline.imageProcessing.vignetteWeight = 1.3;
    };
    const mkShadows = (size: number, pcf: boolean, todo: boolean): void => {
      if (!LIGHTS) return;
      shadowGen = new ShadowGenerator(size, LIGHTS.sun);
      if (pcf) shadowGen.usePercentageCloserFiltering = true;
      else shadowGen.usePoissonSampling = true;
      shadowGen.transparencyShadow = true; // respeta el alpha de los robles
      shadowGen.bias = 0.0012;
      for (const m of SHADOW_CASTERS) shadowGen.addShadowCaster(m);
      if (todo) {
        // RTX: TODO tira sombra (salvo pisos, billboards de UI y cielo)
        const skip = ['patio-ground', 'paseo', 'sendero', 'caminito', 'est-apron', 'est-floor',
          'cancha', 'pl-name', 'chat-plane', 'emo-plane', 'player-cara', 'plaza', 'mu-disc', 'cp-disc', 'tuft'];
        for (const m of scene.meshes) {
          if (skip.some((s) => m.name.startsWith(s))) continue;
          shadowGen.addShadowCaster(m as Mesh);
        }
        for (const m of TREE_CASTERS) shadowGen.addShadowCaster(m);
      }
    };
    const setGraphics = (g: string): void => {
      gfxTeardown();
      CURG = g;
      if (g === '1') { // PBR: lindo y liviano
        mkPipeline(0.22);
        mkShadows(SHADOWRES, false, false);
      } else if (g === '2') { // RTX: todos los chiches
        mkPipeline(0.10); // bloom no tan alto
        mkShadows(SHADOWRES, true, true);
        ssao = new SSAO2RenderingPipeline('ssao', scene, 0.5, [cam0]);
        ssao.radius = 0.6;
        ssao.totalStrength = 1.1;
        ssao.samples = 12;
        // iluminación global aproximada: rebote del pasto + luz de relleno
        if (LIGHTS) {
          LIGHTS.hemi.intensity = 0.88;
          LIGHTS.hemi.groundColor = new Color3(0.38, 0.52, 0.3);
          const fill = new DirectionalLight('gi-fill', new Vector3(0.5, -0.6, 0.45), scene);
          fill.intensity = 0.18;
          fill.diffuse = new Color3(0.75, 0.85, 1.0);
          lampLights.push(fill as unknown as PointLight);
        }
        // rayos del sol: disco brillante + scattering volumétrico
        godrays = new VolumetricLightScatteringPostProcess('rayos', 1.0, cam0, undefined as never, 60, Texture.BILINEAR_SAMPLINGMODE, engine, false);
        GODRAYS_MESH = godrays.mesh;
        if (SKY) godrays.mesh.position.copyFrom(SKY.sun.isVisible ? SKY.sun.position : SKY.moon.position);
        godrays.mesh.scaling.setAll(28);
        godrays.exposure = 0.18;
        godrays.decay = 0.967;
        // puntos de luz cálidos en los faroles más cercanos al patio
        const cerca = LAMP_POS.slice().sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, 4);
        for (const lp of cerca) {
          const pl = new PointLight(`lamp-${lp.x}-${lp.z}`, new Vector3(lp.x, 3.4, lp.z), scene);
          pl.diffuse = Color3.FromHexString('#ffca6a');
          pl.intensity = 0.45;
          pl.range = 10;
          lampLights.push(pl);
        }
      }
    };
    document.querySelectorAll('#gfxopt b').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#gfxopt b').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        setGraphics((el as HTMLElement).dataset.g as string);
      });
    });
    document.querySelectorAll('#shaopt b, #pshaopt b').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#shaopt b, #pshaopt b').forEach((x) => x.classList.remove('on'));
        document.querySelectorAll(`#shaopt b[data-s="${(el as HTMLElement).dataset.s}"], #pshaopt b[data-s="${(el as HTMLElement).dataset.s}"]`).forEach((x) => x.classList.add('on'));
        SHADOWRES = parseInt((el as HTMLElement).dataset.s as string, 10);
        if (CURG !== '0') setGraphics(CURG); // regenera con la nueva resolución
      });
    });
    // reloj real: hora local del dispositivo YA, y la API por IP la refina
    const mclock = $id('mclock');
    const showHour = (hh: number, mm: number, lugar: string): void => {
      mclock.textContent = '🕒 ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (lugar ? ' · ' + lugar : '');
      applySky(hh + mm / 60); // el sol/la luna a su posición horaria
    };
    setInterval(() => { // el cielo sigue al reloj mientras jugás
      const d2 = new Date();
      applySky(d2.getHours() + d2.getMinutes() / 60);
    }, 60000);
    const dl = new Date();
    showHour(dl.getHours(), dl.getMinutes(), '');
    fetch('https://ipapi.co/json/')
      .then((r) => r.json())
      .then((d: { city?: string; timezone?: string }) => {
        if (!d.timezone) return;
        const parts = new Intl.DateTimeFormat('es-AR', { timeZone: d.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
        const [hh, mm] = parts.split(':').map((n) => parseInt(n, 10));
        showHour(hh, mm, d.city ?? '');
      })
      .catch(() => { /* sin red: queda la hora local */ });

    // ─── ENTRADA OBLIGATORIA: pintá tu cabeza en la BOLA 3D + nombre ────
    const iname = $id('iname') as HTMLInputElement;
    const ienter = $id('ienter') as HTMLButtonElement;
    // capas de pintura: trazos (transparente) + color base → compuesto
    const FW = 1024;
    const FH = 512;
    const strokesCv = document.createElement('canvas');
    strokesCv.width = FW;
    strokesCv.height = FH;
    const sctx = strokesCv.getContext('2d') as CanvasRenderingContext2D;
    const compositeCv = document.createElement('canvas');
    compositeCv.width = FW;
    compositeCv.height = FH;
    const cctx = compositeCv.getContext('2d') as CanvasRenderingContext2D;
    let baseCol = '#e8b88f';
    let ink = '#2b1c12';
    let drew = 0;
    const validate = (): void => {
      ienter.disabled = !(iname.value.trim().length >= 2 && drew > 0);
    };
    // mini-escena de la bola: la MISMA geometría de la cabeza del jugador
    const ballcv = $id('ballcv') as HTMLCanvasElement;
    const engine2 = new Engine(ballcv, true, { stencil: false });
    const scene2 = new Scene(engine2);
    scene2.clearColor = Color4.FromHexString('#0b0e18ff');
    const cam2 = new ArcRotateCamera('c2', Math.PI / 2, 1.45, 0.46, new Vector3(0, 0, 0), scene2);
    cam2.minZ = 0.01;
    const h2 = new HemisphericLight('h2', new Vector3(0, 1, 0), scene2);
    h2.intensity = 0.95;
    const d2 = new DirectionalLight('d2', new Vector3(-0.4, -0.7, -0.6), scene2);
    d2.intensity = 0.55;
    // malla de la cabeza (decal full-wrap) centrada en el origen
    const bpos = new Float32Array((DEC_U + 1) * (DEC_V + 1) * 3);
    decalPositions(J0(), bpos, DEC_U, DEC_V, DEC_PHI, DEC_T0, DEC_T1);
    let byMin = 1e9;
    let byMax = -1e9;
    for (let i = 1; i < bpos.length; i += 3) {
      byMin = Math.min(byMin, bpos[i]);
      byMax = Math.max(byMax, bpos[i]);
    }
    const byC = (byMin + byMax) / 2;
    for (let i = 1; i < bpos.length; i += 3) bpos[i] -= byC;
    const bvd = new VertexData();
    bvd.positions = bpos;
    const buvs = new Float32Array((DEC_U + 1) * (DEC_V + 1) * 2);
    const bidx: number[] = [];
    let bk = 0;
    for (let j = 0; j <= DEC_V; j++) {
      for (let i = 0; i <= DEC_U; i++) {
        buvs[bk++] = i / DEC_U;
        buvs[bk++] = 1 - j / DEC_V;
      }
    }
    for (let j = 0; j < DEC_V; j++) {
      for (let i = 0; i < DEC_U; i++) {
        const a = j * (DEC_U + 1) + i;
        bidx.push(a, a + DEC_U + 1, a + 1, a + 1, a + DEC_U + 1, a + DEC_U + 2);
      }
    }
    bvd.uvs = buvs;
    bvd.indices = bidx;
    const bnorm = new Float32Array(bpos.length);
    VertexData.ComputeNormals(bpos, bidx, bnorm);
    bvd.normals = bnorm;
    const ball = new Mesh('bola', scene2);
    bvd.applyToMesh(ball);
    const ballTex = new DynamicTexture('bola-tex', { width: FW, height: FH }, scene2, true);
    const bmat = new StandardMaterial('bola-mat', scene2);
    bmat.diffuseTexture = ballTex;
    bmat.specularColor = new Color3(0.06, 0.06, 0.06);
    bmat.backFaceCulling = false;
    ball.material = bmat;
    const compose = (): void => {
      cctx.fillStyle = baseCol;
      cctx.fillRect(0, 0, FW, FH);
      cctx.drawImage(strokesCv, 0, 0);
      const bc = ballTex.getContext() as unknown as CanvasRenderingContext2D;
      bc.save();
      bc.translate(0, FH);
      bc.scale(1, -1); // flip Y de DynamicTexture
      bc.drawImage(compositeCv, 0, 0);
      bc.restore();
      ballTex.update(false);
    };
    compose();
    engine2.runRenderLoop(() => scene2.render());
    // pintar tocando la bola: pick → UV → trazo en strokesCv
    let painting = false;
    let lastU = -1;
    let lastV = -1;
    const paintAt = (e: PointerEvent, lineFrom: boolean): void => {
      const r = ballcv.getBoundingClientRect();
      const pick = scene2.pick((e.clientX - r.left) * (ballcv.width / r.width), (e.clientY - r.top) * (ballcv.height / r.height));
      if (!pick?.hit || pick.pickedMesh !== ball) return;
      const uv = pick.getTextureCoordinates();
      if (!uv) return;
      const px = uv.x * FW;
      const py = (1 - uv.y) * FH;
      sctx.lineCap = 'round';
      if (ink === 'ERASE') {
        sctx.save();
        sctx.globalCompositeOperation = 'destination-out';
        sctx.beginPath();
        sctx.arc(px, py, 34, 0, 7);
        sctx.fill();
        sctx.restore();
      } else {
        sctx.strokeStyle = ink;
        sctx.fillStyle = ink;
        sctx.lineWidth = 26;
        // si cruza la costura del wrap (salto de u), solo punto
        if (lineFrom && lastU >= 0 && Math.abs(px - lastU) < FW / 2) {
          sctx.beginPath();
          sctx.moveTo(lastU, lastV);
          sctx.lineTo(px, py);
          sctx.stroke();
        } else {
          sctx.beginPath();
          sctx.arc(px, py, 13, 0, 7);
          sctx.fill();
        }
      }
      lastU = px;
      lastV = py;
      drew++;
      validate();
      compose();
    };
    ballcv.addEventListener('pointerdown', (e) => {
      painting = true;
      lastU = -1;
      ballcv.setPointerCapture(e.pointerId);
      paintAt(e, false);
      e.preventDefault();
    });
    ballcv.addEventListener('pointermove', (e) => { if (painting) paintAt(e, true); });
    window.addEventListener('pointerup', () => { painting = false; });
    // rotador: arrastrá el redondo de la derecha para girar la bola
    const rot = $id('ballrot');
    let rotting = -1;
    let rlx = 0;
    let rly = 0;
    rot.addEventListener('pointerdown', (e) => {
      rotting = e.pointerId;
      rot.setPointerCapture(rotting);
      rlx = e.clientX;
      rly = e.clientY;
      e.preventDefault();
      e.stopPropagation();
    });
    rot.addEventListener('pointermove', (e) => {
      if (e.pointerId !== rotting) return;
      ball.rotation.y -= (e.clientX - rlx) * 0.012;
      ball.rotation.x = Math.max(-1.1, Math.min(1.1, ball.rotation.x + (e.clientY - rly) * 0.01));
      rlx = e.clientX;
      rly = e.clientY;
    });
    const rotEnd = (): void => { rotting = -1; };
    rot.addEventListener('pointerup', rotEnd);
    rot.addEventListener('pointercancel', rotEnd);
    // tintas (arriba y abajo) + color base de la bola
    document.querySelectorAll('.inkrow .tool').forEach((el) => {
      el.addEventListener('click', () => {
        const c = (el as HTMLElement).dataset.c as string;
        if (c === 'CLEAR') {
          sctx.clearRect(0, 0, FW, FH);
          drew = 0;
          validate();
          compose();
          return;
        }
        ink = c;
        document.querySelectorAll('.inkrow .tool').forEach((t2) => t2.classList.remove('on'));
        el.classList.add('on');
      });
    });
    document.querySelectorAll('#baserow .tool').forEach((el) => {
      el.addEventListener('click', () => {
        baseCol = (el as HTMLElement).dataset.b as string;
        document.querySelectorAll('#baserow .tool').forEach((t2) => t2.classList.remove('on'));
        el.classList.add('on');
        compose();
      });
    });
    iname.addEventListener('input', validate);
    // cara/nombre guardados: precarga (igual te muestra la entrada)
    try {
      const sn = localStorage.getItem('maplab_name');
      const sf = localStorage.getItem('maplab_face2');
      const sb = localStorage.getItem('maplab_base');
      if (sn) iname.value = sn;
      if (sb) { baseCol = sb; }
      if (sf) {
        const img = new Image();
        img.onload = () => {
          sctx.drawImage(img, 0, 0, FW, FH);
          drew = Math.max(drew, 1);
          validate();
          compose();
        };
        img.src = sf;
      }
    } catch { /* sin storage, no pasa nada */ }
    validate();

    // dino pixel art naranja (guía del estadio)
    const dcv = $id('dinocv') as HTMLCanvasElement;
    drawDino(dcv.getContext('2d') as CanvasRenderingContext2D, 1, 0, 0);
    const dino = $id('dino');
    $id('dinobub').addEventListener('pointerdown', () => { dino.style.display = 'none'; });
    dcv.addEventListener('pointerdown', () => { dino.style.display = 'none'; });
    // horizontal SÍ O SÍ: fullscreen + lock landscape (gesto del usuario)
    const goLandscape = (): void => {
      try {
        const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
        const lock = (): void => {
          const o = screen.orientation as ScreenOrientation & { lock?: (m: string) => Promise<void> };
          if (o && o.lock) o.lock('landscape').catch(() => { /* desktop */ });
        };
        if (el.requestFullscreen && !document.fullscreenElement) {
          el.requestFullscreen().then(lock).catch(lock);
        } else {
          lock();
        }
      } catch { /* sin soporte */ }
    };
    // cara DEFAULT si nunca pintaste (dos ojos + sonrisa al frente)
    const defaultFace = (): void => {
      if (drew > 0) return;
      sctx.fillStyle = '#2b1c12';
      sctx.beginPath(); sctx.arc(512 - 64, 188, 17, 0, 7); sctx.fill();
      sctx.beginPath(); sctx.arc(512 + 64, 188, 17, 0, 7); sctx.fill();
      sctx.strokeStyle = '#2b1c12';
      sctx.lineWidth = 13;
      sctx.lineCap = 'round';
      sctx.beginPath(); sctx.arc(512, 252, 58, Math.PI * 0.15, Math.PI * 0.85); sctx.stroke();
      drew = 1;
      validate();
      compose();
    };
    const openIntro = (paintMode: boolean): void => {
      CINE = false;
      goLandscape();
      $id('menu').style.display = 'none';
      $id('intro').style.display = 'flex';
      $id('ileft').style.display = paintMode ? 'flex' : 'none';
      ($id('ibox').querySelector('.isub') as HTMLElement).innerHTML = paintMode ? T('isub') : T('isubName');
      if (!paintMode) defaultFace(); // pintar es OPCIONAL: JUGAR usa la default/guardada
      dino.style.display = 'flex'; // el dino te tira la data del estadio
      engine2.resize();
      setTimeout(() => engine2.resize(), 600); // tras el giro a landscape
      setTimeout(() => engine.resize(), 600);
      applyLang();
    };
    $id('mplay').addEventListener('click', () => openIntro(false));
    $id('paintrow').addEventListener('click', () => openIntro(true));

    const enterGame = (): void => {
      if (PLAYER) return;
      const nombre = iname.value.trim().slice(0, 14) || 'WACHO';
      try {
        localStorage.setItem('maplab_name', nombre);
        localStorage.setItem('maplab_face2', strokesCv.toDataURL('image/png'));
        localStorage.setItem('maplab_base', baseCol);
      } catch { /* ídem */ }
      cctx.fillStyle = baseCol; // compuesto final fresco
      cctx.fillRect(0, 0, FW, FH);
      cctx.drawImage(strokesCv, 0, 0);
      OUTFIT_ST.piel = baseCol; // manos/cuello del color de la bola
      PLAYER = buildPlayer(scene, compositeCv, nombre);
      initPhysics();
      connectNet(scene, nombre); // online si hay ?ws= configurado
      // BGM como el original: feria en el parque, calma adentro del estadio
      try {
        BGM_FAIR = new Audio(bgmFairUrl);
        BGM_FAIR.loop = true;
        BGM_FAIR.volume = 0.5;
        BGM_FAIR.play().catch(() => { /* autoplay bloqueado */ });
        BGM_CALM = new Audio(bgmCalmUrl);
        BGM_CALM.loop = true;
        BGM_CALM.volume = 0;
        BGM_CALM.play().catch(() => { /* ídem */ });
      } catch { /* sin audio */ }
      if (BALLST && !BALLB) {
        BALLB = new CANNON.Body({
          mass: 1.1,
          shape: new CANNON.Sphere(0.28),
          position: new CANNON.Vec3(BALLST.home.x, BALLST.home.y, BALLST.home.z),
          linearDamping: 0.35,
          angularDamping: 0.35,
          material: PHYS_MAT as CANNON.Material,
        });
        (PHYS as CANNON.World).addBody(BALLB);
      }
      SCORE_RESET_AT = performance.now() / 1000 + 180;
      for (const g of GOALS) paintBoard(g);
      engine2.stopRenderLoop();
      engine2.dispose();
      $id('intro').style.display = 'none';
      $id('dino').style.display = 'none';
      $id('joy').style.display = 'block';
      $id('emobtn').style.display = 'flex';
      $id('jumpbtn').style.display = 'flex';
      $id('chatbtn').style.display = 'flex';
      $id('coins').style.display = 'block';
      $id('pausebtn').style.display = 'flex';
      $id('dicebtn').style.display = 'flex';
      updCoins();
      const cam = scene.activeCamera as ArcRotateCamera;
      cam.alpha = -Math.PI / 2;
      cam.beta = 1.22;
      cam.radius = 9;
      cam.lowerRadiusLimit = 4;
      (window as unknown as Record<string, unknown>).__doorTxt = T('door');
      const hint = document.getElementById('hint');
      if (hint) {
        hint.textContent = T('hintJoy');
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

    // ─── saltar + ragdoll ───────────────────────────────────────────────
    const jb = $id('jumpbtn');
    jb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!JUMP.active && SIT.target === 0 && !RAGD.on) {
        JUMP.active = true;
        JUMP.vy = 5.4;
      }
    });
    // ─── tiendas: abrir y equipar (mecánica del original) ──────────────
    const shopBtn = $id('shopbtn');
    const shopPanel = $id('shoppanel');
    const closeShop = (): void => {
      shopPanel.style.display = 'none';
      shopPanel.classList.remove('panel-center');
    };
    const swatchRow = (cols: string[], pick: (c: string) => void): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'swrow';
      for (const c of cols) {
        const s = document.createElement('div');
        s.className = 'sw';
        s.style.background = c;
        s.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pick(c);
        });
        row.appendChild(s);
      }
      return row;
    };
    const itemRow = (items: string[], pick: (i: number) => void): HTMLElement => {
      const row = document.createElement('div');
      row.className = 'swrow';
      items.forEach((label, i) => {
        const b = document.createElement('div');
        b.className = 'shopitem';
        b.textContent = label;
        b.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          pick(i === 0 ? -1 : i - 1); // el primero siempre es "sacar"
        });
        row.appendChild(b);
      });
      return row;
    };
    const openShop = (shop: { id: string; nombre: string }): void => {
      shopPanel.classList.remove('panel-center');
      shopPanel.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'shoptitle';
      title.textContent = '🛍 ' + shop.nombre;
      shopPanel.appendChild(title);
      const precio = document.createElement('div');
      precio.className = 'isub';
      precio.style.cssText = 'opacity:0.65;margin-bottom:6px;font-size:11px';
      precio.textContent = '🪙 colores 5 · sombreros 25 · anteojos 15 · bufandas 10';
      shopPanel.appendChild(precio);
      if (shop.id === 'shirts' || shop.id === 'customize') {
        shopPanel.appendChild(swatchRow(PALETA, (c) => tryBuy(5, () => { OUTFIT_ST.remera = c; OUTFIT_ST.remeraPat = -1; repaintOutfit(); })));
        shopPanel.appendChild(itemRow(['✕ liso', '〰 rayas', '➖ aros', '◧ mitades', '🌌 galaxy', '🔷 geo', '🌴 tropical'], (i) => tryBuy(i < 0 ? 0 : 15, () => {
          OUTFIT_ST.remeraPat = i;
          repaintOutfit();
        })));
      } else if (shop.id === 'pants') {
        shopPanel.appendChild(swatchRow(PALETA, (c) => tryBuy(5, () => { OUTFIT_ST.pantalon = c; repaintOutfit(); })));
      } else if (shop.id === 'shoes') {
        shopPanel.appendChild(swatchRow(PALETA.concat(['#3dbf5a']), (c) => tryBuy(5, () => { OUTFIT_ST.zapas = c; repaintOutfit(); })));
      } else if (shop.id === 'hats') {
        shopPanel.appendChild(itemRow([T('remove'), '🧢 gorra', '🎩 galera', '🤕 vincha', '👒 piluso', '👑 corona', '🥶 beanie'], (i) => tryBuy(i < 0 ? 0 : 25, () => equipHat(scene, i))));
      } else if (shop.id === 'glasses') {
        shopPanel.appendChild(itemRow([T('remove'), '🕶 redondos', '😎 grandes', '🥽 deportivos', '🤓 cuadrados'], (i) => tryBuy(i < 0 ? 0 : 15, () => {
          OUTFIT_ST.glasses = i;
          saveOutfit();
          paintPlayerFace();
        })));
      } else if (shop.id === 'scarves') {
        shopPanel.appendChild(itemRow([T('remove'), '🧣 roja', '🧣 amarilla', '🧣 rosa', '🧣 violeta', '🧣 celeste', '🧣 naranja'], (i) => tryBuy(i < 0 ? 0 : 10, () => equipScarf(scene, i))));
      }
      const cls = document.createElement('div');
      cls.className = 'shopitem shopclose';
      cls.textContent = T('close');
      cls.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeShop();
      });
      shopPanel.appendChild(cls);
      shopPanel.style.display = 'block';
    };
    shopBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (NEAR_SHOP) openShop(NEAR_SHOP);
    });

    // ─── chat con globo de texto ────────────────────────────────────────
    const chatBtn = $id('chatbtn');
    const chatBar = $id('chatbar');
    const chatInput = $id('chatinput') as HTMLInputElement;
    const MALAS = ['puto', 'puta', 'pija', 'mierda', 'forro', 'concha', 'pelotudo', 'fuck', 'shit', 'bitch', 'asshole', 'caralho', 'porra', 'merda'];
    const sendChat = (): void => {
      let txt = chatInput.value.trim();
      for (const m of MALAS) { // filtro de lenguaje (mecánica del original)
        txt = txt.replace(new RegExp(m, 'gi'), '***');
      }
      if (txt) {
        showChat(scene, txt);
        if (NETROOM) NETROOM.send('chat', txt);
      }
      chatInput.value = '';
      chatBar.style.display = 'none';
    };
    chatBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chatBar.style.display = chatBar.style.display === 'flex' ? 'none' : 'flex';
      if (chatBar.style.display === 'flex') chatInput.focus();
    });
    $id('chatsend').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sendChat();
    });
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

    // ─── apuestas en el fixture board (paga doble, 50/50) ───────────────
    $id('betbtn').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shopPanel.classList.remove('panel-center');
      shopPanel.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'shoptitle';
      title.textContent = '🎲 PRODE · apostá 25 🪙 (paga 50)';
      shopPanel.appendChild(title);
      const equipos = ['ARG', 'BRA', 'GER', 'FRA', 'URU', 'MEX'];
      shopPanel.appendChild(itemRow(['✕'].concat(equipos.map((e2) => '⚽ ' + e2)), (i) => {
        if (i < 0) return;
        tryBuy(25, () => {
          BET.active = true;
          BET.team = equipos[i];
          BET.amount = 25;
          BET.resolveAt = performance.now() / 1000 + 45;
          showChat(scene, '🎲 25 🪙 a ' + BET.team + ' — en 45s sale');
        });
      }));
      const cls = document.createElement('div');
      cls.className = 'shopitem shopclose';
      cls.textContent = T('close');
      cls.addEventListener('pointerdown', (e3) => {
        e3.preventDefault();
        e3.stopPropagation();
        closeShop();
      });
      shopPanel.appendChild(cls);
      shopPanel.style.display = 'block';
    });

    // ─── menú de PAUSA con ajustes ──────────────────────────────────────
    const pauseBtn = $id('pausebtn');
    const pauseMenu = $id('pausemenu');
    pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      PAUSED = true;
      pauseMenu.style.display = 'flex';
    });
    $id('presume').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      PAUSED = false;
      pauseMenu.style.display = 'none';
    });
    $id('pexit').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      location.reload();
    });
    document.querySelectorAll('#presopt b').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#presopt b, #resopt b').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        const r = parseFloat((el as HTMLElement).dataset.r as string);
        const eff = r >= 1.5 ? Math.min(window.devicePixelRatio || 1, 1.75) : r;
        engine.setHardwareScalingLevel(1 / eff);
      });
    });
    document.querySelectorAll('#pgfxopt b').forEach((el) => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#pgfxopt b, #gfxopt b').forEach((x) => x.classList.remove('on'));
        el.classList.add('on');
        setGraphics((el as HTMLElement).dataset.g as string);
      });
    });

    // ─── DADO: previa de los partidos del mundial que se vienen ─────────
    // EN TIEMPO REAL desde openfootball (la misma fuente del original);
    // si no hay red queda la grilla local.
    let PARTIDOS: Array<[string, string, string]> = [
      ['VIE 12', 'MEX', 'RSA'],
      ['VIE 12', 'CAN', 'ITA'],
      ['SÁB 13', 'USA', 'PAR'],
      ['SÁB 13', 'ARG', 'AUS'],
      ['DOM 14', 'BRA', 'MAR'],
      ['DOM 14', 'FRA', 'SEN'],
    ];
    const cod = (n: string): string => {
      const m: Record<string, string> = {
        'Mexico': 'MEX', 'South Africa': 'RSA', 'South Korea': 'KOR', 'Czech Republic': 'CZE',
        'United States': 'USA', 'Canada': 'CAN', 'Argentina': 'ARG', 'Brazil': 'BRA',
        'Germany': 'GER', 'France': 'FRA', 'England': 'ENG', 'Spain': 'ESP', 'Portugal': 'POR',
        'Netherlands': 'NED', 'Uruguay': 'URU', 'Croatia': 'CRO', 'Japan': 'JPN', 'Morocco': 'MAR',
        'Australia': 'AUS', 'Switzerland': 'SUI', 'Belgium': 'BEL', 'Italy': 'ITA', 'Colombia': 'COL',
        'Ecuador': 'ECU', 'Senegal': 'SEN', 'Ghana': 'GHA', 'New Zealand': 'NZL', 'Norway': 'NOR',
      };
      return m[n] || n.slice(0, 3).toUpperCase();
    };
    fetch('https://raw.githubusercontent.com/openfootball/world-cup.json/master/2026/worldcup.json')
      .then((r) => r.json())
      .then((d: { matches?: Array<{ date: string; team1: string; team2: string; score?: { ft?: number[] } }> }) => {
        if (!d.matches) return;
        // tablón: últimos resultados REALES
        const jugados = d.matches.filter((m) => m.score && m.score.ft);
        const filas = jugados.slice(-5).map((m) =>
          `${cod(m.team1)} ${(m.score as { ft: number[] }).ft[0]}-${(m.score as { ft: number[] }).ft[1]} ${cod(m.team2)}`);
        if (filas.length) paintFixtureBoard(filas);
        // dado: próximos partidos reales
        const DIAS = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
        const proximos = d.matches.filter((m) => !m.score || !m.score.ft).slice(0, 6);
        if (proximos.length) {
          PARTIDOS = proximos.map((m) => {
            const f = new Date(m.date + 'T12:00:00');
            return [`${DIAS[f.getDay()]} ${f.getDate()}`, cod(m.team1), cod(m.team2)] as [string, string, string];
          });
        }
      })
      .catch(() => { /* sin red: grilla local */ });
    $id('dicebtn').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      shopPanel.classList.add('panel-center'); // en el medio de la pantalla
      shopPanel.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'shoptitle';
      title.textContent = '🎲 ' + T('fixprev');
      shopPanel.appendChild(title);
      for (const [dia, t1, t2] of PARTIDOS) {
        const row = document.createElement('div');
        row.className = 'fixrow';
        const lbl = document.createElement('span');
        lbl.textContent = '📅 ' + dia;
        row.appendChild(lbl);
        for (const eq of [t1, t2]) {
          const b = document.createElement('div');
          b.className = 'fixbet';
          b.textContent = '⚽ ' + eq + ' · 25🪙';
          b.addEventListener('pointerdown', (e2) => {
            e2.preventDefault();
            e2.stopPropagation();
            if (BET.active) return;
            tryBuy(25, () => {
              BET.active = true;
              BET.team = eq;
              BET.amount = 25;
              BET.resolveAt = performance.now() / 1000 + 45;
              showChat(scene, '🎲 25 🪙 a ' + eq + ' — en 45s sale');
              closeShop();
            });
          });
          row.appendChild(b);
        }
        shopPanel.appendChild(row);
      }
      const cls = document.createElement('div');
      cls.className = 'shopitem shopclose';
      cls.textContent = T('close');
      cls.addEventListener('pointerdown', (e3) => {
        e3.preventDefault();
        e3.stopPropagation();
        closeShop();
      });
      shopPanel.appendChild(cls);
      shopPanel.style.display = 'block';
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
      getPlayer: () => PLAYER, input: INPUT,
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

let __started = false;
export function startGame(): void {
  if (__started) return; // guard: StrictMode monta el efecto dos veces en dev
  __started = true;
  boot();
}
