/**
 * [INPUT]: 无（纯数据 + 类型）
 * [OUTPUT]: CircleObstacle / PLAYER_RADIUS / OBSTACLES
 * [POS]: server/src/shared 的世界碰撞真源 —— server step() 与 client prediction 通过 math.movePlayer
 *        共享同一份障碍物列表，保证服务端权威与客户端预测的碰撞结果完全一致。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 设计：所有障碍物简化为水平面上的圆。movePlayer 会在边界 clamp 之后，对每个障碍执行单步
 * "如果玩家圆心在禁区内 → 沿径向推出"的求解。简单、确定、客户端/服务端可复现。
 * 椭圆/矩形碰撞如需更紧贴可拆成多个圆覆盖。
 */

export interface CircleObstacle {
  /** Obstacle center x in world units (matches server XZ → client world X). */
  cx: number;
  /** Obstacle center z in world units (server's y axis). */
  cy: number;
  /** Solid radius — player gets pushed out if their center is inside (radius + PLAYER_RADIUS). */
  radius: number;
}

/** Player capsule horizontal radius in world units. The avatar body capsules
 *  are ~0.18 wide; 0.4 gives a comfortable buffer so the avatar visibly
 *  stops a hair short of obstacle surfaces. */
export const PLAYER_RADIUS = 0.4;

/** Stadium WALL BAND keep-out. The stadium is now OPEN — players can
 *  walk into the interior through the south entrance and roam the field.
 *  Collision now only blocks the WALL itself (between outerAx/outerBz
 *  and innerAx/innerBz), with an angular gap centered on the south side
 *  (entrance) where the wall is effectively absent. Inside the inner
 *  ellipse (the field) is fully walkable; outside the outer ellipse
 *  (the park) is fully walkable; only the annular wall band is solid.
 *
 *  Map recenter: cx moved from 24 → 110 so the stadium sits on the
 *  midline of the 220-wide map. Stadium grown 2026-06-08: outer
 *  diameter 100 → 140 (ax 75 → 98, bz 50 → 70), center z moved
 *  140 → 150 so the back of the larger stadium doesn't push past
 *  the north fence. */
export const STADIUM_KEEPOUT = {
  cx: 110,
  // Stadium shrunk + pulled south 2026-06-10: diameter 140 → 105
  // (25% reduction). Center z then pulled 130 → 120 so the full oval
  // fits INSIDE the 175-deep fence (at cy=130 the north wall reached
  // z=182.5 and the fence rail sliced through the stadium band).
  cy: 120,
  // Outer wall — matches the visual stadium cylinder (diameter 105
  // × oval ratio 1.4 = ax 73.5, bz 52.5).
  ax: 73.5,
  bz: 52.5,
  // Inner field boundary — wall + stands take ~10 units on each
  // axis, so the walkable interior is the inner ellipse.
  innerAx: 63.5,
  innerBz: 42.5,
  /** Entrance sector half-angle (radians). Sized so the angular gap
   *  matches the gate's pylon-to-pylon chord (pylons span cx ± 5.9 at
   *  outer wall ax=73.5 → angle ≈ asin(5.9/73.5) ≈ 0.080 rad). Visible
   *  GATE_HALF_ANGLE in world.ts is set slightly larger so the visible
   *  gap is wider than the collision gap — players never bump an
   *  invisible wall before the visible one runs out. */
  entranceHalfAngle: 0.080,
};

/** Solid scenery hitboxes. Coordinates match the client's world.ts /
 *  entities.ts build positions. Keep this list in sync with any visible
 *  POI the player should not walk through.
 *
 *  Map recenter (2026-06-08): all cx values shifted by +86 so the
 *  stadium sits on the midline of a 220-wide map. Old cx values are
 *  preserved in parentheses for cross-reference. */
