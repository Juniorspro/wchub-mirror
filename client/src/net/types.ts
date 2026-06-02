/**
 * [INPUT]: 依赖 @shared 的 PlayerSnapshot / StateMsg
 * [OUTPUT]: SessionMeta / PendingInput / PredictedSelf / TimedSnapshot / IdentityStatus / LeaderboardRow
 * [POS]: net 层内部类型 —— 仅客户端可见（server 用 @colyseus/schema，不 import 这些）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { PlayerSnapshot, StateMsg } from '@shared';

/** 连接成功后一次性确定的会话元信息（自身 id / 世界尺寸 / 速度）。 */
export interface SessionMeta {
  selfId: string;
  selfColor: string;
  username: string;
  mapW: number;
  mapH: number;
  playerSpeed: number;
  // MIGRATION: 预测需要的、连接期即固定的游戏参数放这里（如玩家半径、碰撞几何、出生点）。
}

/** 已发出、尚未被服务端 ack 的输入（reconcile 时回放）。 */
export interface PendingInput {
  seq: number;
  vx: number;
  vy: number;
  sentAt: number;
}

/**
 * 自身预测态（本地即时响应，服务端权威到达后 reconcile）。
 * 核心是运动字段；其余服务端权威字段从快照镜像过来供 HUD/渲染读。
 */
export interface PredictedSelf {
  id: string;
  x: number;
  y: number;
  aim: number;
  alive: boolean;
  color: string;
  username: string;
  /** 平滑纠正目标（reconcile 设定，advanceSelfPrediction 每帧逼近）；null=无纠正。 */
  correctionTargetX: number | null;
  correctionTargetY: number | null;
  // MIGRATION: 镜像服务端权威的非运动字段（hp/score/level/...）供自身 HUD 读，
  //   在 reconcileSelf 里从 auth 快照复制。
}

/** 服务端快照 + 客户端收到时刻（插值用）。 */
export interface TimedSnapshot extends StateMsg {
  recvAt: number; // performance.now() at receive
}

/** 服务端身份回显（room "whoami" → "identity"）：decodeIdentity 的结果。 */
export interface IdentityStatus {
  hasIdentity: boolean; // false = 服务端把你当 guest（不存档）
  userID: number | null;
  gameId: number | null;
  username: string | null;
}

/** 排行榜单行（客户端读 topScores / 服务端回传）。 */
export interface LeaderboardRow {
  rank: number;
  name: string;
  score: number;
}
