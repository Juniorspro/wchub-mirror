/**
 * [INPUT]: 无（纯函数）
 * [OUTPUT]: clamp / lerp / lerpAngle / hypot / normalizeInput + Vec2 + movePlayer（默认移动求解器）
 * [POS]: server/src/shared 的运动/插值数学真源 —— server simulation.step() 与 client prediction 必须
 *        调用【同一个】movePlayer，否则预测与权威发散、人物持续抖动/拉扯。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * MIGRATION: movePlayer 默认实现 = 边界 clamp、无碰撞。若你的游戏有墙/障碍/地形碰撞，
 *   把单机版的碰撞求解搬进本函数（引擎无关的纯数学），server step() 与 client predict 自动同步。
 */

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
 * 默认权威移动：位置 += 归一化输入 × 速度 × dt，clamp 到世界边界。无碰撞。
 * 输入应已归一化（normalizeInput）；dt 单位为秒；speed 为 px/秒。
 */
export function movePlayer(
  pos: Vec2,
  input: Vec2,
  dt: number,
  speed: number,
  mapW: number,
  mapH: number,
): Vec2 {
  return {
    x: clamp(pos.x + input.x * speed * dt, 0, mapW),
    y: clamp(pos.y + input.y * speed * dt, 0, mapH),
  };
}
