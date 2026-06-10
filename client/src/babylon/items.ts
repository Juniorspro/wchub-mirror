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
  /** Optional GarmentDesign that the Customize editor can load as a starting
   * point when the player picks this catalog item as a preset. */
  design?: GarmentDesign;
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
  // BUT — if the design has an overlay (crest / sleeve stripes / hem trim /
  // back name+number) OR a side stripe, we MUST go through the canvas
  // texture because those visual elements are baked into the texture, not
  // expressed as separate meshes. Skipping the canvas here is what made
  // Brazil / France / Netherlands etc. render plain (no crest, no number).
  const solidColor = uniformSolidColor(design);
  const hasDecor = !!design.overlay || !!design.sideStripeColor;
  if (solidColor !== null && !hasDecor) {
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

// ─── Shared scarf builder ───────────────────────────────────────────────────
// Both scarf catalog entries call this. The previous per-entry code wrapped
// the neck in 0.6-diameter torus rings — WIDER than the 0.62 head — so the
// scarf floated as fat blobs around the thin neck. This builds a snug wrap
// (≈0.34 across, hugging the neck) of a few stacked knit bands, plus a flat
// tail that drapes down the chest front and ends in tassels — reading as an
// actual worn scarf. matA = primary color, matB = accent stripe.
// Parented to the neck_front socket (world ≈ (0, 2.05, 0)); all coords local.
function buildScarf(
  scene: Scene, parent: TransformNode, label: string,
  matA: StandardMaterial, matB: StandardMaterial,
): Mesh[] {
  const meshes: Mesh[] = [];
  // Neck wrap — 3 stacked bands, snug to the neck. Torus axis is Y by
  // default, so the ring lies horizontal and wraps a vertical neck.
  const bandMats = [matA, matB, matA];
  for (let i = 0; i < bandMats.length; i++) {
    const band = MeshBuilder.CreateTorus(`${label}-band-${i}`, {
      diameter: 0.34, thickness: 0.10, tessellation: 20,
    }, scene);
    band.parent = parent;
    band.position.set(0, 0.08 - i * 0.08, 0);
    band.material = bandMats[i];
    meshes.push(band);
  }
  // Tail — a flat ribbon draping straight down the chest front, offset
  // to one side so it reads as a loose end, not a bib.
  const tail = MeshBuilder.CreateBox(`${label}-tail`, {
    width: 0.16, height: 0.46, depth: 0.05,
  }, scene);
  tail.parent = parent;
  tail.position.set(0.07, -0.30, 0.16);
  tail.rotation.x = 0.12;  // hangs slightly forward off the chest
  tail.material = matA;
  meshes.push(tail);
  // A second, shorter accent stripe near the tail's bottom.
  const tailStripe = MeshBuilder.CreateBox(`${label}-tail-stripe`, {
    width: 0.165, height: 0.07, depth: 0.052,
  }, scene);
  tailStripe.parent = parent;
  tailStripe.position.set(0.07, -0.46, 0.18);
  tailStripe.rotation.x = 0.12;
  tailStripe.material = matB;
  meshes.push(tailStripe);
  // Tassels — three short fringe cylinders hanging off the tail's end.
  const tasselMats = [matA, matB, matA];
  for (let i = 0; i < 3; i++) {
    const tassel = MeshBuilder.CreateCylinder(`${label}-tassel-${i}`, {
      height: 0.09, diameter: 0.02, tessellation: 6,
    }, scene);
    tassel.parent = parent;
    tassel.position.set(0.02 + i * 0.05, -0.55, 0.19);
    tassel.material = tasselMats[i];
    meshes.push(tassel);
  }
  return meshes;
}

// ─── Sewing-pattern UV regions ──────────────────────────────────────────────
// Every garment texture is laid out as a 2×2 grid of cloth panels (see
// textures.ts header). Each Vector4 is (u_start, v_start, u_end, v_end)
// with start < end — REVERSED u-ranges (start > end) make Babylon fall
// back to the default UV (0,0,1,1) which projects the WHOLE texture onto
// the cylinder surface (visible as a tiny "sprite" of the unfolded design
// on the chest). The text-mirror artefact that reversal was meant to fix
// is now handled in drawJerseyOverlay by mirroring the text drawing on
// the back panel only.
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
  // Babylon's MeshBuilder.CreateCylinder with arc=0.5 generates vertices
  // using cos(-angle)/sin(-angle), so a half-cylinder with NO rotation
  // occupies the local -Z half-space (the avatar's BACK). To put the FRONT
  // panel on the avatar's chest (local +Z), the front mesh needs
  // rotation.y = π. Both halves share the same diameter so the side seam
  // visually closes with no z-fight.
  const lowerBack = MeshBuilder.CreateCylinder(`${label}-shell-lower-back`, {
    height: lowerHeight,
    diameterTop: opts.topDiameter,
    diameterBottom: opts.bottomDiameter,
    tessellation: 16,
    arc: 0.5,
    faceUV: [FULL_UV, lowerBackUV, FULL_UV],
    // NO_CAP — see buildSleeve. The hem torus + waistband cover the bottom
    // edge so we don't need a flat cap disc (which would paint the entire
    // jersey design onto a small half-circle plate).
    cap: Mesh.NO_CAP,
  }, scene);
  lowerBack.parent = parent;
  lowerBack.position.set(0, lowerMidY, 0);
  // no rotation — occupies local -Z half = avatar's back
  lowerBack.scaling.set(1.0, 1.0, opts.zScale);
  lowerBack.material = mat;

  const lowerFront = MeshBuilder.CreateCylinder(`${label}-shell-lower-front`, {
    height: lowerHeight,
    diameterTop: opts.topDiameter,
    diameterBottom: opts.bottomDiameter,
    tessellation: 16,
    arc: 0.5,
    faceUV: [FULL_UV, lowerFrontUV, FULL_UV],
    cap: Mesh.NO_CAP,
  }, scene);
  lowerFront.parent = parent;
  lowerFront.position.set(0, lowerMidY, 0);
  lowerFront.rotation.y = Math.PI; // → occupies local +Z half = avatar's chest
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
    // NO_CAP — the neck mesh + collar torus cover the top opening.
    cap: Mesh.NO_CAP,
  }, scene);
  upperBack.parent = parent;
  upperBack.position.set(0, upperMidY, 0);
  // no rotation — local -Z (back)
  upperBack.scaling.set(1.0, 1.0, opts.zScale);
  upperBack.material = mat;

  const upperFront = MeshBuilder.CreateCylinder(`${label}-shell-upper-front`, {
    height: upperHeight,
    diameterTop: opts.neckline,
    diameterBottom: opts.topDiameter,
    tessellation: 16,
    arc: 0.5,
    faceUV: [FULL_UV, upperFrontUV, FULL_UV],
    cap: Mesh.NO_CAP,
  }, scene);
  upperFront.parent = parent;
  upperFront.position.set(0, upperMidY, 0);
  upperFront.rotation.y = Math.PI; // → local +Z (chest)
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
// Build a single sleeve. When opts.bend is true the cylinder is split at
// the elbow world-Y so the upper half follows the shoulder joint and the
// lower half follows the elbow joint — the cloth bends at the elbow like
// the underlying bone. The split point is the avatar's elbow world-Y
// (shoulder joint at y=1.95, elbow local offset −0.55 → world 1.40), set
// here so the actor rig and the garment builders agree without passing it
// in everywhere.
const ELBOW_WORLD_Y = 1.4;

