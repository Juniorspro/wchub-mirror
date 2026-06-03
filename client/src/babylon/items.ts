// ══════════════════════════════════════════════
// Wardrobe catalog. Two item types share TextureItemDef:
//   (1) BODYPAINT items: carry `paints` — skin-tone Patterns applied to the
//       five region StandardMaterials by actor.applyOutfit.
//   (2) GARMENT items (tops / bottoms / footwear): carry `build` — a
//       constructor that creates 3D mesh sub-parts (torso shell, sleeves,
//       leg covers, shoe boxes…) sitting ON TOP of the body, slightly
//       inflated so the bare skin underneath cannot poke through.
//
// Accessory items (hats / glasses / scarves / bags) keep their own build
// path; they parent rigid sub-meshes to bone-socket TransformNodes.
// ══════════════════════════════════════════════

import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector4, type Scene, type TransformNode } from '@babylonjs/core';
import { createStandardMaterial } from './helpers';
import { getPatternTexture, patternDominantColor, patternKey, uniformDesign, type GarmentDesign, type Pattern } from './textures';
import { ASSETS } from '../assets';

export type BodyRegion = 'head' | 'torso' | 'arms' | 'legs' | 'feet';
export type TextureSlot = 'bodypaint' | 'shirt' | 'pants' | 'shoes';
export type AccessorySocket = 'head_top' | 'head_front' | 'neck_front' | 'back_center' | 'hand_l' | 'hand_r';

export interface TextureItemDef {
  id: string;
  label: string;
  slot: TextureSlot;
  zIndex: number;
  swatch: Pattern;
  // EITHER paints (bodypaint slot) OR build (garment slots), not both.
  paints?: Partial<Record<BodyRegion, Pattern>>;
  build?: (scene: Scene, parent: TransformNode) => Mesh[];
}

export interface AccessoryItemDef {
  id: string;
  label: string;
  socket: AccessorySocket;
  swatch: Pattern;
  build: (scene: Scene, parent: TransformNode) => Mesh[];
}

// ─── Material helper shared by garment + accessory builders ────────────────
// Garments take a GarmentDesign (per-panel patterns). Accessories pass a
// uniformDesign(pattern) since they're geometry-merged into one mesh and
// don't have an unfolded UV layout. Image patterns no longer take the
// raw-texture bypass — they go through the same sewing-pattern compositor
// in textures.ts so AI fabrics pick up the four-stitched-panel look too.
function makeDesignMaterial(scene: Scene, name: string, design: GarmentDesign): StandardMaterial {
  // Fast path: a uniform-solid design is one diffuseColor, no canvas raster.
  const solidColor = uniformSolidColor(design);
  if (solidColor !== null) {
    return createStandardMaterial(scene, name, Color3.FromHexString(solidColor));
  }
  const mat = createStandardMaterial(scene, name, new Color3(1, 1, 1));
  mat.diffuseTexture = getPatternTexture(scene, patternKey('garment', design), design);
  return mat;
}

// Returns the shared color when every panel is a solid of the same color;
// null otherwise. Narrowing-friendly so TS infers .color on the solid arms.
function uniformSolidColor(d: GarmentDesign): string | null {
  if (d.back.kind !== 'solid') return null;
  if (d.front.kind !== 'solid') return null;
  if (d.sleeveL.kind !== 'solid') return null;
  if (d.sleeveR.kind !== 'solid') return null;
  const c = d.back.color;
  if (d.front.color !== c || d.sleeveL.color !== c || d.sleeveR.color !== c) return null;
  return c;
}

// Accessories pass a single Pattern through makePatternMaterial (renderer is
// a single merged mesh — no unfolded UV layout). It wraps as a uniformDesign
// internally so all the texture caching/sewing-pattern paths still apply.
function makePatternMaterial(scene: Scene, name: string, pattern: Pattern): StandardMaterial {
  return makeDesignMaterial(scene, name, uniformDesign(pattern));
}

// ─── Sewing-pattern UV regions ──────────────────────────────────────────────
// Every garment texture is laid out as a 2×2 grid of cloth panels (see
// textures.ts header for the picture). These Vector4s name the four
// quadrants for the two garment families:
//
//   SHIRT_UV.bodyBack   ← top-left quadrant   (u 0.0-0.5, v 0.5-1.0)
//   SHIRT_UV.bodyFront  ← top-right quadrant  (u 0.5-1.0, v 0.5-1.0)
//   SHIRT_UV.sleeveL    ← bottom-left         (u 0.0-0.5, v 0.0-0.5)
//   SHIRT_UV.sleeveR    ← bottom-right        (u 0.5-1.0, v 0.0-0.5)
//
//   PANTS_UV.frontL/R   ← top row (v 0.5-1.0)
//   PANTS_UV.backL/R    ← bottom row (v 0.0-0.5)
//
// When a half-cylinder body panel has its side-strip faceUV set to one of
// these regions, the texture's panel content wraps cleanly onto that piece
// of geometry — and the seam line baked into the texture at u=0.5 / v=0.5
// (drawSeams in textures.ts) falls right on the geometry edge where the
// next panel begins. That's what makes the shirt look like four stitched
// panels rather than a single tube of stretched cloth.
const SHIRT_UV = {
  bodyBack:  new Vector4(0.0, 0.5, 0.5, 1.0),
  bodyFront: new Vector4(0.5, 0.5, 1.0, 1.0),
  sleeveL:   new Vector4(0.0, 0.0, 0.5, 0.5),
  sleeveR:   new Vector4(0.5, 0.0, 1.0, 0.5),
} as const;
const PANTS_UV = {
  frontL: new Vector4(0.0, 0.5, 0.5, 1.0),
  frontR: new Vector4(0.5, 0.5, 1.0, 1.0),
  backL:  new Vector4(0.0, 0.0, 0.5, 0.5),
  backR:  new Vector4(0.5, 0.0, 1.0, 0.5),
} as const;
const FULL_UV = new Vector4(0.0, 0.0, 1.0, 1.0);

// Slice a panel's v range to a sub-strip. Used when the torso body splits
// vertically between lower (hem→yoke) and upper (yoke→neck) cylinders —
// each sub-strip gets the proportional slice of its panel.
function subV(uv: Vector4, vFrom: number, vTo: number): Vector4 {
  const v0 = uv.y + (uv.w - uv.y) * vFrom;
  const v1 = uv.y + (uv.w - uv.y) * vTo;
  return new Vector4(uv.x, v0, uv.z, v1);
}

// ─── Garment template builders ──────────────────────────────────────────────
// All builders return the meshes they created so applyOutfit can dispose
// them on re-equip. Materials are NOT returned because dispose(false, true)
// drops the material with the last sub-mesh that owns it.

