// ══════════════════════════════════════════════
// Stadium park: a festive plaza on the outside of a football stadium.
// The stadium dominates the north horizon; the playable area is a 48×48
// grass park to the south, threaded by paved walkways, dotted with
// hand-placed trees (rendered as crossed-billboard SPRITES rather than
// 3D meshes, à la Don't Starve), grass tufts (same technique), and a
// championship football monument at the plaza center.
//
// World coords are XZ; +X is east, +Z is north. Server uses (x, y) where
// y maps to Babylon Z. The fair center is at (24, 0, 24).
// ══════════════════════════════════════════════

import {
  Color3,
  Color4,
  DynamicTexture,
  Material,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  type ArcRotateCamera,
  type DirectionalLight,
  type HemisphericLight,
  type Scene,
} from '@babylonjs/core';
import { createBaseSceneObjects, createStandardMaterial } from './helpers';
import { ASSETS } from '../assets';
import { RUNTIME_CONFIG } from './config';

export interface GameWorldObjects {
  camera: ArcRotateCamera;
  hemiLight: HemisphericLight;
  sunLight: DirectionalLight;
  ground: Mesh;
  /** Repaint the in-world fixture board's texture. Call when the
   *  betting store's fixtures or standings have fresh data. */
  updateFixtureBoard(
    fixtures: ReadonlyArray<{
      homeTeam: string; awayTeam: string; homeCode: string; awayCode: string;
      kickoffMs: number; status: string; scoreHome: number; scoreAway: number;
      minute: number;
    }>,
  ): void;
  /** Repaint the top-up monument's display. Call when the server's
   *  pool total or unlocked-milestone set changes. */
  updateMonument(pool: number, unlockedTierIds: readonly number[]): void;
  /** Repaint the top-voters board. Call when the server's broadcast
   *  list of top contributors changes. */
  updateTopVotersBoard(entries: ReadonlyArray<{
    name: string; contribution: number; team: string; teamCode: string; camp: string;
  }>): void;
  dispose(): void;
}

interface FixtureBoardController {
  meshes: Mesh[];
  repaint(fixtures: Parameters<GameWorldObjects['updateFixtureBoard']>[0]): void;
}

interface MonumentController {
  meshes: Mesh[];
  repaint(pool: number, unlockedTierIds: readonly number[]): void;
}

interface TopVotersBoardController {
  meshes: Mesh[];
  repaint(entries: Parameters<GameWorldObjects['updateTopVotersBoard']>[0]): void;
}

// Map recenter (2026-06-08): everything shifted +86 in x so the stadium
// sits on the midline of a 220-wide map (was on the west edge of a
// 400-wide map, leaving the east and west fences wildly asymmetric).
// FAIR_CENTER + STADIUM_CENTER + all build-call positions reflect the
// new origin. The internal geometry of each prop (relative offsets,
// pillar angles, etc.) is unchanged.
export const FAIR_CENTER = new Vector3(110, 0, 24);
export const FAIR_SIZE = 48;
export const PLAZA_RADIUS = 4.5;

// ─── Portal gates — leave THIS game and enter another in the Rezona app.
// Modelled on the player-tunnel entrances at the base of stadium stands
// (where teams emerge before a game). 5 of them, evenly distributed
// around the field perimeter, all facing INWARD toward the field. When
// the player walks within PORTAL_INTERACT_RADIUS of one (see game.ts),
// a HUD prompt appears asking them to press G to play that game.
export interface PortalGate {
  readonly id: string;
  readonly label: string;
  readonly url: string;
  /** Cover-image asset key registered in src/assets.ts. */
  readonly cover:
    | 'portal-cover-adventure'
    | 'portal-cover-puzzle'
    | 'portal-cover-racing'
    | 'portal-cover-defender'
    | 'portal-cover-cards';
  /** Ground-plane position of the portal's center (computed below). */
  readonly x: number;
  readonly z: number;
  /** Direction the cover image faces (inward normal in radians). */
  readonly facing: number;
}
export const PORTAL_INTERACT_RADIUS = 3.5;

// Signpost — proximity-based controls cheat-sheet. game.ts checks the
// player's distance to (SIGNPOST_X, SIGNPOST_Z) each frame and surfaces
// a HUD tip when within the radius.
export const SIGNPOST_X = 75;
export const SIGNPOST_Z = 30;
export const SIGNPOST_INTERACT_RADIUS = 3.5;

// Stadium center — on the map midline, north of the park. Bigger than
// before (outer diameter 140 vs 100) to give the interior room for
// tiered stands + crowd backdrop, and to read as a proper arena from
// the park. The wall is taller too so it can frame the new roof.
const STADIUM_CENTER = new Vector3(110, 0, 150);
const STADIUM_OUTER_DIAMETER = 140;
const STADIUM_OVAL_RATIO = 1.4;
const STADIUM_WALL_HEIGHT = 26;

// Portal placements — angles on the stadium's INNER ellipse (the field
// edge where the bottom tier of stands begins). All 5 face inward
// toward the field center, just like real team-emergence tunnels. The
// south arc (angle -π/2 ± 0.5) is reserved for the main gate, so the
// 5 portals fan out across the remaining ~260° around the field.
//
// Distribution (clockwise from south-east, around the back, to south-west):
//   SE → E → N (back) → W → SW
const _stadiumPortalSpec: Array<{
  id: string; label: string; url: string;
  cover: PortalGate['cover']; angle: number;
}> = [
  { id: 'portal-adventure', label: 'Pixel Quest',
    url: 'https://rezona.app/pixel-quest',
    cover: 'portal-cover-adventure', angle: -Math.PI / 4 },          // SE
  { id: 'portal-puzzle',    label: 'Bubble Tower',
    url: 'https://rezona.app/bubble-tower',
    cover: 'portal-cover-puzzle',    angle: Math.PI / 6 },            // E-NE
  { id: 'portal-racing',    label: 'Kart Rush',
    url: 'https://rezona.app/kart-rush',
    cover: 'portal-cover-racing',    angle: Math.PI / 2 },            // N (back)
  { id: 'portal-defender',  label: 'Sky Defender',
    url: 'https://rezona.app/sky-defender',
    cover: 'portal-cover-defender',  angle: Math.PI - Math.PI / 6 },  // W-NW
  { id: 'portal-cards',     label: 'Card Clash',
    url: 'https://rezona.app/card-clash',
    cover: 'portal-cover-cards',     angle: Math.PI + Math.PI / 4 },  // SW
];
export const STADIUM_PORTAL_GATES: PortalGate[] = _stadiumPortalSpec.map((s) => {
  // Place portals at the inner ellipse — the field edge where the
  // bottom tier of stands begins. Stand inner edge = (ax-10, bz-10)
  // matching STADIUM_KEEPOUT.innerAx/innerBz.
  const ax = (STADIUM_OUTER_DIAMETER / 2) * STADIUM_OVAL_RATIO;
  const bz = STADIUM_OUTER_DIAMETER / 2;
  const STAND_TIERS = 5;
  const TIER_INSET = 2.0;
  const standInnerAx = ax - STAND_TIERS * TIER_INSET;
  const standInnerBz = bz - STAND_TIERS * TIER_INSET;
  // Sit the portal mouth ~1.2 units OUT FROM the inner edge of the
  // stand (toward the field) so the cover plane doesn't z-fight the
  // riser mesh behind it.
  const cosA = Math.cos(s.angle);
  const sinA = Math.sin(s.angle);
  const nx = cosA / standInnerAx;
  const nz = sinA / standInnerBz;
  const nLen = Math.hypot(nx, nz);
  // Inward-pointing unit normal (toward field center) at this angle:
  const ux = -(nx / nLen);
  const uz = -(nz / nLen);
  const x = STADIUM_CENTER.x + standInnerAx * cosA + ux * 1.2;
  const z = STADIUM_CENTER.z + standInnerBz * sinA + uz * 1.2;
  return {
    id: s.id, label: s.label, url: s.url, cover: s.cover,
    x, z,
    facing: Math.atan2(uz, ux),  // cover faces the field center
  };
});
// Roof sits directly on top of the wall — used to be at y=30, leaving
// a 4-unit visible gap between the wall top and the roof underside.
const STADIUM_ROOF_Y = STADIUM_WALL_HEIGHT;
// Interior floor flush with the outside ground (y=0). Used to be
// raised 0.4 to feel like a step up, but with the player avatar
// staying at y=0 inside the stadium, the avatar visibly sank below
// the floor. Keeping floor flush + a different turf texture gives
// the "you are now inside" cue without breaking the physics.
const STADIUM_INTERIOR_FLOOR_Y = 0;