function buildSleeve(scene: Scene, parent: TransformNode, mat: StandardMaterial, label: string, opts: { height: number; diameter: number; y: number; x: number; side: 'l' | 'r'; sleevePattern: Pattern; bend?: boolean }): Mesh[] {
  const uvRegion = opts.side === 'l' ? SHIRT_UV.sleeveL : SHIRT_UV.sleeveR;
  const meshes: Mesh[] = [];
  const top = opts.y + opts.height / 2;
  const bottom = opts.y - opts.height / 2;

  // Decide whether to split. Only meaningful when the sleeve actually
  // crosses the elbow line — for short sleeves that stop above the elbow
  // there's no cloth to bend at the elbow joint.
  const shouldSplit = opts.bend === true && bottom < ELBOW_WORLD_Y && top > ELBOW_WORLD_Y;

  if (shouldSplit) {
    const upperHeight = top - ELBOW_WORLD_Y;
    const lowerHeight = ELBOW_WORLD_Y - bottom;
    const upperFrac = upperHeight / opts.height;
    // v=0 at panel bottom (wrist), v=1 at panel top (shoulder). The upper
    // strip uses the TOP slice of the panel; the lower strip uses the
    // BOTTOM. Width = upperFrac vs (1−upperFrac).
    const upperUV = subV(uvRegion, 1 - upperFrac, 1);
    const lowerUV = subV(uvRegion, 0, 1 - upperFrac);

    const upperMidY = (top + ELBOW_WORLD_Y) / 2;
    const lowerMidY = (ELBOW_WORLD_Y + bottom) / 2;

    const upper = MeshBuilder.CreateCylinder(`${label}-sleeve-${opts.side}`, {
      height: upperHeight, diameter: opts.diameter, tessellation: 18,
      faceUV: [FULL_UV, upperUV, FULL_UV], cap: Mesh.NO_CAP,
    }, scene);
    upper.parent = parent;
    upper.position.set(opts.x, upperMidY, 0);
    upper.material = mat;
    meshes.push(upper);

    const lower = MeshBuilder.CreateCylinder(`${label}-sleeve-lower-${opts.side}`, {
      height: lowerHeight, diameter: opts.diameter, tessellation: 18,
      faceUV: [FULL_UV, lowerUV, FULL_UV], cap: Mesh.NO_CAP,
    }, scene);
    lower.parent = parent;
    lower.position.set(opts.x, lowerMidY, 0);
    lower.material = mat;
    meshes.push(lower);

    // Elbow patch — small sphere of the same fabric, sitting AT the
    // elbow joint pivot. The upper sleeve and lower sleeve meet here,
    // and when the elbow bends the two cylinders pivot in opposite
    // directions around this point, opening a V-shaped gap on the outer
    // side. The sphere is slightly SMALLER than the cylinder (×0.96), so
    // at rest it's hidden inside the cylinders entirely — no visible
    // bulge. When the joint bends, the cylinder rotates away and the
    // sphere is exposed inside the V-gap, masking it. Routed to the
    // elbow joint by name in actor.ts so it stays at the pivot.
    const elbowPatch = MeshBuilder.CreateSphere(`${label}-elbow-${opts.side}`, {
      diameter: opts.diameter * 0.96, segments: 12,
    }, scene);
    elbowPatch.parent = parent;
    elbowPatch.position.set(opts.x, ELBOW_WORLD_Y, 0);
    elbowPatch.material = mat;
    meshes.push(elbowPatch);
  } else {
    const sleeve = MeshBuilder.CreateCylinder(`${label}-sleeve-${opts.side}`, {
      height: opts.height,
      diameter: opts.diameter,
      tessellation: 18,
      faceUV: [FULL_UV, uvRegion, FULL_UV],
      // NO_CAP — capped cylinders paint the cap disc with FULL_UV which
      // renders the ENTIRE jersey texture onto a flat wrist disc. The
      // cuff torus + hand sphere cover the wrist opening visually.
      cap: Mesh.NO_CAP,
    }, scene);
    sleeve.parent = parent;
    sleeve.position.set(opts.x, opts.y, 0);
    sleeve.material = mat;
    meshes.push(sleeve);
  }

  // Shoulder dome — always at the top of the sleeve, rounds off the
  // shoulder. Slightly larger than the sleeve cylinder (1.05x) so the
  // equator overhangs the cylinder's open top and hides the hole.
  const domeColor = patternDominantColor(opts.sleevePattern);
  const domeMat = createStandardMaterial(scene, `${label}-shoulder-${opts.side}-mat`, Color3.FromHexString(domeColor));
  const dome = MeshBuilder.CreateSphere(`${label}-shoulder-${opts.side}`, {
    diameter: opts.diameter * 1.05,
    segments: 14,
    slice: 0.5,
  }, scene);
  dome.parent = parent;
  dome.position.set(opts.x, top, 0);
  dome.scaling.set(1.0, 0.37, 1.0);
  dome.material = domeMat;
  meshes.push(dome);

  return meshes;
}

function buildTshirt(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  // topDiameter narrowed (was 0.95) so the body's natural shoulder line
  // is less broad — the now-tilted shoulder pads visibly protrude past
  // the body silhouette instead of merging with it.
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 0.82,
    zScale: 0.62,
    bottomDiameter: 0.82,
    neckline: 0.55,
    topY: 2.07,
  });

  // Short sleeves — cylinder for the upper-arm wrap + half-sphere dome on
  // the shoulder. See buildSleeve for the dome-color logic.
  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.675, x: -0.53, side: 'l', sleevePattern: design.sleeveL });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.675, x: 0.53, side: 'r', sleevePattern: design.sleeveR });

  // Collar ring — sits at the neckline.
  const collar = MeshBuilder.CreateTorus(`${label}-collar`, {
    diameter: 0.42, thickness: 0.04, tessellation: 18,
  }, scene);
  collar.parent = parent;
  collar.position.set(0, 2.06, 0);
  collar.scaling.set(1.0, 1.0, 0.7);
  collar.material = mat;

  // (Chest pocket removed — it read as a floating beige plate at the
  // avatar's chest, not adding enough value at this scale.)

  // Hem trim ring.
  const hem = MeshBuilder.CreateTorus(`${label}-hem`, {
    diameter: 0.86, thickness: 0.022, tessellation: 24,
  }, scene);
  hem.parent = parent;
  hem.position.set(0, 1.08, 0);
  hem.scaling.set(1.0, 1.0, 0.62);
  hem.material = mat;

  return [...meshes, ...sleeveL, ...sleeveR, collar, hem];
}