// Builds the two-frustum body shell shared by every shirt template.
//
// FOUR-PANEL CONSTRUCTION — the torso is stitched from FOUR rectangular
// cloth panels: lower-back, lower-front, upper-back (yoke-back), upper-front
// (yoke-front). Each is a half-cylinder (arc=0.5) so the surface reads as a
// flat sheet of fabric with a gentle wrap around the body curve, not a
// single barrel where the texture stretches all the way around. The visible
// side seams run vertically from hem to shoulder at ±X — and because the
// texture's u=0.5 seam line falls exactly there, those side seams read as
// stitches.
//
// Layout: shellLower (waist → high-chest, mostly cylindrical, gentle
// widening) + shellUpper (shoulder yoke → neckline opening, gentle taper).
// The slope start sits HIGH on the torso (y=1.85), so the visible V at the
// top of the shirt is a soft, short taper rather than a steep diagonal that
// runs all the way down from the chest.
function buildShirtBody(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string, opts: { topDiameter: number; zScale: number; bottomDiameter: number; neckline: number; topY: number }): { mat: StandardMaterial; meshes: Mesh[] } {
  const mat = makeDesignMaterial(scene, `${label}-mat`, design);

  const hemY = 1.07;
  const yokeStartY = 1.85; // Where the upper-frustum taper begins.
  const lowerHeight = yokeStartY - hemY;
  const lowerMidY = (hemY + yokeStartY) / 2;
  const upperHeight = opts.topY - yokeStartY;
  const upperMidY = (yokeStartY + opts.topY) / 2;

  // The body panels live in the TOP HALF of the texture (v ∈ [0.5, 1.0]).
  // Within each body panel, hem sits at the bottom of the panel (v=0.5) and
  // shoulder at the top (v=1.0). The lower-cylinder slice and upper-
  // cylinder slice carve up that v range in proportion to their world-
  // space heights so a tileable fabric maintains its scale across the
  // yoke seam.
  const totalH = lowerHeight + upperHeight;
  const yokeFrac = lowerHeight / totalH;
  const lowerBackUV  = subV(SHIRT_UV.bodyBack,  0, yokeFrac);
  const lowerFrontUV = subV(SHIRT_UV.bodyFront, 0, yokeFrac);
  const upperBackUV  = subV(SHIRT_UV.bodyBack,  yokeFrac, 1);
  const upperFrontUV = subV(SHIRT_UV.bodyFront, yokeFrac, 1);

  // ─── Lower torso panels (waist → yoke line) ─────────────────────────────
  // Back half: rotation.y = π puts the cut faces at ±X (so the side seam is
  // along the side of the body). Both halves share the same diameter so the
  // seam visually closes with no z-fight.
  const lowerBack = MeshBuilder.CreateCylinder(`${label}-shell-lower-back`, {
    height: lowerHeight,
    diameterTop: opts.topDiameter,
    diameterBottom: opts.bottomDiameter,
    tessellation: 16,
    arc: 0.5,
    faceUV: [FULL_UV, lowerBackUV, FULL_UV],
    cap: Mesh.CAP_START,
  }, scene);
  lowerBack.parent = parent;
  lowerBack.position.set(0, lowerMidY, 0);
  lowerBack.rotation.y = Math.PI;
  lowerBack.scaling.set(1.0, 1.0, opts.zScale);
  lowerBack.material = mat;

  const lowerFront = MeshBuilder.CreateCylinder(`${label}-shell-lower-front`, {
    height: lowerHeight,
    diameterTop: opts.topDiameter,
    diameterBottom: opts.bottomDiameter,
    tessellation: 16,
    arc: 0.5,
    faceUV: [FULL_UV, lowerFrontUV, FULL_UV],
    cap: Mesh.CAP_START,
  }, scene);
  lowerFront.parent = parent;
  lowerFront.position.set(0, lowerMidY, 0);
  lowerFront.scaling.set(1.0, 1.0, opts.zScale);
  lowerFront.material = mat;

  // ─── Upper torso panels (yoke line → neckline) ──────────────────────────
  const upperBack = MeshBuilder.CreateCylinder(`${label}-shell-upper-back`, {
    height: upperHeight,
    diameterTop: opts.neckline,
    diameterBottom: opts.topDiameter,
    tessellation: 16,
    arc: 0.5,
    faceUV: [FULL_UV, upperBackUV, FULL_UV],
    cap: Mesh.CAP_END,
  }, scene);
  upperBack.parent = parent;
  upperBack.position.set(0, upperMidY, 0);
  upperBack.rotation.y = Math.PI;
  upperBack.scaling.set(1.0, 1.0, opts.zScale);
  upperBack.material = mat;

  const upperFront = MeshBuilder.CreateCylinder(`${label}-shell-upper-front`, {
    height: upperHeight,
    diameterTop: opts.neckline,
    diameterBottom: opts.topDiameter,
    tessellation: 16,
    arc: 0.5,
    faceUV: [FULL_UV, upperFrontUV, FULL_UV],
    cap: Mesh.CAP_END,
  }, scene);
  upperFront.parent = parent;
  upperFront.position.set(0, upperMidY, 0);
  upperFront.scaling.set(1.0, 1.0, opts.zScale);
  upperFront.material = mat;

  return { mat, meshes: [lowerBack, lowerFront, upperBack, upperFront] };
}

// Build a single sleeve as a cylinder (UV-mapped to the assigned sleeve
// quadrant of the texture) + a half-sphere shoulder dome that rounds off
// the top. The cylinder is capped at the wrist (CAP_START) only — the
// dome takes over at the shoulder so there's no flat circular disc poking
// out the top of the shoulder. The dome uses a solid material derived from
// the sleeve pattern's dominant color, so it blends without the UV
// mismatch that a sphere with the full sewing-pattern texture would have
// (a default sphere UV samples the BODY panels at the top, which would
// paint torso pixels onto the shoulder dome).
function buildSleeve(scene: Scene, parent: TransformNode, mat: StandardMaterial, label: string, opts: { height: number; diameter: number; y: number; x: number; side: 'l' | 'r'; sleevePattern: Pattern }): Mesh[] {
  const uvRegion = opts.side === 'l' ? SHIRT_UV.sleeveL : SHIRT_UV.sleeveR;
  const sleeve = MeshBuilder.CreateCylinder(`${label}-sleeve-${opts.side}`, {
    height: opts.height,
    diameter: opts.diameter,
    tessellation: 18,
    faceUV: [FULL_UV, uvRegion, FULL_UV],
    cap: Mesh.CAP_START, // wrist cap only — shoulder is rounded by the dome below
  }, scene);
  sleeve.parent = parent;
  sleeve.position.set(opts.x, opts.y, 0);
  sleeve.material = mat;

  // Shoulder dome — half-sphere mounted at the top of the sleeve. Uses a
  // fresh solid material whose color is pulled from the sleeve pattern, so
  // it visually flows from the sleeve up over the shoulder.
  const domeColor = patternDominantColor(opts.sleevePattern);
  const domeMat = createStandardMaterial(scene, `${label}-shoulder-${opts.side}-mat`, Color3.FromHexString(domeColor));
  const dome = MeshBuilder.CreateSphere(`${label}-shoulder-${opts.side}`, {
    diameter: opts.diameter,
    segments: 14,
    slice: 0.5, // top hemisphere only
  }, scene);
  dome.parent = parent;
  dome.position.set(opts.x, opts.y + opts.height / 2, 0);
  dome.material = domeMat;

  return [sleeve, dome];
}

function buildTshirt(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 0.95,
    zScale: 0.62,
    bottomDiameter: 0.82,
    neckline: 0.55,
    topY: 2.07,
  });

  // Short sleeves — cylinder for the upper-arm wrap + half-sphere dome on
  // the shoulder. See buildSleeve for the dome-color logic.
  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.78, x: -0.53, side: 'l', sleevePattern: design.sleeveL });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.78, x: 0.53, side: 'r', sleevePattern: design.sleeveR });

  // Collar ring — sits at the neckline.
  const collar = MeshBuilder.CreateTorus(`${label}-collar`, {
    diameter: 0.42, thickness: 0.04, tessellation: 18,
  }, scene);
  collar.parent = parent;
  collar.position.set(0, 2.06, 0);
  collar.scaling.set(1.0, 1.0, 0.7);
  collar.material = mat;

  // Front chest pocket.
  const pocket = MeshBuilder.CreateBox(`${label}-pocket`, {
    width: 0.18, height: 0.14, depth: 0.015,
  }, scene);
  pocket.parent = parent;
  pocket.position.set(-0.16, 1.6, 0.28);
  pocket.material = mat;

  // Hem trim ring.
  const hem = MeshBuilder.CreateTorus(`${label}-hem`, {
    diameter: 0.86, thickness: 0.022, tessellation: 24,
  }, scene);
  hem.parent = parent;
  hem.position.set(0, 1.08, 0);
  hem.scaling.set(1.0, 1.0, 0.62);
  hem.material = mat;

  return [...meshes, ...sleeveL, ...sleeveR, collar, pocket, hem];
}

