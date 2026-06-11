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

// ─── Constantes del layout (portables a world.ts) ───────────────────────
const RING_RADIUS = 17.5;        // radio del anillo de tiendas
const PROM_INNER = 13.8;         // paseo de lajas: borde interno
const PROM_OUTER = 21.4;         // paseo de lajas: borde externo
const GATE_ANGLE = -Math.PI / 2; // entrada al sur (-Z)
const GATE_HALF_GAP = 0.30;      // medio-hueco angular del portal (rad)
const FLAG_RADIUS = 6.5;         // mástiles alrededor del monumento
const GROUND_SIZE = 300;

interface TiendaDef {
  id: string;
  nombre: string;
  rubro: string;
  color: string;
}

// Las 7 tiendas reales del juego + 3 temáticas nuevas de feria.
const TIENDAS: TiendaDef[] = [
  { id: 'shirts',    nombre: "Sasha's Shirts",   rubro: 'SHIRTS & JERSEYS', color: '#c14444' },
  { id: 'pants',     nombre: 'Pants Pavilion',   rubro: 'PANTS & SHORTS',   color: '#3a6ea5' },
  { id: 'shoes',     nombre: 'Sneaker Stand',    rubro: 'SHOES',            color: '#e8c84a' },
  { id: 'hats',      nombre: 'The Hattery',      rubro: 'HATS',             color: '#9bd96b' },
  { id: 'glasses',   nombre: 'Glasses + Bags',   rubro: 'GLASSES & BAGS',   color: '#d96bc4' },
  { id: 'scarves',   nombre: 'Cozy Scarves',     rubro: 'SCARVES',          color: '#e89c4a' },
  { id: 'customize', nombre: 'The Design Bench', rubro: 'DESIGN YOUR OWN',  color: '#a85dd9' },
  { id: 'chori',     nombre: 'Choripán Corner',  rubro: 'PARRILLA',         color: '#c75b39' },
  { id: 'mate',      nombre: 'Mate & Tortas',    rubro: 'MERIENDA',         color: '#7c9e5a' },
  { id: 'prode',     nombre: 'Prode Mundial',    rubro: 'APUESTAS',         color: '#4aa3a3' },
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

// ─── Tienda: toldo a dos aguas rayado + mostrador + cartel + faroles ────
function buildTienda(scene: Scene, def: TiendaDef, x: number, z: number, facing: number,
  woodMat: StandardMaterial, woodDarkMat: StandardMaterial): void {
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
    panel.rotation.x = sign === 1 ? Math.PI / 2 - 0.62 : -(Math.PI / 2 - 0.62);
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
}

// ─── Escena completa ────────────────────────────────────────────────────
function buildScene(engine: Engine, canvas: HTMLCanvasElement): Scene {
  const scene = new Scene(engine);
  const SKY = '#aecbe8';
  scene.clearColor = Color4.FromHexString(`${SKY}ff`);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.0065;
  scene.fogColor = Color3.FromHexString(SKY);

  const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.12, 30, new Vector3(0, 1.4, 0), scene);
  camera.lowerRadiusLimit = 7;
  camera.upperRadiusLimit = 58;
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
    buildTienda(scene, TIENDAS[i], x, z, facing, woodMat, woodDarkMat);
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

  // ─── Robles y matas de pasto (billboards cruzados, estilo del juego) ──
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
    const s = 4.2 + rand() * 2.2;
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
    const s = 0.55 + rand() * 0.5;
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

  // ─── Animación: banderas flameando + auto-órbita en reposo ───────────
  let lastInteract = performance.now();
  canvas.addEventListener('pointerdown', () => { lastInteract = performance.now(); }, { passive: true });
  canvas.addEventListener('wheel', () => { lastInteract = performance.now(); }, { passive: true });
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000;
    for (let i = 0; i < flags.length; i++) {
      flags[i].rotation.y = (-((i / FLAGS.length) * Math.PI * 2 + Math.PI / 8) + Math.PI / 2) + Math.sin(t * 2.2 + i * 1.7) * 0.16;
    }
    if (performance.now() - lastInteract > 6000) {
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
    // handle de dev para capturas/automatización (shot-maplab.mjs)
    (window as unknown as Record<string, unknown>).__maplab = { scene, camera: scene.activeCamera };
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
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
