/**
 * [INPUT]: ./obstacles (OBSTACLES + PLAYER_RADIUS)
 * [OUTPUT]: clamp / lerp / lerpAngle / hypot / normalizeInput + Vec2 + movePlayer（默认移动求解器）
 * [POS]: server/src/shared 的运动/插值数学真源 —— server simulation.step() 与 client prediction 必须
 *        调用【同一个】movePlayer，否则预测与权威发散、人物持续抖动/拉扯。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * MIGRATION: movePlayer 在边界 clamp 之后对 OBSTACLES 列表执行圆碰撞推出。新增/调整障碍只需改
 *   ./obstacles，server step() 与 client predict 自动同步。
 */

import { OBSTACLES, PLAYER_RADIUS, STADIUM_KEEPOUT } from './obstacles';

export interface Vec2 {
  x: number;
  y: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 沿最短弧插值角度（弧度），避免 ±π 边界跳变。 */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** 任意输入向量 → 单位圆内（|v|≤1）。挡 NaN/Infinity，斜向不超速。 */
export function normalizeInput(x: number, y: number): Vec2 {
  const vx = Number.isFinite(x) ? x : 0;
  const vy = Number.isFinite(y) ? y : 0;
  const m = Math.sqrt(vx * vx + vy * vy);
  if (m <= 1) return { x: vx, y: vy };
  return { x: vx / m, y: vy / m };
}

/**
 * 默认权威移动：位置 += 归一化输入 × 速度 × dt，clamp 到世界边界，再对 OBSTACLES 中的每个
 * 圆障碍执行单步推出。输入应已归一化（normalizeInput）；dt 单位为秒；speed 为 px/秒。
 *
 * 单步推出：对每个障碍，如果玩家圆心距 < (障碍半径 + 玩家半径)，沿径向把玩家推到刚好相切。
 * 多个障碍时可能发生第一次推出后又落进第二个障碍 —— 实际中障碍间距足够大，单步够用。
 */
export function movePlayer(
  pos: Vec2,
  input: Vec2,
  dt: number,
  speed: number,
  mapW: number,
  mapH: number,
): Vec2 {
  let nx = clamp(pos.x + input.x * speed * dt, 0, mapW);
  let ny = clamp(pos.y + input.y * speed * dt, 0, mapH);

  for (const ob of OBSTACLES) {
    const dx = nx - ob.cx;
    const dy = ny - ob.cy;
    const minDist = ob.radius + PLAYER_RADIUS;
    const dist2 = dx * dx + dy * dy;
    if (dist2 < minDist * minDist) {
      const dist = Math.sqrt(dist2);
      // Edge case: if the player is exactly on an obstacle center, push
      // them along +X arbitrarily. Otherwise push along the radial.
      if (dist < 1e-4) {
        nx = ob.cx + minDist;
      } else {
        const push = (minDist - dist) / dist;
        nx += dx * push;
        ny += dy * push;
      }
    }
  }

  // Stadium ellipse keep-out. Expand the semi-axes by PLAYER_RADIUS so
  // the player center stops short of the actual wall by their radius.
  // If the (normalized) point is inside the unit ellipse, scale it back
  // onto the surface — this is the ellipse-equivalent of "push out
  // radially to the boundary."
  {
    const sx = nx - STADIUM_KEEPOUT.cx;
    const sz = ny - STADIUM_KEEPOUT.cy;
    const ax = STADIUM_KEEPOUT.ax + PLAYER_RADIUS;
    const bz = STADIUM_KEEPOUT.bz + PLAYER_RADIUS;
    const ovalDist2 = (sx * sx) / (ax * ax) + (sz * sz) / (bz * bz);
    if (ovalDist2 < 1 && ovalDist2 > 1e-8) {
      const factor = 1.001 / Math.sqrt(ovalDist2);
      nx = STADIUM_KEEPOUT.cx + sx * factor;
      ny = STADIUM_KEEPOUT.cy + sz * factor;
    }
  }

  // Re-clamp to bounds in case an obstacle push moved the player off-map.
  nx = clamp(nx, 0, mapW);
  ny = clamp(ny, 0, mapH);
  return { x: nx, y: ny };
}