function buildLongSleeveShirt(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 0.98,
    zScale: 0.62,
    bottomDiameter: 0.84,
    neckline: 0.58,
    topY: 2.07,
  });

  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 1.08, diameter: 0.36, y: 1.52, x: -0.53, side: 'l', sleevePattern: design.sleeveL });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 1.08, diameter: 0.36, y: 1.52, x: 0.53, side: 'r', sleevePattern: design.sleeveR });

  const collar = MeshBuilder.CreateTorus(`${label}-collar`, {
    diameter: 0.44, thickness: 0.04, tessellation: 18,
  }, scene);
  collar.parent = parent;
  collar.position.set(0, 2.06, 0);
  collar.scaling.set(1.0, 1.0, 0.7);
  collar.material = mat;

  return [...meshes, ...sleeveL, ...sleeveR, collar];
}

function buildHoodie(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const drawstringMat = createStandardMaterial(scene, `${label}-drawstring-mat`, Color3.FromHexString('#f5f5f5'));
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 1.05,
    zScale: 0.64,
    bottomDiameter: 0.92,
    neckline: 0.62,
    topY: 2.1,
  });

  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.38, y: 1.53, x: -0.53, side: 'l', sleevePattern: design.sleeveL });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.38, y: 1.53, x: 0.53, side: 'r', sleevePattern: design.sleeveR });

  // Hood — wraps the back-top of the head.
  const hood = MeshBuilder.CreateSphere(`${label}-hood`, {
    diameter: 0.84, segments: 18, slice: 0.72,
  }, scene);
  hood.parent = parent;
  hood.position.set(0, 2.42, -0.06);
  hood.material = mat;

  // Kangaroo pocket.
  const pocket = MeshBuilder.CreateBox(`${label}-pocket`, {
    width: 0.6, height: 0.3, depth: 0.02,
  }, scene);
  pocket.parent = parent;
  pocket.position.set(0, 1.32, 0.34);
  pocket.material = mat;

  // Drawstrings.
  const stringL = MeshBuilder.CreateCylinder(`${label}-string-l`, {
    height: 0.32, diameter: 0.025, tessellation: 8,
  }, scene);
  stringL.parent = parent;
  stringL.position.set(-0.07, 1.94, 0.32);
  stringL.material = drawstringMat;

  const stringR = MeshBuilder.CreateCylinder(`${label}-string-r`, {
    height: 0.32, diameter: 0.025, tessellation: 8,
  }, scene);
  stringR.parent = parent;
  stringR.position.set(0.07, 1.94, 0.32);
  stringR.material = drawstringMat;

  return [...meshes, ...sleeveL, ...sleeveR, hood, pocket, stringL, stringR];
}

function buildJacket(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const buttonMat = createStandardMaterial(scene, `${label}-button-mat`, Color3.FromHexString('#caa84a'));
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 1.1,
    zScale: 0.66,
    bottomDiameter: 1.0,
    neckline: 0.66,
    topY: 2.08,
  });

  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.4, y: 1.53, x: -0.54, side: 'l', sleevePattern: design.sleeveL });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.4, y: 1.53, x: 0.54, side: 'r', sleevePattern: design.sleeveR });

  // Lapels.
  const lapelL = MeshBuilder.CreateBox(`${label}-lapel-l`, {
    width: 0.16, height: 0.5, depth: 0.04,
  }, scene);
  lapelL.parent = parent;
  lapelL.position.set(-0.14, 1.76, 0.32);
  lapelL.rotation.z = 0.22;
  lapelL.material = mat;

  const lapelR = MeshBuilder.CreateBox(`${label}-lapel-r`, {
    width: 0.16, height: 0.5, depth: 0.04,
  }, scene);
  lapelR.parent = parent;
  lapelR.position.set(0.14, 1.76, 0.32);
  lapelR.rotation.z = -0.22;
  lapelR.material = mat;

  // Button column.
  const buttons: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const button = MeshBuilder.CreateSphere(`${label}-button-${i}`, { diameter: 0.06, segments: 10 }, scene);
    button.parent = parent;
    button.position.set(0, 1.82 - i * 0.18, 0.36);
    button.material = buttonMat;
    buttons.push(button);
  }

  return [...meshes, ...sleeveL, ...sleeveR, lapelL, lapelR, ...buttons];
}

// ─── Football jersey ────────────────────────────────────────────────────────
// A t-shirt body + sleeves + shoulder domes, plus the four decorative
// elements that read as "this is a real soccer kit, not just a colored
// shirt": chest crest patch, back number plate, sleeve cuff rings, and a
// contrasting collar trim. Each accent is a small mesh with its own solid
// material so it can disagree with the body fabric (e.g. Argentina's gold
// AFA crest patch on the sky-blue/white striped body).
interface JerseyAccents {
  collarColor: string;       // collar torus color
  cuffColor: string;         // wrist cuff ring color
  crestColor: string;        // chest crest patch color
  numberColor: string;       // back number plate color
}

function buildFootballJersey(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string, accents: JerseyAccents): Mesh[] {
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 0.95,
    zScale: 0.62,
    bottomDiameter: 0.82,
    neckline: 0.55,
    topY: 2.07,
  });

  // Short sleeves + shoulder domes (same geometry as buildTshirt).
  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.78, x: -0.53, side: 'l', sleevePattern: design.sleeveL });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.78, x: 0.53, side: 'r', sleevePattern: design.sleeveR });

  // Collar — contrasting team color, slightly thicker than the default tee
  // collar so it reads as a soccer-collar trim.
  const collarMat = createStandardMaterial(scene, `${label}-collar-mat`, Color3.FromHexString(accents.collarColor));
  const collar = MeshBuilder.CreateTorus(`${label}-collar`, {
    diameter: 0.44, thickness: 0.055, tessellation: 20,
  }, scene);
  collar.parent = parent;
  collar.position.set(0, 2.06, 0);
  collar.scaling.set(1.0, 1.0, 0.7);
  collar.material = collarMat;

  // V-neck stripe — a small contrasting wedge under the collar, suggesting
  // a polo-style notch. Just a thin vertical bar in the collar color.
  const vNeck = MeshBuilder.CreateBox(`${label}-vneck`, {
    width: 0.04, height: 0.08, depth: 0.02,
  }, scene);
  vNeck.parent = parent;
  vNeck.position.set(0, 2.0, 0.27);
  vNeck.material = collarMat;

  // Chest crest patch (front upper-left, like a national federation crest).
  const crestMat = createStandardMaterial(scene, `${label}-crest-mat`, Color3.FromHexString(accents.crestColor));
  const crest = MeshBuilder.CreateBox(`${label}-crest`, {
    width: 0.12, height: 0.15, depth: 0.018,
  }, scene);
  crest.parent = parent;
  crest.position.set(-0.16, 1.83, 0.295);
  crest.material = crestMat;

  // Manufacturer logo block — small bar on the right chest (like a brand
  // patch on adidas / Nike kits).
  const brand = MeshBuilder.CreateBox(`${label}-brand`, {
    width: 0.08, height: 0.05, depth: 0.018,
  }, scene);
  brand.parent = parent;
  brand.position.set(0.18, 1.86, 0.295);
  brand.material = crestMat;

  // Back number plate — wide rectangle on the upper-mid back where the
  // squad number would be printed. Players in real kits also have a name
  // bar above the number; we approximate that with a thinner box stacked
  // on top.
  const numberMat = createStandardMaterial(scene, `${label}-number-mat`, Color3.FromHexString(accents.numberColor));
  const numberPlate = MeshBuilder.CreateBox(`${label}-number`, {
    width: 0.4, height: 0.32, depth: 0.018,
  }, scene);
  numberPlate.parent = parent;
  numberPlate.position.set(0, 1.62, -0.302);
  numberPlate.material = numberMat;
  const nameBar = MeshBuilder.CreateBox(`${label}-namebar`, {
    width: 0.5, height: 0.05, depth: 0.018,
  }, scene);
  nameBar.parent = parent;
  nameBar.position.set(0, 1.85, -0.302);
  nameBar.material = numberMat;

  // Sleeve cuff rings — thin torus at the wrist end of each sleeve. The
  // sleeve cylinder spans y=[1.78 - 0.275, 1.78 + 0.275] = [1.505, 2.055];
  // the cuff sits just above the wrist edge so the ring reads as a band,
  // not a bracelet.
  const cuffMat = createStandardMaterial(scene, `${label}-cuff-mat`, Color3.FromHexString(accents.cuffColor));
  const cuffY = 1.78 - 0.275 + 0.04;
  const cuffL = MeshBuilder.CreateTorus(`${label}-cuff-l`, {
    diameter: 0.40, thickness: 0.04, tessellation: 18,
  }, scene);
  cuffL.parent = parent;
  cuffL.position.set(-0.53, cuffY, 0);
  cuffL.material = cuffMat;
  const cuffR = MeshBuilder.CreateTorus(`${label}-cuff-r`, {
    diameter: 0.40, thickness: 0.04, tessellation: 18,
  }, scene);
  cuffR.parent = parent;
  cuffR.position.set(0.53, cuffY, 0);
  cuffR.material = cuffMat;

  // Hem trim ring — uses body material, so it picks up whichever side of
  // the texture sits at v ~ 0.5 (the bottom of each body panel). Reads as
  // a finished shirt edge.
  const hem = MeshBuilder.CreateTorus(`${label}-hem`, {
    diameter: 0.86, thickness: 0.024, tessellation: 24,
  }, scene);
  hem.parent = parent;
  hem.position.set(0, 1.08, 0);
  hem.scaling.set(1.0, 1.0, 0.62);
  hem.material = mat;

  return [
    ...meshes, ...sleeveL, ...sleeveR,
    collar, vNeck, crest, brand,
    numberPlate, nameBar,
    cuffL, cuffR, hem,
  ];
}