export const OBSTACLES: CircleObstacle[] = [
  // ─── Stalls (counter + back wall, approximated as one circle each) ──────
  { cx:  98, cy: 16, radius: 1.4 },  // Sasha's Shirts (was 12)
  { cx: 121, cy: 18, radius: 1.4 },  // Pants Pavilion (was 35)
  { cx: 170, cy: 20, radius: 1.4 },  // Sneaker Stand  (was 84)
  { cx: 114, cy: 39, radius: 1.4 },  // The Hattery    (was 28)
  { cx: 100, cy: 34, radius: 1.4 },  // Glasses + Bags (was 14)
  { cx:  94, cy: 28, radius: 1.4 },  // Cozy Scarves   (was 8)
  { cx: 110, cy: 14, radius: 1.4 },  // The Design Bench (was 24)

  // ─── Plaza centerpiece — championship football monument ─────────────────
  { cx: 110, cy: 24, radius: 1.6 },  // (was 24)

  // ─── Stadium entrance gate pylons (south wall,
  //     z = STADIUM_KEEPOUT.cy - STADIUM_KEEPOUT.bz = 120 - 52.5 = 67.5).
  { cx: 105, cy: 67.5, radius: 0.9 },
  { cx: 115, cy: 67.5, radius: 0.9 },

  // ─── Top-up monument stepped base (west meadow at 98, 50 — moved off
  //     the gate approach; display face aimed at spawn) ───────────────────
  { cx:  98, cy: 50, radius: 2.2 },

  // ─── Top-voters podium central plinth (statues stand on it; players
  //     can walk on the outer tiers but not through the centre) ──────────
  { cx:  50, cy: 50, radius: 2.0 },

  // ─── Picnic-area tables (4 around the parasol at 162, 56 — moved
  //     south-east, clear of the amphitheater stage disc) ────────────────
  { cx: 158.8, cy: 56,   radius: 1.2 },
  { cx: 165.2, cy: 56,   radius: 1.2 },
  { cx: 162,   cy: 52.8, radius: 1.2 },
  { cx: 162,   cy: 59.2, radius: 1.2 },

  // ─── Concession-stand cluster, 4 carts around (146, 12) ─────────────────
  { cx: 146,   cy: 16.5, radius: 1.1 },  // N cart
  { cx: 150.5, cy: 12,   radius: 1.1 },  // E cart
  { cx: 146,   cy:  7.5, radius: 1.1 },  // S cart
  { cx: 141.5, cy: 12,   radius: 1.1 },  // W cart

  // ─── Trophy plaza @ (186, 60) — central pedestal + 4 surround ──────────
  { cx: 186,   cy: 60,   radius: 1.1 },
  { cx: 186,   cy: 63.5, radius: 0.5 },
  { cx: 189.5, cy: 60,   radius: 0.5 },
  { cx: 186,   cy: 56.5, radius: 0.5 },
  { cx: 182.5, cy: 60,   radius: 0.5 },

  // ─── Photo selfie spot @ (186, 25) — backdrop frame + giant ball ───────
  { cx: 186,   cy: 23,   radius: 2.6 },
  { cx: 188.5, cy: 25.5, radius: 1.3 },

  // ─── Amphitheater @ (148, 70) — backdrop wall only, stage walkable ──────
  { cx: 141, cy: 71.5, radius: 1.5 },  // backdrop west end
  { cx: 148, cy: 71.5, radius: 1.5 },  // backdrop center
  { cx: 155, cy: 71.5, radius: 1.5 },  // backdrop east end
  // Two side wings angled inward
  { cx: 142.5, cy: 70.4, radius: 1.2 },
  { cx: 153.5, cy: 70.4, radius: 1.2 },

  // ─── Soccer field goalposts — 4 posts per goal, 2 goals ─────────────────
  // Soccer field center moved from (72, 32) → (158, 32)
  // North goal at (cx=158, cz=45.4)
  { cx: 155.6, cy: 45.4, radius: 0.2 },
  { cx: 160.4, cy: 45.4, radius: 0.2 },
  { cx: 155.6, cy: 46.4, radius: 0.2 },
  { cx: 160.4, cy: 46.4, radius: 0.2 },
  // South goal at (cx=158, cz=18.6)
  { cx: 155.6, cy: 18.6, radius: 0.2 },
  { cx: 160.4, cy: 18.6, radius: 0.2 },
  { cx: 155.6, cy: 17.6, radius: 0.2 },
  { cx: 160.4, cy: 17.6, radius: 0.2 },

  // ═══ Hitbox pass 2026-06-11 — every remaining solid POI that players ═══
  // ═══ could previously walk straight through.                         ═══

  // ─── Top-voters podium statue plinths @ (50, 50) — the central plinth
  //     (r 2.0 above) only covered rank #1; the four outer plinths
  //     (r 1.1, ring radius 3.7) stand on the walkable tier-2 surface.
  { cx: 53.7, cy: 50,   radius: 1.15 },
  { cx: 46.3, cy: 50,   radius: 1.15 },
  { cx: 50,   cy: 53.7, radius: 1.15 },
  { cx: 50,   cy: 46.3, radius: 1.15 },

  // ─── Fixture board @ (140, 50) — two support posts (cx ± 4.35) plus a
  //     row of circles under the 7.6-wide display panel (its bottom edge
  //     is at y 0.9, well below avatar head height — walking "through"
  //     the board clipped the avatar into the canvas).
  { cx: 135.65, cy: 50, radius: 0.35 },
  { cx: 144.35, cy: 50, radius: 0.35 },
  { cx: 137.5,  cy: 50, radius: 1.3 },
  { cx: 140,    cy: 50, radius: 1.3 },
  { cx: 142.5,  cy: 50, radius: 1.3 },

  // ─── Mascot statue @ (195, 40) — stone pedestal drum d3.4 ──────────────
  { cx: 195, cy: 40, radius: 1.8 },

  // ─── Trophy replica tent @ (180, 45) — central pedestal + 4 corner posts
  { cx: 180, cy: 45, radius: 0.8 },
  { cx: 178, cy: 43, radius: 0.2 },
  { cx: 182, cy: 43, radius: 0.2 },
  { cx: 178, cy: 47, radius: 0.2 },
  { cx: 182, cy: 47, radius: 0.2 },

  // ─── Lampposts (buildFestiveDecor lampPositions — base drum d 0.36) ────
  { cx: 102, cy: 16, radius: 0.25 },
  { cx: 118, cy: 17, radius: 0.25 },
  { cx: 103, cy: 33, radius: 0.25 },
  { cx: 118, cy: 31, radius: 0.25 },
  { cx: 109, cy: 44, radius: 0.25 },
  { cx: 119, cy: 61, radius: 0.25 },
  { cx:  91, cy: 21, radius: 0.25 },
  { cx:  68, cy: 36, radius: 0.25 },
  { cx: 137, cy: 15, radius: 0.25 },
  { cx: 137, cy: 38, radius: 0.25 },

  // ─── Flag-banner poles framing the gate approach (z = 65) ──────────────
  { cx: 100, cy: 65, radius: 0.2 },
  { cx: 120, cy: 65, radius: 0.2 },

  // ─── Picnic parasol pole @ plot center (162, 56) ───────────────────────
  { cx: 162, cy: 56, radius: 0.15 },

  // ─── Amphitheater stage flagpole @ (148+2.5, 70-4) ─────────────────────
  { cx: 150.5, cy: 66, radius: 0.15 },

  // ─── Park benches (world.ts benchSpec — seat 1.6×0.5, one circle each) ─
  { cx: 107, cy:  9, radius: 0.8 },
  { cx: 113, cy:  9, radius: 0.8 },
  { cx: 105, cy: 42, radius: 0.8 },
  { cx: 120, cy: 47, radius: 0.8 },
  { cx:  92, cy: 30, radius: 0.8 },
  { cx:  56, cy: 40, radius: 0.8 },
  { cx: 146, cy: 51, radius: 0.8 },
  { cx: 172, cy: 30, radius: 0.8 },

  // ─── Hero banner posts @ (110, 41) — face bottom is at y 3.2 so players
  //     walk UNDER the banner; only the two posts (cx ± 5.0) are solid.
  { cx: 105, cy: 41, radius: 0.3 },
  { cx: 115, cy: 41, radius: 0.3 },

  // ─── Small mascot posters (posterSpots) — 1.7-wide framed sign on two
  //     posts, face bottom at y 1.7 (head height) → one solid circle each.
  { cx:  88, cy: 30, radius: 1.1 },
  { cx: 132, cy: 30, radius: 1.1 },
  { cx: 118, cy: 64, radius: 1.1 },
  { cx:  60, cy: 46, radius: 1.1 },
];