function buildLongSleeveShirt(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 0.84, // narrowed (was 0.98) — see buildTshirt comment
    zScale: 0.62,
    bottomDiameter: 0.84,
    neckline: 0.58,
    topY: 2.07,
  });

  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 1.08, diameter: 0.36, y: 1.41, x: -0.53, side: 'l', sleevePattern: design.sleeveL, bend: true });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 1.08, diameter: 0.36, y: 1.41, x: 0.53, side: 'r', sleevePattern: design.sleeveR, bend: true });

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
    topDiameter: 0.92, // narrowed (was 1.05) — see buildTshirt comment
    zScale: 0.64,
    bottomDiameter: 0.92,
    neckline: 0.62,
    topY: 2.1,
  });

  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.38, y: 1.40, x: -0.53, side: 'l', sleevePattern: design.sleeveL, bend: true });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.38, y: 1.40, x: 0.53, side: 'r', sleevePattern: design.sleeveR, bend: true });

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
    topDiameter: 1.0, // narrowed (was 1.1) — see buildTshirt comment
    zScale: 0.66,
    bottomDiameter: 1.0,
    neckline: 0.66,
    topY: 2.08,
  });

  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.4, y: 1.40, x: -0.54, side: 'l', sleevePattern: design.sleeveL, bend: true });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 1.1, diameter: 0.4, y: 1.40, x: 0.54, side: 'r', sleevePattern: design.sleeveR, bend: true });

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
// A t-shirt body + sleeves + shoulder domes, plus three accent meshes that
// genuinely wrap or trim the geometry (collar, cuffs, hem). Everything that
// used to float (crest patch, brand block, back number plate, name bar) is
// now baked INTO the per-panel texture via design.overlay, so the jersey
// surface looks like one continuous garment.
interface JerseyAccents {
  collarColor: string; // collar torus color
  cuffColor: string;   // wrist cuff ring color
}

function buildFootballJersey(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string, accents: JerseyAccents): Mesh[] {
  const { mat, meshes } = buildShirtBody(scene, parent, design, label, {
    topDiameter: 0.82, // narrowed (was 0.95) — see buildTshirt comment
    zScale: 0.62,
    bottomDiameter: 0.82,
    neckline: 0.55,
    topY: 2.07,
  });

  const sleeveL = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.675, x: -0.53, side: 'l', sleevePattern: design.sleeveL });
  const sleeveR = buildSleeve(scene, parent, mat, label, { height: 0.55, diameter: 0.36, y: 1.675, x: 0.53, side: 'r', sleevePattern: design.sleeveR });

  // Collar — torus ring at the neckline, slightly thicker than a default
  // tee collar so it reads as a soccer-collar trim.
  const collarMat = createStandardMaterial(scene, `${label}-collar-mat`, Color3.FromHexString(accents.collarColor));
  const collar = MeshBuilder.CreateTorus(`${label}-collar`, {
    diameter: 0.44, thickness: 0.055, tessellation: 20,
  }, scene);
  collar.parent = parent;
  collar.position.set(0, 2.06, 0);
  collar.scaling.set(1.0, 1.0, 0.7);
  collar.material = collarMat;

  // Sleeve cuff rings — torus at the wrist end of each sleeve. The sleeve
  // cylinder spans y=[1.505, 2.055]; the cuff sits just above the wrist
  // edge so it reads as a band, not a bracelet.
  const cuffMat = createStandardMaterial(scene, `${label}-cuff-mat`, Color3.FromHexString(accents.cuffColor));
  const cuffY = 1.675 - 0.275 + 0.04;
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

  // Hem trim — uses body material, so it picks up the bottom edge of the
  // body panels. Reads as a finished shirt edge.
  const hem = MeshBuilder.CreateTorus(`${label}-hem`, {
    diameter: 0.86, thickness: 0.024, tessellation: 24,
  }, scene);
  hem.parent = parent;
  hem.position.set(0, 1.08, 0);
  hem.scaling.set(1.0, 1.0, 0.62);
  hem.material = mat;

  return [...meshes, ...sleeveL, ...sleeveR, collar, cuffL, cuffR, hem];
}

// Build one pant leg as a FRONT + BACK half-cylinder pair. Each half-
// cylinder wraps the assigned panel region of the texture (PANTS_UV.frontL
// vs backL for the left leg, frontR vs backR for the right). The texture's
// u=0.5 seam ends up running down the outside of the leg, which is exactly
// where a side seam would be on real trousers.
// Avatar knee world-Y (hip joint at y=1.1, knee local offset −0.55 →
// world 0.55). Used to split long-pants legs into thigh + shin segments
// so the cloth bends at the knee.
const KNEE_WORLD_Y = 0.55;

