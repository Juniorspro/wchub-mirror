/// <reference types="vite/client" />
// ══════════════════════════════════════════════════════════════════════
// PERSONAJE v1 — laboratorio de personaje humanoide estilo PS1.
// Low-poly honesto (cajas + cilindros de pocos lados), texturas 64px con
// sampling NEAREST (pixelado fiel), cara pintada con parpadeo, camiseta
// rayada con 10 en la espalda, y animación procedural por jerarquía de
// nodos (respira, mira alrededor, balancea brazos y saluda al tocarlo).
// Sin huesos ni GLB: todo procedural, portable al juego después.
// ══════════════════════════════════════════════════════════════════════
import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
} from '@babylonjs/core';

function stdMat(scene: Scene, name: string, hex: string): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  return m;
}

// Textura pintada a mano, pixelada (NEAREST = nada de filtrado, puro PS1).
// El canvas se pinta con el eje Y dado vuelta (las DynamicTexture sin
// mipmaps salen espejadas verticalmente en el plano — visto en la cara).
function paintFlipped(tex: DynamicTexture, size: number,
  paint: (ctx: CanvasRenderingContext2D, s: number) => void): void {
  const c = tex.getContext() as unknown as CanvasRenderingContext2D;
  c.save();
  c.translate(0, size);
  c.scale(1, -1);
  paint(c, size);
  c.restore();
  tex.update(false);
}

function pixelTex(scene: Scene, name: string, size: number,
  paint: (ctx: CanvasRenderingContext2D, s: number) => void): DynamicTexture {
  const tex = new DynamicTexture(name, { width: size, height: size }, scene, false);
  paintFlipped(tex, size, paint);
  tex.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
  return tex;
}

interface Personaje {
  root: TransformNode;
  hips: TransformNode;
  chest: TransformNode;
  head: TransformNode;
  shoulderL: TransformNode;
  shoulderR: TransformNode;
  elbowR: TransformNode;
  paintFace: (blink: boolean) => void;
  meshes: Mesh[];
}