// ─── Trees — crossed-billboard sprites (world.ts treeSpec). Only the
//     trunk blocks (canopy is well above head height): radius scales with
//     the sprite scale. The south-fringe trees at z < 0 sit outside the
//     playable rectangle and are skipped. Keep in sync with treeSpec.
const TREE_SPEC: ReadonlyArray<readonly [number, number, number]> = [
  // [x, z, sprite scale]
  [ 15,  18, 2.0], [ 22,  40, 2.2], [ 14,  60, 2.0], [ 25,  82, 2.1],
  [ 10, 130, 2.2], [  8, 160, 2.4],
  [192,  20, 2.1], [195,  48, 2.0], [188, 100, 2.2], [195, 130, 2.1],
  [188, 160, 2.3],
  [ 80,   6, 1.7], [130,   8, 1.6], [140,   6, 1.8], [ 70,  10, 1.8],
  [ 62,  16, 1.6], [176,  16, 1.9],
  [ 70,  53, 1.9], [ 78,  46, 1.7], [ 88,  46, 1.8], [ 64,  30, 1.7],
  [ 55,  60, 2.0],
  [ 38,  68, 2.1], [ 46,  77, 1.9],
  [174,  60, 1.9],
];
for (const [x, z, scale] of TREE_SPEC) {
  OBSTACLES.push({ cx: x, cy: z, radius: Math.min(1.0, Math.max(0.6, 0.4 * scale)) });
}