export function createGameWorld(scene: Scene, canvas: HTMLCanvasElement): GameWorldObjects {
  // LLM-EXTENSION:WORLD — Multiplayer stadium-park: 48×48 grass park (centered at 24,0,24) just south of a large football stadium (oval cylinder + roof torus + perimeter pillars + signage at z=125). Trees and grass are rendered as CROSSED-BILLBOARD 2D sprites (two perpendicular planes per instance with canvas-painted PNG textures via DynamicTexture) for a stylized Don't-Starve look. A championship football monument sits at the plaza center. Stalls live in entities.ts at scattered/organic positions with a new design: peaked awning + back-wall banner + side panels + lanterns. Camera is ArcRotateCamera; game.ts re-targets camera.target each frame. FAIR_CENTER/FAIR_SIZE preserved so spawn + server boundaries are unchanged.
  // DO NOT REMOVE the LLM-EXTENSION:WORLD tag — scripts/check-architecture.mjs requires it to appear exactly once across the src tree.
  const base = createBaseSceneObjects(scene, canvas);
  scene.clearColor = Color4.FromHexString(`${RUNTIME_CONFIG.world.clearColor}ff`);

  base.camera.alpha = -Math.PI / 2;
  base.camera.beta = Math.PI / 3;
  base.camera.radius = 16;
  base.camera.target.copyFrom(FAIR_CENTER);
  base.camera.lowerRadiusLimit = 4;
  base.camera.upperRadiusLimit = 60;
  // ArcRotateCamera.beta is the polar angle from +Y.
  //   beta = 0      → camera above, looking straight down
  //   beta = π/2    → camera horizontal, looking sideways
  //   beta > π/2    → camera BELOW horizontal — looking UP at the
  //                   target from a lower vantage point
  //
  // Hard clamp lowerBetaLimit so the camera can't pin vertically
  // straight-down (looks weird and breaks framing). upperBetaLimit
  // is INITIALLY π/2 + 0.7 rad (~40° below horizontal) — generous so
  // players can look up at tall objects above the avatar. The game
  // render loop ALSO bumps camera.target.y when beta goes past
  // horizontal, which tilts the view direction up further (see
  // game.ts lookUpBoost). The per-frame ground guard below stops the
  // camera physically dipping below the ground plane regardless of
  // beta.
  base.camera.lowerBetaLimit = 0.15;
  base.camera.upperBetaLimit = Math.PI / 2 + 0.7;
  base.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');

  // Per-frame ground guard: compute the maximum beta that keeps the
  // camera position at least GROUND_CAM_MARGIN above y=0. ArcRotate
  // camera's y position = target.y + radius * cos(beta), so the limit
  // is beta_max = acos((minY - target.y) / radius). Reapply each
  // render — radius + target.y both change at runtime. Margin lowered
  // to 0.15 so the camera can dip very close to the ground, giving
  // more upward-tilt headroom.
  const GROUND_CAM_MARGIN = 0.15;
  // Stadium wall keep-out for the camera. Outer ellipse matches the
  // visible wall ribbon; "+ a hair" so we never z-fight the wall mesh.
  const STAD_CAM_AX = (STADIUM_OUTER_DIAMETER / 2) * STADIUM_OVAL_RATIO - 0.5;
  const STAD_CAM_BZ = STADIUM_OUTER_DIAMETER / 2 - 0.5;
  const STAD_CAM_CX = STADIUM_CENTER.x;
  const STAD_CAM_CZ = STADIUM_CENTER.z;
  scene.onBeforeRenderObservable.add(() => {
    const c = base.camera;
    if (c.radius <= 0) return;
    const cosArg = (GROUND_CAM_MARGIN - c.target.y) / c.radius;
    if (cosArg <= -1) { c.upperBetaLimit = Math.PI - 0.05; }
    else if (cosArg >= 1) { c.upperBetaLimit = 0.05; }
    else {
      const lower = c.lowerBetaLimit ?? 0.15;
      c.upperBetaLimit = Math.max(lower + 0.05, Math.acos(cosArg) - 0.02);
    }
    if (c.beta > c.upperBetaLimit) c.beta = c.upperBetaLimit;

    // ─── Wall keep-out: camera must be on the SAME SIDE of the stadium
    //     wall as the target. If the target is inside the stadium and
    //     the camera (from radius/alpha/beta) ends up outside the
    //     wall, shrink the radius to whatever value would put the
    //     camera exactly on the wall — capped by lowerRadiusLimit so
    //     it never collapses entirely.
    //
    //     ArcRotateCamera position (Babylon left-handed):
    //       cam.x = target.x - r * cos(alpha) * sin(beta)
    //       cam.z = target.z - r * sin(alpha) * sin(beta)
    //     So the unit XZ direction from target → camera is:
    //       (ux, uz) = (-cos(alpha) * sin(beta), -sin(alpha) * sin(beta))
    //     Then camera = target + r * (ux, uz).
    //
    //     Ellipse norm: N(p) = ((p.x - cx)/ax)² + ((p.z - cz)/bz)²
    //     We want N(camera) on the same side of 1 as N(target).
    const sinB = Math.sin(c.beta);
    const ux = -Math.cos(c.alpha) * sinB;
    const uz = -Math.sin(c.alpha) * sinB;
    const tx = c.target.x - STAD_CAM_CX;
    const tz = c.target.z - STAD_CAM_CZ;
    const a2 = STAD_CAM_AX * STAD_CAM_AX;
    const b2 = STAD_CAM_BZ * STAD_CAM_BZ;
    const targetN = (tx * tx) / a2 + (tz * tz) / b2;
    const targetInside = targetN < 1;
    // Camera offset at current radius:
    const cdx = c.radius * ux;
    const cdz = c.radius * uz;
    const camN = ((tx + cdx) * (tx + cdx)) / a2 + ((tz + cdz) * (tz + cdz)) / b2;
    const camInside = camN < 1;
    if (targetInside !== camInside) {
      // Solve N(target + r*u) = 1 for r:
      //   A·r² + B·r + C = 0
      //   A = ux²/ax² + uz²/bz²
      //   B = 2(tx·ux/ax² + tz·uz/bz²)
      //   C = tx²/ax² + tz²/bz² − 1   (= targetN − 1)
      const A = (ux * ux) / a2 + (uz * uz) / b2;
      const B = 2 * (tx * ux / a2 + tz * uz / b2);
      const C = targetN - 1;
      const disc = B * B - 4 * A * C;
      if (disc > 0 && A > 1e-9) {
        const sq = Math.sqrt(disc);
        // We want the positive root that lies BEFORE the current
        // (now-too-large) radius. Both roots if A>0 + C<0 (target
        // inside) → one positive, one negative; pick positive.
        const r1 = (-B + sq) / (2 * A);
        const r2 = (-B - sq) / (2 * A);
        const candidates = [r1, r2].filter((r) => r > 0.1);
        if (candidates.length > 0) {
          const rWall = Math.min(...candidates);
          // Pull camera radius IN by an extra 0.3 so it sits just
          // inside (or outside, mirroring) the wall, never touching.
          const newR = Math.max(c.lowerRadiusLimit ?? 4, rWall - 0.3);
          if (newR < c.radius) c.radius = newR;
        }
      }
    }
  });

  base.hemiLight.intensity = 0.95;
  base.hemiLight.groundColor = new Color3(0.55, 0.6, 0.45);
  base.sunLight.intensity = 0.7;

  const allMeshes: Mesh[] = [];
  const allTextures: Texture[] = [];
  const allMaterials: StandardMaterial[] = [];

  // Fixture board controller — set inside the build block below, so
  // updateFixtureBoard can route repaints to it.
  let fixtureBoardController: FixtureBoardController | null = null;
  // Same idea for the top-up monument.
  let monumentController: MonumentController | null = null;
  // ...and the top-voters board.
  let topVotersBoardController: TopVotersBoardController | null = null;

  // ─── Ground ───────────────────────────────────────────────────────────────
  // Map width is now 220 (was 400) after the recenter. Ground extent is
  // still oversized to fill the horizon past the fence at max camera
  // radius. Centered on the playable midpoint (x=110, z=110).
  const ground = MeshBuilder.CreateGround('park-ground', {
    width: 460, height: 460, subdivisions: 1,
  }, scene);
  ground.position.set(110, 0, 110);
  // AI-painted top-down grass texture, tiled across the whole ground.
  // uScale/vScale = how many tile repeats fit across the ground; bigger
  // = smaller-looking grass tufts. ~30 = ~20-unit tile = ~7× avatar
  // height per tile, which reads as park grass at gameplay zoom.
  const groundMat = createStandardMaterial(scene, 'park-ground-mat', Color3.FromHexString('#74a05f'));
  const groundTex = new Texture(ASSETS['ground-grass'], scene);
  groundTex.uScale = 30;
  groundTex.vScale = 30;
  groundTex.anisotropicFilteringLevel = 8;
  groundMat.diffuseTexture = groundTex;
  ground.material = groundMat;
  ground.receiveShadows = true;
  allTextures.push(groundTex);
  allMaterials.push(groundMat);

  // ─── Plaza disc + soft shadow ─────────────────────────────────────────────
  const plazaMat = createStandardMaterial(scene, 'plaza-mat', Color3.FromHexString('#d8c5a4'));
  const plaza = MeshBuilder.CreateDisc('plaza', { radius: PLAZA_RADIUS, tessellation: 48 }, scene);
  plaza.rotation.x = Math.PI / 2;
  plaza.position.set(FAIR_CENTER.x, 0.015, FAIR_CENTER.z);
  plaza.material = plazaMat;
  allMeshes.push(plaza);

  const plazaShadow = MeshBuilder.CreateDisc('plaza-shadow', {
    radius: PLAZA_RADIUS + 0.18, tessellation: 48,
  }, scene);
  plazaShadow.rotation.x = Math.PI / 2;
  plazaShadow.position.set(FAIR_CENTER.x, 0.008, FAIR_CENTER.z);
  const shadowMat = new StandardMaterial('plaza-shadow-mat', scene);
  shadowMat.diffuseColor = Color3.FromHexString('#000000');
  shadowMat.alpha = 0.08;
  plazaShadow.material = shadowMat;
  plazaShadow.isPickable = false;
  allMeshes.push(plazaShadow);

  // ─── Walkways ─────────────────────────────────────────────────────────────
  // Park-interior cross + radial branches to stalls, PLUS a wider
  // network connecting the new outdoor attractions:
  //   - East main path extends out past the soccer field to the trophy
  //     plaza and photo spot
  //   - North spine continues to the stadium gate
  //   - Branches lead to the concession-stand cluster and amphitheater
  // Walkway material — AI-painted sandy path texture, tiled.
  const pathMat = createStandardMaterial(scene, 'walkway-mat', Color3.FromHexString('#cbb389'));
  const pathTex = new Texture(ASSETS['ground-path'], scene);
  // Walkway boxes vary in length; one shared material with a moderate uScale
  // tiles the path texture along the walkway's long axis. vScale is fixed
  // so the texture reads at a consistent grain regardless of segment length.
  pathTex.uScale = 4;
  pathTex.vScale = 1;
  pathTex.anisotropicFilteringLevel = 4;
  pathMat.diffuseTexture = pathTex;
  allTextures.push(pathTex);
  allMaterials.push(pathMat);
  // All x values += 86 from the original (map recenter).
  const pathSpec: Array<[number, number, number, number, number?]> = [
    // Park interior — central cross
    [110,  1, 110, 47, 2.0],
    [ 87, 24, 133, 24, 2.0],
    // Park interior — radial branches to stalls
    [110, 14, 108, 14, 1.2],
    [110, 18,  98, 16, 1.2],
    [110, 18, 121, 18, 1.2],
    [115, 24, 125, 32, 1.2],
    [110, 32, 114, 39, 1.2],
    [108, 32, 100, 34, 1.2],
    [104, 24,  94, 28, 1.2],
    // Extension — north spine to the stadium gate. Stadium grew so the
    // south wall is now at z = STADIUM_CENTER.z - bz = 150 - 70 = 80.
    [110, 47, 110, 78, 2.0],
    // Extension — east main artery past soccer + shoes to photo spot
    [133, 24, 186, 24, 1.8],
    // Branch — main artery → shoes stall (extended to reach the stall)
    [156, 24, 170, 20, 1.4],
    // Branch — south to concession cluster
    [146, 24, 146, 12, 1.4],
    // Branch — north to amphitheater (extended to reach the stage front)
    [148, 45, 148, 70, 1.4],
    // Branch — north to trophy plaza, reaching the central pedestal
    [186, 24, 186, 60, 1.6],
    // Branch — short stub north to the photo selfie spot
    [186, 24, 186, 25, 1.4],

    // ─── Cluster connector paths (themed-zone interconnections) ─────────
    // West "Betting Plaza" loop — links signpost (75, 30) → monument
    // (80, 50) → top-voters (95, 40) → fixture board (140, 50) all
    // together so the four boards read as one walkable zone.
    [ 75, 30,  80, 50, 1.4],
    [ 80, 50,  95, 40, 1.4],
    [ 95, 40, 140, 50, 1.4],
    // Spur from the spine path at z=47 west to the betting plaza so
    // players see it on the way to the stadium gate.
    [110, 47,  95, 40, 1.4],
    // East "Trophy Walk" loop — trophy plaza (186, 60) → trophy tent
    // (180, 45) → mascot (195, 40) → photo spot (186, 25).
    [186, 60, 180, 45, 1.4],
    [180, 45, 195, 40, 1.2],
    [186, 25, 195, 40, 1.2],
    // Spine spur east at z=80 to the new fan-zone (130, 92) — links
    // amphitheater approach with the fan zone.
    [110, 80, 130, 92, 1.6],
    [130, 92, 148, 70, 1.4],
    // Stadium-approach press tent spur (90, 78) — runs west off the spine.
    [110, 70,  90, 78, 1.4],
    // "Food Avenue" connector — concession cluster (146, 12) east to
    // the new food court (160, 20).
    [146, 12, 160, 20, 1.4],
  ];
  for (const [x1, z1, x2, z2, w] of pathSpec) {
    allMeshes.push(buildWalkway(scene, x1, z1, x2, z2, w ?? 1.5, pathMat));
  }

  // ─── Soccer practice field ────────────────────────────────────────────────
  for (const m of buildSoccerField(scene, 158, 32)) allMeshes.push(m);

  // ─── Festive decor: lampposts + flag banners + balloons ─────────────────
  for (const m of buildFestiveDecor(scene)) allMeshes.push(m);

  // ─── Extra POIs to fill empty park areas — see buildExtraPois ─────────
  for (const m of buildExtraPois(scene)) allMeshes.push(m);

  // ─── Stadium entrance gate — at the south wall of the enlarged stadium ───
  // STADIUM_CENTER.z (150) - bz (70) = 80, the south face of the wall.
  for (const m of buildStadiumGate(scene, STADIUM_CENTER.x, STADIUM_CENTER.z - 70)) allMeshes.push(m);

  // ─── Portal gates — leave to another Rezona game ──────────────────────────
  // Decorative gates mounted on the stadium wall with game cover images.
  // game.ts watches the player's distance to each portal; HUD prompts on
  // proximity; pressing G redirects the browser. See STADIUM_PORTAL_GATES.
  for (const portal of STADIUM_PORTAL_GATES) {
    for (const m of buildPortalGate(scene, portal)) allMeshes.push(m);
  }

  // ─── Concession stand cluster (south-east, 4 colorful food carts) ────────
  for (const m of buildConcessionCluster(scene, 146, 12)) allMeshes.push(m);

  // ─── Trophy plaza (north-east corner) ─────────────────────────────────────
  for (const m of buildTrophyPlaza(scene, 186, 60)) allMeshes.push(m);

  // ─── Photo selfie spot (far east) ─────────────────────────────────────────
  for (const m of buildPhotoSpot(scene, 186, 25)) allMeshes.push(m);

  // ─── Amphitheater (north of soccer field) ─────────────────────────────────
  for (const m of buildAmphitheater(scene, 148, 70)) allMeshes.push(m);

  // ─── World Cup fixture board — large physical billboard in the park ───────
  // Standalone plot at (140, 50) — east of the plaza, west of the amphitheater
  // / trophy plaza, on the path to the soccer field. Visible from spawn,
  // doesn't conflict with any other POI. The board's texture is repainted
  // each time bettingFixtures + bettingStandings change in the store.
  const boardCtl = buildFixtureBoard(scene, 140, 50);
  for (const m of boardCtl.meshes) allMeshes.push(m);
  fixtureBoardController = boardCtl;

  // ─── Top-Hero monument — mirror plot west of the plaza ────────────────────
  // Tall obelisk showing the server-wide top-up pool progress, with all
  // five milestone tiers and unlock state. Sits at (80, 50), opposite
  // the fixture board for visual balance.
  const monumentCtl = buildTopupMonument(scene, 80, 50);
  for (const m of monumentCtl.meshes) allMeshes.push(m);
  monumentController = monumentCtl;

  // ─── Top-voters board — Betting Plaza cluster ─────────────────────────
  // Sits with the top-up monument (80, 50), fixture board (140, 50),
  // and signpost (75, 30). Moved from (65, 80) to (95, 40) so the
  // four boards are within a short walk of each other on the west
  // side of the plaza — coherent "Betting Plaza" zone.
  const topVotersCtl = buildTopVotersBoard(scene, 95, 40);
  for (const m of topVotersCtl.meshes) allMeshes.push(m);
  topVotersBoardController = topVotersCtl;

  // ─── Stadium ──────────────────────────────────────────────────────────────
  for (const m of buildStadium(scene, STADIUM_CENTER.x, STADIUM_CENTER.z)) {
    allMeshes.push(m);
  }

  // NOTE: buildStadiumPitch was here — the interior soccer pitch + goal
  // posts have been removed at the user's request so the stadium
  // interior is empty space (the ground texture shows through).

  // ─── Park fence — visible boundary matching the server clamp ─────────────
  // Map is now 220×220 (was 400×220 with stadium on west edge → wildly
  // asymmetric fence distances). The east + west fences sit symmetric
  // around the stadium midline at x=110.
  for (const m of buildParkFence(scene, 0, 0, 220, 220)) {
    allMeshes.push(m);
  }

  // ─── Centerpiece: championship football monument at plaza center ──────────
  for (const m of buildCenterpiece(scene, FAIR_CENTER.x, FAIR_CENTER.z)) {
    allMeshes.push(m);
  }

  // ─── Trees — crossed-billboard sprites ────────────────────────────────────
  // ONE texture + ONE material per type, shared across all instances of
  // that type. Each tree contributes 2 perpendicular planes (so the
  // silhouette reads as 3D from any rotation angle).
  const oakTex = loadSpriteTexture(scene, 'oak-tree');
  allTextures.push(oakTex);
  const oakMat = makeFoliageMaterial(scene, 'oak-sprite-mat', oakTex);
  allMaterials.push(oakMat);

  // Tree positions span the FULL 260×260 ground, not just the playable
  // 48×48 park. Inside the park we keep a sparse handful (so walkways
  // and stalls breathe); outside we add forest fringes to the south,
  // east, west, and a buffer grove between the park edge and the
  // stadium. Outer trees are larger so they read at distance as proper
  // park trees rather than shrubs. Positions are hand-placed and
  // avoid: the stadium footprint (x ∈ [-51, 99] && z ∈ [75, 175]) and
  // the central walkways.
  // ~35 oak trees, no pines (per design call: oak only for a unified
  // canopy look). Slightly varied scale per instance so the silhouette
  // doesn't read as identical clones.
  // All x values += 86 from the original (map recenter).
  const treeSpec: Array<[number, number, 'oak' | 'pine', number]> = [
    // ─── Park interior — borders only, center kept clear ─────────────────
    [ 92, 10, 'oak',  1.9],
    [ 91, 32, 'oak',  1.7],
    [ 92, 42, 'oak',  1.9],
    [104,  6, 'oak',  1.7],
    [116,  6, 'oak',  1.9],
    [128, 12, 'oak',  1.8],
    [130, 22, 'oak',  1.7],
    [129, 32, 'oak',  1.9],
    [122, 45, 'oak',  1.7],
    [104, 44, 'oak',  1.8],

    // ─── South tree fringe (just outside the south fence) ────────────────
    [ 71,  -4, 'oak', 2.0],
    [ 96,  -8, 'oak', 2.2],
    [126,  -2, 'oak', 1.9],
    [156,  -4, 'oak', 2.1],
    [116, -18, 'oak', 2.4],
    [176, -12, 'oak', 2.2],

    // ─── East scatter (around concession + soccer + trophy) ─────────────
    [174, 10, 'oak', 2.1],
    [199, 18, 'oak', 2.0],
    [199, 45, 'oak', 2.2],
    [200, 68, 'oak', 2.0],

    // ─── West scatter (mirror of east now that the stadium's centered) ──
    [ 64, 28, 'oak', 1.9],
    [ 72, 58, 'oak', 2.3],
    [ 56, 12, 'oak', 1.9],

    // ─── North buffer (frames the stadium gate) ────────────────────────
    [ 94, 72, 'oak', 2.1],
    [128, 74, 'oak', 2.0],
    [ 80, 60, 'oak', 1.9],
    [132, 56, 'oak', 2.0],

    // No "behind stadium" trees — the enlarged stadium now reaches all
    // the way to the north fence (z=220), so there's no room for a
    // tree band north of it.
  ];
  // Pine support kept in the type signature in case it returns later, but
  // the catalog above is oak-only — all entries map to oakMat.
  for (const [x, z, _type, scale] of treeSpec) {
    for (const m of buildSpriteTree(scene, x, z, scale, oakMat, 'oak')) allMeshes.push(m);
  }

  // ─── Grass tufts — sprite-stacked across the green areas ──────────────────
  // One shared material; many tiny instances scattered with a 2D Poisson-
  // ish distribution that AVOIDS walkways, the plaza, and the centerpiece.
  const grassTex = loadSpriteTexture(scene, 'grass-tuft');
  allTextures.push(grassTex);
  const grassMat = makeFoliageMaterial(scene, 'grass-sprite-mat', grassTex);
  allMaterials.push(grassMat);

  // Grass lattice — step bumped 2.6 → 4.5 so we render ~75 tufts (×2
  // planes = ~150 transparent meshes) instead of ~290 (~580). Visual
  // density is preserved by slightly larger tufts in buildGrassTuft;
  // GPU jitter on lower-end hardware drops dramatically.
  // Park interior grass — bounds shifted +86 to match the recentered
  // plaza (x ∈ [88, 132] now, was [2, 46]).
  let grassIdx = 0;
  for (let gx = 88; gx < 132; gx += 4.5) {
    for (let gz = 2; gz < 46; gz += 4.5) {
      const jx = (Math.sin(grassIdx * 12.9898) * 43758.5453) % 1;
      const jz = (Math.sin(grassIdx * 78.233)  * 43758.5453) % 1;
      const x = gx + jx * 2.5;
      const z = gz + jz * 2.5;
      grassIdx++;
      if (!isGrassOpenArea(x, z)) continue;
      for (const m of buildGrassTuft(scene, x, z, grassMat, grassIdx)) allMeshes.push(m);
    }
  }

  // ─── Benches ──────────────────────────────────────────────────────────────
  // x values += 86 (map recenter).
  const benchSpec: Array<[number, number, number]> = [
    [107,  9,  Math.PI],
    [113,  9,  0],
    [107, 43,  Math.PI],
    [113, 43,  0],
    [ 95, 21,  Math.PI / 2],
    [ 95, 27, -Math.PI / 2],
    [125, 21,  Math.PI / 2],
    [125, 27, -Math.PI / 2],
  ];
  for (const [x, z, rot] of benchSpec) {
    for (const m of buildBench(scene, x, z, rot)) allMeshes.push(m);
  }

  // ─── Perf: freeze the world matrix of every static decoration ──────────
  // None of these meshes move, rotate, or scale after construction.
  // Freezing tells Babylon to skip the per-frame world-matrix recompute
  // for them, which adds up across hundreds of static decorations and
  // measurably reduces the per-frame CPU cost that was causing jitter.
  // Also disable pickability so the picking ray doesn't iterate them.
  ground.isPickable = false;
  ground.freezeWorldMatrix();
  for (const m of allMeshes) {
    m.isPickable = false;
    m.freezeWorldMatrix();
  }

  return {
    ...base,
    ground,
    updateFixtureBoard(fixtures) {
      if (fixtureBoardController) fixtureBoardController.repaint(fixtures);
    },
    updateMonument(pool, unlockedTierIds) {
      if (monumentController) monumentController.repaint(pool, unlockedTierIds);
    },
    updateTopVotersBoard(entries) {
      if (topVotersBoardController) topVotersBoardController.repaint(entries);
    },
    dispose() {
      ground.dispose();
      for (const m of allMeshes) m.dispose();
      for (const mat of allMaterials) mat.dispose();
      for (const t of allTextures) t.dispose();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// In-world World Cup fixture board — a tall standing billboard with a
// wooden frame. The display face uses a DynamicTexture canvas painted
// with the next several upcoming/live matches. The texture is repainted
// from game.ts whenever the server pushes a new fixtures snapshot.
// ─────────────────────────────────────────────────────────────────────────────
// Top-Hero monument — a tall obelisk showing the server-wide top-up
// pool, progress to the next tier, and the milestone ladder (all five
// tiers with their unlock state). Players see it from across the plaza
// and can walk up to read the details. The display face is a
// DynamicTexture canvas repainted each time the pool changes.
function buildTopupMonument(scene: Scene, cx: number, cz: number): MonumentController {
  // Keep this in sync with BETTING_SERVER_MILESTONES in store.ts and
  // SERVER_MILESTONES in server/src/game/event.ts. Local copy so this
  // file stays asset-only.
  const TIERS = [
    { threshold:   1000, reward:   30, label: 'First Thousand' },
    { threshold:   5000, reward:  100, label: 'Five Thousand Pool' },
    { threshold:  15000, reward:  200, label: 'Fifteen K Mark' },
    { threshold:  40000, reward:  500, label: 'Forty K Tier' },
    { threshold: 100000, reward: 1500, label: 'Hundred K Champion' },
  ];
  const meshes: Mesh[] = [];
  const stoneMat = createStandardMaterial(scene, 'mon-stone', Color3.FromHexString('#9a8e72'));
  const stoneDarkMat = createStandardMaterial(scene, 'mon-stone-dark', Color3.FromHexString('#6d6149'));
  const goldMat = createStandardMaterial(scene, 'mon-gold', Color3.FromHexString('#e6c34a'));
  const crystalMat = createStandardMaterial(scene, 'mon-crystal', Color3.FromHexString('#7be8c4'));
  crystalMat.emissiveColor = new Color3(0.4, 0.85, 0.7);
  crystalMat.specularColor = new Color3(0.6, 0.9, 0.8);

  // Paved plot
  const plot = MeshBuilder.CreateDisc('mon-plot', { radius: 4.5, tessellation: 32 }, scene);
  plot.rotation.x = Math.PI / 2;
  plot.position.set(cx, 0.03, cz);
  plot.material = stoneMat;
  plot.isPickable = false;
  meshes.push(plot);

  // Stepped stone base (3 levels, wider at the bottom)
  for (const [w, h, y] of [
    [3.8, 0.4, 0.2],
    [3.2, 0.5, 0.65],
    [2.6, 0.4, 1.10],
  ] as Array<[number, number, number]>) {
    const step = MeshBuilder.CreateBox('mon-step', { width: w, height: h, depth: w }, scene);
    step.position.set(cx, y, cz);
    step.material = (y === 0.65) ? stoneDarkMat : stoneMat;
    meshes.push(step);
  }

  // Obelisk shaft (tall slim cylinder with subtle taper)
  const SHAFT_H = 8;
  const shaft = MeshBuilder.CreateCylinder('mon-shaft', {
    height: SHAFT_H, diameterTop: 1.4, diameterBottom: 1.8, tessellation: 8,
  }, scene);
  shaft.position.set(cx, 1.3 + SHAFT_H / 2, cz);
  shaft.material = stoneMat;
  meshes.push(shaft);

  // Gold capital ring near the top
  const ring = MeshBuilder.CreateCylinder('mon-ring', {
    height: 0.3, diameter: 1.7, tessellation: 16,
  }, scene);
  ring.position.set(cx, 1.3 + SHAFT_H - 0.2, cz);
  ring.material = goldMat;
  meshes.push(ring);

  // Crystal on top — glows softly, reward-feel
  const crystal = MeshBuilder.CreateSphere('mon-crystal', {
    diameter: 1.2, segments: 8,
  }, scene);
  crystal.scaling.y = 1.5;
  crystal.position.set(cx, 1.3 + SHAFT_H + 0.6, cz);
  crystal.material = crystalMat;
  meshes.push(crystal);

  // Gold pyramid pinnacle above the crystal
  const pinnacle = MeshBuilder.CreateCylinder('mon-pinnacle', {
    height: 0.6, diameterTop: 0.05, diameterBottom: 0.6, tessellation: 4,
  }, scene);
  pinnacle.position.set(cx, 1.3 + SHAFT_H + 1.5, cz);
  pinnacle.material = goldMat;
  meshes.push(pinnacle);

  // Front display panel — wide and tall, mounted on the front face of
  // the obelisk facing south (toward the plaza).
  const FACE_W = 4.4;
  const FACE_H = 5.5;
  const FACE_Y = 4.5;
  const CANVAS_W = 1024;
  const CANVAS_H = Math.floor(CANVAS_W * (FACE_H / FACE_W));
  const tex = new DynamicTexture('mon-tex', { width: CANVAS_W, height: CANVAS_H }, scene, true);
  const ctxInit = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctxInit.fillStyle = '#1a1f2c';
  ctxInit.fillRect(0, 0, CANVAS_W, CANVAS_H);
  tex.update();

  const faceMat = new StandardMaterial('mon-face-mat', scene);
  faceMat.diffuseTexture = tex;
  faceMat.emissiveTexture = tex;
  faceMat.emissiveColor = new Color3(0.7, 0.7, 0.7);
  faceMat.specularColor = new Color3(0, 0, 0);
  faceMat.backFaceCulling = false;
  const face = MeshBuilder.CreatePlane('mon-face', {
    width: FACE_W, height: FACE_H, sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  face.position.set(cx, FACE_Y, cz - 0.92);  // front face, slightly outside the shaft
  face.material = faceMat;
  face.isPickable = false;
  meshes.push(face);

  function repaint(pool: number, unlockedIds: readonly number[]): void {
    const unlocked = new Set(unlockedIds);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    // Dark gradient background
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, '#1a1f2c');
    grad.addColorStop(1, '#0d1018');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Header
    ctx.fillStyle = '#e6c34a';
    ctx.fillRect(0, 0, CANVAS_W, 80);
    ctx.fillStyle = '#1a1f2c';
    ctx.font = 'bold 40px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 TOP-UP POOL', CANVAS_W / 2, 40);

    // Current pool — big number
    ctx.fillStyle = '#e6c34a';
    ctx.font = 'bold 110px Inter, system-ui, sans-serif';
    ctx.fillText(`${pool}`, CANVAS_W / 2, 200);
    ctx.fillStyle = '#aaa';
    ctx.font = 'bold 28px Inter, system-ui, sans-serif';
    ctx.fillText('coins contributed', CANVAS_W / 2, 270);

    // Progress bar to the next tier
    const nextTier = TIERS.find((t, i) => !unlocked.has(i));
    const barX = 60;
    const barY = 330;
    const barW = CANVAS_W - 2 * barX;
    const barH = 32;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(barX, barY, barW, barH);
    if (nextTier) {
      // progress relative to previous unlock threshold
      const lastUnlocked = TIERS.filter((_, i) => unlocked.has(i)).pop();
      const lo = lastUnlocked ? lastUnlocked.threshold : 0;
      const hi = nextTier.threshold;
      const t = Math.max(0, Math.min(1, (pool - lo) / (hi - lo)));
      const grad2 = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      grad2.addColorStop(0, '#e6c34a');
      grad2.addColorStop(1, '#f5a142');
      ctx.fillStyle = grad2;
      ctx.fillRect(barX, barY, barW * t, barH);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${pool} / ${nextTier.threshold}  ·  next: ${nextTier.label} (+${nextTier.reward} 🪙)`,
        CANVAS_W / 2, barY + barH / 2 + 1,
      );
    } else {
      ctx.fillStyle = '#3a8634';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 24px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ALL MILESTONES UNLOCKED', CANVAS_W / 2, barY + barH / 2 + 1);
    }

    // Tier ladder
    ctx.font = 'bold 32px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const rowsY0 = 420;
    const rowH = (CANVAS_H - rowsY0 - 50) / TIERS.length;
    for (let i = 0; i < TIERS.length; i++) {
      const t = TIERS[i];
      const ok = unlocked.has(i);
      const y = rowsY0 + i * rowH + rowH / 2;
      // row tint
      if (ok) {
        ctx.fillStyle = 'rgba(58, 134, 52, 0.15)';
        ctx.fillRect(40, rowsY0 + i * rowH + 4, CANVAS_W - 80, rowH - 8);
      }
      // checkmark / locked icon
      ctx.fillStyle = ok ? '#3a8634' : '#666';
      ctx.textAlign = 'center';
      ctx.fillText(ok ? '✓' : '○', 90, y);
      // threshold + label
      ctx.fillStyle = ok ? '#fff' : '#aaa';
      ctx.textAlign = 'left';
      ctx.fillText(`${t.threshold}`, 160, y);
      ctx.font = 'bold 26px Inter, system-ui, sans-serif';
      ctx.fillText(t.label, 320, y);
      ctx.font = 'bold 32px Inter, system-ui, sans-serif';
      // reward on the right
      ctx.fillStyle = ok ? '#e6c34a' : '#776';
      ctx.textAlign = 'right';
      ctx.fillText(`+${t.reward} 🪙`, CANVAS_W - 60, y);
    }

    tex.update();
  }

  // Initial paint with zero state — will be overwritten by first
  // event:pool-update broadcast after connect.
  repaint(0, []);

  return { meshes, repaint };
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-voters board — leaderboard of biggest betters in this room session.
// Standalone wooden billboard, similar architecture to the fixture board
// but a slimmer profile and a different content schema. Each row shows
// rank, player name, their team affiliation (3-letter code + team
// name), and their lifetime contribution amount. Camp colors (HOME/
// DRAW/AWAY) tint the team chip so it reads at a glance.
function buildTopVotersBoard(scene: Scene, cx: number, cz: number): TopVotersBoardController {
  const meshes: Mesh[] = [];
  const woodMat = createStandardMaterial(scene, 'tv-wood-mat', Color3.FromHexString('#7a5836'));
  const woodDarkMat = createStandardMaterial(scene, 'tv-wood-dark', Color3.FromHexString('#4a341c'));
  const stoneMat = createStandardMaterial(scene, 'tv-stone', Color3.FromHexString('#b8aa90'));
  const goldMat = createStandardMaterial(scene, 'tv-gold', Color3.FromHexString('#e6c34a'));

  // Paved plot
  const plot = MeshBuilder.CreateDisc('tv-plot', { radius: 4.5, tessellation: 32 }, scene);
  plot.rotation.x = Math.PI / 2;
  plot.position.set(cx, 0.03, cz);
  plot.material = stoneMat;
  plot.isPickable = false;
  meshes.push(plot);

  // Frame dimensions (taller than the fixture board, narrower)
  const FACE_W = 6.2;
  const FACE_H = 4.8;
  const FACE_Y = 3.2;
  const POST_HEIGHT = 5.2;
  const POST_OFFSET = FACE_W / 2 + 0.5;

  // Posts outside the face
  for (const sign of [-1, 1] as const) {
    const post = MeshBuilder.CreateCylinder(`tv-post-${sign}`, {
      height: POST_HEIGHT, diameter: 0.32, tessellation: 10,
    }, scene);
    post.position.set(cx + sign * POST_OFFSET, POST_HEIGHT / 2, cz);
    post.material = woodDarkMat;
    meshes.push(post);
    const cap = MeshBuilder.CreateCylinder(`tv-post-cap-${sign}`, {
      height: 0.18, diameterTop: 0.38, diameterBottom: 0.55, tessellation: 10,
    }, scene);
    cap.position.set(cx + sign * POST_OFFSET, POST_HEIGHT + 0.05, cz);
    cap.material = goldMat;
    meshes.push(cap);
  }

  // Frame
  const frameThick = 0.12;
  const frameDepth = 0.25;
  for (const [name, dx, dy, w, h] of [
    ['top', 0, FACE_H / 2 + frameThick / 2, FACE_W + 0.4, frameThick],
    ['bot', 0, -FACE_H / 2 - frameThick / 2, FACE_W + 0.4, frameThick],
  ] as Array<[string, number, number, number, number]>) {
    const bar = MeshBuilder.CreateBox(`tv-frame-${name}`, {
      width: w, height: h, depth: frameDepth,
    }, scene);
    bar.position.set(cx + dx, FACE_Y + dy, cz);
    bar.material = woodMat;
    meshes.push(bar);
  }
  for (const sign of [-1, 1] as const) {
    const side = MeshBuilder.CreateBox(`tv-frame-side-${sign}`, {
      width: frameThick, height: FACE_H + 2 * frameThick, depth: frameDepth,
    }, scene);
    side.position.set(cx + sign * (FACE_W / 2 + frameThick / 2), FACE_Y, cz);
    side.material = woodMat;
    meshes.push(side);
  }

  // Topper accent
  const topper = MeshBuilder.CreateBox('tv-topper', {
    width: FACE_W * 0.5, height: 0.5, depth: 0.18,
  }, scene);
  topper.position.set(cx, FACE_Y + FACE_H / 2 + 0.5, cz);
  topper.material = goldMat;
  meshes.push(topper);

  // Display face — DynamicTexture
  const CANVAS_W = 1024;
  const CANVAS_H = Math.floor(CANVAS_W * (FACE_H / FACE_W));
  const tex = new DynamicTexture('tv-tex', { width: CANVAS_W, height: CANVAS_H }, scene, true);
  const ctxInit = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctxInit.fillStyle = '#1c1b1a';
  ctxInit.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctxInit.fillStyle = '#c8c0a8';
  ctxInit.font = 'bold 48px Inter, system-ui, sans-serif';
  ctxInit.textAlign = 'center';
  ctxInit.fillText('LOADING…', CANVAS_W / 2, CANVAS_H / 2);
  tex.update();

  const faceMat = new StandardMaterial('tv-face-mat', scene);
  faceMat.diffuseTexture = tex;
  faceMat.emissiveTexture = tex;
  faceMat.emissiveColor = new Color3(0.7, 0.7, 0.7);
  faceMat.specularColor = new Color3(0, 0, 0);
  faceMat.backFaceCulling = false;
  const face = MeshBuilder.CreatePlane('tv-face', {
    width: FACE_W, height: FACE_H, sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  face.position.set(cx, FACE_Y, cz + 0.01);
  face.material = faceMat;
  face.isPickable = false;
  meshes.push(face);

  // Camp → chip color
  const campColor = (camp: string): string => {
    if (camp === 'HOME') return '#3a6ea5';
    if (camp === 'AWAY') return '#c14444';
    if (camp === 'DRAW') return '#7a7a7a';
    return '#4a4a4a';
  };

  function repaint(entries: Parameters<GameWorldObjects['updateTopVotersBoard']>[0]): void {
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    // Dark wood background with gold header
    ctx.fillStyle = '#1c1b1a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = '#e6c34a';
    ctx.fillRect(0, 0, CANVAS_W, 84);
    ctx.fillStyle = '#1c1b1a';
    ctx.font = 'bold 50px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 TOP VOTERS', CANVAS_W / 2, 42);

    if (entries.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '36px Inter, system-ui, sans-serif';
      ctx.fillText('Be the first to place a bet!', CANVAS_W / 2, CANVAS_H / 2 + 20);
      tex.update();
      return;
    }

    // Show up to 8 rows for legibility
    const list = entries.slice(0, 8);
    const rowH = (CANVAS_H - 110) / list.length;
    ctx.font = 'bold 30px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    list.forEach((e, i) => {
      const y = 100 + i * rowH + rowH / 2;
      // Alternate row tint
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(0, 100 + i * rowH, CANVAS_W, rowH);
      }
      // Rank with medal for top 3
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      ctx.fillStyle = '#fff5d8';
      ctx.textAlign = 'left';
      ctx.font = 'bold 34px Inter, system-ui, sans-serif';
      ctx.fillText(medal, 36, y);

      // Player name
      ctx.font = 'bold 30px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#fff5d8';
      ctx.fillText(e.name.slice(0, 14), 110, y);

      // Team chip (rounded rect with the team code on a colored fill)
      const chipX = 440;
      const chipW = 140;
      const chipH = 40;
      const chipY = y - chipH / 2;
      if (e.teamCode) {
        ctx.fillStyle = campColor(e.camp);
        ctx.beginPath();
        const r = 8;
        ctx.moveTo(chipX + r, chipY);
        ctx.lineTo(chipX + chipW - r, chipY);
        ctx.quadraticCurveTo(chipX + chipW, chipY, chipX + chipW, chipY + r);
        ctx.lineTo(chipX + chipW, chipY + chipH - r);
        ctx.quadraticCurveTo(chipX + chipW, chipY + chipH, chipX + chipW - r, chipY + chipH);
        ctx.lineTo(chipX + r, chipY + chipH);
        ctx.quadraticCurveTo(chipX, chipY + chipH, chipX, chipY + chipH - r);
        ctx.lineTo(chipX, chipY + r);
        ctx.quadraticCurveTo(chipX, chipY, chipX + r, chipY);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(e.teamCode, chipX + chipW / 2, y + 1);
        // Team name to the right of the chip
        ctx.font = '24px Inter, system-ui, sans-serif';
        ctx.fillStyle = '#c8c0a8';
        ctx.textAlign = 'left';
        ctx.fillText(e.team.slice(0, 14), chipX + chipW + 14, y);
      } else {
        ctx.fillStyle = '#666';
        ctx.font = 'italic 24px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('— (no bet yet)', chipX, y);
      }

      // Contribution amount on the right
      ctx.fillStyle = '#e6c34a';
      ctx.font = 'bold 32px Inter, system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${e.contribution} 🪙`, CANVAS_W - 36, y);
    });

    tex.update();
  }

  // Initial paint with empty list
  repaint([]);

  return { meshes, repaint };
}

function buildFixtureBoard(scene: Scene, cx: number, cz: number): FixtureBoardController {
  const meshes: Mesh[] = [];
  const woodMat = createStandardMaterial(scene, 'board-wood-mat', Color3.FromHexString('#7a5836'));
  const woodDarkMat = createStandardMaterial(scene, 'board-wood-dark-mat', Color3.FromHexString('#4a341c'));
  const stoneMat = createStandardMaterial(scene, 'board-stone-mat', Color3.FromHexString('#b8aa90'));
  const goldMat = createStandardMaterial(scene, 'board-gold-mat', Color3.FromHexString('#e6c34a'));

  // ── Paved plot under the board (signals "this is a designated spot")
  const plot = MeshBuilder.CreateDisc('board-plot', {
    radius: 5, tessellation: 32,
  }, scene);
  plot.rotation.x = Math.PI / 2;
  plot.position.set(cx, 0.03, cz);
  plot.material = stoneMat;
  plot.isPickable = false;
  meshes.push(plot);

  // ── Frame around the display panel (declared first so the posts can
  //    use FACE_W to sit OUTSIDE the panel — old version put posts at
  //    cx ± 3.4 which was 0.4 units INSIDE the face edge and visually
  //    covered the text near the left/right margins).
  const FACE_W = 7.6;
  const FACE_H = 3.4;

  // ── Two posts that hold the board up — positioned just outside the
  //    frame's outer edge so they never overlap the display face.
  const POST_HEIGHT = 4.5;
  const POST_OFFSET = FACE_W / 2 + 0.55;  // 4.35 — clears the frame side
  for (const sign of [-1, 1] as const) {
    const post = MeshBuilder.CreateCylinder(`board-post-${sign}`, {
      height: POST_HEIGHT, diameter: 0.35, tessellation: 10,
    }, scene);
    post.position.set(cx + sign * POST_OFFSET, POST_HEIGHT / 2, cz);
    post.material = woodDarkMat;
    meshes.push(post);
    // Cap
    const cap = MeshBuilder.CreateCylinder(`board-post-cap-${sign}`, {
      height: 0.18, diameterTop: 0.4, diameterBottom: 0.55, tessellation: 10,
    }, scene);
    cap.position.set(cx + sign * POST_OFFSET, POST_HEIGHT + 0.05, cz);
    cap.material = goldMat;
    meshes.push(cap);
  }

  const FACE_Y = 2.6;
  const frameThick = 0.12;
  const frameDepth = 0.25;
  // Top frame
  const frameTop = MeshBuilder.CreateBox('board-frame-top', {
    width: FACE_W + 0.4, height: frameThick, depth: frameDepth,
  }, scene);
  frameTop.position.set(cx, FACE_Y + FACE_H / 2 + frameThick / 2, cz);
  frameTop.material = woodMat;
  meshes.push(frameTop);
  // Bottom frame
  const frameBot = MeshBuilder.CreateBox('board-frame-bot', {
    width: FACE_W + 0.4, height: frameThick, depth: frameDepth,
  }, scene);
  frameBot.position.set(cx, FACE_Y - FACE_H / 2 - frameThick / 2, cz);
  frameBot.material = woodMat;
  meshes.push(frameBot);
  // Left + right frames
  for (const sign of [-1, 1] as const) {
    const side = MeshBuilder.CreateBox(`board-frame-side-${sign}`, {
      width: frameThick, height: FACE_H + 2 * frameThick, depth: frameDepth,
    }, scene);
    side.position.set(cx + sign * (FACE_W / 2 + frameThick / 2), FACE_Y, cz);
    side.material = woodMat;
    meshes.push(side);
  }
  // Sign topper — "WORLD CUP 2026" gold accent above the board
  const topper = MeshBuilder.CreateBox('board-topper', {
    width: FACE_W * 0.55, height: 0.5, depth: 0.18,
  }, scene);
  topper.position.set(cx, FACE_Y + FACE_H / 2 + 0.5, cz);
  topper.material = goldMat;
  meshes.push(topper);

  // ── Display face — DynamicTexture canvas
  const CANVAS_W = 1024;
  const CANVAS_H = Math.floor(CANVAS_W * (FACE_H / FACE_W));  // matches aspect
  const tex = new DynamicTexture('board-tex', { width: CANVAS_W, height: CANVAS_H }, scene, true);
  // Suppress the default white background — start painted on the first repaint.
  const ctxInit = tex.getContext() as unknown as CanvasRenderingContext2D;
  ctxInit.fillStyle = '#1c1b1a';
  ctxInit.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctxInit.fillStyle = '#c8c0a8';
  ctxInit.font = 'bold 56px Inter, system-ui, sans-serif';
  ctxInit.textAlign = 'center';
  ctxInit.fillText('LOADING SCHEDULE…', CANVAS_W / 2, CANVAS_H / 2);
  tex.update();
  const faceMat = new StandardMaterial('board-face-mat', scene);
  faceMat.diffuseTexture = tex;
  faceMat.emissiveTexture = tex;
  faceMat.emissiveColor = new Color3(0.7, 0.7, 0.7);
  faceMat.specularColor = new Color3(0, 0, 0);
  faceMat.backFaceCulling = false;
  const face = MeshBuilder.CreatePlane('board-face', {
    width: FACE_W, height: FACE_H, sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  face.position.set(cx, FACE_Y, cz + 0.01);  // a hair in front of the frame
  face.material = faceMat;
  face.isPickable = false;
  meshes.push(face);

  function repaint(fixtures: Parameters<GameWorldObjects['updateFixtureBoard']>[0]): void {
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    // Background — dark wood look so the gold text pops
    ctx.fillStyle = '#1c1b1a';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Header bar
    ctx.fillStyle = '#e6c34a';
    ctx.fillRect(0, 0, CANVAS_W, 78);
    ctx.fillStyle = '#1c1b1a';
    ctx.font = 'bold 48px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('2026 FIFA WORLD CUP · FIXTURES', CANVAS_W / 2, 39);

    // List up to 5 upcoming matches (drop already-resolved, sort by kickoff)
    const now = Date.now();
    const upcoming = fixtures
      .filter((f) => f.status !== 'FINISHED' || f.minute > 0)
      .slice()
      .sort((a, b) => a.kickoffMs - b.kickoffMs)
      .slice(0, 5);

    if (upcoming.length === 0) {
      ctx.fillStyle = '#888';
      ctx.font = '40px Inter, system-ui, sans-serif';
      ctx.fillText('No matches scheduled', CANVAS_W / 2, CANVAS_H / 2 + 20);
      tex.update();
      return;
    }

    const rowH = (CANVAS_H - 100) / upcoming.length;
    ctx.font = 'bold 32px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    upcoming.forEach((f, i) => {
      const y = 100 + i * rowH + rowH / 2;
      // Alternate row tint
      if (i % 2 === 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(0, 100 + i * rowH, CANVAS_W, rowH);
      }
      // Status / time on the left
      ctx.textAlign = 'left';
      let leftLabel = '';
      let leftColor = '#aaa';
      if (f.status === 'IN_PLAY' || f.status === 'PAUSED') {
        leftLabel = `LIVE ${f.minute}'`;
        leftColor = '#e85a4f';
      } else if (f.status === 'FINISHED') {
        leftLabel = 'FT';
        leftColor = '#888';
      } else {
        const dt = f.kickoffMs - now;
        if (dt < 0) leftLabel = 'Soon';
        else if (dt < 60 * 60 * 1000) leftLabel = `in ${Math.ceil(dt / 60000)}m`;
        else if (dt < 24 * 60 * 60 * 1000) leftLabel = `in ${Math.floor(dt / 3600000)}h`;
        else leftLabel = `in ${Math.floor(dt / 86400000)}d`;
        leftColor = '#7ab8e8';
      }
      ctx.fillStyle = leftColor;
      ctx.fillText(leftLabel, 36, y);

      // Teams in the center: HOME (right-aligned) [vs / score] AWAY (left-aligned)
      ctx.fillStyle = '#fff5d8';
      const midX = CANVAS_W / 2;
      ctx.textAlign = 'right';
      ctx.fillText(f.homeTeam, midX - 60, y);
      ctx.textAlign = 'left';
      ctx.fillText(f.awayTeam, midX + 60, y);

      // Score (live/FT) or "vs"
      ctx.textAlign = 'center';
      if (f.status === 'IN_PLAY' || f.status === 'PAUSED' || f.status === 'FINISHED') {
        ctx.fillStyle = '#e6c34a';
        ctx.font = 'bold 38px Inter, system-ui, sans-serif';
        ctx.fillText(`${f.scoreHome} – ${f.scoreAway}`, midX, y);
        ctx.font = 'bold 32px Inter, system-ui, sans-serif';
      } else {
        ctx.fillStyle = '#888';
        ctx.fillText('vs', midX, y);
      }

      // TLA codes on the far right
      ctx.fillStyle = '#aaa';
      ctx.textAlign = 'right';
      ctx.font = 'bold 24px ui-monospace, monospace';
      ctx.fillText(`${f.homeCode} · ${f.awayCode}`, CANVAS_W - 36, y);
      ctx.font = 'bold 32px Inter, system-ui, sans-serif';
    });

    tex.update();
  }

  return { meshes, repaint };
}

// ─────────────────────────────────────────────────────────────────────────────
// Open-area filter for grass: rejects positions that overlap walkways,
// the plaza, the centerpiece base, or the bench footprints.
function isGrassOpenArea(x: number, z: number): boolean {
  // Plaza disc + centerpiece radius (map recenter: plaza is now at x=110).
  const dPlaza = Math.hypot(x - 110, z - 24);
  if (dPlaza < PLAZA_RADIUS + 0.5) return false;

  // Main + cross walkways (1.2 wide buffer)
  if (Math.abs(x - 110) < 1.5) return false;
  if (Math.abs(z - 24) < 1.5) return false;

  // Skip tiles very close to known stall positions (small clearing
  // around each stall counter). x values += 86 from the original.
  const stallPts = [
    [ 98, 16], [121, 18], [125, 32], [114, 39],
    [100, 34], [ 94, 28], [110, 14],
  ];
  for (const [sx, sz] of stallPts) {
    if (Math.hypot(x - sx, z - sz) < 2.4) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Walkway: thin paved box from (x1, z1) to (x2, z2).
function buildWalkway(scene: Scene, x1: number, z1: number, x2: number, z2: number, width: number, mat: StandardMaterial): Mesh {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  const midX = (x1 + x2) / 2;
  const midZ = (z1 + z2) / 2;
  const angle = Math.atan2(dz, dx);

  const path = MeshBuilder.CreateBox('walkway', {
    width: length, height: 0.04, depth: width,
  }, scene);
  path.position.set(midX, 0.02, midZ);
  path.rotation.y = -angle;
  path.material = mat;
  path.isPickable = false;
  return path;
}

// ─────────────────────────────────────────────────────────────────────────────
// Foliage materials: alpha-tested (no semi-transparency to sort), two-
// sided, slightly self-lit so the planes don't acquire harsh directional
// shading from one side.
function makeFoliageMaterial(scene: Scene, name: string, tex: Texture): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseTexture = tex;
  mat.diffuseTexture.hasAlpha = true;
  mat.useAlphaFromDiffuseTexture = true;
  mat.backFaceCulling = false;
  // Alpha-test (cut-off) instead of alpha-blend → no back-to-front
  // sorting issues with many overlapping foliage planes.
  mat.transparencyMode = Material.MATERIAL_ALPHATEST;
  mat.alphaCutOff = 0.4;
  mat.specularColor = new Color3(0, 0, 0);
  // Self-illumination so the back side of the flat plane doesn't read
  // as pitch dark when the directional sun is in front of it.
  mat.emissiveTexture = tex;
  mat.emissiveColor = new Color3(0.45, 0.45, 0.45);
  return mat;
}

// Sprite-stacked tree — two perpendicular planes at the same XZ point.
// One faces the X axis, the other faces the Z axis; together the
// silhouette reads as a 3D shape from any camera angle.
function buildSpriteTree(scene: Scene, x: number, z: number, scale: number, mat: StandardMaterial, type: 'oak' | 'pine'): Mesh[] {
  const aspectY = type === 'oak' ? 1.1 : 1.4;
  const size = 9 * scale;
  const height = size * aspectY;
  const planeOpts = { width: size, height, sideOrientation: Mesh.DOUBLESIDE };

  // BOTTOM_PADDING_FRAC: the AI-painted sprites have ~8-12% transparent
  // alpha padding at the bottom of the PNG (the silhouette doesn't
  // extend all the way to the bottom edge). If we put the plane's
  // bottom at world y=0, the visible trunk floats above the ground by
  // that padding amount. Sinking the plane by this fraction of its
  // height pushes the empty padding below the ground so the visible
  // tree silhouette sits flush on the grass.
  const BOTTOM_PADDING_FRAC = 0.1;
  const planeCenterY = height / 2 - height * BOTTOM_PADDING_FRAC;

  // 3 crossed planes at 0°/60°/120° (was 2 at 0°/90°) — eliminates the
  // "missing one face" issue where a tree appeared as a 2D card when
  // the camera was aligned with one of its plane axes. Three planes
  // give 6 visible silhouettes around the tree (each plane has two
  // sides), so the tree reads as 3D from every direction at the cost
  // of just one extra draw per tree.
  const meshes: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const plane = MeshBuilder.CreatePlane(`tree-${type}-${x}-${z}-${i}`, planeOpts, scene);
    plane.position.set(x, planeCenterY, z);
    plane.rotation.y = (i * Math.PI) / 3;
    plane.material = mat;
    plane.isPickable = false;
    meshes.push(plane);
  }
  return meshes;
}

// Sprite-stacked grass tuft — same technique, smaller. Light random
// rotation around Y per instance so the field doesn't read as aligned.
function buildGrassTuft(scene: Scene, x: number, z: number, mat: StandardMaterial, seed: number): Mesh[] {
  const r1 = ((Math.sin(seed * 17.31)  * 43758.5453) % 1 + 1) % 1;
  const r2 = ((Math.sin(seed * 53.179) * 43758.5453) % 1 + 1) % 1;
  const size = 0.6 + r1 * 0.4;
  const baseRot = r2 * Math.PI;

  // Same bottom-padding trick as the trees: sink the plane so the
  // padded alpha below the grass blades goes underground and the
  // visible blades touch the ground.
  const BOTTOM_PADDING_FRAC = 0.1;
  const centerY = size / 2 - size * BOTTOM_PADDING_FRAC;

  const planeOpts = { width: size, height: size, sideOrientation: Mesh.DOUBLESIDE };
  const meshes: Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const plane = MeshBuilder.CreatePlane(`grass-${seed}-${i}`, planeOpts, scene);
    plane.position.set(x, centerY, z);
    plane.rotation.y = baseRot + (i * Math.PI) / 2;
    plane.material = mat;
    plane.isPickable = false;
    meshes.push(plane);
  }
  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLIAGE SPRITE TEXTURES — generated upstream by the
// rezona-pgc-tools-gen-image skill (gpt-image-2) and stored in
// src/assets/sprite/, registered in src/assets.ts.
//
// The previous version painted each silhouette procedurally on a
// DynamicTexture canvas — readable but visually blocky. The PNG sprites
// give a much cleaner stylized cartoon look with proper alpha edges.
// To regenerate or restyle, run:
//   node ~/.claude/skills/rezona-pgc-tools-gen-image/scripts/gen-image.mjs \
//     --model gpt-image-2 --kind sprite --size 1024x1024 --no-compress \
//     --key <oak-tree|pine-tree|grass-tuft> --root client --prompt "..."
function loadSpriteTexture(scene: Scene, assetKey: 'oak-tree' | 'pine-tree' | 'grass-tuft'): Texture {
  const url = ASSETS[assetKey];
  const tex = new Texture(url, scene, /* noMipmapOrOptions */ false, /* invertY */ true);
  tex.hasAlpha = true;
  tex.name = `${assetKey}-sprite-tex`;
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bench: unchanged from prior version.
// ─────────────────────────────────────────────────────────────────────────────
// Extra POIs to fill out the previously-empty grass areas. Each is a
// small cluster of primitive meshes — no AI textures, no interaction —
// just geometric "stuff" to make the world feel populated. Coords are
// hand-picked to land in empty park regions away from the existing
// stalls / attractions.
function buildExtraPois(scene: Scene): Mesh[] {
  const meshes: Mesh[] = [];
  const cream = createStandardMaterial(scene, 'epoi-cream', Color3.FromHexString('#f4ebd6'));
  const charcoal = createStandardMaterial(scene, 'epoi-charcoal', Color3.FromHexString('#2c2c30'));
  const stone = createStandardMaterial(scene, 'epoi-stone', Color3.FromHexString('#b8aa90'));
  const wood = createStandardMaterial(scene, 'epoi-wood', Color3.FromHexString('#8a6435'));
  const woodDark = createStandardMaterial(scene, 'epoi-wood-dark', Color3.FromHexString('#4a341c'));
  const gold = createStandardMaterial(scene, 'epoi-gold', Color3.FromHexString('#e6c34a'));
  const red = createStandardMaterial(scene, 'epoi-red', Color3.FromHexString('#c14444'));
  const blue = createStandardMaterial(scene, 'epoi-blue', Color3.FromHexString('#3a6ea5'));
  const green = createStandardMaterial(scene, 'epoi-green', Color3.FromHexString('#3a8634'));
  const white = createStandardMaterial(scene, 'epoi-white', Color3.FromHexString('#ededea'));

  // ── 1. MASCOT STATUE — relocated to the Trophy Walk (east cluster) ──────
  // Was at (40, 110) — far west, isolated, no thematic neighbour. Moved
  // adjacent to the trophy plaza + photo spot so it reads as a "fan
  // photo op" anchoring the east cluster.
  const mascotCx = 195, mascotCz = 40;
  // Stone pedestal — 2 stacked drums
  const pedBase = MeshBuilder.CreateCylinder('epoi-mascot-base', {
    height: 0.6, diameter: 3.4, tessellation: 24,
  }, scene);
  pedBase.position.set(mascotCx, 0.3, mascotCz);
  pedBase.material = stone;
  meshes.push(pedBase);
  const pedTop = MeshBuilder.CreateCylinder('epoi-mascot-base-top', {
    height: 0.5, diameter: 2.8, tessellation: 24,
  }, scene);
  pedTop.position.set(mascotCx, 0.85, mascotCz);
  pedTop.material = charcoal;
  meshes.push(pedTop);
  // Plaque on the front
  const plaque = MeshBuilder.CreateBox('epoi-mascot-plaque', {
    width: 1.4, height: 0.5, depth: 0.1,
  }, scene);
  plaque.position.set(mascotCx, 0.55, mascotCz - 1.45);
  plaque.material = gold;
  meshes.push(plaque);
  // Body — round torso (white with red triangle accent)
  const body = MeshBuilder.CreateSphere('epoi-mascot-body', { diameter: 2.0, segments: 16 }, scene);
  body.position.set(mascotCx, 2.5, mascotCz);
  body.scaling.set(0.95, 1.1, 0.95);
  body.material = white;
  meshes.push(body);
  // Red diagonal sash across the body
  const sash = MeshBuilder.CreateBox('epoi-mascot-sash', {
    width: 2.0, height: 0.35, depth: 0.05,
  }, scene);
  sash.position.set(mascotCx, 2.5, mascotCz - 0.95);
  sash.rotation.z = 0.3;
  sash.material = red;
  meshes.push(sash);
  // Head — football (white sphere with dark pentagons)
  const head = MeshBuilder.CreateSphere('epoi-mascot-head', { diameter: 1.6, segments: 18 }, scene);
  head.position.set(mascotCx, 4.2, mascotCz);
  head.material = white;
  meshes.push(head);
  // Hex panels on the head
  const hexMat = createStandardMaterial(scene, 'epoi-mascot-hex', Color3.FromHexString('#1a1a1d'));
  for (const [lon, lat] of [[0, 0], [Math.PI / 2.5, 0.3], [-Math.PI / 2.5, 0.3], [Math.PI, 0], [0, 0.7]] as Array<[number, number]>) {
    const hex = MeshBuilder.CreateDisc('epoi-mascot-hex', { radius: 0.22, tessellation: 6 }, scene);
    const r = 0.83;
    const px = mascotCx + Math.cos(lat) * Math.cos(lon) * r;
    const py = 4.2 + Math.sin(lat) * r;
    const pz = mascotCz + Math.cos(lat) * Math.sin(lon) * r;
    hex.position.set(px, py, pz);
    hex.lookAt(new Vector3(mascotCx + (px - mascotCx) * 100, 4.2 + (py - 4.2) * 100, mascotCz + (pz - mascotCz) * 100));
    hex.material = hexMat;
    meshes.push(hex);
  }
  // Eyes (white) + pupils (black)
  for (const sign of [-1, 1] as const) {
    const eyeWhite = MeshBuilder.CreateSphere(`epoi-mascot-eye-w-${sign}`, { diameter: 0.4, segments: 10 }, scene);
    eyeWhite.position.set(mascotCx + sign * 0.28, 4.35, mascotCz - 0.6);
    eyeWhite.material = white;
    meshes.push(eyeWhite);
    const pupil = MeshBuilder.CreateSphere(`epoi-mascot-eye-p-${sign}`, { diameter: 0.18, segments: 8 }, scene);
    pupil.position.set(mascotCx + sign * 0.28, 4.35, mascotCz - 0.75);
    pupil.material = hexMat;
    meshes.push(pupil);
  }
  // Arms — two stubby cylinders raised in a "yay" pose
  for (const sign of [-1, 1] as const) {
    const arm = MeshBuilder.CreateCylinder(`epoi-mascot-arm-${sign}`, {
      height: 1.2, diameter: 0.35, tessellation: 10,
    }, scene);
    arm.position.set(mascotCx + sign * 1.0, 3.2, mascotCz);
    arm.rotation.z = -sign * 0.7;  // angled up and out
    arm.material = white;
    meshes.push(arm);
    // Glove — sphere at end
    const glove = MeshBuilder.CreateSphere(`epoi-mascot-glove-${sign}`, { diameter: 0.5, segments: 10 }, scene);
    const handX = mascotCx + sign * 1.0 + sign * Math.sin(0.7) * 0.6;
    const handY = 3.2 + Math.cos(0.7) * 0.6;
    glove.position.set(handX, handY, mascotCz);
    glove.material = red;
    meshes.push(glove);
  }

  // ── 2. FAN ZONE — relocated next to the amphitheater (Stadium Approach) ─
  // Was at (178, 105) — far NE, no thematic neighbour. Moved to (130,
  // 88), west of the amphitheater (148, 70), east of the spine path
  // (110). Now reads as "the second viewing area before the stadium,"
  // grouped with the amphitheater as match-day watch spots.
  const fzCx = 130, fzCz = 92;
  // Paved square
  const fzPlot = MeshBuilder.CreateDisc('epoi-fz-plot', { radius: 8, tessellation: 32 }, scene);
  fzPlot.rotation.x = Math.PI / 2;
  fzPlot.position.set(fzCx, 0.03, fzCz);
  fzPlot.material = stone;
  fzPlot.isPickable = false;
  meshes.push(fzPlot);
  // Two-post big screen frame
  for (const sign of [-1, 1] as const) {
    const screenPost = MeshBuilder.CreateBox(`epoi-fz-post-${sign}`, {
      width: 0.4, height: 6.5, depth: 0.4,
    }, scene);
    screenPost.position.set(fzCx + sign * 3.5, 3.25, fzCz + 5.5);
    screenPost.material = charcoal;
    meshes.push(screenPost);
  }
  // The screen itself — dark panel with blue tint (suggesting glow)
  const screen = MeshBuilder.CreateBox('epoi-fz-screen', {
    width: 7.4, height: 4.2, depth: 0.25,
  }, scene);
  screen.position.set(fzCx, 4.0, fzCz + 5.5);
  const screenMat = createStandardMaterial(scene, 'epoi-fz-screen-mat', Color3.FromHexString('#1a3a6e'));
  screenMat.emissiveColor = new Color3(0.25, 0.45, 0.7);
  screen.material = screenMat;
  meshes.push(screen);
  // Screen frame (gold trim)
  const frameTop = MeshBuilder.CreateBox('epoi-fz-frame-top', {
    width: 7.8, height: 0.3, depth: 0.35,
  }, scene);
  frameTop.position.set(fzCx, 6.25, fzCz + 5.5);
  frameTop.material = gold;
  meshes.push(frameTop);
  // Chair rows facing the screen
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 7; col++) {
      const cx = fzCx + (col - 3) * 0.9;
      const cz = fzCz - 1 + row * 1.1;
      const seat = MeshBuilder.CreateBox(`epoi-fz-chair-${row}-${col}`, {
        width: 0.65, height: 0.08, depth: 0.6,
      }, scene);
      seat.position.set(cx, 0.5, cz);
      seat.material = (col + row) % 2 === 0 ? red : blue;
      meshes.push(seat);
      const back = MeshBuilder.CreateBox(`epoi-fz-back-${row}-${col}`, {
        width: 0.65, height: 0.7, depth: 0.07,
      }, scene);
      back.position.set(cx, 0.85, cz + 0.27);
      back.material = (col + row) % 2 === 0 ? red : blue;
      meshes.push(back);
    }
  }

  // ── 3. PRESS / MEDIA AREA — relocated to the Stadium Approach ──────────
  // Was at (60, 85) — far west, disconnected from the stadium it's
  // supposed to cover. Moved to (90, 78), just west of the spine path
  // approaching the gate, so the cameras genuinely face the gate.
  const prCx = 90, prCz = 78;
  // Tent base — square with peaked roof (built from box + 4 triangular ribbons would be heavy; use a box + a pyramid cap)
  const tentBody = MeshBuilder.CreateBox('epoi-press-tent-body', {
    width: 5, height: 2.5, depth: 4,
  }, scene);
  tentBody.position.set(prCx, 1.25, prCz);
  const tentMat = createStandardMaterial(scene, 'epoi-press-tent-mat', Color3.FromHexString('#3a3a8c'));
  tentBody.material = tentMat;
  meshes.push(tentBody);
  // Striped awning over the front
  const awning = MeshBuilder.CreateBox('epoi-press-awning', {
    width: 5.4, height: 0.2, depth: 1.6,
  }, scene);
  awning.position.set(prCx, 2.65, prCz - 2.4);
  awning.rotation.x = -0.25;
  awning.material = white;
  meshes.push(awning);
  // PRESS label on the front (gold horizontal stripe)
  const label = MeshBuilder.CreateBox('epoi-press-label', {
    width: 3.5, height: 0.5, depth: 0.06,
  }, scene);
  label.position.set(prCx, 1.6, prCz - 2.05);
  label.material = gold;
  meshes.push(label);
  // 3 camera tripods in front of the tent
  for (let i = 0; i < 3; i++) {
    const tx = prCx + (i - 1) * 1.6;
    const tz = prCz - 4.5;
    // Tripod — 3 legs as a cone, then a cylinder body
    const tripod = MeshBuilder.CreateCylinder(`epoi-press-tripod-${i}`, {
      height: 1.4, diameterTop: 0.06, diameterBottom: 0.5, tessellation: 6,
    }, scene);
    tripod.position.set(tx, 0.7, tz);
    tripod.material = charcoal;
    meshes.push(tripod);
    // Camera body
    const cam = MeshBuilder.CreateBox(`epoi-press-cam-${i}`, {
      width: 0.45, height: 0.35, depth: 0.7,
    }, scene);
    cam.position.set(tx, 1.55, tz);
    cam.material = charcoal;
    meshes.push(cam);
    // Lens
    const lens = MeshBuilder.CreateCylinder(`epoi-press-lens-${i}`, {
      height: 0.4, diameter: 0.25, tessellation: 10,
    }, scene);
    lens.position.set(tx, 1.55, tz - 0.55);
    lens.rotation.x = Math.PI / 2;
    lens.material = white;
    meshes.push(lens);
  }

  // ── 4. SIGNPOST WITH PARK MAP (west park, near plaza) ──────────────────
  // Wooden post + angled signboard with a DynamicTexture map of the
  // park's POIs. INTERACTIVE: when the player walks within
  // SIGNPOST_INTERACT_RADIUS, the HUD shows a controls cheat-sheet (see
  // game.ts proximity check). This makes it the "press G to play"
  // pattern but for help rather than redirect.
  const spCx = 75, spCz = 30;
  // Tall sturdy post
  const spPost = MeshBuilder.CreateCylinder('epoi-sign-post', {
    height: 3.2, diameter: 0.3, tessellation: 8,
  }, scene);
  spPost.position.set(spCx, 1.6, spCz);
  spPost.material = woodDark;
  meshes.push(spPost);
  // Base stone collar
  const spBase = MeshBuilder.CreateCylinder('epoi-sign-base', {
    height: 0.3, diameterTop: 0.5, diameterBottom: 0.8, tessellation: 12,
  }, scene);
  spBase.position.set(spCx, 0.15, spCz);
  spBase.material = stone;
  meshes.push(spBase);
  // Signboard — wider flat panel angled toward the spawn so players
  // see it on their way to the plaza
  const SIGN_W = 2.6, SIGN_H = 1.7;
  const signFrame = MeshBuilder.CreateBox('epoi-sign-frame', {
    width: SIGN_W + 0.2, height: SIGN_H + 0.2, depth: 0.18,
  }, scene);
  signFrame.position.set(spCx, 2.5, spCz);
  signFrame.material = woodDark;
  signFrame.rotation.y = -0.4;
  meshes.push(signFrame);
  // Painted face — small DynamicTexture map of the park's main POIs
  const signTex = new DynamicTexture('epoi-sign-tex', { width: 768, height: 512 }, scene, true);
  const signCtx = signTex.getContext() as unknown as CanvasRenderingContext2D;
  // Cream parchment background
  signCtx.fillStyle = '#f4ebd6';
  signCtx.fillRect(0, 0, 768, 512);
  // Header strip
  signCtx.fillStyle = '#7a5836';
  signCtx.fillRect(0, 0, 768, 64);
  signCtx.fillStyle = '#fff5d8';
  signCtx.font = 'bold 36px Inter, system-ui, sans-serif';
  signCtx.textAlign = 'center';
  signCtx.textBaseline = 'middle';
  signCtx.fillText('🗺️  FAIRGROUND MAP', 384, 32);
  // Draw the map — top-down stylized icons for each major POI
  // The map covers world coords roughly x ∈ [50, 200], z ∈ [0, 220].
  // Scale: canvas 768x448 (below the header) → 1 canvas unit ≈ 0.2 world.
  signCtx.font = 'bold 16px Inter, system-ui, sans-serif';
  const worldToCanvas = (wx: number, wz: number): [number, number] => {
    const cx = ((wx - 50) / 150) * 720 + 24;
    // Z runs south (0) to north (220); on the canvas top is north so we flip.
    const cy = 64 + 24 + ((220 - wz) / 220) * 400;
    return [cx, cy];
  };
  const drawPoi = (wx: number, wz: number, dot: string, label: string): void => {
    const [px, py] = worldToCanvas(wx, wz);
    signCtx.fillStyle = dot;
    signCtx.beginPath();
    signCtx.arc(px, py, 8, 0, Math.PI * 2);
    signCtx.fill();
    signCtx.fillStyle = '#3a2410';
    signCtx.textAlign = 'left';
    signCtx.fillText(label, px + 14, py + 4);
  };
  // Background — light green for grass, gray ellipse for stadium
  signCtx.fillStyle = '#c2dba5';
  signCtx.fillRect(24, 88, 720, 400);
  // Stadium silhouette
  signCtx.fillStyle = '#9a8e72';
  signCtx.beginPath();
  const [sx, sy] = worldToCanvas(110, 150);
  signCtx.ellipse(sx, sy, 200, 100, 0, 0, Math.PI * 2);
  signCtx.fill();
  signCtx.strokeStyle = '#7a5836';
  signCtx.lineWidth = 2;
  signCtx.stroke();
  // POIs (dot + label)
  drawPoi(110,  24, '#c14444', 'Plaza');
  drawPoi( 80,  50, '#3a6ea5', 'Monument');
  drawPoi(140,  50, '#3a8634', 'Fixtures');
  drawPoi(110, 150, '#e6c34a', 'Stadium');
  drawPoi(178, 105, '#d96bc4', 'Fan zone');
  drawPoi( 60,  85, '#7a7a7a', 'Press');
  signTex.update();
  const signFaceMat = new StandardMaterial('epoi-sign-face-mat', scene);
  signFaceMat.diffuseTexture = signTex;
  signFaceMat.emissiveTexture = signTex;
  signFaceMat.emissiveColor = new Color3(0.65, 0.65, 0.65);
  signFaceMat.specularColor = new Color3(0, 0, 0);
  const signFace = MeshBuilder.CreatePlane('epoi-sign-face', {
    width: SIGN_W, height: SIGN_H, sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  signFace.position.set(
    spCx + Math.cos(-0.4 + Math.PI / 2) * 0.10,
    2.5,
    spCz + Math.sin(-0.4 + Math.PI / 2) * 0.10,
  );
  signFace.rotation.y = -0.4;
  signFace.material = signFaceMat;
  meshes.push(signFace);

  // ── 5. FOOD COURT — relocated adjacent to the concession cluster ───────
  // Was at (175, 50) — isolated mid-east. Moved to (160, 20), east of
  // the existing concession cluster (146, 12) so the two form a
  // continuous "Food Avenue" instead of two separate isolated spots.
  const fcCx = 160, fcCz = 20;
  const fcPlot = MeshBuilder.CreateDisc('epoi-fc-plot', { radius: 6, tessellation: 24 }, scene);
  fcPlot.rotation.x = Math.PI / 2;
  fcPlot.position.set(fcCx, 0.03, fcCz);
  fcPlot.material = stone;
  fcPlot.isPickable = false;
  meshes.push(fcPlot);
  const truckColors = [red, blue, green];
  for (let i = 0; i < 3; i++) {
    const tx = fcCx + (i - 1) * 3.2;
    const tz = fcCz;
    // Truck body (box)
    const body = MeshBuilder.CreateBox(`epoi-fc-truck-${i}`, {
      width: 2.6, height: 1.6, depth: 1.4,
    }, scene);
    body.position.set(tx, 1.0, tz);
    body.material = truckColors[i];
    meshes.push(body);
    // Cab
    const cab = MeshBuilder.CreateBox(`epoi-fc-cab-${i}`, {
      width: 0.9, height: 1.0, depth: 1.2,
    }, scene);
    cab.position.set(tx + 1.2, 0.7, tz);
    cab.material = truckColors[i];
    meshes.push(cab);
    // Awning over the service window
    const truckAwning = MeshBuilder.CreateBox(`epoi-fc-awning-${i}`, {
      width: 2.0, height: 0.05, depth: 0.8,
    }, scene);
    truckAwning.position.set(tx - 0.2, 2.0, tz - 0.85);
    truckAwning.rotation.x = -0.18;
    truckAwning.material = white;
    meshes.push(truckAwning);
    // Wheels
    for (const wx of [tx - 0.9, tx + 0.9]) {
      const wheel = MeshBuilder.CreateCylinder(`epoi-fc-wheel-${i}-${wx}`, {
        height: 0.25, diameter: 0.5, tessellation: 10,
      }, scene);
      wheel.position.set(wx, 0.25, tz + 0.7);
      wheel.rotation.z = Math.PI / 2;
      wheel.material = charcoal;
      meshes.push(wheel);
    }
  }

  // ── 7. TROPHY REPLICA TENT — anchors the Trophy Walk cluster ──────────
  // Was at (200, 90) — isolated far east. Moved to (180, 45), close to
  // the trophy plaza (186, 60), the photo spot (186, 25), and the
  // mascot statue (195, 40) — together they form a coherent "Trophy
  // Walk" east of the plaza.
  const trCx = 180, trCz = 45;
  // 4 corner posts
  for (const [px, pz] of [[trCx - 2, trCz - 2], [trCx + 2, trCz - 2], [trCx - 2, trCz + 2], [trCx + 2, trCz + 2]] as Array<[number, number]>) {
    const post = MeshBuilder.CreateBox(`epoi-trophy-post-${px}-${pz}`, {
      width: 0.18, height: 3.0, depth: 0.18,
    }, scene);
    post.position.set(px, 1.5, pz);
    post.material = woodDark;
    meshes.push(post);
  }
  // Striped roof — single flat box
  const roof = MeshBuilder.CreateBox('epoi-trophy-roof', {
    width: 4.4, height: 0.2, depth: 4.4,
  }, scene);
  roof.position.set(trCx, 3.1, trCz);
  roof.material = red;
  meshes.push(roof);
  // Pedestal
  const ped = MeshBuilder.CreateCylinder('epoi-trophy-ped', {
    height: 1.4, diameterTop: 1.0, diameterBottom: 1.4, tessellation: 16,
  }, scene);
  ped.position.set(trCx, 0.7, trCz);
  ped.material = stone;
  meshes.push(ped);
  // Trophy — golden cup
  const cup = MeshBuilder.CreateCylinder('epoi-trophy-cup', {
    height: 0.9, diameterTop: 0.7, diameterBottom: 0.3, tessellation: 16,
  }, scene);
  cup.position.set(trCx, 1.85, trCz);
  cup.material = gold;
  meshes.push(cup);
  const cupBase = MeshBuilder.CreateCylinder('epoi-trophy-cup-base', {
    height: 0.2, diameter: 0.55, tessellation: 12,
  }, scene);
  cupBase.position.set(trCx, 1.3, trCz);
  cupBase.material = gold;
  meshes.push(cupBase);
  // Handles
  for (const sign of [-1, 1] as const) {
    const handle = MeshBuilder.CreateTorus(`epoi-trophy-handle-${sign}`, {
      diameter: 0.35, thickness: 0.06, tessellation: 12,
    }, scene);
    handle.position.set(trCx + sign * 0.42, 1.9, trCz);
    handle.rotation.y = Math.PI / 2;
    handle.material = gold;
    meshes.push(handle);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Festive decoration: lampposts scattered around the park + flag banners
// strung between poles near the stadium gate + balloon clusters at the
// plaza and the fixture board. Adds vertical interest, color, and a
// "lived-in / event day" atmosphere without taking up walkable space.
function buildFestiveDecor(scene: Scene): Mesh[] {
  const meshes: Mesh[] = [];
  const lampPoleMat = createStandardMaterial(scene, 'decor-lamp-pole', Color3.FromHexString('#383838'));
  const lampGlassMat = createStandardMaterial(scene, 'decor-lamp-glass', Color3.FromHexString('#fff5b0'));
  lampGlassMat.emissiveColor = new Color3(0.9, 0.8, 0.4);
  lampGlassMat.specularColor = new Color3(0, 0, 0);
  const poleMat = createStandardMaterial(scene, 'decor-pole-mat', Color3.FromHexString('#ededea'));
  // Country-flag colors for the banner strip — recognizable WC nations.
  const FLAG_COLORS = [
    '#74acdf', '#fce300',   // Argentina
    '#009b3a', '#fedf00',   // Brazil
    '#ce1126', '#ffffff',   // England-ish
    '#0055a4', '#ef4135',   // France
    '#000000', '#dd0000',   // Germany
    '#ff9900', '#ffffff',   // Netherlands
    '#aa151b', '#f1bf00',   // Spain
    '#171796', '#fefefe',   // Portugal
    '#ff0000', '#0064cb',   // Croatia
  ];
  const flagMats = FLAG_COLORS.map((hex, i) => createStandardMaterial(scene, `decor-flag-${i}`, Color3.FromHexString(hex)));

  // ── Lamppost helper — black pole + golden glowing globe on top.
  const buildLamppost = (x: number, z: number) => {
    const POLE_HEIGHT = 3.6;
    const pole = MeshBuilder.CreateCylinder(`decor-lamp-pole-${x}-${z}`, {
      height: POLE_HEIGHT, diameter: 0.16, tessellation: 8,
    }, scene);
    pole.position.set(x, POLE_HEIGHT / 2, z);
    pole.material = lampPoleMat;
    meshes.push(pole);
    // Decorative base (slightly wider at the bottom)
    const base = MeshBuilder.CreateCylinder(`decor-lamp-base-${x}-${z}`, {
      height: 0.3, diameterTop: 0.22, diameterBottom: 0.36, tessellation: 8,
    }, scene);
    base.position.set(x, 0.15, z);
    base.material = lampPoleMat;
    meshes.push(base);
    // Lamp globe
    const globe = MeshBuilder.CreateSphere(`decor-lamp-globe-${x}-${z}`, {
      diameter: 0.5, segments: 12,
    }, scene);
    globe.position.set(x, POLE_HEIGHT + 0.2, z);
    globe.material = lampGlassMat;
    meshes.push(globe);
    // Cap above the globe
    const cap = MeshBuilder.CreateCylinder(`decor-lamp-cap-${x}-${z}`, {
      height: 0.15, diameterTop: 0.1, diameterBottom: 0.35, tessellation: 8,
    }, scene);
    cap.position.set(x, POLE_HEIGHT + 0.5, z);
    cap.material = lampPoleMat;
    meshes.push(cap);
  };

  // Lampposts at the corners of the central plaza + along the spine
  // path leading to the stadium gate. Six total — enough for visual
  // rhythm without crowding.
  const lampPositions: Array<[number, number]> = [
    [102, 16], [118, 16],  // Plaza corners (SE / SW of centerpiece)
    [102, 32], [118, 32],  // Plaza corners (NE / NW)
    [110, 55], [110, 70],  // Along the spine to the stadium gate
  ];
  for (const [lx, lz] of lampPositions) buildLamppost(lx, lz);

  // ── Flag banner — two poles with a string of small flags between
  //    them, framing the path approach to the stadium gate. Sits
  //    visible from the central plaza looking north.
  const FLAG_BAR_Y = 4.8;
  const FLAG_BAR_X1 = 100, FLAG_BAR_X2 = 120;
  const FLAG_BAR_Z = 65;
  for (const px of [FLAG_BAR_X1, FLAG_BAR_X2]) {
    const flagPole = MeshBuilder.CreateCylinder(`decor-flagpole-${px}`, {
      height: FLAG_BAR_Y + 0.8, diameter: 0.18, tessellation: 8,
    }, scene);
    flagPole.position.set(px, (FLAG_BAR_Y + 0.8) / 2, FLAG_BAR_Z);
    flagPole.material = poleMat;
    meshes.push(flagPole);
    // Gold finial
    const finial = MeshBuilder.CreateSphere(`decor-flagpole-cap-${px}`, {
      diameter: 0.3, segments: 10,
    }, scene);
    finial.position.set(px, FLAG_BAR_Y + 0.95, FLAG_BAR_Z);
    finial.material = createStandardMaterial(scene, `decor-flagpole-finial-${px}`, Color3.FromHexString('#e6c34a'));
    meshes.push(finial);
  }
  // String of small triangle/rectangle flags hanging between the poles
  const numFlags = 14;
  for (let i = 0; i < numFlags; i++) {
    const t = (i + 0.5) / numFlags;
    const fx = FLAG_BAR_X1 + (FLAG_BAR_X2 - FLAG_BAR_X1) * t;
    // The string sags slightly in the middle — quadratic dip.
    const sag = 0.4 * Math.sin(t * Math.PI);
    const flag = MeshBuilder.CreateBox(`decor-flag-${i}`, {
      width: 0.55, height: 0.65, depth: 0.04,
    }, scene);
    flag.position.set(fx, FLAG_BAR_Y - 0.35 - sag, FLAG_BAR_Z);
    flag.material = flagMats[i % flagMats.length];
    meshes.push(flag);
  }

  // ── Balloon cluster — three balloons on strings tied to the
  //    centerpiece monument + another cluster near the fixture board
  //    (140, 50). Bright primary colors, floats above eye level.
  const BALLOON_COLORS = ['#e34141', '#3a6ea5', '#e6c34a', '#9bd96b', '#d96bc4'];
  const balloonMats = BALLOON_COLORS.map((hex, i) =>
    createStandardMaterial(scene, `decor-balloon-${i}`, Color3.FromHexString(hex)),
  );
  const stringMat = createStandardMaterial(scene, 'decor-balloon-string', Color3.FromHexString('#aaa'));
  const buildBalloonCluster = (cx: number, cz: number, anchorY: number) => {
    const offsets: Array<[number, number, number]> = [
      [-0.4, 4.2,  0.3],
      [ 0.4, 4.5, -0.2],
      [ 0.0, 5.0,  0.0],
    ];
    for (let i = 0; i < offsets.length; i++) {
      const [dx, dy, dz] = offsets[i];
      // Balloon — slightly elongated sphere
      const balloon = MeshBuilder.CreateSphere(`decor-balloon-${cx}-${cz}-${i}`, {
        diameter: 0.6, segments: 14,
      }, scene);
      balloon.position.set(cx + dx, dy, cz + dz);
      balloon.scaling.y = 1.15;
      balloon.material = balloonMats[(i + Math.floor(cx + cz)) % balloonMats.length];
      meshes.push(balloon);
      // Tiny tie at the bottom
      const tie = MeshBuilder.CreateCylinder(`decor-balloon-tie-${cx}-${cz}-${i}`, {
        height: 0.08, diameterTop: 0.04, diameterBottom: 0.08, tessellation: 6,
      }, scene);
      tie.position.set(cx + dx, dy - 0.36, cz + dz);
      tie.material = balloon.material;
      meshes.push(tie);
      // String — a thin tall cylinder from balloon down to anchor
      const stringLen = dy - 0.4 - anchorY;
      const stringMesh = MeshBuilder.CreateCylinder(`decor-balloon-string-${cx}-${cz}-${i}`, {
        height: stringLen, diameter: 0.02, tessellation: 4,
      }, scene);
      stringMesh.position.set(cx + dx * 0.4, anchorY + stringLen / 2, cz + dz * 0.4);
      stringMesh.material = stringMat;
      meshes.push(stringMesh);
    }
  };
  // Centerpiece monument — anchor at the gold ball atop the column (y≈3.3)
  buildBalloonCluster(110, 24, 3.3);
  // Fixture board — anchor at the topper above the board (y≈3.6)
  buildBalloonCluster(140, 51, 3.6);

  // ── Small picnic tables scattered in open grass areas to give
  //    eat-and-chat spots. Each is a top box + 2 bench planks +
  //    cross-leg pairs. Color and size unified for batch-friendliness.
  const tableTopMat = createStandardMaterial(scene, 'decor-picnic-top', Color3.FromHexString('#a07851'));
  const tableLegMat = createStandardMaterial(scene, 'decor-picnic-leg', Color3.FromHexString('#6b4628'));
  const buildPicnicTable = (cx: number, cz: number, rot: number) => {
    const root = new TransformNode(`decor-picnic-root-${cx}-${cz}`, scene);
    root.position.set(cx, 0, cz);
    root.rotation.y = rot;
    const place = (mesh: Mesh) => { mesh.parent = root; meshes.push(mesh); };
    // Top
    const top = MeshBuilder.CreateBox(`decor-picnic-top-${cx}-${cz}`, {
      width: 2.2, height: 0.08, depth: 0.9,
    }, scene);
    top.position.set(0, 0.75, 0);
    top.material = tableTopMat;
    place(top);
    // Benches on each side
    for (const sign of [-1, 1] as const) {
      const bench = MeshBuilder.CreateBox(`decor-picnic-bench-${cx}-${cz}-${sign}`, {
        width: 2.2, height: 0.05, depth: 0.3,
      }, scene);
      bench.position.set(0, 0.45, sign * 0.78);
      bench.material = tableTopMat;
      place(bench);
    }
    // Legs (4 X-frames)
    for (const lx of [-0.95, 0.95]) {
      const leg = MeshBuilder.CreateBox(`decor-picnic-leg-${cx}-${cz}-${lx}`, {
        width: 0.08, height: 0.75, depth: 1.5,
      }, scene);
      leg.position.set(lx, 0.375, 0);
      leg.material = tableLegMat;
      place(leg);
    }
  };
  buildPicnicTable(135, 25, 0);
  buildPicnicTable(150, 40, Math.PI / 4);
  buildPicnicTable( 88, 12, -Math.PI / 6);
  buildPicnicTable(170, 30, Math.PI / 3);

  return meshes;
}

function buildBench(scene: Scene, x: number, z: number, rotationY: number): Mesh[] {
  const meshes: Mesh[] = [];
  const woodMat = createStandardMaterial(scene, `bench-wood-${x}-${z}`, Color3.FromHexString('#8a6435'));
  const legMat = createStandardMaterial(scene, `bench-leg-${x}-${z}`, Color3.FromHexString('#383838'));

  const place = (mesh: Mesh, lx: number, ly: number, lz: number): void => {
    const wx = x + lx * Math.cos(rotationY) - lz * Math.sin(rotationY);
    const wz = z + lx * Math.sin(rotationY) + lz * Math.cos(rotationY);
    mesh.position.set(wx, ly, wz);
    mesh.rotation.y = rotationY;
  };

  const seat = MeshBuilder.CreateBox(`bench-seat-${x}-${z}`, {
    width: 1.6, height: 0.08, depth: 0.5,
  }, scene);
  place(seat, 0, 0.45, 0);
  seat.material = woodMat;
  meshes.push(seat);

  const back = MeshBuilder.CreateBox(`bench-back-${x}-${z}`, {
    width: 1.6, height: 0.55, depth: 0.07,
  }, scene);
  place(back, 0, 0.73, -0.22);
  back.material = woodMat;
  meshes.push(back);

  const legOffsets: Array<[number, number]> = [
    [-0.72, -0.18], [0.72, -0.18], [-0.72, 0.18], [0.72, 0.18],
  ];
  for (let i = 0; i < legOffsets.length; i++) {
    const [lx, lz] = legOffsets[i];
    const leg = MeshBuilder.CreateBox(`bench-leg-${x}-${z}-${i}`, {
      width: 0.08, height: 0.42, depth: 0.08,
    }, scene);
    place(leg, lx, 0.21, lz);
    leg.material = legMat;
    meshes.push(leg);
  }
  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Centerpiece: a championship football monument at the plaza center.
// Stone pedestal (3 stacked cylinders for base / column / cap) topped by
// a giant gold soccer ball with hex-patch detail.
function buildCenterpiece(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const stoneMat = createStandardMaterial(scene, 'cp-stone', Color3.FromHexString('#a9a59a'));
  const stoneAccentMat = createStandardMaterial(scene, 'cp-stone-accent', Color3.FromHexString('#7e7a70'));
  const goldMat = createStandardMaterial(scene, 'cp-gold', Color3.FromHexString('#e6c34a'));
  goldMat.specularColor = new Color3(0.9, 0.75, 0.3);
  goldMat.specularPower = 64;
  const darkMat = createStandardMaterial(scene, 'cp-dark', Color3.FromHexString('#2b2820'));

  // Base — wide drum
  const base = MeshBuilder.CreateCylinder('cp-base', {
    height: 0.35, diameterTop: 2.4, diameterBottom: 2.8, tessellation: 24,
  }, scene);
  base.position.set(cx, 0.175, cz);
  base.material = stoneMat;
  meshes.push(base);

  // Lower trim ring
  const trim1 = MeshBuilder.CreateCylinder('cp-trim-1', {
    height: 0.1, diameter: 2.3, tessellation: 24,
  }, scene);
  trim1.position.set(cx, 0.4, cz);
  trim1.material = stoneAccentMat;
  meshes.push(trim1);

  // Column
  const column = MeshBuilder.CreateCylinder('cp-column', {
    height: 1.6, diameter: 1.1, tessellation: 24,
  }, scene);
  column.position.set(cx, 1.25, cz);
  column.material = stoneMat;
  meshes.push(column);

  // Upper trim ring
  const trim2 = MeshBuilder.CreateCylinder('cp-trim-2', {
    height: 0.12, diameter: 1.3, tessellation: 24,
  }, scene);
  trim2.position.set(cx, 2.11, cz);
  trim2.material = stoneAccentMat;
  meshes.push(trim2);

  // Cap (slightly wider on top to receive the ball)
  const cap = MeshBuilder.CreateCylinder('cp-cap', {
    height: 0.3, diameterTop: 1.6, diameterBottom: 1.3, tessellation: 24,
  }, scene);
  cap.position.set(cx, 2.32, cz);
  cap.material = stoneMat;
  meshes.push(cap);

  // Gold ball
  const ball = MeshBuilder.CreateSphere('cp-ball', { diameter: 1.5, segments: 24 }, scene);
  ball.position.set(cx, 3.3, cz);
  ball.material = goldMat;
  meshes.push(ball);

  // Football panel pattern — small dark hex-shaped patches on the ball.
  // Each patch is a small disc, slightly offset OUTWARD from the ball
  // center so it sits flush with the sphere's surface.
  const patchPositions: Array<[number, number]> = [
    [0,         0],
    [Math.PI / 3,        Math.PI / 4],
    [-Math.PI / 3,      -Math.PI / 4],
    [2 * Math.PI / 3,    Math.PI / 4],
    [-2 * Math.PI / 3,  -Math.PI / 4],
    [Math.PI,             0],
  ];
  const ballRadius = 0.75;
  const patchOffset = ballRadius + 0.005;
  for (let i = 0; i < patchPositions.length; i++) {
    const [longitude, latitude] = patchPositions[i];
    const px = cx + Math.cos(latitude) * Math.cos(longitude) * patchOffset;
    const py = 3.3 + Math.sin(latitude) * patchOffset;
    const pz = cz + Math.cos(latitude) * Math.sin(longitude) * patchOffset;
    const patch = MeshBuilder.CreateDisc(`cp-patch-${i}`, { radius: 0.18, tessellation: 6 }, scene);
    patch.position.set(px, py, pz);
    // Make the disc face outward from the ball center.
    patch.lookAt(new Vector3(cx + (px - cx) * 100, 3.3 + (py - 3.3) * 100, cz + (pz - cz) * 100));
    patch.material = darkMat;
    meshes.push(patch);
  }

  // Plaque on the front of the pedestal
  const plaque = MeshBuilder.CreateBox('cp-plaque', {
    width: 0.8, height: 0.5, depth: 0.05,
  }, scene);
  plaque.position.set(cx, 1.25, cz - 0.58);
  plaque.material = stoneAccentMat;
  meshes.push(plaque);

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Soccer practice field — a striped grass pitch with two goalposts. The
// pitch surface is just a flat box; the goals are simple frame meshes
// at each short end. Centered on (cx, cz). Pitch span: ~20 × 28 units.
function buildSoccerField(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const turfMat = createStandardMaterial(scene, 'soccer-turf-mat', Color3.FromHexString('#3e8a3a'));
  const lineMat = createStandardMaterial(scene, 'soccer-line-mat', Color3.FromHexString('#f4f4ee'));
  const goalMat = createStandardMaterial(scene, 'soccer-goal-mat', Color3.FromHexString('#f4f4ee'));

  // Pitch (slightly above ground so it doesn't z-fight)
  const pitch = MeshBuilder.CreateBox('soccer-pitch', {
    width: 18, height: 0.05, depth: 26,
  }, scene);
  pitch.position.set(cx, 0.03, cz);
  pitch.material = turfMat;
  pitch.isPickable = false;
  meshes.push(pitch);

  // Border lines — thin white strips along the pitch outline
  const borderSpec: Array<[number, number, number, number]> = [
    // [w, d, dx, dz] relative to pitch center
    [18, 0.2,  0,  13],   // long line, far end
    [18, 0.2,  0, -13],   // long line, near end
    [0.2, 26,  9,   0],   // side line, +X
    [0.2, 26, -9,   0],   // side line, -X
    [18, 0.2,  0,   0],   // center line
  ];
  for (let i = 0; i < borderSpec.length; i++) {
    const [w, d, dx, dz] = borderSpec[i];
    const line = MeshBuilder.CreateBox(`soccer-line-${i}`, {
      width: w, height: 0.03, depth: d,
    }, scene);
    line.position.set(cx + dx, 0.06, cz + dz);
    line.material = lineMat;
    line.isPickable = false;
    meshes.push(line);
  }

  // Center circle
  const centerCircle = MeshBuilder.CreateTorus('soccer-center-circle', {
    diameter: 5, thickness: 0.18, tessellation: 32,
  }, scene);
  centerCircle.position.set(cx, 0.05, cz);
  centerCircle.material = lineMat;
  centerCircle.isPickable = false;
  meshes.push(centerCircle);

  // Two goals — one on each short end (+Z and -Z from center).
  for (const sign of [1, -1] as const) {
    const goalZ = cz + sign * 13.4;
    // Crossbar
    const crossbar = MeshBuilder.CreateBox(`soccer-goal-${sign}-crossbar`, {
      width: 5, height: 0.15, depth: 0.15,
    }, scene);
    crossbar.position.set(cx, 2.2, goalZ);
    crossbar.material = goalMat;
    meshes.push(crossbar);

    // Left + right posts
    for (const px of [-2.4, 2.4]) {
      const post = MeshBuilder.CreateCylinder(`soccer-goal-${sign}-post-${px}`, {
        height: 2.3, diameter: 0.18, tessellation: 8,
      }, scene);
      post.position.set(cx + px, 1.15, goalZ);
      post.material = goalMat;
      meshes.push(post);
    }
    // Back depth posts (forming the rectangular goal box from above)
    for (const px of [-2.4, 2.4]) {
      const backPost = MeshBuilder.CreateCylinder(`soccer-goal-${sign}-back-${px}`, {
        height: 2.3, diameter: 0.15, tessellation: 8,
      }, scene);
      backPost.position.set(cx + px, 1.15, goalZ + sign * 1.0);
      backPost.material = goalMat;
      meshes.push(backPost);
    }
    // Back crossbar
    const backCrossbar = MeshBuilder.CreateBox(`soccer-goal-${sign}-back-crossbar`, {
      width: 5, height: 0.12, depth: 0.12,
    }, scene);
    backCrossbar.position.set(cx, 2.2, goalZ + sign * 1.0);
    backCrossbar.material = goalMat;
    meshes.push(backCrossbar);
  }

  // ─── Soccer ball at the center spot ──────────────────────────────────
  // Static visual for now — a small black-and-white football sitting at
  // the kickoff circle. Players walk through it (no physics body). True
  // multiplayer-kickable would need server-authoritative ball state and
  // collision impulses, which is a follow-up.
  const ballWhiteMat = createStandardMaterial(scene, 'soccer-ball-white-mat', Color3.FromHexString('#f8f8f4'));
  const ballDarkMat = createStandardMaterial(scene, 'soccer-ball-dark-mat', Color3.FromHexString('#222020'));
  const ballRadius = 0.28;
  const ballY = ballRadius;
  const ball = MeshBuilder.CreateSphere('soccer-ball', {
    diameter: ballRadius * 2, segments: 20,
  }, scene);
  ball.position.set(cx, ballY, cz);
  ball.material = ballWhiteMat;
  meshes.push(ball);

  // Six dark hex patches around the ball surface — same technique as
  // the centerpiece monument football.
  const patchPositions: Array<[number, number]> = [
    [0,                  0],
    [Math.PI / 3,        Math.PI / 4],
    [-Math.PI / 3,      -Math.PI / 4],
    [2 * Math.PI / 3,    Math.PI / 4],
    [-2 * Math.PI / 3,  -Math.PI / 4],
    [Math.PI,            0],
  ];
  const patchOffset = ballRadius + 0.005;
  for (let i = 0; i < patchPositions.length; i++) {
    const [lon, lat] = patchPositions[i];
    const px = cx + Math.cos(lat) * Math.cos(lon) * patchOffset;
    const py = ballY + Math.sin(lat) * patchOffset;
    const pz = cz + Math.cos(lat) * Math.sin(lon) * patchOffset;
    const patch = MeshBuilder.CreateDisc(`soccer-ball-patch-${i}`, { radius: 0.07, tessellation: 6 }, scene);
    patch.position.set(px, py, pz);
    patch.lookAt(new Vector3(cx + (px - cx) * 100, ballY + (py - ballY) * 100, cz + (pz - cz) * 100));
    patch.material = ballDarkMat;
    meshes.push(patch);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stadium entrance gate — a substantial arched gateway built INTO the
// stadium's south wall. Two tall pylons flank a wide arched lintel + a
// gold-trimmed banner. Sits at z = stadium_center_z - stadium_bz (right
// at the outer wall surface), centered east-west on the stadium midline.
// Players walking up the north spine path arrive AT the gate, then pass
// through it — the angular keep-out gap in the wall band lets them
// transit invisibly. Visually telegraphs "this is the way in".
function buildStadiumGate(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const pylonMat = createStandardMaterial(scene, 'gate-pylon-mat', Color3.FromHexString('#ededea'));
  const accentMat = createStandardMaterial(scene, 'gate-accent-mat', Color3.FromHexString('#3a6ea5'));
  const goldMat = createStandardMaterial(scene, 'gate-gold-mat', Color3.FromHexString('#e6c34a'));
  const stoneMat = createStandardMaterial(scene, 'gate-stone-mat', Color3.FromHexString('#c2b294'));

  // Pylons sized to FULLY COVER the wall opening (no visible sky gap
  // between pylon and wall edge). Wall opening half-chord at the
  // south face = ax * sin(GATE_HALF_ANGLE) = 98 * sin(0.063) ≈ 6.16.
  // Pylon outer edge = pylonHalfSpan + pylonWidth/2 = 4.9 + 1.3 = 6.2.
  // Very slight overlap so adjacency reads as continuous.
  const pylonHeight = 7;
  const pylonHalfSpan = 4.9;
  const pylonWidth = 2.6;
  for (const sign of [-1, 1] as const) {
    const pylon = MeshBuilder.CreateBox(`gate-pylon-${sign}`, {
      width: pylonWidth, height: pylonHeight, depth: 2.0,
    }, scene);
    pylon.position.set(cx + sign * pylonHalfSpan, pylonHeight / 2, cz);
    pylon.material = pylonMat;
    meshes.push(pylon);

    // Stone base ring at the bottom of each pylon
    const baseRing = MeshBuilder.CreateBox(`gate-base-${sign}`, {
      width: pylonWidth + 0.5, height: 0.4, depth: 2.5,
    }, scene);
    baseRing.position.set(cx + sign * pylonHalfSpan, 0.2, cz);
    baseRing.material = stoneMat;
    meshes.push(baseRing);

    // Gold cap on each pylon
    const cap = MeshBuilder.CreateCylinder(`gate-cap-${sign}`, {
      height: 0.35, diameterTop: 1.2, diameterBottom: 2.4, tessellation: 12,
    }, scene);
    cap.position.set(cx + sign * pylonHalfSpan, pylonHeight + 0.18, cz);
    cap.material = goldMat;
    meshes.push(cap);
  }

  // Lintel spans both pylons including their widths.
  const lintelW = (pylonHalfSpan * 2) + pylonWidth;  // 12.4
  const lintel = MeshBuilder.CreateBox('gate-lintel', {
    width: lintelW, height: 1.6, depth: 0.9,
  }, scene);
  lintel.position.set(cx, pylonHeight - 0.3, cz);
  lintel.material = accentMat;
  meshes.push(lintel);

  // Gold trim across the top of the lintel
  const lintelTrim = MeshBuilder.CreateBox('gate-lintel-trim', {
    width: lintelW + 0.3, height: 0.3, depth: 1.05,
  }, scene);
  lintelTrim.position.set(cx, pylonHeight + 0.65, cz);
  lintelTrim.material = goldMat;
  meshes.push(lintelTrim);

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal gate — modelled on a team-emergence tunnel at the base of
// stadium stands. Two stout pillars frame a deep recessed dark opening
// (the "tunnel mouth"), with the game's cover image hung inside the
// recess. Players walk up to the front of the field-facing tunnel
// mouth; HUD prompts on proximity; G key redirects to portal.url.
function buildPortalGate(scene: Scene, portal: PortalGate): Mesh[] {
  const meshes: Mesh[] = [];
  const stoneMat = createStandardMaterial(scene, `portal-stone-${portal.id}`, Color3.FromHexString('#b8aa90'));
  const trimMat = createStandardMaterial(scene, `portal-trim-${portal.id}`, Color3.FromHexString('#e6c34a'));
  const tunnelMat = createStandardMaterial(scene, `portal-tunnel-${portal.id}`, Color3.FromHexString('#181410'));
  tunnelMat.specularColor = new Color3(0, 0, 0);

  // Build locally with the tunnel facing +Z (cover visible from +Z),
  // then rotate so it faces `portal.facing` in world coords.
  const root = new TransformNode(`portal-root-${portal.id}`, scene);
  root.position.set(portal.x, 0, portal.z);
  // facing=0 means the cover faces world +X. Local geometry faces +Z,
  // so we rotate by (facing - π/2) around Y.
  root.rotation.y = -portal.facing + Math.PI / 2;

  // ── Dimensions — flat-frame portal: 5 wide, 4.5 tall, only 0.4 deep.
  // Old version had a 1.4-unit-deep tunnel recess with a roof + back
  // wall, which from oblique camera angles occluded the cover poster.
  // Now everything is shallow + flat: two pillars + lintel + cover
  // plane between them, with a thin dark backdrop directly behind the
  // poster to give it contrast without hiding it.
  const mouthW = 5.0;
  const mouthH = 4.5;
  const pillarW = 1.0;
  const pillarD = 0.5;

  // Two stone pillars flanking the mouth — shallow now so they don't
  // protrude in front of the cover plane from side angles.
  for (const sign of [-1, 1] as const) {
    const pillar = MeshBuilder.CreateBox(`portal-pillar-${portal.id}-${sign}`, {
      width: pillarW, height: mouthH, depth: pillarD,
    }, scene);
    pillar.position.set(sign * (mouthW / 2 + pillarW / 2), mouthH / 2, 0);
    pillar.material = stoneMat;
    pillar.parent = root;
    meshes.push(pillar);
  }

  // Lintel across the top
  const lintelW = mouthW + 2 * pillarW + 0.4;
  const lintel = MeshBuilder.CreateBox(`portal-lintel-${portal.id}`, {
    width: lintelW, height: 0.9, depth: pillarD,
  }, scene);
  lintel.position.set(0, mouthH + 0.45, 0);
  lintel.material = stoneMat;
  lintel.parent = root;
  meshes.push(lintel);

  // Gold trim band under the lintel
  const trim = MeshBuilder.CreateBox(`portal-trim-${portal.id}`, {
    width: lintelW + 0.2, height: 0.18, depth: pillarD + 0.1,
  }, scene);
  trim.position.set(0, mouthH - 0.05, 0);
  trim.material = trimMat;
  trim.parent = root;
  meshes.push(trim);

  // Thin dark backdrop directly BEHIND the poster — gives the bright
  // cover image edge contrast without forming a recess that would
  // occlude it from oblique angles. Sits 0.1 units behind the cover.
  const coverW = mouthW - 0.2;
  const coverH = mouthH - 0.7;
  const backdrop = MeshBuilder.CreateBox(`portal-backdrop-${portal.id}`, {
    width: coverW + 0.15, height: coverH + 0.15, depth: 0.08,
  }, scene);
  backdrop.position.set(0, mouthH / 2 - 0.1, -0.05);
  backdrop.material = tunnelMat;
  backdrop.parent = root;
  meshes.push(backdrop);

  // ── Cover image — flat plane between the pillars, in FRONT of the
  // backdrop. Emissive so it stays readable in any light.
  const coverMat = new StandardMaterial(`portal-cover-mat-${portal.id}`, scene);
  const coverTex = new Texture(ASSETS[portal.cover], scene, /* noMipmap */ false, /* invertY */ true);
  coverTex.anisotropicFilteringLevel = 8;
  coverMat.diffuseTexture = coverTex;
  coverMat.emissiveTexture = coverTex;
  coverMat.emissiveColor = new Color3(0.6, 0.6, 0.6);
  coverMat.specularColor = new Color3(0, 0, 0);
  coverMat.backFaceCulling = false;
  const cover = MeshBuilder.CreatePlane(`portal-cover-${portal.id}`, {
    width: coverW, height: coverH, sideOrientation: Mesh.DOUBLESIDE,
  }, scene);
  cover.position.set(0, mouthH / 2 - 0.1, 0.02);
  cover.material = coverMat;
  cover.parent = root;
  meshes.push(cover);

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// REMOVED: buildStadiumPitch — the interior soccer pitch was removed
// at the user's request so the stadium interior is now empty space
// (just the ground texture showing through, double-sided wall enclosing
// it). Players still walk in through the south gate but the inside is
// a blank arena that future events / mini-games can fill.
// The function definition below is kept commented-out as a reference
// in case the pitch needs to come back later.
/* function _DELETED_buildStadiumPitch(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const turfMat = createStandardMaterial(scene, 'stadium-pitch-turf-mat', Color3.FromHexString('#3a8634'));
  const lineMat = createStandardMaterial(scene, 'stadium-pitch-line-mat', Color3.FromHexString('#f4f4ee'));
  const goalMat = createStandardMaterial(scene, 'stadium-pitch-goal-mat', Color3.FromHexString('#f4f4ee'));

  const pitchW = 100;
  const pitchD = 60;

  const pitch = MeshBuilder.CreateBox('stadium-pitch', {
    width: pitchW, height: 0.06, depth: pitchD,
  }, scene);
  pitch.position.set(cx, 0.04, cz);
  pitch.material = turfMat;
  pitch.isPickable = false;
  meshes.push(pitch);

  // Field lines — long edges, short edges, halfway line
  const halfW = pitchW / 2;
  const halfD = pitchD / 2;
  const lineY = 0.075;
  const lineWidth = 0.4;
  const borderSpec: Array<[number, number, number, number]> = [
    // [w, d, dx, dz] relative to pitch center
    [pitchW, lineWidth,  0,  halfD],
    [pitchW, lineWidth,  0, -halfD],
    [lineWidth, pitchD,  halfW,  0],
    [lineWidth, pitchD, -halfW,  0],
    [pitchW, lineWidth,  0,  0],  // halfway line
  ];
  for (let i = 0; i < borderSpec.length; i++) {
    const [w, d, dx, dz] = borderSpec[i];
    const line = MeshBuilder.CreateBox(`stadium-pitch-line-${i}`, {
      width: w, height: 0.05, depth: d,
    }, scene);
    line.position.set(cx + dx, lineY, cz + dz);
    line.material = lineMat;
    line.isPickable = false;
    meshes.push(line);
  }

  // Center circle (torus)
  const centerCircle = MeshBuilder.CreateTorus('stadium-pitch-center-circle', {
    diameter: 12, thickness: 0.35, tessellation: 40,
  }, scene);
  centerCircle.position.set(cx, lineY, cz);
  centerCircle.material = lineMat;
  centerCircle.isPickable = false;
  meshes.push(centerCircle);

  // Two goals — one at each short end
  for (const sign of [1, -1] as const) {
    const goalZ = cz + sign * (halfD - 0.5);
    // Crossbar
    const crossbar = MeshBuilder.CreateBox(`stadium-pitch-goal-${sign}-crossbar`, {
      width: 9, height: 0.25, depth: 0.25,
    }, scene);
    crossbar.position.set(cx, 4.0, goalZ);
    crossbar.material = goalMat;
    meshes.push(crossbar);
    // Posts (L + R, front + back)
    for (const px of [-4.4, 4.4]) {
      const post = MeshBuilder.CreateCylinder(`stadium-pitch-goal-${sign}-post-${px}`, {
        height: 4.0, diameter: 0.3, tessellation: 10,
      }, scene);
      post.position.set(cx + px, 2.0, goalZ);
      post.material = goalMat;
      meshes.push(post);
    }
    // Back depth posts
    for (const px of [-4.4, 4.4]) {
      const back = MeshBuilder.CreateCylinder(`stadium-pitch-goal-${sign}-back-${px}`, {
        height: 4.0, diameter: 0.25, tessellation: 10,
      }, scene);
      back.position.set(cx + px, 2.0, goalZ + sign * 1.8);
      back.material = goalMat;
      meshes.push(back);
    }
    // Back crossbar
    const backBar = MeshBuilder.CreateBox(`stadium-pitch-goal-${sign}-back-crossbar`, {
      width: 9, height: 0.2, depth: 0.2,
    }, scene);
    backBar.position.set(cx, 4.0, goalZ + sign * 1.8);
    backBar.material = goalMat;
    meshes.push(backBar);
  }

  // Center spot ball
  const ballWhite = createStandardMaterial(scene, 'stadium-pitch-ball-white', Color3.FromHexString('#f8f8f4'));
  const ballDark = createStandardMaterial(scene, 'stadium-pitch-ball-dark', Color3.FromHexString('#222020'));
  const ballR = 0.45;
  const ball = MeshBuilder.CreateSphere('stadium-pitch-ball', { diameter: ballR * 2, segments: 22 }, scene);
  ball.position.set(cx, ballR, cz);
  ball.material = ballWhite;
  meshes.push(ball);
  const patchPos: Array<[number, number]> = [
    [0, 0], [Math.PI / 3, Math.PI / 4], [-Math.PI / 3, -Math.PI / 4],
    [2 * Math.PI / 3, Math.PI / 4], [-2 * Math.PI / 3, -Math.PI / 4], [Math.PI, 0],
  ];
  for (let i = 0; i < patchPos.length; i++) {
    const [lon, lat] = patchPos[i];
    const px = cx + Math.cos(lat) * Math.cos(lon) * (ballR + 0.005);
    const py = ballR + Math.sin(lat) * (ballR + 0.005);
    const pz = cz + Math.cos(lat) * Math.sin(lon) * (ballR + 0.005);
    const patch = MeshBuilder.CreateDisc(`stadium-pitch-ball-patch-${i}`, { radius: 0.11, tessellation: 6 }, scene);
    patch.position.set(px, py, pz);
    patch.lookAt(new Vector3(cx + (px - cx) * 100, ballR + (py - ballR) * 100, cz + (pz - cz) * 100));
    patch.material = ballDark;
    meshes.push(patch);
  }

  return meshes;
} */

// ─────────────────────────────────────────────────────────────────────────────
// Park fence: a low wooden boundary that traces the playable-area
// rectangle. Each side is ONE long thin box (cheap to render) with
// regularly-spaced posts on top for shape. The fence is purely visual —
// the actual clamp happens server-side via gameConfig.world bounds and
// the movePlayer wall logic. Placed JUST INSIDE the world boundary so
// the player never sees a fence beyond their walkable area.
function buildParkFence(scene: Scene, x0: number, z0: number, x1: number, z1: number): Mesh[] {
  const meshes: Mesh[] = [];
  const railMat = createStandardMaterial(scene, 'fence-rail-mat', Color3.FromHexString('#8a6435'));
  const postMat = createStandardMaterial(scene, 'fence-post-mat', Color3.FromHexString('#6b4e26'));

  const RAIL_HEIGHT = 1.1;
  const RAIL_THICK = 0.18;
  const POST_SIZE = 0.32;
  const POST_HEIGHT = 1.4;
  const POST_SPACING = 8;

  // 4 long rail boxes — one per edge. Width/depth swap depending on the
  // axis the edge runs along. Centered on each edge, raised so the
  // bottom of the rail sits on the ground.
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const xLen = x1 - x0;
  const zLen = z1 - z0;
  const railY = RAIL_HEIGHT / 2;

  // South rail (z = z0)
  const sRail = MeshBuilder.CreateBox('fence-rail-s', { width: xLen, height: RAIL_HEIGHT, depth: RAIL_THICK }, scene);
  sRail.position.set(cx, railY, z0);
  sRail.material = railMat;
  meshes.push(sRail);

  // North rail (z = z1)
  const nRail = MeshBuilder.CreateBox('fence-rail-n', { width: xLen, height: RAIL_HEIGHT, depth: RAIL_THICK }, scene);
  nRail.position.set(cx, railY, z1);
  nRail.material = railMat;
  meshes.push(nRail);

  // West rail (x = x0)
  const wRail = MeshBuilder.CreateBox('fence-rail-w', { width: RAIL_THICK, height: RAIL_HEIGHT, depth: zLen }, scene);
  wRail.position.set(x0, railY, cz);
  wRail.material = railMat;
  meshes.push(wRail);

  // East rail (x = x1)
  const eRail = MeshBuilder.CreateBox('fence-rail-e', { width: RAIL_THICK, height: RAIL_HEIGHT, depth: zLen }, scene);
  eRail.position.set(x1, railY, cz);
  eRail.material = railMat;
  meshes.push(eRail);

  // Posts every POST_SPACING along each edge — square caps on top of
  // the rail, so the boundary reads as a built fence, not a flat panel.
  const postY = POST_HEIGHT / 2;
  // South + North posts (vary x, fix z to z0 / z1)
  for (let x = x0; x <= x1; x += POST_SPACING) {
    for (const z of [z0, z1]) {
      const post = MeshBuilder.CreateBox(`fence-post-x${x}-z${z}`, {
        width: POST_SIZE, height: POST_HEIGHT, depth: POST_SIZE,
      }, scene);
      post.position.set(x, postY, z);
      post.material = postMat;
      meshes.push(post);
    }
  }
  // West + East posts (vary z, fix x to x0 / x1), skip the corners
  // already covered by the south/north loops above.
  for (let z = z0 + POST_SPACING; z < z1; z += POST_SPACING) {
    for (const x of [x0, x1]) {
      const post = MeshBuilder.CreateBox(`fence-post-x${x}-z${z}`, {
        width: POST_SIZE, height: POST_HEIGHT, depth: POST_SIZE,
      }, scene);
      post.position.set(x, postY, z);
      post.material = postMat;
      meshes.push(post);
    }
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concession-stand cluster: 4 small food carts ringed around a central
// open paved square. Each cart has a counter, peaked striped awning, a
// flag, and a slightly different color to read as a festival row.
function buildConcessionCluster(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const paveMat = createStandardMaterial(scene, 'concession-pave-mat', Color3.FromHexString('#d3b88a'));
  const counterMat = createStandardMaterial(scene, 'concession-counter-mat', Color3.FromHexString('#a07851'));
  const postMat = createStandardMaterial(scene, 'concession-post-mat', Color3.FromHexString('#6b4628'));

  // Central paved square (a slightly larger plaza for the cluster)
  const plazaSquare = MeshBuilder.CreateBox('concession-plaza', {
    width: 10, height: 0.05, depth: 10,
  }, scene);
  plazaSquare.position.set(cx, 0.025, cz);
  plazaSquare.material = paveMat;
  plazaSquare.isPickable = false;
  meshes.push(plazaSquare);

  // Four carts at the cardinal directions of the plaza
  const cartColors = ['#d96b6b', '#e8c84a', '#3a6ea5', '#9bd96b'];
  const cartOffsets: Array<[number, number, number]> = [
    [ 0,  4.5, Math.PI],     // N edge, facing south
    [ 4.5, 0, -Math.PI / 2], // E edge, facing west
    [ 0, -4.5, 0],           // S edge, facing north
    [-4.5, 0,  Math.PI / 2], // W edge, facing east
  ];
  for (let i = 0; i < 4; i++) {
    const [dx, dz, facing] = cartOffsets[i];
    const cartX = cx + dx;
    const cartZ = cz + dz;
    const awningMat = createStandardMaterial(scene, `concession-${i}-awn-mat`, Color3.FromHexString(cartColors[i]));
    const trimMat = createStandardMaterial(scene, `concession-${i}-trim-mat`, Color3.FromHexString('#f4ecd9'));
    const root = new TransformNode(`concession-${i}-root`, scene);
    root.position.set(cartX, 0, cartZ);
    root.rotation.y = facing;

    // Counter
    const counter = MeshBuilder.CreateBox(`concession-${i}-counter`, {
      width: 1.8, height: 0.9, depth: 0.6,
    }, scene);
    counter.parent = root;
    counter.position.set(0, 0.45, 0);
    counter.material = counterMat;
    meshes.push(counter);
    // Counter top
    const top = MeshBuilder.CreateBox(`concession-${i}-counter-top`, {
      width: 2.0, height: 0.06, depth: 0.7,
    }, scene);
    top.parent = root;
    top.position.set(0, 0.93, 0);
    top.material = trimMat;
    meshes.push(top);

    // Two posts
    for (const sign of [-1, 1] as const) {
      const post = MeshBuilder.CreateBox(`concession-${i}-post-${sign}`, {
        width: 0.1, height: 2.2, depth: 0.1,
      }, scene);
      post.parent = root;
      post.position.set(sign * 0.85, 1.1, 0.05);
      post.material = postMat;
      meshes.push(post);
    }

    // Peaked awning (two slanted panels)
    for (const sign of [-1, 1] as const) {
      const panel = MeshBuilder.CreateBox(`concession-${i}-roof-${sign}`, {
        width: 2.2, height: 0.07, depth: 0.7,
      }, scene);
      panel.parent = root;
      panel.position.set(0, 2.35, sign * 0.25);
      panel.rotation.x = sign * 0.55;
      panel.material = awningMat;
      meshes.push(panel);
    }
    // Ridge cap
    const ridge = MeshBuilder.CreateBox(`concession-${i}-ridge`, {
      width: 2.25, height: 0.08, depth: 0.1,
    }, scene);
    ridge.parent = root;
    ridge.position.set(0, 2.62, 0);
    ridge.material = trimMat;
    meshes.push(ridge);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trophy plaza: a small paved disc with a giant championship trophy in
// the middle and four smaller pedestals (one per cardinal direction)
// holding mini-trophies — like a winners' display.
function buildTrophyPlaza(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const paveMat = createStandardMaterial(scene, 'trophy-plaza-pave-mat', Color3.FromHexString('#d8c5a4'));
  const stoneMat = createStandardMaterial(scene, 'trophy-stone-mat', Color3.FromHexString('#9c968b'));
  const goldMat = createStandardMaterial(scene, 'trophy-gold-mat', Color3.FromHexString('#e8c84a'));
  goldMat.specularColor = new Color3(0.9, 0.75, 0.3);
  goldMat.specularPower = 64;
  const silverMat = createStandardMaterial(scene, 'trophy-silver-mat', Color3.FromHexString('#c8c8d0'));
  silverMat.specularColor = new Color3(0.7, 0.7, 0.75);

  // Paved disc base
  const disc = MeshBuilder.CreateDisc('trophy-plaza-disc', {
    radius: 6, tessellation: 32,
  }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(cx, 0.02, cz);
  disc.material = paveMat;
  disc.isPickable = false;
  meshes.push(disc);

  // Central tall pedestal + giant trophy
  const ped = MeshBuilder.CreateCylinder('trophy-main-pedestal', {
    height: 1.8, diameterTop: 1.4, diameterBottom: 1.6, tessellation: 24,
  }, scene);
  ped.position.set(cx, 0.9, cz);
  ped.material = stoneMat;
  meshes.push(ped);

  // Trophy: cup + handles + base ring + stem
  const trophyStem = MeshBuilder.CreateCylinder('trophy-main-stem', {
    height: 0.6, diameter: 0.4, tessellation: 16,
  }, scene);
  trophyStem.position.set(cx, 2.1, cz);
  trophyStem.material = goldMat;
  meshes.push(trophyStem);

  const trophyBaseRing = MeshBuilder.CreateCylinder('trophy-main-baseRing', {
    height: 0.18, diameter: 0.95, tessellation: 16,
  }, scene);
  trophyBaseRing.position.set(cx, 1.89, cz);
  trophyBaseRing.material = goldMat;
  meshes.push(trophyBaseRing);

  const cup = MeshBuilder.CreateCylinder('trophy-main-cup', {
    height: 1.2, diameterTop: 1.3, diameterBottom: 0.7, tessellation: 24,
  }, scene);
  cup.position.set(cx, 3.0, cz);
  cup.material = goldMat;
  meshes.push(cup);

  // Two handles (toruses on the side of the cup)
  for (const sign of [-1, 1] as const) {
    const handle = MeshBuilder.CreateTorus(`trophy-main-handle-${sign}`, {
      diameter: 0.55, thickness: 0.1, tessellation: 16,
    }, scene);
    handle.position.set(cx + sign * 0.75, 3.0, cz);
    handle.rotation.z = Math.PI / 2;
    handle.material = goldMat;
    meshes.push(handle);
  }

  // Cup top — a small ring + cap to give the trophy a finished look
  const cupTop = MeshBuilder.CreateTorus('trophy-main-rim', {
    diameter: 1.3, thickness: 0.08, tessellation: 24,
  }, scene);
  cupTop.position.set(cx, 3.6, cz);
  cupTop.material = goldMat;
  meshes.push(cupTop);

  // Four smaller pedestals + mini-trophies around the main one
  const surroundOffsets: Array<[number, number]> = [
    [0, 3.5], [3.5, 0], [0, -3.5], [-3.5, 0],
  ];
  for (let i = 0; i < surroundOffsets.length; i++) {
    const [dx, dz] = surroundOffsets[i];
    const px = cx + dx;
    const pz = cz + dz;
    const sped = MeshBuilder.CreateCylinder(`trophy-small-pedestal-${i}`, {
      height: 1.0, diameter: 0.7, tessellation: 16,
    }, scene);
    sped.position.set(px, 0.5, pz);
    sped.material = stoneMat;
    meshes.push(sped);

    // Mini trophy on top — silver for variety
    const miniMat = i % 2 === 0 ? silverMat : goldMat;
    const miniBase = MeshBuilder.CreateCylinder(`trophy-mini-base-${i}`, {
      height: 0.18, diameter: 0.5, tessellation: 12,
    }, scene);
    miniBase.position.set(px, 1.1, pz);
    miniBase.material = miniMat;
    meshes.push(miniBase);

    const miniCup = MeshBuilder.CreateCylinder(`trophy-mini-cup-${i}`, {
      height: 0.5, diameterTop: 0.5, diameterBottom: 0.3, tessellation: 12,
    }, scene);
    miniCup.position.set(px, 1.5, pz);
    miniCup.material = miniMat;
    meshes.push(miniCup);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo selfie spot: a giant freestanding jersey-shaped backdrop (just a
// big rectangle frame), a circular pavement disc to stand on for the
// shot, and a comically oversized soccer ball next to the frame.
function buildPhotoSpot(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const paveMat = createStandardMaterial(scene, 'photo-pave-mat', Color3.FromHexString('#e7d8b4'));
  const frameMat = createStandardMaterial(scene, 'photo-frame-mat', Color3.FromHexString('#3a6ea5'));
  const frameAccentMat = createStandardMaterial(scene, 'photo-frame-accent-mat', Color3.FromHexString('#f4f4ee'));
  const ballWhiteMat = createStandardMaterial(scene, 'photo-ball-white-mat', Color3.FromHexString('#f8f8f4'));
  const ballDarkMat = createStandardMaterial(scene, 'photo-ball-dark-mat', Color3.FromHexString('#222020'));

  // Standing disc
  const disc = MeshBuilder.CreateDisc('photo-disc', {
    radius: 3, tessellation: 24,
  }, scene);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(cx, 0.02, cz);
  disc.material = paveMat;
  disc.isPickable = false;
  meshes.push(disc);

  // Backdrop frame — a thick rectangular jersey-style banner standing
  // upright behind the photo disc (further from approach direction).
  const frameRoot = new TransformNode('photo-frame-root', scene);
  frameRoot.position.set(cx, 0, cz - 2);
  // Outer frame (blue jersey shape)
  const frameOuter = MeshBuilder.CreateBox('photo-frame-outer', {
    width: 5, height: 6, depth: 0.3,
  }, scene);
  frameOuter.parent = frameRoot;
  frameOuter.position.set(0, 3, 0);
  frameOuter.material = frameMat;
  meshes.push(frameOuter);
  // White interior cutout (visual — slightly smaller, in front of the outer)
  const frameInner = MeshBuilder.CreateBox('photo-frame-inner', {
    width: 4, height: 4.8, depth: 0.32,
  }, scene);
  frameInner.parent = frameRoot;
  frameInner.position.set(0, 3, 0.01);
  frameInner.material = frameAccentMat;
  meshes.push(frameInner);
  // Big number "10" on the white area — represented as two boxes (the
  // characters themselves are too detailed for primitives; use a stylized
  // mark of a vertical bar + a small ring to suggest "10")
  const numberMark = MeshBuilder.CreateBox('photo-number-bar', {
    width: 0.4, height: 2.0, depth: 0.05,
  }, scene);
  numberMark.parent = frameRoot;
  numberMark.position.set(-0.8, 3, 0.18);
  numberMark.material = frameMat;
  meshes.push(numberMark);
  const numberRing = MeshBuilder.CreateTorus('photo-number-ring', {
    diameter: 1.6, thickness: 0.3, tessellation: 20,
  }, scene);
  numberRing.parent = frameRoot;
  numberRing.position.set(0.8, 3, 0.18);
  numberRing.rotation.x = Math.PI / 2;
  numberRing.material = frameMat;
  meshes.push(numberRing);

  // Oversized soccer ball next to the frame
  const ballX = cx + 2.5;
  const ballY = 1.2;
  const ballZ = cz + 0.5;
  const ball = MeshBuilder.CreateSphere('photo-ball', {
    diameter: 2.4, segments: 32,
  }, scene);
  ball.position.set(ballX, ballY, ballZ);
  ball.material = ballWhiteMat;
  meshes.push(ball);

  // Dark patches on the ball (6 hex-disc patches around the surface)
  const ballRadius = 1.2;
  const patchOffset = ballRadius + 0.005;
  const patchPositions: Array<[number, number]> = [
    [0,          0],
    [Math.PI / 3,        Math.PI / 4],
    [-Math.PI / 3,      -Math.PI / 4],
    [2 * Math.PI / 3,    Math.PI / 4],
    [-2 * Math.PI / 3,  -Math.PI / 4],
    [Math.PI,             0],
  ];
  for (let i = 0; i < patchPositions.length; i++) {
    const [lon, lat] = patchPositions[i];
    const px = ballX + Math.cos(lat) * Math.cos(lon) * patchOffset;
    const py = ballY + Math.sin(lat) * patchOffset;
    const pz = ballZ + Math.cos(lat) * Math.sin(lon) * patchOffset;
    const patch = MeshBuilder.CreateDisc(`photo-ball-patch-${i}`, { radius: 0.32, tessellation: 6 }, scene);
    patch.position.set(px, py, pz);
    patch.lookAt(new Vector3(ballX + (px - ballX) * 100, ballY + (py - ballY) * 100, ballZ + (pz - ballZ) * 100));
    patch.material = ballDarkMat;
    meshes.push(patch);
  }

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Amphitheater: a small curved tiered seating area with a flat stage in
// front. The tiers are concentric arc-shaped rings (built as wide flat
// boxes that approximate the curve).
function buildAmphitheater(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const stageMat = createStandardMaterial(scene, 'amp-stage-mat', Color3.FromHexString('#6e4a2c'));
  const tierMat = createStandardMaterial(scene, 'amp-tier-mat', Color3.FromHexString('#b3a989'));
  const tierAccentMat = createStandardMaterial(scene, 'amp-tier-accent-mat', Color3.FromHexString('#8a7e5d'));
  const flagpoleMat = createStandardMaterial(scene, 'amp-pole-mat', Color3.FromHexString('#444444'));
  const flagMat = createStandardMaterial(scene, 'amp-flag-mat', Color3.FromHexString('#3a6ea5'));

  // Flat stage at the front (the player-facing side, -Z from center)
  const stageZ = cz - 4;
  const stage = MeshBuilder.CreateCylinder('amp-stage', {
    height: 0.3, diameter: 7, tessellation: 24,
  }, scene);
  stage.position.set(cx, 0.15, stageZ);
  stage.scaling.set(1.2, 1, 0.7);
  stage.material = stageMat;
  meshes.push(stage);

  // Backdrop — a flat rectangular wall behind the stage. Two prior
  // attempts (hollow cylinder bands, then a solid half-cylinder bowl)
  // both rendered as floating discs when the camera dropped low: the
  // half-cylinder's CAP_ALL top dominated top-down views, the hollow
  // tube's open ends caused the original "flying ribbon" bug. A plain
  // box reads correctly from every angle.
  const backdrop = MeshBuilder.CreateBox('amp-backdrop', {
    width: 12, height: 3.2, depth: 0.5,
  }, scene);
  backdrop.position.set(cx, 1.6, cz + 1.5);
  backdrop.material = tierMat;
  meshes.push(backdrop);

  // Two side wings angled inward — gives the backdrop a "shell stage"
  // silhouette without resorting to curves. Each side panel is rotated
  // around Y so its inner face angles toward the stage.
  for (const sign of [-1, 1] as const) {
    const wing = MeshBuilder.CreateBox(`amp-backdrop-wing-${sign}`, {
      width: 3.5, height: 2.6, depth: 0.45,
    }, scene);
    wing.position.set(cx + sign * 5.5, 1.3, cz + 0.4);
    wing.rotation.y = sign * 0.45;  // ~26° toward the stage
    wing.material = tierMat;
    meshes.push(wing);
  }

  // Top trim — runs along the top of the backdrop in the accent color.
  const trim = MeshBuilder.CreateBox('amp-backdrop-trim', {
    width: 12.4, height: 0.28, depth: 0.6,
  }, scene);
  trim.position.set(cx, 3.34, cz + 1.5);
  trim.material = tierAccentMat;
  meshes.push(trim);

  // Flagpole + flag on the stage
  const pole = MeshBuilder.CreateCylinder('amp-flagpole', {
    height: 4, diameter: 0.18, tessellation: 8,
  }, scene);
  pole.position.set(cx + 2.5, 2.3, stageZ);
  pole.material = flagpoleMat;
  meshes.push(pole);

  const flag = MeshBuilder.CreateBox('amp-flag', {
    width: 1.2, height: 0.8, depth: 0.05,
  }, scene);
  flag.position.set(cx + 3.1, 3.7, stageZ);
  flag.material = flagMat;
  meshes.push(flag);

  return meshes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stadium
function buildStadium(scene: Scene, cx: number, cz: number): Mesh[] {
  const meshes: Mesh[] = [];
  const beigeMat = createStandardMaterial(scene, 'stadium-beige', Color3.FromHexString('#d8c4a5'));
  const grayMat = createStandardMaterial(scene, 'stadium-gray', Color3.FromHexString('#8a8a86'));
  const whiteMat = createStandardMaterial(scene, 'stadium-white', Color3.FromHexString('#ededea'));
  const accentMat = createStandardMaterial(scene, 'stadium-accent', Color3.FromHexString('#3a6ea5'));
  const seatMat = createStandardMaterial(scene, 'stadium-seat', Color3.FromHexString('#5a4030'));
  const roofMat = createStandardMaterial(scene, 'stadium-roof-mat', Color3.FromHexString('#aeb1b4'));

  // ── Interior turf floor — flush with outside ground, painted with the
  // AI-generated stadium-turf texture. Built as a flat oval disc that
  // fills the inner ellipse. Sits a hair above y=0 to avoid z-fighting
  // with the park ground beneath.
  const turfMat = createStandardMaterial(scene, 'stadium-turf-mat', Color3.FromHexString('#3a8634'));
  const turfTex = new Texture(ASSETS['stadium-turf'], scene);
  turfTex.uScale = 8;
  turfTex.vScale = 8;
  turfTex.anisotropicFilteringLevel = 8;
  turfMat.diffuseTexture = turfTex;
  const innerAxFloor = (STADIUM_OUTER_DIAMETER / 2) * STADIUM_OVAL_RATIO - 12;
  const innerBzFloor = STADIUM_OUTER_DIAMETER / 2 - 12;
  const floor = MeshBuilder.CreateDisc('stadium-floor', {
    radius: 1, tessellation: 64,
  }, scene);
  floor.rotation.x = Math.PI / 2;
  floor.scaling.set(innerAxFloor, innerBzFloor, 1);
  floor.position.set(cx, 0.02, cz);
  floor.material = turfMat;
  floor.isPickable = false;
  meshes.push(floor);

  // Wall is built in TWO ribbons so the gate cut-out is only at the
  // bottom (doorway height) — the wall closes off above the lintel.
  // Old version had a full-height gap that looked like a "sky window"
  // above the gate.
  //
  //   ┌───────────────────────┐
  //   │      UPPER (no gap)   │   y ∈ [GATE_OPENING_HEIGHT, wallTop]
  //   ├───┐               ┌───┤
  //   │   │               │   │   y ∈ [0, GATE_OPENING_HEIGHT]
  //   │   │               │   │   LOWER (gap at south)
  //   └───┘               └───┘
  //         ←─ gate gap ─→
  const ax = (STADIUM_OUTER_DIAMETER / 2) * STADIUM_OVAL_RATIO;
  const bz = STADIUM_OUTER_DIAMETER / 2;
  const wallTopY = STADIUM_WALL_HEIGHT;
  // Doorway height = EXACTLY the gate's lintel-trim top
  // (pylonHeight 7 + lintelTrim center 0.65 + half-trim 0.15 = 7.8).
  // Was 8.2 — that 0.4-unit gap showed a thin sky-blue strip between
  // the gate's gold trim and the wall above it.
  const GATE_OPENING_HEIGHT = 7.8;
  // Gap angular half-width on the south side. Sized so the wall opening
  // exactly frames the gate's pylons (outer pylon edges at cx ± 5.9,
  // so chord_half ≈ 5.9, angle_half = asin(5.9/ax) ≈ 0.060 rad at the
  // enlarged ax=98). The collision keep-out angle is updated to match
  // — see obstacles.ts STADIUM_KEEPOUT.entranceHalfAngle.
  const GATE_HALF_ANGLE = 0.063;
  const segments = 64;

  // LOWER wall: ribbon following the ellipse from east edge of gap → CCW
  // around → west edge of gap. y range [0, GATE_OPENING_HEIGHT].
  const lowerBottom: Vector3[] = [];
  const lowerTop: Vector3[] = [];
  const angleStart = -Math.PI / 2 + GATE_HALF_ANGLE;
  const angleEnd = -Math.PI / 2 + 2 * Math.PI - GATE_HALF_ANGLE;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = angleStart + (angleEnd - angleStart) * t;
    const x = cx + ax * Math.cos(a);
    const z = cz + bz * Math.sin(a);
    lowerBottom.push(new Vector3(x, 0, z));
    lowerTop.push(new Vector3(x, GATE_OPENING_HEIGHT, z));
  }
  const lowerWall = MeshBuilder.CreateRibbon('stadium-outer-wall-lower', {
    pathArray: [lowerBottom, lowerTop],
    sideOrientation: Mesh.DOUBLESIDE,
    closeArray: false,
    closePath: false,
  }, scene);
  lowerWall.material = beigeMat;
  meshes.push(lowerWall);

  // UPPER wall: ribbon going ALL THE WAY around the ellipse (closed
  // path — no gap), from y = GATE_OPENING_HEIGHT up to the wall top.
  // Closes off the sky window that used to sit above the gate.
  const upperBottom: Vector3[] = [];
  const upperTop: Vector3[] = [];
  const upperSegments = 64;
  for (let i = 0; i <= upperSegments; i++) {
    const t = i / upperSegments;
    const a = t * Math.PI * 2;
    const x = cx + ax * Math.cos(a);
    const z = cz + bz * Math.sin(a);
    upperBottom.push(new Vector3(x, GATE_OPENING_HEIGHT, z));
    upperTop.push(new Vector3(x, wallTopY, z));
  }
  const upperWall = MeshBuilder.CreateRibbon('stadium-outer-wall-upper', {
    pathArray: [upperBottom, upperTop],
    sideOrientation: Mesh.DOUBLESIDE,
    closeArray: false,
    closePath: true,
  }, scene);
  upperWall.material = beigeMat;
  meshes.push(upperWall);

  // ── Tiered stands — N concentric rings that step UP and OUTWARD as
  // you move away from the field. Tier 0 is the lowest (closest to the
  // field, smallest radius), tier N-1 is the highest (closest to the
  // wall, largest radius). The riser of each tier faces INWARD (toward
  // the field) so spectators "sit" on the shelf facing the action.
  //
  //                                            ┌─── wall (radius ax)
  //                                       ┌────┘
  //                                ┌──────┘            tier N-1 (top)
  //                          ┌────┘
  //                    ┌────┘                          ...
  //              ┌────┘
  //        ┌────┘                                      tier 0 (bottom)
  //  field ┘──────────────────                         (radius ax_in)
  //
  // Stand depth (on each axis) = STAND_TIERS * TIER_INSET = 10, so the
  // inner edge of the bottom tier lands at (ax-10, bz-10) = (88, 60),
  // matching STADIUM_KEEPOUT.innerAx/innerBz — keep-out stays accurate.
  const STAND_TIERS = 5;
  const TIER_RISE = 2.0;
  const TIER_INSET = 2.0;
  const standInnerAx = ax - STAND_TIERS * TIER_INSET;  // 88
  const standInnerBz = bz - STAND_TIERS * TIER_INSET;  // 60
  for (let tier = 0; tier < STAND_TIERS; tier++) {
    const yBottom = STADIUM_INTERIOR_FLOOR_Y + tier * TIER_RISE;
    const yTop = yBottom + TIER_RISE;
    // Linear interpolation from standInner (at tier=0) to wall ax (at tier=N)
    const tIn = tier / STAND_TIERS;
    const tOut = (tier + 1) / STAND_TIERS;
    const innerA = standInnerAx + (ax - standInnerAx) * tIn;
    const innerB = standInnerBz + (bz - standInnerBz) * tIn;
    const outerA = standInnerAx + (ax - standInnerAx) * tOut;
    const outerB = standInnerBz + (bz - standInnerBz) * tOut;
    // Riser ribbon — VERTICAL face at the INNER edge of this tier,
    // facing the field. Spans from yBottom (top of previous shelf, or
    // floor for tier 0) up to yTop (this tier's shelf level).
    const riserLow: Vector3[] = [];
    const riserHigh: Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const a = angleStart + (angleEnd - angleStart) * t;
      const x = cx + innerA * Math.cos(a);
      const z = cz + innerB * Math.sin(a);
      riserLow.push(new Vector3(x, yBottom, z));
      riserHigh.push(new Vector3(x, yTop, z));
    }
    const riser = MeshBuilder.CreateRibbon(`stadium-stand-riser-${tier}`, {
      pathArray: [riserLow, riserHigh],
      sideOrientation: Mesh.DOUBLESIDE,
      closeArray: false,
      closePath: false,
    }, scene);
    riser.material = seatMat;
    meshes.push(riser);
    // Shelf ribbon — HORIZONTAL at yTop, spans from inner radius to
    // outer radius (so each shelf butts against the next tier's riser).
    const shelfInner: Vector3[] = [];
    const shelfOuter: Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const a = angleStart + (angleEnd - angleStart) * t;
      const ix = cx + innerA * Math.cos(a);
      const iz = cz + innerB * Math.sin(a);
      const ox = cx + outerA * Math.cos(a);
      const oz = cz + outerB * Math.sin(a);
      shelfInner.push(new Vector3(ix, yTop, iz));
      shelfOuter.push(new Vector3(ox, yTop, oz));
    }
    const shelf = MeshBuilder.CreateRibbon(`stadium-stand-shelf-${tier}`, {
      pathArray: [shelfInner, shelfOuter],
      sideOrientation: Mesh.DOUBLESIDE,
      closeArray: false,
      closePath: false,
    }, scene);
    shelf.material = grayMat;
    meshes.push(shelf);
  }

  // ── Side caps at the gate cut — close off the "open end" of the
  //    stand ribbons that would otherwise show empty voids. One quad
  //    per tier, so the cap silhouette follows the STAIR-STEP profile
  //    of the actual seating rather than a sloppy diagonal slope.
  //
  //    For tier N at the gate angle, the cap quad covers:
  //      - radial extent: from this tier's INNER edge to its OUTER edge
  //      - height: from y=0 up to this tier's shelf level (yTop)
  //
  //    Tier 0's quad is small (innermost, lowest). Each subsequent
  //    quad is wider AND taller, so when stacked side-by-side they
  //    form a staircase shape matching the visible stands.
  const capAngles = [angleStart, angleEnd];
  for (let i = 0; i < capAngles.length; i++) {
    const a = capAngles[i];
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    for (let tier = 0; tier < STAND_TIERS; tier++) {
      const tInTier = tier / STAND_TIERS;
      const tOutTier = (tier + 1) / STAND_TIERS;
      const innerA = standInnerAx + (ax - standInnerAx) * tInTier;
      const innerB = standInnerBz + (bz - standInnerBz) * tInTier;
      const outerA = standInnerAx + (ax - standInnerAx) * tOutTier;
      const outerB = standInnerBz + (bz - standInnerBz) * tOutTier;
      const yTop = STADIUM_INTERIOR_FLOOR_Y + (tier + 1) * TIER_RISE;
      // 3D corners of this tier's cap quad in the radial-vertical plane:
      const xIn = cx + innerA * cosA;
      const zIn = cz + innerB * sinA;
      const xOut = cx + outerA * cosA;
      const zOut = cz + outerB * sinA;
      const bottom = [
        new Vector3(xIn, 0, zIn),
        new Vector3(xOut, 0, zOut),
      ];
      const top = [
        new Vector3(xIn, yTop, zIn),
        new Vector3(xOut, yTop, zOut),
      ];
      const cap = MeshBuilder.CreateRibbon(`stadium-stand-sidecap-${i}-${tier}`, {
        pathArray: [bottom, top],
        sideOrientation: Mesh.DOUBLESIDE,
        closeArray: false,
        closePath: false,
      }, scene);
      cap.material = seatMat;
      meshes.push(cap);
    }
  }

  // ── Crowd backdrop — a tall ribbon ON the inside face of the upper
  // wall (at radius slightly inside ax), starting at the top of the
  // highest stand tier and going up to just below the roof. Looks
  // like the stadium has many more rows of spectators continuing up
  // the back of the bowl. The tileable AI-generated crowd image is
  // sampled densely (uScale 16) so each "person" is tiny — sells the
  // huge-arena / tiny-me scale.
  const crowdTex = new Texture(ASSETS['stadium-crowd'], scene);
  crowdTex.hasAlpha = false;
  crowdTex.uScale = 16;
  crowdTex.vScale = 1;
  crowdTex.anisotropicFilteringLevel = 8;
  const crowdMat = new StandardMaterial('stadium-crowd-mat', scene);
  crowdMat.diffuseTexture = crowdTex;
  crowdMat.emissiveTexture = crowdTex;
  crowdMat.emissiveColor = new Color3(0.35, 0.35, 0.35);
  crowdMat.specularColor = new Color3(0, 0, 0);
  crowdMat.backFaceCulling = false;
  const crowdBottomY = STADIUM_INTERIOR_FLOOR_Y + STAND_TIERS * TIER_RISE;  // top of stands = 10
  const crowdTopY = STADIUM_WALL_HEIGHT - 1;  // just below roof
  // Sit the crowd 0.4 units inside the wall — close enough that the
  // wall behind it isn't visible through any gap, far enough that it
  // doesn't z-fight with the wall mesh.
  const crowdAx = ax - 0.4;
  const crowdBz = bz - 0.4;
  const crowdBottom: Vector3[] = [];
  const crowdTop: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = angleStart + (angleEnd - angleStart) * t;
    const x = cx + crowdAx * Math.cos(a);
    const z = cz + crowdBz * Math.sin(a);
    crowdBottom.push(new Vector3(x, crowdBottomY, z));
    crowdTop.push(new Vector3(x, crowdTopY, z));
  }
  const crowdRing = MeshBuilder.CreateRibbon('stadium-crowd-ring', {
    pathArray: [crowdBottom, crowdTop],
    sideOrientation: Mesh.DOUBLESIDE,
    closeArray: false,
    closePath: false,
  }, scene);
  crowdRing.material = crowdMat;
  meshes.push(crowdRing);

  // ── Roof — a flat oval cap covering the stadium. Built as a thin
  // ring extruded from the outer wall down to inside the stands,
  // giving a partial cover over the crowd. Centered just above the
  // wall top.
  const roofInnerA = ax - 4;
  const roofInnerB = bz - 4;
  const roofOuterA = ax + 2;
  const roofOuterB = bz + 2;
  const roofTopPaths: Vector3[][] = [];
  const roofSegments = 64;
  // Top surface of the roof (single flat ring)
  const roofInner: Vector3[] = [];
  const roofOuter: Vector3[] = [];
  for (let i = 0; i <= roofSegments; i++) {
    const t = i / roofSegments;
    const a = t * Math.PI * 2;
    const oox = cx + roofOuterA * Math.cos(a);
    const ooz = cz + roofOuterB * Math.sin(a);
    const iix = cx + roofInnerA * Math.cos(a);
    const iiz = cz + roofInnerB * Math.sin(a);
    roofOuter.push(new Vector3(oox, STADIUM_ROOF_Y, ooz));
    roofInner.push(new Vector3(iix, STADIUM_ROOF_Y, iiz));
  }
  roofTopPaths.push(roofInner, roofOuter);
  const roof = MeshBuilder.CreateRibbon('stadium-roof', {
    pathArray: roofTopPaths,
    sideOrientation: Mesh.DOUBLESIDE,
    closeArray: false,
    closePath: true,
  }, scene);
  roof.material = roofMat;
  meshes.push(roof);

  // Roof outer rim — a thin gold trim around the very edge so the
  // silhouette reads as a real roof, not a flat disk.
  const goldMat = createStandardMaterial(scene, 'stadium-roof-trim-mat', Color3.FromHexString('#e6c34a'));
  const rimBottom: Vector3[] = [];
  const rimTop: Vector3[] = [];
  for (let i = 0; i <= roofSegments; i++) {
    const t = i / roofSegments;
    const a = t * Math.PI * 2;
    const x = cx + (roofOuterA + 0.3) * Math.cos(a);
    const z = cz + (roofOuterB + 0.3) * Math.sin(a);
    rimBottom.push(new Vector3(x, STADIUM_ROOF_Y - 0.3, z));
    rimTop.push(new Vector3(x, STADIUM_ROOF_Y + 0.4, z));
  }
  const rim = MeshBuilder.CreateRibbon('stadium-roof-rim', {
    pathArray: [rimBottom, rimTop],
    sideOrientation: Mesh.DOUBLESIDE,
    closeArray: false,
    closePath: true,
  }, scene);
  rim.material = goldMat;
  meshes.push(rim);

  // Decorative perimeter pillars — `ax` and `bz` already in scope from
  // the wall-ribbon block. Skip pillars in the south entrance arc.
  const numPillars = 28;  // more pillars for the bigger stadium
  for (let i = 0; i < numPillars; i++) {
    const angle = (i / numPillars) * Math.PI * 2;
    let normAngle = angle;
    while (normAngle > Math.PI) normAngle -= 2 * Math.PI;
    while (normAngle < -Math.PI) normAngle += 2 * Math.PI;
    if (Math.abs(normAngle - (-Math.PI / 2)) < GATE_HALF_ANGLE + 0.05) continue;
    const px = cx + Math.cos(angle) * ax;
    const pz = cz + Math.sin(angle) * bz;
    const pillar = MeshBuilder.CreateBox(`stadium-pillar-${i}`, {
      width: 1.2, height: STADIUM_WALL_HEIGHT + 2, depth: 1.2,
    }, scene);
    pillar.position.set(px, (STADIUM_WALL_HEIGHT + 2) / 2, pz);
    pillar.material = whiteMat;
    meshes.push(pillar);
  }

  const signZ = cz - bz - 8;
  const sign = MeshBuilder.CreateBox('stadium-sign', {
    width: 26, height: 5, depth: 0.9,
  }, scene);
  sign.position.set(cx, 22, signZ);
  sign.material = accentMat;
  meshes.push(sign);

  for (const polePx of [-12, 12]) {
    const pole = MeshBuilder.CreateCylinder(`stadium-sign-pole-${polePx}`, {
      height: 28,
      diameter: 0.8,
      tessellation: 8,
    }, scene);
    pole.position.set(cx + polePx, 14, signZ);
    pole.material = whiteMat;
    meshes.push(pole);
  }

  // Flagpoles distributed around the roof rim, equally spaced — skip
  // the south entrance arc to keep the gate sightline clean.
  const numFlags = 16;
  for (let i = 0; i < numFlags; i++) {
    const a = (i / numFlags) * Math.PI * 2;
    let normA = a;
    while (normA > Math.PI) normA -= 2 * Math.PI;
    while (normA < -Math.PI) normA += 2 * Math.PI;
    if (Math.abs(normA - (-Math.PI / 2)) < 0.3) continue;
    const fpx = cx + (ax + 1.5) * Math.cos(a);
    const fpz = cz + (bz + 1.5) * Math.sin(a);
    const flagpole = MeshBuilder.CreateCylinder(`stadium-flagpole-${i}`, {
      height: 6, diameter: 0.3, tessellation: 6,
    }, scene);
    flagpole.position.set(fpx, STADIUM_ROOF_Y + 3, fpz);
    flagpole.material = whiteMat;
    meshes.push(flagpole);

    const flag = MeshBuilder.CreateBox(`stadium-flag-${i}`, {
      width: 1.4, height: 0.9, depth: 0.05,
    }, scene);
    // Place the flag outward from the pole
    const outX = Math.cos(a);
    const outZ = Math.sin(a);
    flag.position.set(fpx + outX * 0.75, STADIUM_ROOF_Y + 5, fpz + outZ * 0.75);
    flag.material = accentMat;
    meshes.push(flag);
  }

  return meshes;
}
