/**
 * [INPUT]: 依赖 @shared 的 SNAPSHOT_DELAY_MS / clamp / lerp / lerpAngle / PlayerSnapshot；./client；./types
 * [OUTPUT]: bracketAt / getInterpolatedPlayers / latestSnapshot
 * [POS]: 其他玩家（非自身）平滑层 —— 在【服务端时钟 t】上做 SNAPSHOT_DELAY_MS 延迟双快照插值，
 *        消除 30Hz 抖动与网络到达抖动。自身走 prediction（不在此插值）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 为何按服务端时钟 t 而非到达时刻 recvAt 插值：服务端像节拍器定频盖 t，网络再以抖动投递。
 * 按 recvAt 取 bracket 会把抖动变成 α 速度摇摆 → 全场忽快忽停。按 t 取，渲染时间随平滑本地帧钟
 * 前进、s0.t/s1.t 等距 → α 平滑滑动；残余网络抖动由 client.ts 里重阻尼的 serverClockOffset EMA 吸收。
 */

import { SNAPSHOT_DELAY_MS, clamp, lerp, lerpAngle } from '@shared';
import type { PlayerSnapshot } from '@shared';
import type { NetClient } from './client';
import type { TimedSnapshot } from './types';

/** 渲染时间（服务端时钟），保持在过去 SNAPSHOT_DELAY_MS。 */
function renderServerTime(net: NetClient): number {
  return net.clientToServerTime(performance.now()) - SNAPSHOT_DELAY_MS;
}

/**
 * 纯函数：在缓冲里取夹住 renderTime（服务端时钟 ms）的两帧 + 混合因子 α∈[0,1]。
 * 边界情形自然落入数学：空缓冲→null；单帧/超出最新→s0===s1（冻结）；早于最旧→α 夹到 0。无特判分支。
 */
export function bracketAt(
  snaps: TimedSnapshot[],
  renderTime: number,
): { s0: TimedSnapshot; s1: TimedSnapshot; alpha: number } | null {
  if (snaps.length === 0) return null;
  let i0 = 0;
  for (let i = snaps.length - 1; i >= 0; i--) {
    if (snaps[i].t <= renderTime) {
      i0 = i;
      break;
    }
  }
  const s0 = snaps[i0];
  const s1 = snaps[i0 + 1] ?? s0;
  const span = s1.t - s0.t || 1;
  const alpha = clamp((renderTime - s0.t) / span, 0, 1);
  return { s0, s1, alpha };
}

function bracket(net: NetClient) {
  return bracketAt(net.snapshots, renderServerTime(net));
}

/** 其他玩家（排除自身）的插值快照：位置/朝向插值，其余字段取较新帧。 */
export function getInterpolatedPlayers(net: NetClient): PlayerSnapshot[] {
  if (!net.meta) return [];
  const br = bracket(net);
  if (!br) return [];
  const { s0, s1, alpha } = br;

  const s1Map = new Map<string, PlayerSnapshot>();
  for (const p of s1.players) s1Map.set(p.id, p);

  const result: PlayerSnapshot[] = [];
  const selfId = net.meta.selfId;
  for (const pa of s0.players) {
    if (pa.id === selfId) continue; // 自身走 prediction
    const pb = s1Map.get(pa.id);
    if (!pb) {
      result.push(pa);
      continue;
    }
    // 取较新帧全字段（游戏自定义字段一并带过），仅位置/朝向插值。
    result.push({
      ...pb,
      x: lerp(pa.x, pb.x, alpha),
      y: lerp(pa.y, pb.y, alpha),
      aim: lerpAngle(pa.aim, pb.aim, alpha),
    });
  }
  return result;
}

export function latestSnapshot(net: NetClient): TimedSnapshot | null {
  return net.snapshots[net.snapshots.length - 1] || null;
}