// Build one pant leg as a FRONT + BACK half-cylinder pair. Each half-
// cylinder wraps the assigned panel region of the texture (PANTS_UV.frontL
// vs backL for the left leg, frontR vs backR for the right). The texture's
// u=0.5 seam ends up running down the outside of the leg, which is exactly
// where a side seam would be on real trousers.
function buildPantLeg(scene: Scene, parent: TransformNode, mat: StandardMaterial, label: string, opts: { height: number; diameter: number; y: number; x: number; side: 'l' | 'r' }): Mesh[] {
  const frontUV = opts.side === 'l' ? PANTS_UV.frontL : PANTS_UV.frontR;
  const backUV  = opts.side === 'l' ? PANTS_UV.backL  : PANTS_UV.backR;
  // Front half — opens toward +Z. Default cylinder arc=0.5 hugs the +Z
  // hemisphere; no rotation needed.
  const front = MeshBuilder.CreateCylinder(`${label}-leg-${opts.side}-front`, {
    height: opts.height,
    diameter: opts.diameter,
    tessellation: 14,
    arc: 0.5,
    faceUV: [FULL_UV, frontUV, FULL_UV],
    cap: Mesh.CAP_ALL,
  }, scene);
  front.parent = parent;
  front.position.set(opts.x, opts.y, 0);
  front.material = mat;
  // Back half — rotate π so its arc covers -Z. Front and back share the
  // same axis + diameter, so they meet seamlessly at the ±X side seams.
  const back = MeshBuilder.CreateCylinder(`${label}-leg-${opts.side}-back`, {
    height: opts.height,
    diameter: opts.diameter,
    tessellation: 14,
    arc: 0.5,
    faceUV: [FULL_UV, backUV, FULL_UV],
    cap: Mesh.CAP_ALL,
  }, scene);
  back.parent = parent;
  back.position.set(opts.x, opts.y, 0);
  back.rotation.y = Math.PI;
  back.material = mat;
  return [front, back];
}

function buildPants(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const mat = makeDesignMaterial(scene, `${label}-mat`, design);
  const legs = [
    ...buildPantLeg(scene, parent, mat, label, { height: 0.92, diameter: 0.44, y: 0.7, x: -0.22, side: 'l' }),
    ...buildPantLeg(scene, parent, mat, label, { height: 0.92, diameter: 0.44, y: 0.7, x: 0.22, side: 'r' }),
  ];

  // Waistband — full ring, picks up bulk fabric color from the texture.
  const waistband = MeshBuilder.CreateCylinder(`${label}-waistband`, {
    height: 0.1, diameter: 0.85, tessellation: 24,
  }, scene);
  waistband.parent = parent;
  waistband.position.set(0, 1.08, 0);
  waistband.scaling.set(1.0, 1.0, 0.6);
  waistband.material = mat;

  // Back pockets — flat patch boxes on the back panel.
  const pocketL = MeshBuilder.CreateBox(`${label}-pocket-l`, {
    width: 0.18, height: 0.2, depth: 0.02,
  }, scene);
  pocketL.parent = parent;
  pocketL.position.set(-0.18, 0.92, -0.26);
  pocketL.material = mat;

  const pocketR = MeshBuilder.CreateBox(`${label}-pocket-r`, {
    width: 0.18, height: 0.2, depth: 0.02,
  }, scene);
  pocketR.parent = parent;
  pocketR.position.set(0.18, 0.92, -0.26);
  pocketR.material = mat;

  return [...legs, waistband, pocketL, pocketR];
}

function buildShorts(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const mat = makeDesignMaterial(scene, `${label}-mat`, design);
  const legs = [
    ...buildPantLeg(scene, parent, mat, label, { height: 0.55, diameter: 0.44, y: 0.85, x: -0.22, side: 'l' }),
    ...buildPantLeg(scene, parent, mat, label, { height: 0.55, diameter: 0.44, y: 0.85, x: 0.22, side: 'r' }),
  ];

  const waistband = MeshBuilder.CreateCylinder(`${label}-waistband`, {
    height: 0.1, diameter: 0.85, tessellation: 24,
  }, scene);
  waistband.parent = parent;
  waistband.position.set(0, 1.08, 0);
  waistband.scaling.set(1.0, 1.0, 0.6);
  waistband.material = mat;

  return [...legs, waistband];
}

function buildShoes(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string, _options?: { soleColor?: string; laceColor?: string }): Mesh[] {
  // ONE continuous mesh per side — a sliced-sphere dome scaled to a shoe
  // shape. Same silhouette signature as the bare foot (same scaling ratios),
  // just slightly larger so it visually wraps over the foot. The sphere's
  // default UV samples the texture rather than the four sewing-pattern
  // quadrants, so per-panel customization is muted on shoes — the
  // Customize HUD treats the shoes slot as a single-pattern target.
  const mat = makeDesignMaterial(scene, `${label}-mat`, design);
  const meshes: Mesh[] = [];

  const buildOne = (side: 'l' | 'r', x: number) => {
    const shoe = MeshBuilder.CreateSphere(`${label}-shoe-${side}`, {
      diameter: 0.52, segments: 22, slice: 0.5,
    }, scene);
    shoe.parent = parent;
    shoe.position.set(x, 0, 0.1);
    shoe.scaling.set(0.88, 0.7, 1.7);
    shoe.material = mat;
    meshes.push(shoe);
  };

  buildOne('l', -0.22);
  buildOne('r', 0.22);

  return meshes;
}

