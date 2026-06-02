/**
 * [INPUT]: 依赖 @shared 的 movePlayer / hypot / SELF_SNAP_DISTANCE / PlayerSnapshot / StateMsg；./types
 * [OUTPUT]: reconcileSelf / advanceSelfPrediction
 * [POS]: 客户端预测的物理大脑 —— 调 @shared.movePlayer，与服务端 simulation.step() 共用同一移动公式。
 *        公式不一致 = 预测与权威发散 = 人物持续抖动/拉扯。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { SELF_SNAP_DISTANCE, hypot, movePlayer } from '@shared';
import type { StateMsg } from '@shared';
import type { PendingInput, PredictedSelf, SessionMeta } from './types';

// 平滑纠正：半衰期式逼近权威位置（小偏差不硬拉，避免可见跳变）。
const CORRECTION_HALF_LIFE_S = 0.06;
const CORRECTION_K = Math.log(2) / CORRECTION_HALF_LIFE_S;
const CORRECTION_DONE_EPSILON_PX = 0.5;

/** 每渲染帧推进自身预测：应用当前输入移动 + 逼近纠正目标。 */
export function advanceSelfPrediction(
  self: PredictedSelf,
  input: { vx: number; vy: number; aim: number },
  dt: number,
  meta: SessionMeta,
  speed: number,
): void {
  if (self.alive) {
    const next = movePlayer({ x: self.x, y: self.y }, { x: input.vx, y: input.vy }, dt, speed, meta.mapW, meta.mapH);
    self.x = next.x;
    self.y = next.y;
    // 自身朝向信本地输入（即时）；不被服务端 ~50ms 前的 aim 回声往回拽。
    if (typeof input.aim === 'number') self.aim = input.aim;
  }

  if (self.correctionTargetX != null && self.correctionTargetY != null) {
    const k = 1 - Math.exp(-dt * CORRECTION_K);
    self.x += (self.correctionTargetX - self.x) * k;
    self.y += (self.correctionTargetY - self.y) * k;
    if (hypot(self.correctionTargetX - self.x, self.correctionTargetY - self.y) < CORRECTION_DONE_EPSILON_PX) {
      self.correctionTargetX = null;
      self.correctionTargetY = null;
    }
  }
}

/**
 * 收到权威快照 → 对齐自身预测：
 *   1. 从 auth 复制非运动权威字段（HUD 用）。
 *   2. 丢弃已 ack 的 pending 输入。
 *   3. 从 auth 位置回放未 ack 输入（与服务端同公式）→ 得到"服务端若处理完所有输入应在的位置"。
 *   4. 与当前预测比对：大偏差硬拉、中偏差设平滑纠正目标、小偏差忽略。
 */
export function reconcileSelf(
  prev: PredictedSelf | null,
  snap: StateMsg,
  meta: SessionMeta,
  pendingInputs: PendingInput[],
): PredictedSelf | null {
  const auth = snap.players.find((p) => p.id === meta.selfId);
  if (!auth) return prev;

  if (!prev) {
    return {
      id: auth.id,
      x: auth.x,
      y: auth.y,
      aim: auth.aim,
      alive: auth.alive,
      color: auth.color,
      username: auth.username,
      correctionTargetX: null,
      correctionTargetY: null,
      // MIGRATION: 这里补齐 PredictedSelf 镜像的非运动字段初值（如 hp: auth.hp, score: auth.score）。
    };
  }

  const wasAlive = prev.alive;
  const nowAlive = auth.alive;
  prev.alive = nowAlive;
  prev.color = auth.color;
  prev.username = auth.username;
  // MIGRATION: 这里把 auth 的非运动权威字段复制进 prev（prev.hp = auth.hp; prev.score = auth.score; ...）。

  // 丢弃已被服务端确认的输入
  const ack = auth.ack || 0;
  while (pendingInputs.length && pendingInputs[0].seq <= ack) {
    pendingInputs.shift();
  }

  // 从权威位置回放未 ack 输入（与服务端 movePlayer 一致）
  const speed = meta.playerSpeed;
  let replayX = auth.x;
  let replayY = auth.y;
  const nowT = performance.now();
  for (let i = 0; i < pendingInputs.length; i++) {
    const inp = pendingInputs[i];
    const next = pendingInputs[i + 1];
    const dur = ((next ? next.sentAt : nowT) - inp.sentAt) / 1000;
    if (dur <= 0) continue;
    const r = movePlayer({ x: replayX, y: replayY }, { x: inp.vx, y: inp.vy }, dur, speed, meta.mapW, meta.mapH);
    replayX = r.x;
    replayY = r.y;
  }

  const teleported = !wasAlive && nowAlive; // 重生 = 瞬移，直接对齐
  const dist = hypot(replayX - prev.x, replayY - prev.y);
  if (teleported || dist > SELF_SNAP_DISTANCE) {
    prev.x = replayX;
    prev.y = replayY;
    prev.correctionTargetX = null;
    prev.correctionTargetY = null;
  } else if (dist > 0.5) {
    prev.correctionTargetX = replayX;
    prev.correctionTargetY = replayY;
  } else {
    prev.correctionTargetX = null;
    prev.correctionTargetY = null;
  }
  return prev;
}
