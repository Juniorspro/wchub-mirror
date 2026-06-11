/**
 * [INPUT]: 无（纯数据 + 函数）
 * [OUTPUT]: GroundLevel / GROUND_LEVELS / groundHeightAt
 * [POS]: server/src/shared 的地面高度真源 —— 客户端渲染（avatar Y / 摄像机目标）按
 *        groundHeightAt(x, z) 把角色抬上凸起的可行走平台；server 目前不消费高度
 *        （移动是纯 2D），但定义放 shared，保证未来任何一端引用的是同一份数据。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 设计：每个"层级"是一个水平椭圆盘（圆是 ax === bz 的特例），带一个顶面高度 h。
 * groundHeightAt 返回包含该点的所有盘中最高的 h，否则 0（公园草地）。
 * 平台必须与 client/src/babylon/world.ts 的可见几何严格同步 —— 这里的每一项都
 * 标注了它对应的 build 函数。台阶高差 ≤0.35，角色直接"踩上去"（客户端做短时
 * 平滑），不需要跳跃也不存在碰撞边缘。
 */

export interface GroundLevel {
  /** Platform center x in world units. */
  cx: number;
  /** Platform center z in world units (server's y axis). */
  cy: number;
  /** Ellipse semi-axis along x. For circles ax === bz === radius. */
  ax: number;
  /** Ellipse semi-axis along z. */
  bz: number;
  /** Walkable floor height (world Y) on top of this platform. */
  h: number;
}

/** Raised walkable surfaces. Order doesn't matter — groundHeightAt takes
 *  the MAX height among all platforms containing the point, so a small
 *  high platform stacked on a wide low one resolves correctly. */
export const GROUND_LEVELS: GroundLevel[] = [
  // ─── Central plaza platform @ FAIR_CENTER (110, 24) — world.ts
  //     'plaza-platform' (r 4.5, h 0.5) + 'plaza-platform-step'
  //     (r 4.5+0.7, h 0.5*0.45). The centerpiece on top has its own
  //     circle obstacle so the column itself is never walkable.
  { cx: 110, cy: 24, ax: 5.2, bz: 5.2, h: 0.225 },
  { cx: 110, cy: 24, ax: 4.5, bz: 4.5, h: 0.5 },

  // ─── Top-up monument plot @ (98, 50) — world.ts buildTopupMonument
  //     'mon-plot' (r 4.5, h 0.5) + 'mon-plot-step' (r 4.5+0.6, h 0.225).
  { cx: 98, cy: 50, ax: 5.1, bz: 5.1, h: 0.225 },
  { cx: 98, cy: 50, ax: 4.5, bz: 4.5, h: 0.5 },

  // ─── Top-voters podium @ (50, 50) — world.ts buildTopVotersPodium
  //     'tvp-base-rim' (r 8.9, h 0.15), 'tvp-base-disc' (r 8.5, h 0.35),
  //     'tvp-tier-2' (r 5.5, stacked → top 0.7). The five statue plinths
  //     on top are circle obstacles (players walk the tiers, not through
  //     the plinths).
  { cx: 50, cy: 50, ax: 8.9, bz: 8.9, h: 0.15 },
  { cx: 50, cy: 50, ax: 8.5, bz: 8.5, h: 0.35 },
  { cx: 50, cy: 50, ax: 5.5, bz: 5.5, h: 0.7 },

  // ─── Amphitheater stage @ (148, 66) — world.ts buildAmphitheater
  //     'amp-stage': cylinder d7 h0.3 scaled (1.2, 1, 0.7) → ellipse
  //     rx 4.2 / rz 2.45, top at 0.3. Backdrop wall behind it stays a
  //     circle obstacle; the stage itself is a walkable riser.
  { cx: 148, cy: 66, ax: 4.2, bz: 2.45, h: 0.3 },
];

/** Walkable floor height at a world (x, z) point. 0 = base park ground.
 *  Deterministic + engine-free so client render and any future server
 *  consumer (e.g. ball physics on a platform) agree exactly. */
export function groundHeightAt(x: number, y: number): number {
  let h = 0;
  for (const g of GROUND_LEVELS) {
    if (g.h <= h) continue;
    const dx = (x - g.cx) / g.ax;
    const dy = (y - g.cy) / g.bz;
    if (dx * dx + dy * dy <= 1) h = g.h;
  }
  return h;
}
