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
  cy: 150,
  // Outer wall — matches the visual stadium cylinder (diameter 140
  // × oval ratio 1.4 = ax 98, bz 70).
  ax: 98,
  bz: 70,
  // Inner field boundary — wall + stands take ~10 units on each
  // axis, so the walkable interior is the inner ellipse.
  innerAx: 88,
  innerBz: 60,
  /** Entrance sector half-angle (radians). Sized to exactly frame the
   *  gate's pylons (outer pylon edges at cx ± 5.9, so the chord at the
   *  outer wall ax=98 needs angle ≈ asin(5.9/98) ≈ 0.060 rad). Visible
   *  GATE_HALF_ANGLE in world.ts is set slightly larger (0.063) so the
   *  visible gap is wider than the collision gap — players never bump
   *  an invisible wall before the visible one runs out. */
  entranceHalfAngle: 0.060,
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

  // ─── Stadium entrance gate pylons (at south wall of enlarged stadium, z=80) ──
  { cx: 105, cy: 80, radius: 0.9 },
  { cx: 115, cy: 80, radius: 0.9 },

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
