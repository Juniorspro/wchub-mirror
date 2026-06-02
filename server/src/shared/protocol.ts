/**
 * [INPUT]: 无（纯类型）
 * [OUTPUT]: ClientMsg(InputMsg) / ServerEvent / PlayerSnapshot / StateMsg
 * [POS]: server/src/shared 的协议边界 —— Colyseus 化后只承载【输入消息 + 瞬时事件 + 客户端快照 DTO】。
 *        玩家/实体的【持续状态】由 server/src/game/state.ts 的 @colyseus/schema 承载，不在此重复。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * 分工：
 *   - @colyseus/schema（state.ts）：每 tick 自动 diff 同步的【持续状态】（位置/血量/分数…）。
 *   - ServerEvent（broadcast）：一次性【瞬时事件】（命中/拾取/升级/死亡特效触发）。
 *   - PlayerSnapshot/StateMsg：NetClient 把 schema 读出后转成的 plain DTO，喂 prediction/interpolation。
 */

// ══════════════════════════════════════════════
// Client → Server（Colyseus room.send 的 payload）
// ══════════════════════════════════════════════

/** 标准移动 + 朝向输入。每个游戏都用这一条移动通道。 */
export interface InputMsg {
  type: 'input';
  seq: number; // 客户端自增序号 → 服务端回显 ack → 客户端 reconcile
  vx: number; // 归一化输入 x ∈ [-1,1]
  vy: number; // 归一化输入 y ∈ [-1,1]
  aim: number; // 朝向角（弧度）
}

// MIGRATION: 把单机游戏的"非移动操作"加成额外消息类型（开火/技能/升级/交互），
//   例如：export interface ActionMsg { type: 'action'; kind: string }
export type ClientMsg = InputMsg;

// ══════════════════════════════════════════════
// Server → Client 瞬时事件（room.broadcast / client.send "event"）
// ══════════════════════════════════════════════

/**
 * 瞬时事件基形。每个游戏按需收窄成联合类型，例如：
 *   export interface HitEvent { type: 'hit'; attackerId: string; victimId: string; dmg: number }
 *   export type ServerEvent = HitEvent | PickupEvent | ...
 */
export interface ServerEvent {
  type: string;
  [field: string]: unknown;
}

// ══════════════════════════════════════════════
// 客户端快照 DTO（NetClient 从 @colyseus/schema 读出后转成 plain，喂 prediction/interpolation）
// server 不 import 这些（server 用 schema）；放 shared 让 client 各层统一经 @shared 取用。
// ══════════════════════════════════════════════

export interface PlayerSnapshot {
  id: string;
  x: number;
  y: number;
  aim: number;
  alive: boolean;
  color: string;
  username: string;
  ack: number; // 最近已应用的输入 seq → reconcile
  // Dressup Lounge — every player's outfit, CSV ids parsed client-side
  // by actor.applyOutfit. Sync over the schema so remote players see
  // each other's clothing changes.
  textureItems: string;
  accessoryItems: string;
}

export interface StateMsg {
  t: number; // 服务端 epoch ms（插值时间基准）
  players: PlayerSnapshot[];
  // MIGRATION: 共享世界实体（怪/道具/子弹）按需加成并列数组，例如 mobs: MobSnapshot[]。
}