// ─── Imported-asset helper ──────────────────────────────────────────────────
const imageAsset = (key: string, fallback: string): Pattern => {
  const url = ASSETS[key];
  return url ? { kind: 'image', url, fallbackColor: fallback } : { kind: 'solid', color: fallback };
};

const solid = (color: string): Pattern => ({ kind: 'solid', color });

// ─── Wardrobe catalog ───────────────────────────────────────────────────────
export const WARDROBE_TEXTURE_ITEMS: TextureItemDef[] = [
  // Bodypaint — paints head + torso + arms + legs + feet (all visible skin).
  {
    id: 'skin-light', label: 'Light Skin', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#f1c8a5'),
    paints: { head: solid('#f1c8a5'), torso: solid('#f1c8a5'), arms: solid('#f1c8a5'), legs: solid('#f1c8a5'), feet: solid('#f1c8a5') },
  },
  {
    id: 'skin-tan', label: 'Tan Skin', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#c79b6f'),
    paints: { head: solid('#c79b6f'), torso: solid('#c79b6f'), arms: solid('#c79b6f'), legs: solid('#c79b6f'), feet: solid('#c79b6f') },
  },
  {
    id: 'skin-deep', label: 'Deep Skin', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#7a513a'),
    paints: { head: solid('#7a513a'), torso: solid('#7a513a'), arms: solid('#7a513a'), legs: solid('#7a513a'), feet: solid('#7a513a') },
  },
  {
    id: 'skin-mint', label: 'Mint Alien', slot: 'bodypaint', zIndex: 0,
    swatch: solid('#a8d8b9'),
    paints: { head: solid('#a8d8b9'), torso: solid('#a8d8b9'), arms: solid('#a8d8b9'), legs: solid('#a8d8b9'), feet: solid('#a8d8b9') },
  },

  // ─── Shirts (garments) ─────────────────────────────────────────────────────
  // Legacy uniform-design items (one Pattern, same on every panel) call
  // uniformDesign(p). Showcase items at the bottom of this block use
  // explicit per-panel GarmentDesigns to demonstrate the four-panel layout.
  {
    id: 'shirt-white-tee', label: 'White Tee', slot: 'shirt', zIndex: 40,
    swatch: solid('#f5f5f5'),
    build: (s, p) => buildTshirt(s, p, uniformDesign(solid('#f5f5f5')), 'shirt-white-tee'),
  },
  {
    id: 'shirt-yellow-polo', label: 'Yellow Polo', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'hatch', bg: '#e8c84a', line: '#c9a92e', spacing: 10 },
    build: (s, p) => buildTshirt(s, p, uniformDesign({ kind: 'hatch', bg: '#e8c84a', line: '#c9a92e', spacing: 14 }), 'shirt-yellow-polo'),
  },
  {
    id: 'shirt-red-sweater', label: 'Red Sweater', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'hStripes', colors: ['#c14444', '#9c2f2f'], thickness: 10 },
    build: (s, p) => buildLongSleeveShirt(s, p, uniformDesign({ kind: 'hStripes', colors: ['#c14444', '#9c2f2f'], thickness: 18 }), 'shirt-red-sweater'),
  },
  // Showcase: two-tone hoodie — solid blue body, white sleeves.
  {
    id: 'shirt-blue-hoodie', label: 'Two-tone Hoodie', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'twoTone', top: '#3a6ea5', bottom: '#f5f5f5' },
    build: (s, p) => buildHoodie(s, p, {
      kind: 'garment',
      back: solid('#3a6ea5'), front: solid('#3a6ea5'),
      sleeveL: solid('#f5f5f5'), sleeveR: solid('#f5f5f5'),
    }, 'shirt-blue-hoodie'),
  },
  // Showcase: striped-back jacket — solid front, hStripes back, navy sleeves.
  {
    id: 'shirt-black-jacket', label: 'Striped-Back Jacket', slot: 'shirt', zIndex: 50,
    swatch: { kind: 'hStripes', colors: ['#222226', '#15151a'], thickness: 12 },
    build: (s, p) => buildJacket(s, p, {
      kind: 'garment',
      back: { kind: 'hStripes', colors: ['#444450', '#1a1a1d'], thickness: 16 },
      front: solid('#222226'),
      sleeveL: solid('#15151a'), sleeveR: solid('#15151a'),
    }, 'shirt-black-jacket'),
  },
  // Showcase: contrast-sleeve polo (new) — yellow body, navy sleeves.
  {
    id: 'shirt-contrast-polo', label: 'Contrast-Sleeve Polo', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'twoTone', top: '#e8c84a', bottom: '#2c557d' },
    build: (s, p) => buildTshirt(s, p, {
      kind: 'garment',
      back: solid('#e8c84a'), front: solid('#e8c84a'),
      sleeveL: solid('#2c557d'), sleeveR: solid('#2c557d'),
    }, 'shirt-contrast-polo'),
  },
  // Showcase: logo tee (new) — white back & sleeves, two-tone front (top
  // half white, bottom half a red emblem block).
  {
    id: 'shirt-logo-tee', label: 'Logo Tee', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'twoTone', top: '#f5f5f5', bottom: '#c14444' },
    build: (s, p) => buildTshirt(s, p, {
      kind: 'garment',
      back: solid('#f5f5f5'),
      front: { kind: 'twoTone', top: '#f5f5f5', bottom: '#c14444' },
      sleeveL: solid('#f5f5f5'), sleeveR: solid('#f5f5f5'),
    }, 'shirt-logo-tee'),
  },

  // ─── World Cup football jerseys ───────────────────────────────────────────
  // Each is buildFootballJersey: per-panel team body design + accent meshes
  // (collar, V-neck notch, chest crest patch, brand block, back name bar +
  // number plate, sleeve cuff rings, hem trim). The accent colors are
  // pulled from each nation's recognizable kit palette so the silhouette
  // reads as that team at a glance.

  // Argentina — sky-blue / white vertical stripes (la Albiceleste), black
  // shorts, gold AFA crest, black collar.
  {
    id: 'jersey-argentina', label: 'Argentina #10', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'vStripes', colors: ['#75aadb', '#f5f5f5'], thickness: 14 },
    build: (s, p) => buildFootballJersey(s, p, {
      kind: 'garment',
      back:    { kind: 'vStripes', colors: ['#75aadb', '#f5f5f5'], thickness: 36 },
      front:   { kind: 'vStripes', colors: ['#75aadb', '#f5f5f5'], thickness: 36 },
      sleeveL: solid('#75aadb'),
      sleeveR: solid('#75aadb'),
    }, 'jersey-argentina', {
      collarColor: '#1a1a1d',
      cuffColor:   '#1a1a1d',
      crestColor:  '#e8c84a',  // AFA gold-yellow shield
      numberColor: '#1a1a1d',  // black number-on-white feel via dark plate
    }),
  },

  // Brazil — yellow body (Seleção canarinho), green collar/cuffs, blue
  // accent on the crest area (national tri-color: yellow + green + blue).
  {
    id: 'jersey-brazil', label: 'Brazil #10', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'twoTone', top: '#fde047', bottom: '#0a5c2e' },
    build: (s, p) => buildFootballJersey(s, p, {
      kind: 'garment',
      back:    solid('#fde047'),
      front:   solid('#fde047'),
      sleeveL: solid('#fde047'),
      sleeveR: solid('#fde047'),
    }, 'jersey-brazil', {
      collarColor: '#0a5c2e',  // CBF green collar
      cuffColor:   '#0a5c2e',
      crestColor:  '#0a5c2e',  // green CBF shield on yellow body
      numberColor: '#0a5c2e',
    }),
  },

  // Germany — white body, classic Adidas black/red/gold accents. We can't
  // do diagonal three-stripes procedurally, but the chest hStripe band +
  // black collar + red cuffs + gold crest patch reads as Die Mannschaft.
  {
    id: 'jersey-germany', label: 'Germany #13', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'hStripes', colors: ['#f5f5f5', '#1a1a1d'], thickness: 14 },
    build: (s, p) => buildFootballJersey(s, p, {
      kind: 'garment',
      back:    solid('#f5f5f5'),
      front:   { kind: 'hStripes', colors: ['#f5f5f5', '#1a1a1d'], thickness: 60 },
      sleeveL: solid('#f5f5f5'),
      sleeveR: solid('#f5f5f5'),
    }, 'jersey-germany', {
      collarColor: '#1a1a1d',  // black trim
      cuffColor:   '#c14444',  // red cuff (national tricolor)
      crestColor:  '#e8c84a',  // DFB gold eagle
      numberColor: '#1a1a1d',
    }),
  },

  // France — navy body (Les Bleus), red/white tricolor accents, gold star.
  {
    id: 'jersey-france', label: 'France #7', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'twoTone', top: '#19387c', bottom: '#c14444' },
    build: (s, p) => buildFootballJersey(s, p, {
      kind: 'garment',
      back:    solid('#19387c'),
      front:   solid('#19387c'),
      sleeveL: solid('#19387c'),
      sleeveR: solid('#19387c'),
    }, 'jersey-france', {
      collarColor: '#c14444',  // red collar trim
      cuffColor:   '#f5f5f5',  // white cuffs
      crestColor:  '#e8c84a',  // gold FFF rooster
      numberColor: '#f5f5f5',  // white number plate on navy
    }),
  },

  // Netherlands — bright orange (Oranje), black accents.
  {
    id: 'jersey-netherlands', label: 'Netherlands #11', slot: 'shirt', zIndex: 40,
    swatch: { kind: 'twoTone', top: '#ff7f3f', bottom: '#1a1a1d' },
    build: (s, p) => buildFootballJersey(s, p, {
      kind: 'garment',
      back:    solid('#ff7f3f'),
      front:   solid('#ff7f3f'),
      sleeveL: solid('#ff7f3f'),
      sleeveR: solid('#ff7f3f'),
    }, 'jersey-netherlands', {
      collarColor: '#1a1a1d',
      cuffColor:   '#1a1a1d',
      crestColor:  '#1a1a1d',  // black KNVB lion on orange
      numberColor: '#1a1a1d',
    }),
  },

  // ─── Pants (garments) ──────────────────────────────────────────────────────
  // For pants, GarmentDesign field names map to leg quadrants like so (see
  // PANTS_UV in this file):
  //   back    → front-L leg
  //   front   → front-R leg
  //   sleeveL → back-L  leg
  //   sleeveR → back-R  leg
  // uniformDesign() makes that mapping invisible; the showcase entries use
  // the alias explicitly.
  {
    id: 'pants-blue-jeans', label: 'Blue Jeans', slot: 'pants', zIndex: 20,
    swatch: { kind: 'hatch', bg: '#3b537c', line: '#2a3e5d', spacing: 6 },
    build: (s, p) => buildPants(s, p, uniformDesign({ kind: 'hatch', bg: '#3b537c', line: '#2a3e5d', spacing: 8 }), 'pants-blue-jeans'),
  },
  {
    id: 'pants-black-slacks', label: 'Black Slacks', slot: 'pants', zIndex: 20,
    swatch: solid('#2a2a30'),
    build: (s, p) => buildPants(s, p, uniformDesign(solid('#2a2a30')), 'pants-black-slacks'),
  },
  {
    id: 'pants-gray-sweats', label: 'Gray Sweats', slot: 'pants', zIndex: 20,
    swatch: { kind: 'hStripes', colors: ['#9a9ca3', '#888a91'], thickness: 8 },
    build: (s, p) => buildPants(s, p, uniformDesign({ kind: 'hStripes', colors: ['#9a9ca3', '#888a91'], thickness: 12 }), 'pants-gray-sweats'),
  },
  {
    id: 'pants-red-shorts', label: 'Red Shorts', slot: 'pants', zIndex: 20,
    swatch: solid('#c14444'),
    build: (s, p) => buildShorts(s, p, uniformDesign(solid('#c14444')), 'pants-red-shorts'),
  },
  {
    id: 'pants-khaki-cargo', label: 'Khaki Cargo', slot: 'pants', zIndex: 20,
    swatch: { kind: 'hatch', bg: '#a89868', line: '#8a7e54', spacing: 16 },
    build: (s, p) => buildPants(s, p, uniformDesign({ kind: 'hatch', bg: '#a89868', line: '#8a7e54', spacing: 16 }), 'pants-khaki-cargo'),
  },
  // Showcase: plaid back, solid front — proves per-panel pants work too.
  {
    id: 'pants-plaid', label: 'Plaid-Knee Pants', slot: 'pants', zIndex: 20,
    swatch: { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 10 },
    build: (s, p) => buildPants(s, p, {
      kind: 'garment',
      back: solid('#3b4b30'),    // front-L leg solid khaki
      front: solid('#3b4b30'),   // front-R leg solid khaki
      sleeveL: { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 18 }, // back-L plaid
      sleeveR: { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 18 }, // back-R plaid
    }, 'pants-plaid'),
  },

  // ─── Shoes (garments) ──────────────────────────────────────────────────────
  // Shoes use a single-mesh sphere whose default UV samples the whole texture,
  // so per-panel customization is muted here — every shoe ships uniform.
  {
    id: 'shoes-white-sneakers', label: 'White Sneakers', slot: 'shoes', zIndex: 30,
    swatch: imageAsset('shoes-canvas', '#f5f5f5'),
    build: (s, p) => buildShoes(s, p, uniformDesign(imageAsset('shoes-canvas', '#f5f5f5')), 'shoes-white-sneakers', { soleColor: '#dadada', laceColor: '#f5f5f5' }),
  },
  {
    id: 'shoes-black-boots', label: 'Black Boots', slot: 'shoes', zIndex: 30,
    swatch: solid('#1a1a1d'),
    build: (s, p) => buildShoes(s, p, uniformDesign(solid('#1a1a1d')), 'shoes-black-boots', { soleColor: '#0a0a0d', laceColor: '#3a3a3d' }),
  },
  {
    id: 'shoes-red-trainers', label: 'Red Trainers', slot: 'shoes', zIndex: 30,
    swatch: solid('#c14444'),
    build: (s, p) => buildShoes(s, p, uniformDesign(solid('#c14444')), 'shoes-red-trainers', { soleColor: '#f5f5f5', laceColor: '#f5f5f5' }),
  },
  {
    id: 'shoes-brown-loafers', label: 'Brown Loafers', slot: 'shoes', zIndex: 30,
    swatch: imageAsset('shoes-leather', '#7a4a26'),
    build: (s, p) => buildShoes(s, p, uniformDesign(imageAsset('shoes-leather', '#7a4a26')), 'shoes-brown-loafers', { soleColor: '#3a2410', laceColor: '#5a3818' }),
  },
  {
    id: 'shoes-yellow-sandals', label: 'Yellow Sandals', slot: 'shoes', zIndex: 30,
    swatch: solid('#e8c84a'),
    build: (s, p) => buildShoes(s, p, uniformDesign(solid('#e8c84a')), 'shoes-yellow-sandals', { soleColor: '#a8893a', laceColor: '#a8893a' }),
  },
];