function buildPantLeg(scene: Scene, parent: TransformNode, mat: StandardMaterial, label: string, opts: { height: number; diameter: number; y: number; x: number; side: 'l' | 'r'; bend?: boolean }): Mesh[] {
  const frontUV = opts.side === 'l' ? PANTS_UV.frontL : PANTS_UV.frontR;
  const backUV  = opts.side === 'l' ? PANTS_UV.backL  : PANTS_UV.backR;
  const meshes: Mesh[] = [];
  const top = opts.y + opts.height / 2;
  const bottom = opts.y - opts.height / 2;

  const shouldSplit = opts.bend === true && bottom < KNEE_WORLD_Y && top > KNEE_WORLD_Y;

  // Babylon's arc=0.5 cylinder with no rotation occupies local -Z half
  // (see buildShirtBody for the cos(-angle) explanation). BACK panel
  // mesh has no rotation; FRONT panel rotates π to sit on local +Z.
  const makeHalf = (name: string, uv: Vector4, h: number, midY: number, isFront: boolean): Mesh => {
    const m = MeshBuilder.CreateCylinder(name, {
      height: h, diameter: opts.diameter, tessellation: 14, arc: 0.5,
      faceUV: [FULL_UV, uv, FULL_UV], cap: Mesh.NO_CAP,
    }, scene);
    m.parent = parent;
    m.position.set(opts.x, midY, 0);
    if (isFront) m.rotation.y = Math.PI;
    m.material = mat;
    return m;
  };

  if (shouldSplit) {
    const upperHeight = top - KNEE_WORLD_Y;
    const lowerHeight = KNEE_WORLD_Y - bottom;
    const upperFrac = upperHeight / opts.height;
    const upperMidY = (top + KNEE_WORLD_Y) / 2;
    const lowerMidY = (KNEE_WORLD_Y + bottom) / 2;

    const upperBackUV  = subV(backUV,  1 - upperFrac, 1);
    const lowerBackUV  = subV(backUV,  0, 1 - upperFrac);
    const upperFrontUV = subV(frontUV, 1 - upperFrac, 1);
    const lowerFrontUV = subV(frontUV, 0, 1 - upperFrac);

    meshes.push(makeHalf(`${label}-leg-${opts.side}-back`,        upperBackUV,  upperHeight, upperMidY, false));
    meshes.push(makeHalf(`${label}-leg-${opts.side}-front`,       upperFrontUV, upperHeight, upperMidY, true));
    meshes.push(makeHalf(`${label}-leg-lower-${opts.side}-back`,  lowerBackUV,  lowerHeight, lowerMidY, false));
    meshes.push(makeHalf(`${label}-leg-lower-${opts.side}-front`, lowerFrontUV, lowerHeight, lowerMidY, true));

    // Knee patch — sphere of the same fabric at the knee pivot,
    // slightly SMALLER than the cylinder (×0.96) so it hides inside at
    // rest. Becomes visible inside the V-gap when the knee bends.
    const kneePatch = MeshBuilder.CreateSphere(`${label}-knee-${opts.side}`, {
      diameter: opts.diameter * 0.96, segments: 12,
    }, scene);
    kneePatch.parent = parent;
    kneePatch.position.set(opts.x, KNEE_WORLD_Y, 0);
    kneePatch.material = mat;
    meshes.push(kneePatch);
  } else {
    meshes.push(makeHalf(`${label}-leg-${opts.side}-back`,  backUV,  opts.height, opts.y, false));
    meshes.push(makeHalf(`${label}-leg-${opts.side}-front`, frontUV, opts.height, opts.y, true));
  }

  return meshes;
}