// ─── Stadium portal gates — 5 flat-frame portals on the field edge
//     (world.ts STADIUM_PORTAL_GATES). Same placement math as the client:
//     point on the stand-inner ellipse (= keep-out inner ellipse) pushed
//     1.2 units toward the field center along the inward normal. Each
//     portal is ~7 wide: one circle for the cover/backdrop span + one per
//     stone pillar (local ±3.0 along the tangent). Effective coverage with
//     PLAYER_RADIUS leaves no walk-through gap. Interact radius (3.5) is
//     larger than every circle, so the HUD prompt still triggers.
const PORTAL_ANGLES = [
  -Math.PI / 4,             // SE — Pixel Quest
  Math.PI / 6,              // E-NE — Bubble Tower
  Math.PI / 2,              // N (back) — Kart Rush
  Math.PI - Math.PI / 6,    // W-NW — Sky Defender
  Math.PI + Math.PI / 4,    // SW — Card Clash
];
for (const angle of PORTAL_ANGLES) {
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const nx = cosA / STADIUM_KEEPOUT.innerAx;
  const nz = sinA / STADIUM_KEEPOUT.innerBz;
  const nLen = Math.hypot(nx, nz);
  const ux = -(nx / nLen);   // inward unit normal (toward field center)
  const uz = -(nz / nLen);
  const px = STADIUM_KEEPOUT.cx + STADIUM_KEEPOUT.innerAx * cosA + ux * 1.2;
  const pz = STADIUM_KEEPOUT.cy + STADIUM_KEEPOUT.innerBz * sinA + uz * 1.2;
  const tx = -uz;            // tangent (along the portal's width)
  const tz = ux;
  OBSTACLES.push({ cx: px, cy: pz, radius: 1.5 });
  OBSTACLES.push({ cx: px + tx * 3, cy: pz + tz * 3, radius: 0.7 });
  OBSTACLES.push({ cx: px - tx * 3, cy: pz - tz * 3, radius: 0.7 });
}