// ─── Accessory builders ─────────────────────────────────────────────────────
export const WARDROBE_ACCESSORY_ITEMS: AccessoryItemDef[] = [
  // Hats / glasses / scarves / backpack are each ONE continuous mesh —
  // primitives are built, materialed, then Mesh.MergeMeshes-d into a single
  // resulting block. Multi-color details (top-hat band, backpack strap) are
  // dropped because a single-mesh merge keeps a single material.
  {
    id: 'hat-cap',
    label: 'Baseball Cap',
    socket: 'head_top',
    swatch: solid('#c14444'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'hat-cap-mat', solid('#c14444'));
      const crown = MeshBuilder.CreateSphere('hat-cap-crown', { diameter: 0.74, segments: 16, slice: 0.55 }, scene);
      const brim = MeshBuilder.CreateCylinder('hat-cap-brim', { height: 0.04, diameterTop: 0.66, diameterBottom: 0.76, tessellation: 18 }, scene);
      crown.position.set(0, -0.02, 0);
      brim.position.set(0, -0.05, 0.22);
      brim.rotation.x = -0.18;
      crown.material = mat;
      brim.material = mat;
      const merged = Mesh.MergeMeshes([crown, brim], true, true);
      if (!merged) return [];
      merged.name = 'hat-cap';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'hat-top-hat',
    label: 'Top Hat',
    socket: 'head_top',
    swatch: solid('#1a1a1d'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'hat-top-mat', solid('#1a1a1d'));
      const crown = MeshBuilder.CreateCylinder('hat-top-crown', { height: 0.55, diameter: 0.52, tessellation: 24 }, scene);
      const brim = MeshBuilder.CreateCylinder('hat-top-brim', { height: 0.04, diameter: 0.82, tessellation: 24 }, scene);
      crown.position.set(0, 0.32, 0);
      brim.position.set(0, 0.04, 0);
      crown.material = mat;
      brim.material = mat;
      const merged = Mesh.MergeMeshes([crown, brim], true, true);
      if (!merged) return [];
      merged.name = 'hat-top-hat';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'hat-beanie',
    label: 'Knit Beanie',
    socket: 'head_top',
    swatch: { kind: 'hStripes', colors: ['#3a6ea5', '#2c557d'], thickness: 10 },
    build: (scene, parent) => {
      // Already a single mesh — no merge needed.
      const beanie = MeshBuilder.CreateSphere('hat-beanie', { diameter: 0.7, segments: 18, slice: 0.5 }, scene);
      beanie.parent = parent;
      beanie.position.set(0, -0.05, 0);
      const pattern: Pattern = { kind: 'hStripes', colors: ['#3a6ea5', '#2c557d'], thickness: 10 };
      beanie.material = makePatternMaterial(scene, 'hat-beanie-mat', pattern);
      return [beanie];
    },
  },
  {
    id: 'hat-wizard',
    label: 'Wizard Hat',
    socket: 'head_top',
    swatch: { kind: 'dots', bg: '#2d2470', dot: '#e8c84a', size: 16 },
    build: (scene, parent) => {
      const pattern: Pattern = { kind: 'dots', bg: '#2d2470', dot: '#e8c84a', size: 22 };
      const mat = makePatternMaterial(scene, 'hat-wiz-mat', pattern);
      const cone = MeshBuilder.CreateCylinder('hat-wiz-cone', { height: 0.85, diameterTop: 0.0, diameterBottom: 0.6, tessellation: 24 }, scene);
      const brim = MeshBuilder.CreateCylinder('hat-wiz-brim', { height: 0.04, diameter: 0.88, tessellation: 24 }, scene);
      cone.position.set(0, 0.47, 0);
      cone.rotation.z = -0.08;
      brim.position.set(0, 0.04, 0);
      cone.material = mat;
      brim.material = mat;
      const merged = Mesh.MergeMeshes([cone, brim], true, true);
      if (!merged) return [];
      merged.name = 'hat-wizard';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'glasses-round',
    label: 'Round Glasses',
    socket: 'head_front',
    swatch: solid('#22232a'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'glasses-mat', solid('#22232a'));
      const left = MeshBuilder.CreateTorus('glasses-l', { diameter: 0.22, thickness: 0.025, tessellation: 18 }, scene);
      const right = MeshBuilder.CreateTorus('glasses-r', { diameter: 0.22, thickness: 0.025, tessellation: 18 }, scene);
      const bridge = MeshBuilder.CreateBox('glasses-bridge', { width: 0.1, height: 0.025, depth: 0.025 }, scene);
      left.position.set(-0.13, 0, 0);
      left.rotation.x = Math.PI / 2;
      right.position.set(0.13, 0, 0);
      right.rotation.x = Math.PI / 2;
      bridge.position.set(0, 0, 0);
      left.material = mat;
      right.material = mat;
      bridge.material = mat;
      const merged = Mesh.MergeMeshes([left, right, bridge], true, true);
      if (!merged) return [];
      merged.name = 'glasses-round';
      merged.parent = parent;
      return [merged];
    },
  },
  {
    id: 'glasses-shades',
    label: 'Shades',
    socket: 'head_front',
    swatch: solid('#000000'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'shades-mat', solid('#000000'));
      const lens = MeshBuilder.CreateBox('shades-lens', { width: 0.5, height: 0.12, depth: 0.04 }, scene);
      const frame = MeshBuilder.CreateBox('shades-frame', { width: 0.52, height: 0.02, depth: 0.04 }, scene);
      lens.position.set(0, 0, 0.02);
      frame.position.set(0, 0.06, 0.02);
      lens.material = mat;
      frame.material = mat;
      const merged = Mesh.MergeMeshes([lens, frame], true, true);
      if (!merged) return [];
      merged.name = 'glasses-shades';
      merged.parent = parent;
      return [merged];
    },
  },
  // Scarves built as a STACK of thin horizontal torus rings — alternating
  // colors create clearly horizontal bands wrapping the neck (not a single
  // ring with a vertical hanging tail). A short side-flap suggests the
  // scarf's end being tucked across the chest rather than dangling down.
  {
    id: 'scarf-red',
    label: 'Striped Scarf',
    socket: 'neck_front',
    swatch: { kind: 'hStripes', colors: ['#c14444', '#f5f5f5'], thickness: 6 },
    build: (scene, parent) => {
      const matA = makePatternMaterial(scene, 'scarf-red-a-mat', solid('#c14444'));
      const matB = makePatternMaterial(scene, 'scarf-red-b-mat', solid('#f5f5f5'));
      const meshes: Mesh[] = [];
      const bandColors = [matA, matB, matA, matB, matA];
      const bandSpacing = 0.05;
      const startY = bandSpacing * 2; // centred around y=0 — bands lie HORIZONTAL (XZ plane), stacked vertically.
      for (let i = 0; i < bandColors.length; i++) {
        const band = MeshBuilder.CreateTorus(`scarf-red-band-${i}`, {
          diameter: 0.6, thickness: 0.07, tessellation: 24,
        }, scene);
        band.parent = parent;
        // No rotation: default torus is in XZ plane (axis = Y), so it wraps a
        // vertical neck — exactly what we want.
        band.position.set(0, startY - i * bandSpacing, 0);
        band.material = bandColors[i];
        meshes.push(band);
      }
      // Short horizontal flap draped across the chest front.
      const flap = MeshBuilder.CreateBox('scarf-red-flap', {
        width: 0.34, height: 0.06, depth: 0.14,
      }, scene);
      flap.parent = parent;
      flap.position.set(0.08, -0.1, 0.28);
      flap.rotation.y = -0.25;
      flap.material = matA;
      meshes.push(flap);
      return meshes;
    },
  },
  {
    id: 'scarf-mustard',
    label: 'Mustard Scarf',
    socket: 'neck_front',
    swatch: { kind: 'hatch', bg: '#e8c84a', line: '#a8893a', spacing: 8 },
    build: (scene, parent) => {
      const matA = makePatternMaterial(scene, 'scarf-m-a-mat', solid('#e8c84a'));
      const matB = makePatternMaterial(scene, 'scarf-m-b-mat', solid('#a8893a'));
      const meshes: Mesh[] = [];
      const bandColors = [matA, matB, matA, matB, matA];
      const bandSpacing = 0.05;
      const startY = bandSpacing * 2;
      for (let i = 0; i < bandColors.length; i++) {
        const band = MeshBuilder.CreateTorus(`scarf-m-band-${i}`, {
          diameter: 0.6, thickness: 0.07, tessellation: 24,
        }, scene);
        band.parent = parent;
        band.position.set(0, startY - i * bandSpacing, 0);
        band.material = bandColors[i];
        meshes.push(band);
      }
      const flap = MeshBuilder.CreateBox('scarf-m-flap', {
        width: 0.34, height: 0.06, depth: 0.14,
      }, scene);
      flap.parent = parent;
      flap.position.set(0.08, -0.1, 0.28);
      flap.rotation.y = -0.25;
      flap.material = matA;
      meshes.push(flap);
      return meshes;
    },
  },
  {
    id: 'backpack-standard',
    label: 'Backpack',
    socket: 'back_center',
    swatch: solid('#3a6ea5'),
    build: (scene, parent) => {
      const mat = makePatternMaterial(scene, 'backpack-mat', solid('#3a6ea5'));
      const body = MeshBuilder.CreateBox('backpack-body', { width: 0.7, height: 0.75, depth: 0.3 }, scene);
      const strap = MeshBuilder.CreateBox('backpack-strap', { width: 0.82, height: 0.08, depth: 0.04 }, scene);
      const pocket = MeshBuilder.CreateBox('backpack-pocket', { width: 0.4, height: 0.3, depth: 0.05 }, scene);
      body.position.set(0, 0, -0.2);
      strap.position.set(0, 0.3, 0.27);
      pocket.position.set(0, -0.05, -0.38);
      body.material = mat;
      strap.material = mat;
      pocket.material = mat;
      const merged = Mesh.MergeMeshes([body, strap, pocket], true, true);
      if (!merged) return [];
      merged.name = 'backpack';
      merged.parent = parent;
      return [merged];
    },
  },
];

