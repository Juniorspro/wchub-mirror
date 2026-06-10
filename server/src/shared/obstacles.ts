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
];