function buildPersonaje(scene: Scene): Personaje {
  const meshes: Mesh[] = [];
  const skin = stdMat(scene, 'p-skin', '#e8b88f');
  const shorts = stdMat(scene, 'p-shorts', '#1f2b56');
  const hair = stdMat(scene, 'p-hair', '#3a2a1c');
  const sockMat = stdMat(scene, 'p-sock', '#f2f2ee');
  const soleMat = stdMat(scene, 'p-sole', '#2c2c30');
  const shoeMat = stdMat(scene, 'p-shoe', '#f8f8f4');

  // camiseta: franjas verticales celeste/blanco (8px por franja a 64px)
  const jerseyTex = pixelTex(scene, 'p-jersey-tex', 64, (c, s) => {
    for (let i = 0; i < 8; i++) {
      c.fillStyle = i % 2 === 0 ? '#9ec8e8' : '#f4f6f8';
      c.fillRect(i * (s / 8), 0, s / 8, s);
    }
  });
  const jersey = new StandardMaterial('p-jersey', scene);
  jersey.diffuseTexture = jerseyTex;
  jersey.specularColor = new Color3(0.04, 0.04, 0.04);

  const part = (mesh: Mesh, mat: StandardMaterial, parent: TransformNode,
    x: number, y: number, z: number): Mesh => {
    mesh.parent = parent;
    mesh.position.set(x, y, z);
    mesh.material = mat;
    meshes.push(mesh);
    return mesh;
  };
  const B = MeshBuilder;

  const root = new TransformNode('p-root', scene);

  // ── piernas (ancladas al piso, de abajo hacia arriba) ────────────────
  const hips = new TransformNode('p-hips', scene);
  hips.parent = root;
  hips.position.y = 0.97;
  part(B.CreateBox('p-pelvis', { width: 0.46, height: 0.2, depth: 0.3 }, scene), shorts, hips, 0, 0.0, 0);
  for (const sx of [-1, 1] as const) {
    const leg = new TransformNode(`p-leg-${sx}`, scene);
    leg.parent = hips;
    leg.position.set(sx * 0.145, -0.08, 0);
    part(B.CreateBox('p-thigh', { width: 0.21, height: 0.4, depth: 0.26 }, scene), shorts, leg, 0, -0.2, 0);   // short
    part(B.CreateBox('p-shin', { width: 0.16, height: 0.26, depth: 0.18 }, scene), skin, leg, 0, -0.51, 0);
    part(B.CreateBox('p-sock', { width: 0.17, height: 0.16, depth: 0.19 }, scene), sockMat, leg, 0, -0.70, 0);
    part(B.CreateBox('p-shoe', { width: 0.19, height: 0.12, depth: 0.34 }, scene), shoeMat, leg, 0, -0.81, -0.05);
    part(B.CreateBox('p-sole', { width: 0.2, height: 0.05, depth: 0.36 }, scene), soleMat, leg, 0, -0.875, -0.05);
  }

  // ── torso con camiseta + 10 en la espalda ────────────────────────────
  const chest = new TransformNode('p-chest', scene);
  chest.parent = hips;
  chest.position.y = 0.12;
  part(B.CreateBox('p-torso', { width: 0.58, height: 0.62, depth: 0.32 }, scene), jersey, chest, 0, 0.4, 0);
  const numTex = pixelTex(scene, 'p-num-tex', 64, (c, s) => {
    c.clearRect(0, 0, s, s);
    c.fillStyle = '#1f2b56';
    c.font = 'bold 44px ui-monospace, monospace';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('10', s / 2, s / 2 + 2);
  });
  numTex.hasAlpha = true;
  const numMat = new StandardMaterial('p-num', scene);
  numMat.diffuseTexture = numTex;
  numMat.useAlphaFromDiffuseTexture = true;
  numMat.specularColor = new Color3(0, 0, 0);
  const numPlane = part(B.CreatePlane('p-num-plane', { width: 0.4, height: 0.4 }, scene), numMat, chest, 0, 0.45, 0.165);
  numPlane.rotation.y = Math.PI; // espalda = +Z (el pibe mira a -Z)

  // ── cabeza con cara pintada + pelo ───────────────────────────────────
  const head = new TransformNode('p-head', scene);
  head.parent = chest;
  head.position.y = 0.78;
  part(B.CreateBox('p-neck', { width: 0.14, height: 0.12, depth: 0.14 }, scene), skin, head, 0, -0.08, 0);
  part(B.CreateBox('p-skull', { width: 0.46, height: 0.46, depth: 0.46 }, scene), skin, head, 0, 0.2, 0);
  part(B.CreateBox('p-hair-top', { width: 0.5, height: 0.14, depth: 0.5 }, scene), hair, head, 0, 0.43, 0);
  part(B.CreateBox('p-hair-back', { width: 0.5, height: 0.3, depth: 0.12 }, scene), hair, head, 0, 0.24, 0.2);
  part(B.CreateBox('p-fringe', { width: 0.5, height: 0.1, depth: 0.08 }, scene), hair, head, 0, 0.4, -0.22);
  // orejas
  for (const sx of [-1, 1] as const) {
    part(B.CreateBox('p-ear', { width: 0.06, height: 0.12, depth: 0.1 }, scene), skin, head, sx * 0.26, 0.18, 0.02);
  }
  // cara: plano al frente con textura repintable (parpadeo)
  const faceTex = new DynamicTexture('p-face-tex', { width: 64, height: 64 }, scene, false);
  faceTex.updateSamplingMode(Texture.NEAREST_SAMPLINGMODE);
  const paintFace = (blink: boolean): void => paintFlipped(faceTex, 64, (c) => {
    c.fillStyle = '#e8b88f';                       // piel
    c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#5a3a22';                       // cejas
    c.fillRect(14, 22, 12, 3);
    c.fillRect(38, 22, 12, 3);
    if (blink) {
      c.fillStyle = '#7a4a2a';                     // ojos cerrados
      c.fillRect(15, 32, 10, 2);
      c.fillRect(39, 32, 10, 2);
    } else {
      c.fillStyle = '#ffffff';                     // ojos
      c.fillRect(15, 28, 10, 8);
      c.fillRect(39, 28, 10, 8);
      c.fillStyle = '#2c1c10';                     // pupilas
      c.fillRect(19, 30, 4, 5);
      c.fillRect(43, 30, 4, 5);
    }
    c.fillStyle = '#c2825e';                       // nariz
    c.fillRect(30, 36, 4, 6);
    c.fillStyle = '#8a4a34';                       // sonrisa
    c.fillRect(24, 48, 16, 3);
    c.fillRect(22, 46, 3, 3);
    c.fillRect(39, 46, 3, 3);
  });
  paintFace(false);
  const faceMat = new StandardMaterial('p-face', scene);
  faceMat.diffuseTexture = faceTex;
  faceMat.emissiveColor = new Color3(0.25, 0.25, 0.25); // que se lea en sombra
  faceMat.specularColor = new Color3(0, 0, 0);
  part(B.CreatePlane('p-face-plane', { width: 0.42, height: 0.42 }, scene), faceMat, head, 0, 0.19, -0.231);

  // ── brazos: hombro → codo → mano (saluda con el derecho) ─────────────
  const mkArm = (sx: 1 | -1): { shoulder: TransformNode; elbow: TransformNode } => {
    const shoulder = new TransformNode(`p-shoulder-${sx}`, scene);
    shoulder.parent = chest;
    shoulder.position.set(sx * 0.37, 0.62, 0);
    part(B.CreateBox('p-sleeve', { width: 0.18, height: 0.22, depth: 0.2 }, scene), jersey, shoulder, 0, -0.08, 0);
    part(B.CreateBox('p-upper-arm', { width: 0.13, height: 0.16, depth: 0.14 }, scene), skin, shoulder, 0, -0.26, 0);
    const elbow = new TransformNode(`p-elbow-${sx}`, scene);
    elbow.parent = shoulder;
    elbow.position.set(0, -0.34, 0);
    part(B.CreateBox('p-forearm', { width: 0.12, height: 0.24, depth: 0.13 }, scene), skin, elbow, 0, -0.12, 0);
    part(B.CreateBox('p-hand', { width: 0.13, height: 0.12, depth: 0.14 }, scene), skin, elbow, 0, -0.3, 0);
    return { shoulder, elbow };
  };
  const armL = mkArm(-1);
  const armR = mkArm(1);
  armL.shoulder.rotation.z = 0.12;  // brazos apenas abiertos en reposo
  armR.shoulder.rotation.z = -0.12;

  return {
    root, hips, chest, head,
    shoulderL: armL.shoulder, shoulderR: armR.shoulder, elbowR: armR.elbow,
    paintFace, meshes,
  };
}