const TEXTURE_INDEX = new Map(WARDROBE_TEXTURE_ITEMS.map((i) => [i.id, i] as const));
const ACCESSORY_INDEX = new Map(WARDROBE_ACCESSORY_ITEMS.map((i) => [i.id, i] as const));

export function getTextureItem(id: string): TextureItemDef | undefined {
  return TEXTURE_INDEX.get(id);
}

export function getAccessoryItem(id: string): AccessoryItemDef | undefined {
  return ACCESSORY_INDEX.get(id);
}

// ─── Custom-design wire format ──────────────────────────────────────────────
// A custom per-panel design rides through the existing textureItems CSV as
// a synthetic item id: `look:<slot>:<base64url(JSON(GarmentDesign))>`. The
// resolver below synthesizes a TextureItemDef on the fly so applyOutfit
// can treat it identically to a catalog entry.

const LOOK_ID_PREFIX = 'look:';
const SLOT_Z: Record<Exclude<TextureSlot, 'bodypaint'>, number> = { shirt: 40, pants: 20, shoes: 30 };

// Choose the default garment template per slot. Custom shirts use the
// t-shirt template (short sleeves) — the simplest and most generic; logo /
// long-sleeve / hoodie / jacket variants stay catalog-only for now.
const SLOT_BUILDER: Record<Exclude<TextureSlot, 'bodypaint'>, (s: Scene, p: TransformNode, d: GarmentDesign, label: string) => Mesh[]> = {
  shirt: (s, p, d, label) => buildTshirt(s, p, d, label),
  pants: (s, p, d, label) => buildPants(s, p, d, label),
  shoes: (s, p, d, label) => buildShoes(s, p, d, label),
};