function buildPants(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string): Mesh[] {
  const mat = makeDesignMaterial(scene, `${label}-mat`, design);
  const legs = [
    ...buildPantLeg(scene, parent, mat, label, { height: 0.92, diameter: 0.44, y: 0.7, x: -0.22, side: 'l', bend: true }),
    ...buildPantLeg(scene, parent, mat, label, { height: 0.92, diameter: 0.44, y: 0.7, x: 0.22, side: 'r', bend: true }),
  ];

  // Waistband — full ring, picks up bulk fabric color from the texture.
  const waistband = MeshBuilder.CreateCylinder(`${label}-waistband`, {
    height: 0.1, diameter: 0.85, tessellation: 24,
  }, scene);
  waistband.parent = parent;
  waistband.position.set(0, 1.08, 0);
  waistband.scaling.set(1.0, 1.0, 0.6);
  waistband.material = mat;

  // Back pockets removed — they were thin boxes parented to root, which
  // meant the pant leg cylinders rotated with the hip while the pockets
  // stayed pinned, reading as floating plates behind the avatar during
  // the walk cycle. The patches added little visual value at the
  // avatar's scale; cleaner to omit them than to rig them properly.

  return [...legs, waistband];
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

function buildShoes(scene: Scene, parent: TransformNode, design: GarmentDesign, label: string, options?: { soleColor?: string; laceColor?: string }): Mesh[] {
  // Split shoe into THREE meshes per foot:
  //   1. upper — sliced-sphere dome on top (carries the body material/design)
  //   2. sole  — flat low cylinder underneath (its own solid color)
  //   3. lace patch — small contrasting box on the front of the upper
  // Catalog entries (e.g. white sneakers) already pass `soleColor` and
  // `laceColor`; this builder finally uses them.
  const upperMat = makeDesignMaterial(scene, `${label}-upper-mat`, design);
  const soleMat = createStandardMaterial(scene, `${label}-sole-mat`, Color3.FromHexString(options?.soleColor ?? '#3a3a3d'));
  const laceMat = createStandardMaterial(scene, `${label}-lace-mat`, Color3.FromHexString(options?.laceColor ?? '#f5f5f5'));
  const meshes: Mesh[] = [];

  const buildOne = (side: 'l' | 'r', x: number) => {
    // SOLE — chunky thickness so the shoe reads as a SHOE from low
    // camera angles, not a flat disc. Old version was 0.04 thick which
    // turned into a barely-visible white plate near the ground; bumped
    // to 0.09. Position raised correspondingly so the bottom still
    // touches ground.
    const sole = MeshBuilder.CreateCylinder(`${label}-sole-${side}`, {
      diameter: 0.5, height: 0.09, tessellation: 22,
    }, scene);
    sole.parent = parent;
    sole.position.set(x, 0.045, 0.16);
    sole.scaling.set(0.95, 1.0, 1.5);
    sole.material = soleMat;
    meshes.push(sole);

    // UPPER — taller (Y-scale 0.7 → 1.05) so the dome rises above the
    // sole as a proper shoe upper rather than a squashed cap. Sits on
    // top of the (now-thicker) sole.
    const upper = MeshBuilder.CreateSphere(`${label}-upper-${side}`, {
      diameter: 0.52, segments: 22, slice: 0.5,
    }, scene);
    upper.parent = parent;
    upper.position.set(x, 0.09, 0.16);
    upper.scaling.set(0.88, 1.05, 1.4);
    upper.material = upperMat;
    meshes.push(upper);

    // LACE patch — moved up to match the taller upper. The upper's
    // mid-front at z≈0.30 now sits around y≈0.30; the +0.21 rad
    // forward-tilt keeps the patch hugging the slope of the upper.
    const lace = MeshBuilder.CreateBox(`${label}-lace-${side}`, {
      width: 0.16, height: 0.025, depth: 0.18,
    }, scene);
    lace.parent = parent;
    lace.position.set(x, 0.32, 0.30);
    lace.rotation.x = 0.21;
    lace.material = laceMat;
    meshes.push(lace);
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

// ─── Jersey catalog (designs + accents shared with HUD presets) ──────────
// Defined ABOVE WARDROBE_TEXTURE_ITEMS so the spread below can reference
// JERSEY_CATALOG_ITEMS (TS const-hoisting forbids forward reference).
// Each entry's `design` doubles as the build argument AND the editor preset
// the player can load in the Customize panel.
interface JerseyCatalogEntry {
  id: string;
  label: string;
  presetLabel: string; // shorter label for the preset chip
  design: GarmentDesign;
  accents: JerseyAccents;
}

const JERSEY_CATALOG: readonly JerseyCatalogEntry[] = [
  {
    id: 'jersey-argentina', label: 'Argentina #10', presetLabel: 'Argentina',
    accents: { collarColor: '#1a1a1d', cuffColor: '#1a1a1d' },
    design: {
      kind: 'garment',
      // Body uses AI-painted vertical-stripe fabric with knit-weave texture;
      // sleeves stay solid light-blue to match the historical kit (sleeves
      // are usually solid, not striped). Fallback color = stripe blue so
      // the canvas isn't bright pink before the PNG arrives.
      back:    imageAsset('jersey-argentina-fabric', '#75aadb'),
      front:   imageAsset('jersey-argentina-fabric', '#75aadb'),
      sleeveL: solid('#75aadb'),
      sleeveR: solid('#75aadb'),
      overlay: {
        crestColor: '#e8c84a', crestInitial: 'A',
        sleeveStripeColor: '#f5f5f5',
        hemColor: '#1a1a1d',
        numberColor: '#1a1a1d', numberText: '10',
        nameColor: '#1a1a1d', nameText: 'MESSI',
      },
    },
  },
  {
    id: 'jersey-brazil', label: 'Brazil #10', presetLabel: 'Brazil',
    accents: { collarColor: '#0a5c2e', cuffColor: '#0a5c2e' },
    design: {
      kind: 'garment',
      back: solid('#fde047'), front: solid('#fde047'),
      sleeveL: solid('#fde047'), sleeveR: solid('#fde047'),
      overlay: {
        crestColor: '#0a5c2e', crestInitial: 'B',
        sleeveStripeColor: '#0a5c2e',
        hemColor: '#0a5c2e',
        numberColor: '#0a5c2e', numberText: '10',
        nameColor: '#0a5c2e', nameText: 'NEYMAR',
      },
    },
  },
  {
    id: 'jersey-germany', label: 'Germany #13', presetLabel: 'Germany',
    accents: { collarColor: '#1a1a1d', cuffColor: '#c14444' },
    design: {
      kind: 'garment',
      // Back stays solid white; only the FRONT body shows the famous
      // black-band horizontal stripes (AI fabric with knit-weave texture).
      // Sleeves stay solid white to match the historic kit.
      back:    solid('#f5f5f5'),
      front:   imageAsset('jersey-germany-fabric', '#f5f5f5'),
      sleeveL: solid('#f5f5f5'),
      sleeveR: solid('#f5f5f5'),
      overlay: {
        crestColor: '#e8c84a', crestInitial: 'D',
        sleeveStripeColor: '#1a1a1d',
        hemColor: '#c14444',
        numberColor: '#1a1a1d', numberText: '13',
        nameColor: '#1a1a1d', nameText: 'MULLER',
      },
    },
  },
  {
    id: 'jersey-france', label: 'France #7', presetLabel: 'France',
    accents: { collarColor: '#c14444', cuffColor: '#f5f5f5' },
    design: {
      kind: 'garment',
      back: solid('#19387c'), front: solid('#19387c'),
      sleeveL: solid('#19387c'), sleeveR: solid('#19387c'),
      overlay: {
        crestColor: '#e8c84a', crestInitial: 'F',
        sleeveStripeColor: '#f5f5f5',
        hemColor: '#c14444',
        numberColor: '#f5f5f5', numberText: '7',
        nameColor: '#f5f5f5', nameText: 'GRIEZMANN',
      },
    },
  },
  {
    id: 'jersey-netherlands', label: 'Netherlands #11', presetLabel: 'Netherlands',
    accents: { collarColor: '#1a1a1d', cuffColor: '#1a1a1d' },
    design: {
      kind: 'garment',
      back: solid('#ff7f3f'), front: solid('#ff7f3f'),
      sleeveL: solid('#ff7f3f'), sleeveR: solid('#ff7f3f'),
      overlay: {
        crestColor: '#1a1a1d', crestInitial: 'N',
        sleeveStripeColor: '#1a1a1d',
        hemColor: '#1a1a1d',
        numberColor: '#1a1a1d', numberText: '11',
        nameColor: '#1a1a1d', nameText: 'GAKPO',
      },
    },
  },
  {
    id: 'jersey-spain', label: 'Spain #9', presetLabel: 'Spain',
    accents: { collarColor: '#1a3673', cuffColor: '#e8c84a' },
    design: {
      kind: 'garment',
      back: solid('#c41e3a'), front: solid('#c41e3a'),
      sleeveL: solid('#c41e3a'), sleeveR: solid('#c41e3a'),
      overlay: {
        crestColor: '#e8c84a', crestInitial: 'E',
        sleeveStripeColor: '#1a3673',
        hemColor: '#1a3673',
        numberColor: '#e8c84a', numberText: '9',
        nameColor: '#1a3673', nameText: 'MORATA',
      },
    },
  },
  {
    id: 'jersey-italy', label: 'Italy #10', presetLabel: 'Italy',
    accents: { collarColor: '#f5f5f5', cuffColor: '#0a5c2e' },
    design: {
      kind: 'garment',
      back: solid('#1864a3'), front: solid('#1864a3'),
      sleeveL: solid('#1864a3'), sleeveR: solid('#1864a3'),
      overlay: {
        crestColor: '#e8c84a', crestInitial: 'I',
        sleeveStripeColor: '#f5f5f5',
        hemColor: '#0a5c2e',
        numberColor: '#f5f5f5', numberText: '10',
        nameColor: '#f5f5f5', nameText: 'BARELLA',
      },
    },
  },
  {
    id: 'jersey-england', label: 'England #10', presetLabel: 'England',
    accents: { collarColor: '#19387c', cuffColor: '#c14444' },
    design: {
      kind: 'garment',
      back: solid('#f5f5f5'), front: solid('#f5f5f5'),
      sleeveL: solid('#f5f5f5'), sleeveR: solid('#f5f5f5'),
      overlay: {
        crestColor: '#19387c', crestInitial: 'E',
        sleeveStripeColor: '#c14444',
        hemColor: '#19387c',
        numberColor: '#19387c', numberText: '10',
        nameColor: '#19387c', nameText: 'BELLINGHAM',
      },
    },
  },
  {
    id: 'jersey-portugal', label: 'Portugal #7', presetLabel: 'Portugal',
    accents: { collarColor: '#0a5c2e', cuffColor: '#e8c84a' },
    design: {
      kind: 'garment',
      back: solid('#7a1f1f'), front: solid('#7a1f1f'),
      sleeveL: solid('#7a1f1f'), sleeveR: solid('#7a1f1f'),
      overlay: {
        crestColor: '#0a5c2e', crestInitial: 'P',
        sleeveStripeColor: '#e8c84a',
        hemColor: '#e8c84a',
        numberColor: '#e8c84a', numberText: '7',
        nameColor: '#0a5c2e', nameText: 'RONALDO',
      },
    },
  },
  {
    id: 'jersey-croatia', label: 'Croatia #10', presetLabel: 'Croatia',
    accents: { collarColor: '#19387c', cuffColor: '#19387c' },
    design: {
      kind: 'garment',
      // ALL four panels use the AI checker fabric — Croatia's iconic
      // šahovnica pattern wraps the whole body including the sleeves.
      // Procedural checker rendered as a coarse grid at this resolution;
      // the AI version reads as a crisp jersey kit with knit texture.
      back:    imageAsset('jersey-croatia-fabric', '#c41e2a'),
      front:   imageAsset('jersey-croatia-fabric', '#c41e2a'),
      sleeveL: imageAsset('jersey-croatia-fabric', '#c41e2a'),
      sleeveR: imageAsset('jersey-croatia-fabric', '#c41e2a'),
      overlay: {
        crestColor: '#19387c', crestInitial: 'H',
        sleeveStripeColor: '#19387c',
        hemColor: '#19387c',
        numberColor: '#19387c', numberText: '10',
        nameColor: '#19387c', nameText: 'MODRIC',
      },
    },
  },
];

export interface JerseyPreset {
  id: string;
  label: string;
  design: GarmentDesign;
}

export const JERSEY_PRESETS: readonly JerseyPreset[] = JERSEY_CATALOG.map((e) => ({
  id: e.id,
  label: e.presetLabel,
  design: e.design,
}));

const JERSEY_CATALOG_ITEMS: TextureItemDef[] = JERSEY_CATALOG.map((entry) => ({
  id: entry.id,
  label: entry.label,
  slot: 'shirt' as TextureSlot,
  zIndex: 40,
  swatch: entry.design.front,
  design: entry.design,
  build: (s, p) => buildFootballJersey(s, p, entry.design, entry.id, entry.accents),
}));

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

  // ─── AI-generated fabric prints ───────────────────────────────────────────
  // Each shirt uses a single tileable AI-painted texture on all four
  // garment panels (back / front / sleeveL / sleeveR). textures.ts already
  // supports `kind: 'image'` patterns — the canvas painter renders the
  // panel's fallback color first, async-loads the PNG, and redraws the
  // panel + seams when the bitmap arrives. Pattern-only artwork (no text,
  // no logo, no shirt silhouette) so the repetition across panels reads
  // as a uniform fabric, not a duplicated logo.
  {
    id: 'shirt-ai-tropical', label: 'Tropical Hawaiian',  slot: 'shirt', zIndex: 40,
    swatch: imageAsset('shirt-tropical', '#2c8a8c'),
    build: (s, p) => buildTshirt(s, p, {
      kind: 'garment',
      back:    imageAsset('shirt-tropical', '#2c8a8c'),
      front:   imageAsset('shirt-tropical', '#2c8a8c'),
      sleeveL: imageAsset('shirt-tropical', '#2c8a8c'),
      sleeveR: imageAsset('shirt-tropical', '#2c8a8c'),
    }, 'shirt-ai-tropical'),
  },
  {
    id: 'shirt-ai-galaxy', label: 'Galaxy Nebula',  slot: 'shirt', zIndex: 40,
    swatch: imageAsset('shirt-galaxy', '#2a1a4e'),
    build: (s, p) => buildTshirt(s, p, {
      kind: 'garment',
      back:    imageAsset('shirt-galaxy', '#2a1a4e'),
      front:   imageAsset('shirt-galaxy', '#2a1a4e'),
      sleeveL: imageAsset('shirt-galaxy', '#2a1a4e'),
      sleeveR: imageAsset('shirt-galaxy', '#2a1a4e'),
    }, 'shirt-ai-galaxy'),
  },
  {
    id: 'shirt-ai-geometric', label: 'Memphis Pop',  slot: 'shirt', zIndex: 40,
    swatch: imageAsset('shirt-geometric', '#f4ead0'),
    build: (s, p) => buildTshirt(s, p, {
      kind: 'garment',
      back:    imageAsset('shirt-geometric', '#f4ead0'),
      front:   imageAsset('shirt-geometric', '#f4ead0'),
      sleeveL: imageAsset('shirt-geometric', '#f4ead0'),
      sleeveR: imageAsset('shirt-geometric', '#f4ead0'),
    }, 'shirt-ai-geometric'),
  },

  // ─── World Cup football jerseys ───────────────────────────────────────────
  // Each is buildFootballJersey: per-panel team body design + accent meshes
  // (collar, sleeve cuff rings, hem trim) + a baked-in overlay (crest, brand
  // patch, name bar, number plate) drawn directly onto the texture so
  // nothing floats. The HUD reads each item's `design` to load it as a
  // preset in the Customize panel; the player can then change the number
  // and name on the back and equip it as their own variant.
  ...JERSEY_CATALOG_ITEMS,

  // ─── Pants (garments) ──────────────────────────────────────────────────────
  // For pants, GarmentDesign field names map to leg quadrants like so (see
  // PANTS_UV in this file):
  //   back    → front-L leg
  //   front   → front-R leg
  //   sleeveL → back-L  leg
  //   sleeveR → back-R  leg
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
    build: (s, p) => {
      const d = uniformDesign({ kind: 'hStripes', colors: ['#9a9ca3', '#888a91'], thickness: 12 });
      d.sideStripeColor = '#f5f5f5'; // adidas-style white stripe down the outer leg
      return buildPants(s, p, d, 'pants-gray-sweats');
    },
  },
  {
    id: 'pants-red-shorts', label: 'Red Shorts', slot: 'pants', zIndex: 20,
    swatch: solid('#c14444'),
    build: (s, p) => {
      const d = uniformDesign(solid('#c14444'));
      d.sideStripeColor = '#f5f5f5';
      return buildShorts(s, p, d, 'pants-red-shorts');
    },
  },
  {
    id: 'pants-khaki-cargo', label: 'Khaki Cargo', slot: 'pants', zIndex: 20,
    swatch: { kind: 'hatch', bg: '#a89868', line: '#8a7e54', spacing: 16 },
    build: (s, p) => buildPants(s, p, uniformDesign({ kind: 'hatch', bg: '#a89868', line: '#8a7e54', spacing: 16 }), 'pants-khaki-cargo'),
  },
  {
    id: 'pants-plaid', label: 'Plaid-Knee Pants', slot: 'pants', zIndex: 20,
    swatch: { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 10 },
    build: (s, p) => buildPants(s, p, {
      kind: 'garment',
      back: solid('#3b4b30'), front: solid('#3b4b30'),
      sleeveL: { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 18 },
      sleeveR: { kind: 'checker', colorA: '#4a5d3a', colorB: '#2e3a23', size: 18 },
    }, 'pants-plaid'),
  },

  // ─── Shoes (garments) ──────────────────────────────────────────────────────
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

// (Jersey catalog moved above WARDROBE_TEXTURE_ITEMS for const-hoisting.)

// ─── Accessory builders ─────────────────────────────────────────────────────
export const WARDROBE_ACCESSORY_ITEMS: AccessoryItemDef[] = [
  // Hats / glasses / scarves / backpack no longer go through Mesh.MergeMeshes
  // — keeping the sub-meshes separate lets us paint the brim a different
  // color from the crown, the strap a different color from the bag body,
  // etc. Cost is a handful of extra draw calls per accessory; benefit is
  // accessories that read as actual objects, not single-color blobs.
  {
    id: 'hat-cap',
    label: 'Baseball Cap',
    socket: 'head_top',
    swatch: solid('#c14444'),
    build: (scene, parent) => {
      const crownMat = createStandardMaterial(scene, 'hat-cap-crown-mat', Color3.FromHexString('#c14444'));
      const brimMat = createStandardMaterial(scene, 'hat-cap-brim-mat', Color3.FromHexString('#7a1f1f'));
      const buttonMat = createStandardMaterial(scene, 'hat-cap-btn-mat', Color3.FromHexString('#f5f5f5'));

      // Crown — a hemisphere that HUGS the 0.62 head dome (head_top socket
      // sits at world y=2.65; head centre 2.5, radius 0.31). Diameter 0.66
      // (just over the head) and slid down so the dome caps the skull
      // instead of ballooning above it.
      const crown = MeshBuilder.CreateSphere('hat-cap-crown', { diameter: 0.66, segments: 18, slice: 0.52 }, scene);
      crown.parent = parent;
      crown.position.set(0, -0.06, 0);
      crown.material = crownMat;

      // Peak — a flat tongue projecting FORWARD only (a baseball bill),
      // not a full ring. Thin box, slightly down-tilted, sitting at brow
      // height in front of the crown.
      const peak = MeshBuilder.CreateBox('hat-cap-peak', { width: 0.36, height: 0.035, depth: 0.30 }, scene);
      peak.parent = parent;
      peak.position.set(0, -0.10, 0.30);
      peak.rotation.x = -0.16;
      peak.material = brimMat;
      // Rounded front lip on the peak so its leading edge doesn't read as
      // a hard rectangle.
      const peakTip = MeshBuilder.CreateCylinder('hat-cap-peak-tip', { height: 0.36, diameter: 0.05, tessellation: 12 }, scene);
      peakTip.parent = parent;
      peakTip.rotation.z = Math.PI / 2;
      peakTip.position.set(0, -0.125, 0.45);
      peakTip.rotation.x = -0.16;
      peakTip.material = brimMat;

      // Tiny apex button.
      const button = MeshBuilder.CreateSphere('hat-cap-btn', { diameter: 0.055, segments: 10 }, scene);
      button.parent = parent;
      button.position.set(0, 0.13, 0);
      button.material = buttonMat;

      return [crown, peak, peakTip, button];
    },
  },
  {
    id: 'hat-top-hat',
    label: 'Top Hat',
    socket: 'head_top',
    swatch: solid('#1a1a1d'),
    build: (scene, parent) => {
      const crownMat = createStandardMaterial(scene, 'hat-top-crown-mat', Color3.FromHexString('#1a1a1d'));
      const bandMat = createStandardMaterial(scene, 'hat-top-band-mat', Color3.FromHexString('#7a1f1f'));

      const crown = MeshBuilder.CreateCylinder('hat-top-crown', { height: 0.55, diameter: 0.52, tessellation: 24 }, scene);
      crown.parent = parent;
      crown.position.set(0, 0.32, 0);
      crown.material = crownMat;

      const brim = MeshBuilder.CreateCylinder('hat-top-brim', { height: 0.04, diameter: 0.82, tessellation: 24 }, scene);
      brim.parent = parent;
      brim.position.set(0, 0.04, 0);
      brim.material = crownMat;

      // Hatband — thin torus around the base of the crown, contrast color.
      const band = MeshBuilder.CreateTorus('hat-top-band', { diameter: 0.54, thickness: 0.05, tessellation: 24 }, scene);
      band.parent = parent;
      band.position.set(0, 0.1, 0);
      band.material = bandMat;

      return [crown, brim, band];
    },
  },
  {
    id: 'hat-beanie',
    label: 'Knit Beanie',
    socket: 'head_top',
    swatch: { kind: 'hStripes', colors: ['#3a6ea5', '#2c557d'], thickness: 10 },
    build: (scene, parent) => {
      const pattern: Pattern = { kind: 'hStripes', colors: ['#3a6ea5', '#2c557d'], thickness: 10 };
      const knitMat = makePatternMaterial(scene, 'hat-beanie-mat', pattern);
      // Snug dome over the head (0.66 just clears the 0.62 head), pulled
      // down so it covers the upper skull like a worn beanie.
      const beanie = MeshBuilder.CreateSphere('hat-beanie', { diameter: 0.66, segments: 20, slice: 0.58 }, scene);
      beanie.parent = parent;
      beanie.position.set(0, -0.09, 0);
      beanie.material = knitMat;

      // Folded knit cuff — a torus around the bottom rim that gives the
      // beanie its characteristic rolled brim (was missing → read as a
      // plain ball).
      const cuff = MeshBuilder.CreateTorus('hat-beanie-cuff', { diameter: 0.6, thickness: 0.09, tessellation: 22 }, scene);
      cuff.parent = parent;
      cuff.position.set(0, -0.12, 0);
      cuff.material = knitMat;

      // Pom-pom on top.
      const pomMat = createStandardMaterial(scene, 'hat-beanie-pom-mat', Color3.FromHexString('#f5f5f5'));
      const pom = MeshBuilder.CreateSphere('hat-beanie-pom', { diameter: 0.16, segments: 12 }, scene);
      pom.parent = parent;
      pom.position.set(0, 0.14, 0);
      pom.material = pomMat;

      return [beanie, cuff, pom];
    },
  },
  {
    id: 'hat-wizard',
    label: 'Wizard Hat',
    socket: 'head_top',
    swatch: { kind: 'dots', bg: '#2d2470', dot: '#e8c84a', size: 16 },
    build: (scene, parent) => {
      const pattern: Pattern = { kind: 'dots', bg: '#2d2470', dot: '#e8c84a', size: 22 };
      const mainMat = makePatternMaterial(scene, 'hat-wiz-mat', pattern);
      const starMat = createStandardMaterial(scene, 'hat-wiz-star-mat', Color3.FromHexString('#e8c84a'));

      const cone = MeshBuilder.CreateCylinder('hat-wiz-cone', { height: 0.85, diameterTop: 0.0, diameterBottom: 0.6, tessellation: 24 }, scene);
      cone.parent = parent;
      cone.position.set(0, 0.47, 0);
      cone.rotation.z = -0.08;
      cone.material = mainMat;

      const brim = MeshBuilder.CreateCylinder('hat-wiz-brim', { height: 0.04, diameter: 0.88, tessellation: 24 }, scene);
      brim.parent = parent;
      brim.position.set(0, 0.04, 0);
      brim.material = mainMat;

      // Star — a gold sphere on the front of the cone (cheaper than an
      // actual star polygon, reads well at gameplay distance).
      const star = MeshBuilder.CreateSphere('hat-wiz-star', { diameter: 0.16, segments: 12 }, scene);
      star.parent = parent;
      star.position.set(0, 0.45, 0.22);
      star.material = starMat;

      return [cone, brim, star];
    },
  },
  {
    id: 'glasses-round',
    label: 'Round Glasses',
    socket: 'head_front',
    swatch: solid('#22232a'),
    build: (scene, parent) => {
      const mat = createStandardMaterial(scene, 'glasses-mat', Color3.FromHexString('#22232a'));
      // Thinner frames (0.018 was 0.025) — reads more like real spectacles.
      const left = MeshBuilder.CreateTorus('glasses-l', { diameter: 0.22, thickness: 0.018, tessellation: 22 }, scene);
      left.parent = parent;
      left.position.set(-0.13, 0, 0);
      left.rotation.x = Math.PI / 2;
      left.material = mat;
      const right = MeshBuilder.CreateTorus('glasses-r', { diameter: 0.22, thickness: 0.018, tessellation: 22 }, scene);
      right.parent = parent;
      right.position.set(0.13, 0, 0);
      right.rotation.x = Math.PI / 2;
      right.material = mat;
      const bridge = MeshBuilder.CreateBox('glasses-bridge', { width: 0.06, height: 0.018, depth: 0.018 }, scene);
      bridge.parent = parent;
      bridge.position.set(0, 0, 0);
      bridge.material = mat;
      // Temple arms — thin boxes going back from each lens past the
      // visible edge of the head (they tuck in but the front edge reads).
      const templeL = MeshBuilder.CreateBox('glasses-temple-l', { width: 0.018, height: 0.018, depth: 0.18 }, scene);
      templeL.parent = parent;
      templeL.position.set(-0.22, 0, -0.06);
      templeL.material = mat;
      const templeR = MeshBuilder.CreateBox('glasses-temple-r', { width: 0.018, height: 0.018, depth: 0.18 }, scene);
      templeR.parent = parent;
      templeR.position.set(0.22, 0, -0.06);
      templeR.material = mat;
      return [left, right, bridge, templeL, templeR];
    },
  },
  {
    id: 'glasses-shades',
    label: 'Shades',
    socket: 'head_front',
    swatch: solid('#000000'),
    build: (scene, parent) => {
      const lensMat = createStandardMaterial(scene, 'shades-lens-mat', Color3.FromHexString('#0a0a12'));
      const frameMat = createStandardMaterial(scene, 'shades-frame-mat', Color3.FromHexString('#1a1a1d'));
      // Sleeker lens shape — slightly wraparound look via rotated boxes.
      const lensL = MeshBuilder.CreateBox('shades-lens-l', { width: 0.23, height: 0.1, depth: 0.04 }, scene);
      lensL.parent = parent;
      lensL.position.set(-0.13, 0, 0.02);
      lensL.rotation.y = 0.08;
      lensL.material = lensMat;
      const lensR = MeshBuilder.CreateBox('shades-lens-r', { width: 0.23, height: 0.1, depth: 0.04 }, scene);
      lensR.parent = parent;
      lensR.position.set(0.13, 0, 0.02);
      lensR.rotation.y = -0.08;
      lensR.material = lensMat;
      // Thin top frame piece spanning both lenses.
      const frame = MeshBuilder.CreateBox('shades-frame', { width: 0.5, height: 0.018, depth: 0.04 }, scene);
      frame.parent = parent;
      frame.position.set(0, 0.06, 0.02);
      frame.material = frameMat;
      // Temple arms.
      const templeL = MeshBuilder.CreateBox('shades-temple-l', { width: 0.018, height: 0.018, depth: 0.18 }, scene);
      templeL.parent = parent;
      templeL.position.set(-0.24, 0.04, -0.06);
      templeL.material = frameMat;
      const templeR = MeshBuilder.CreateBox('shades-temple-r', { width: 0.018, height: 0.018, depth: 0.18 }, scene);
      templeR.parent = parent;
      templeR.position.set(0.24, 0.04, -0.06);
      templeR.material = frameMat;
      return [lensL, lensR, frame, templeL, templeR];
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
      return buildScarf(scene, parent, 'scarf-red', matA, matB);
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
      return buildScarf(scene, parent, 'scarf-m', matA, matB);
    },
  },
  {
    id: 'backpack-standard',
    label: 'Backpack',
    socket: 'back_center',
    swatch: solid('#3a6ea5'),
    build: (scene, parent) => {
      const bodyMat = createStandardMaterial(scene, 'backpack-body-mat', Color3.FromHexString('#19387c'));
      const strapMat = createStandardMaterial(scene, 'backpack-strap-mat', Color3.FromHexString('#3a6ea5'));
      const pocketMat = createStandardMaterial(scene, 'backpack-pocket-mat', Color3.FromHexString('#2c557d'));
      const buckleMat = createStandardMaterial(scene, 'backpack-buckle-mat', Color3.FromHexString('#c0c0c0'));

      const body = MeshBuilder.CreateBox('backpack-body', { width: 0.7, height: 0.75, depth: 0.3 }, scene);
      body.parent = parent;
      body.position.set(0, 0, -0.2);
      body.material = bodyMat;

      const strap = MeshBuilder.CreateBox('backpack-strap', { width: 0.82, height: 0.08, depth: 0.04 }, scene);
      strap.parent = parent;
      strap.position.set(0, 0.3, 0.27);
      strap.material = strapMat;

      const pocket = MeshBuilder.CreateBox('backpack-pocket', { width: 0.4, height: 0.3, depth: 0.05 }, scene);
      pocket.parent = parent;
      pocket.position.set(0, -0.05, -0.38);
      pocket.material = pocketMat;

      // Buckle — small silver box on the strap front.
      const buckle = MeshBuilder.CreateBox('backpack-buckle', { width: 0.1, height: 0.08, depth: 0.025 }, scene);
      buckle.parent = parent;
      buckle.position.set(0, 0.3, 0.30);
      buckle.material = buckleMat;

      return [body, strap, pocket, buckle];
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