function buildScene(engine: Engine, canvas: HTMLCanvasElement): Scene {
  const scene = new Scene(engine);
  const BG = '#1a1c2e';
  scene.clearColor = Color4.FromHexString(`${BG}ff`);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.05;
  scene.fogColor = Color3.FromHexString(BG);

  const camera = new ArcRotateCamera('cam', -Math.PI / 2, 1.32, 3.6, new Vector3(0, 1.1, 0), scene);
  camera.lowerRadiusLimit = 1.6;
  camera.upperRadiusLimit = 8;
  camera.lowerBetaLimit = 0.5;
  camera.upperBetaLimit = 1.52;
  camera.minZ = 0.05;
  camera.maxZ = 60;
  camera.wheelDeltaPercentage = 0.02;
  camera.pinchDeltaPercentage = 0.012;
  camera.attachControl(canvas, true);

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.85;
  hemi.groundColor = new Color3(0.25, 0.22, 0.35);
  const key = new DirectionalLight('key', new Vector3(-0.5, -1, -0.6), scene);
  key.intensity = 0.7;
  key.diffuse = new Color3(1.0, 0.95, 0.85);

  // tarima: disco con damero pixelado (vibra PS1) + aro
  const floorTex = pixelTex(scene, 'stage-tex', 64, (c, s) => {
    const q = s / 8;
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        c.fillStyle = (i + j) % 2 === 0 ? '#23253a' : '#2e3150';
        c.fillRect(i * q, j * q, q, q);
      }
    }
  });
  const floorMat = new StandardMaterial('stage-mat', scene);
  floorMat.diffuseTexture = floorTex;
  floorMat.specularColor = new Color3(0.05, 0.05, 0.08);
  const stage = MeshBuilder.CreateCylinder('stage', { diameter: 4.4, height: 0.12, tessellation: 24 }, scene);
  stage.position.y = -0.06;
  stage.material = floorMat;
  const rim = MeshBuilder.CreateTorus('stage-rim', { diameter: 4.4, thickness: 0.08, tessellation: 28 }, scene);
  rim.position.y = 0.0;
  const rimMat = stdMat(scene, 'stage-rim-mat', '#4dc9ff');
  rimMat.emissiveColor = Color3.FromHexString('#1d4a66');
  rim.material = rimMat;

  const p = buildPersonaje(scene);

  // ── animación procedural ──────────────────────────────────────────────
  let waveStart = -10; // saluda al arrancar
  let blinkOn = false;
  let nextBlink = 2.5;
  scene.onPointerDown = (_evt, pick) => {
    if (pick?.hit && p.meshes.includes(pick.pickedMesh as Mesh)) {
      waveStart = performance.now() / 1000;
    }
  };
  let lastInteract = performance.now();
  canvas.addEventListener('pointerdown', () => { lastInteract = performance.now(); }, { passive: true });
  canvas.addEventListener('wheel', () => { lastInteract = performance.now(); }, { passive: true });

  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000;
    // respiración + bob
    p.chest.scaling.y = 1 + 0.018 * Math.sin(t * 1.7);
    p.root.position.y = 0.012 * Math.sin(t * 1.7);
    // mirada curiosa + balanceo
    p.head.rotation.y = 0.28 * Math.sin(t * 0.33) + 0.06 * Math.sin(t * 1.1);
    p.head.rotation.z = 0.04 * Math.sin(t * 0.47);
    p.hips.rotation.y = 0.05 * Math.sin(t * 0.5);
    // brazo izquierdo: vaivén suave
    p.shoulderL.rotation.z = 0.12 + 0.05 * Math.sin(t * 1.7 + 1.3);
    p.shoulderL.rotation.x = 0.04 * Math.sin(t * 1.4);
    // brazo derecho: reposo o saludo (1.8s con entrada/salida suave)
    const w = t - waveStart;
    if (w >= 0 && w < 1.8) {
      const env = Math.min(1, w / 0.25, (1.8 - w) / 0.35); // rampa subir/bajar
      p.shoulderR.rotation.z = -0.12 - 2.15 * env;
      p.elbowR.rotation.z = env * 0.55 * Math.sin(t * 13);
    } else {
      p.shoulderR.rotation.z = -0.12 - 0.05 * Math.sin(t * 1.7);
      p.shoulderR.rotation.x = 0.04 * Math.sin(t * 1.4 + 0.7);
      p.elbowR.rotation.z = 0;
    }
    // parpadeo
    if (!blinkOn && t > nextBlink) {
      blinkOn = true;
      p.paintFace(true);
    } else if (blinkOn && t > nextBlink + 0.13) {
      blinkOn = false;
      nextBlink = t + 2.2 + Math.random() * 2.6;
      p.paintFace(false);
    }
    // turntable en reposo
    if (performance.now() - lastInteract > 6000) {
      camera.alpha += 0.00014 * scene.getEngine().getDeltaTime();
    }
  });

  // handle de dev para capturas (shot-charlab.mjs): saludo on demand
  (window as unknown as Record<string, unknown>).__charlab = {
    scene, camera,
    wave: () => { waveStart = performance.now() / 1000; },
  };
  return scene;
}

// ─── Boot blindado: si no hay WebGL (jsdom/harness) avisa sin crashear ──
function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const err = document.getElementById('err');
  const fail = (msg: string): void => {
    if (err) { err.style.display = 'block'; err.textContent = '[charlab] ' + msg; }
  };
  if (!canvas) { fail('no canvas'); return; }
  try {
    const engine = new Engine(canvas, true, { stencil: false, powerPreference: 'high-performance' });
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    engine.setHardwareScalingLevel(1 / dpr);
    const scene = buildScene(engine, canvas);
    engine.runRenderLoop(() => scene.render());
    window.addEventListener('resize', () => engine.resize());
    setTimeout(() => {
      const hint = document.getElementById('hint');
      if (hint) hint.style.opacity = '0';
    }, 7000);
  } catch (e) {
    fail((e as Error)?.message ?? String(e));
  }
}

boot();