export function encodeLookId(slot: Exclude<TextureSlot, 'bodypaint'>, design: GarmentDesign): string {
  const json = JSON.stringify(design);
  // base64url — replace +/= so the id stays safe inside a CSV.
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${LOOK_ID_PREFIX}${slot}:${b64}`;
}

export function decodeLookId(id: string): { slot: Exclude<TextureSlot, 'bodypaint'>; design: GarmentDesign } | null {
  if (!id.startsWith(LOOK_ID_PREFIX)) return null;
  const rest = id.slice(LOOK_ID_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const slot = rest.slice(0, sep) as Exclude<TextureSlot, 'bodypaint'>;
  if (slot !== 'shirt' && slot !== 'pants' && slot !== 'shoes') return null;
  const b64 = rest.slice(sep + 1).replace(/-/g, '+').replace(/_/g, '/');
  try {
    // atob requires correct padding length.
    const padded = b64 + '==='.slice(0, (4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json) as unknown;
    if (!isGarmentDesign(parsed)) return null;
    return { slot, design: parsed };
  } catch {
    return null;
  }
}

function isPattern(v: unknown): v is Pattern {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { kind?: unknown }).kind;
  return typeof k === 'string' && ['solid', 'hStripes', 'vStripes', 'dots', 'twoTone', 'hatch', 'checker', 'image'].includes(k);
}

function isGarmentDesign(v: unknown): v is GarmentDesign {
  if (!v || typeof v !== 'object') return false;
  const d = v as Partial<GarmentDesign>;
  return d.kind === 'garment' && isPattern(d.back) && isPattern(d.front) && isPattern(d.sleeveL) && isPattern(d.sleeveR);
}

// Wraps getTextureItem with a look:<slot>:<b64> fast path that synthesises
// a TextureItemDef so actor.applyOutfit can treat the custom design the
// same as any catalog item. Decode failures fall back to undefined, so the
// outfit loop skips the slot and the bare body (or the previous garment)
// shows through.
export function getTextureItemOrCustom(id: string): TextureItemDef | undefined {
  if (id.startsWith(LOOK_ID_PREFIX)) {
    const parsed = decodeLookId(id);
    if (!parsed) return undefined;
    const { slot, design } = parsed;
    return {
      id,
      label: 'Custom',
      slot,
      zIndex: SLOT_Z[slot],
      // HUD swatch picks the front panel as the representative thumbnail.
      swatch: design.front,
      build: (scene, parent) => SLOT_BUILDER[slot](scene, parent, design, `custom-${slot}`),
    };
  }
  return TEXTURE_INDEX.get(id);
}

export interface ItemField {
  field: { count: number };
  collected: number;
  update(): number;
  dispose(): void;
}

export function createItemField(_scene: Scene): ItemField {
  // LLM-EXTENSION:ITEMS — Wardrobe catalog with TWO mechanisms: (1) BODYPAINT items carry `paints` — Pattern per skin region applied directly to the actor's region StandardMaterials; (2) GARMENT items (shirts, pants, shoes) carry `build` — a builder function that creates 3D mesh sub-parts (torso shells, sleeves, leg covers, shoe boxes) sitting on top of the body with slight inflation so the skin can't poke through. Garment templates: tshirt, longSleeveShirt, hoodie, jacket, pants, shorts, shoes. Accessory items (hats, glasses, scarves, bag) parent rigid primitive sub-meshes to bone-socket TransformNodes.
  // DO NOT REMOVE the LLM-EXTENSION:ITEMS tag — templates/3d/scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  return {
    field: { count: WARDROBE_TEXTURE_ITEMS.length + WARDROBE_ACCESSORY_ITEMS.length },
    collected: 0,
    update() { return 0; },
    dispose() { /* no-op */ },
  };
}
