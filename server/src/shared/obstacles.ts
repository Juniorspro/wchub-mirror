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

/** Stadium oval keep-out — the stadium walls form an ellipse much too big
 *  for the circular-obstacle list to approximate cleanly. movePlayer
 *  treats this region specially: if the player ends up inside the
 *  ellipse, push them out along the radial gradient onto the boundary.
 *  Values match the client's stadium build (world.ts → STADIUM_CENTER /
 *  STADIUM_OUTER_DIAMETER × STADIUM_OVAL_RATIO). */
export const STADIUM_KEEPOUT = {
  cx: 24,
  cy: 140,
  ax: 75,  // X semi-axis (long axis along the pitch)
  bz: 50,  // Z semi-axis
};

/** Solid scenery hitboxes. Coordinates match the client's world.ts /
 *  entities.ts build positions. Keep this list in sync with any visible
 *  POI the player should not walk through. */
export const OBSTACLES: CircleObstacle[] = [
  // ─── Stalls (counter + back wall, approximated as one circle each) ──────
  { cx: 12, cy: 16, radius: 1.4 },  // Sasha's Shirts
  { cx: 35, cy: 18, radius: 1.4 },  // Pants Pavilion
  { cx: 84, cy: 20, radius: 1.4 },  // Sneaker Stand (outside the park)
  { cx: 28, cy: 39, radius: 1.4 },  // The Hattery
  { cx: 14, cy: 34, radius: 1.4 },  // Glasses + Bags
  { cx:  8, cy: 28, radius: 1.4 },  // Cozy Scarves
  { cx: 24, cy: 14, radius: 1.4 },  // The Design Bench

  // ─── Plaza centerpiece — championship football monument ─────────────────
  { cx: 24, cy: 24, radius: 1.6 },

  // ─── Stadium entrance gate pylons (z = 82) ──────────────────────────────
  { cx: 20.5, cy: 82, radius: 0.9 },
  { cx: 27.5, cy: 82, radius: 0.9 },

  // ─── Concession-stand cluster, 4 carts around (60, 12) ──────────────────
  { cx: 60,   cy: 16.5, radius: 1.1 },  // N cart
  { cx: 64.5, cy: 12,   radius: 1.1 },  // E cart
  { cx: 60,   cy:  7.5, radius: 1.1 },  // S cart
  { cx: 55.5, cy: 12,   radius: 1.1 },  // W cart

  // ─── Trophy plaza @ (100, 60) — central pedestal + 4 surround ──────────
  { cx: 100,   cy: 60,   radius: 1.1 },
  { cx: 100,   cy: 63.5, radius: 0.5 },
  { cx: 103.5, cy: 60,   radius: 0.5 },
  { cx: 100,   cy: 56.5, radius: 0.5 },
  { cx:  96.5, cy: 60,   radius: 0.5 },

  // ─── Photo selfie spot @ (100, 25) — backdrop frame + giant ball ───────
  { cx: 100,   cy: 23,   radius: 2.6 },
  { cx: 102.5, cy: 25.5, radius: 1.3 },

  // ─── Amphitheater @ (62, 70) — one big circle covers stage + tiers ─────
  { cx: 62, cy: 70, radius: 6.5 },

  // ─── Soccer field goalposts — 4 posts per goal, 2 goals ─────────────────
  // North goal at (cx=72, cz=72+13.4=45.4)
  { cx: 69.6, cy: 45.4, radius: 0.2 },
  { cx: 74.4, cy: 45.4, radius: 0.2 },
  { cx: 69.6, cy: 46.4, radius: 0.2 },
  { cx: 74.4, cy: 46.4, radius: 0.2 },
  // South goal at (cx=72, cz=72-13.4=18.6)
  { cx: 69.6, cy: 18.6, radius: 0.2 },
  { cx: 74.4, cy: 18.6, radius: 0.2 },
  { cx: 69.6, cy: 17.6, radius: 0.2 },
  { cx: 74.4, cy: 17.6, radius: 0.2 },
];
