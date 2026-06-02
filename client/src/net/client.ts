/**
 * [INPUT]: 依赖 colyseus.js (Client/Room)；@shared (常量 + normalizeInput + 快照/事件类型)；./prediction；./types
 * [OUTPUT]: NetClient 类（meta / predictedSelf / snapshots / 回调）+ NetStatus / NetClientCallbacks
 * [POS]: 客户端同步层门面 —— 连 colyseus.js，onStateChange 把 @colyseus/schema 转成 plain 快照
 *        喂给 prediction/interpolation。游戏的 controller/render 只读 net，不碰 Colyseus 细节。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * MIGRATION 扩展点（搜 "MIGRATION:"）：
 *   1. onStateChange 解码循环：补齐你在 @shared/protocol.PlayerSnapshot 里加的游戏字段。
 *   2. 共享世界实体（怪/道具/子弹）：仿 players 解码成并列数组，挂到快照上。
 *   3. 游戏专属上行操作（开火/技能/升级）：用通用 send(type, payload) 或仿 sendInput 加方法。
 */

import { Client, Room } from 'colyseus.js';
import {
  MAP_H,
  MAP_W,
  PENDING_INPUTS_CAP,
  PLAYER_SPEED,
  SNAPSHOT_BUFFER_CAP,
  TICK_MS,
  normalizeInput,
} from '@shared';
import type { PlayerSnapshot, ServerEvent, StateMsg } from '@shared';
import { reconcileSelf } from './prediction';
import type { IdentityStatus, PendingInput, PredictedSelf, SessionMeta, TimedSnapshot } from './types';

export type NetStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface NetClientCallbacks {
  onStatus?: (status: NetStatus) => void;
  onHello?: (meta: SessionMeta) => void;
  onEvent?: (event: ServerEvent) => void;
  onState?: (snapshot: TimedSnapshot) => void;
  onIdentity?: (status: IdentityStatus) => void;
}

// 注入的运行时配置（vite injectGameConfigPlugin / Worker /game.config.js → window.GAME_CONFIG）。
interface GameConfigView {
  roomName: string;
  port: number;
}
function gameConfig(): GameConfigView {
  const c = (window as unknown as { GAME_CONFIG?: Partial<GameConfigView> }).GAME_CONFIG ?? {};
  return { roomName: c.roomName ?? 'arena', port: c.port ?? 2567 };
}

const INPUT_SEND_INTERVAL_MS = TICK_MS;
// joinOrCreate 无内建超时：Container 冷启动 / 代理 WS 停滞可能永不 settle。
// race 一个 deadline，把"永久 connecting"翻成真实 error，上层据此重试。
const CONNECT_TIMEOUT_MS = 25_000;

export class NetClient {
  meta: SessionMeta | null = null;
  roomCode = '';
  status: NetStatus = 'idle';
  private room: Room | null = null;
  private cbs: NetClientCallbacks;
  private helloSent = false;

  readonly snapshots: TimedSnapshot[] = [];
  predictedSelf: PredictedSelf | null = null;
  readonly pendingInputs: PendingInput[] = [];
  private inputSeq = 0;

  serverClockOffset: number | null = null;
  identityStatus: IdentityStatus | null = null;
  private lastInputSentAt = 0;

  constructor(callbacks: NetClientCallbacks = {}) {
    this.cbs = callbacks;
  }

  /** 连接 Colyseus 房间。token/gameId 搭车 join opts（服务端 decodeIdentity 用，做身份/存档）。 */
  async connect(roomCode: string, token?: string, gameId?: number): Promise<void> {
    this.disconnect();
    this.roomCode = roomCode;
    this.setStatus('connecting');
    try {
      const { roomName, port } = gameConfig();
      const loc = window.location;
      const forceProd = new URLSearchParams(loc.search).get('prod') === '1';
      const isLocal = !forceProd && ['localhost', '127.0.0.1', ''].includes(loc.hostname);
      const proto = forceProd || loc.protocol === 'https:' ? 'wss:' : 'ws:';
      // dev standalone：直连 :port colyseus；生产：经 Worker /rooms/:code 转发到 Container。
      const standaloneLocal = isLocal && loc.port !== '8787';
      const endpoint = standaloneLocal
        ? `${proto}//localhost:${port}`
        : `${proto}//${loc.host}/rooms/${encodeURIComponent(roomCode)}`;

      const client = new Client(endpoint);
      const opts: Record<string, unknown> = { code: roomCode, name: 'player' };
      if (token) opts.token = token;
      if (gameId != null) opts.gameId = gameId;

      let timedOut = false;
      const join = client.joinOrCreate(roomName, opts);
      join
        .then((r) => {
          if (timedOut) {
            try {
              r.leave();
            } catch {
              /* ignore late resolve after timeout */
            }
          }
        })
        .catch(() => {
          /* 超时已 reject；吞掉迟到失败避免 unhandledrejection */
        });

      let timer: ReturnType<typeof setTimeout> | undefined;
      const room = await Promise.race([
        join,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('connect timeout'));
          }, CONNECT_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);
      this.room = room;
      this.setStatus('connected');

      const liveCode = ((room.state as { code?: string })?.code as string) || roomCode;
      this.roomCode = liveCode;
      this.meta = {
        selfId: room.sessionId,
        selfColor: '',
        username: 'player',
        mapW: MAP_W,
        mapH: MAP_H,
        playerSpeed: PLAYER_SPEED,
      };

      room.onStateChange((state) => this.onStateChange(state));
      room.onMessage('event', (e: ServerEvent) => this.cbs.onEvent?.(e));
      room.onMessage('identity', (m: IdentityStatus) => {
        this.identityStatus = m;
        this.cbs.onIdentity?.(m);
      });
      room.onMessage('pong', () => {});
      room.onLeave(() => this.setStatus('disconnected'));
      room.onError(() => this.setStatus('error'));
    } catch {
      this.setStatus('error');
    }
  }

  disconnect(): void {
    if (this.room) {
      try {
        this.room.leave();
      } catch {
        /* ignore */
      }
    }
    this.room = null;
    this.helloSent = false;
    this.snapshots.length = 0;
    this.pendingInputs.length = 0;
    this.predictedSelf = null;
    this.serverClockOffset = null;
    this.identityStatus = null;
    this.inputSeq = 0;
    this.meta = null;
    this.roomCode = '';
  }

  /** 发移动 + 朝向输入（节流到 tick 间隔）。本地入 pendingInputs 供 reconcile 回放。 */
  sendInput(rawVx: number, rawVy: number, aim: number): void {
    if (!this.room) return;
    const now = performance.now();
    if (now - this.lastInputSentAt < INPUT_SEND_INTERVAL_MS) return;

    const { x: vx, y: vy } = normalizeInput(rawVx, rawVy);
    this.inputSeq++;
    this.pendingInputs.push({ seq: this.inputSeq, vx, vy, sentAt: now });
    while (this.pendingInputs.length > PENDING_INPUTS_CAP) this.pendingInputs.shift();
    this.room.send('input', { seq: this.inputSeq, vx, vy, aim });
    this.lastInputSentAt = now;
  }

  /** 通用上行：游戏专属操作（开火/技能/升级/交互）走这条，服务端在 messages.ts 注册同名 onMessage。 */
  send(type: string, payload?: unknown): void {
    this.room?.send(type, payload);
  }

  /** 问服务端"我是谁"（它 decodeIdentity 出的身份）；响应经 onIdentity 回调 + identityStatus 字段。 */
  requestWhoami(): void {
    this.room?.send('whoami');
  }

  clientToServerTime(clientNow: number): number {
    return clientNow + (this.serverClockOffset ?? 0);
  }

  isOpen(): boolean {
    return this.room != null;
  }

  /** schema state → plain 快照，喂 reconcile + 插值缓冲。 */
  private onStateChange(state: unknown): void {
    const recvAt = performance.now();
    const s = state as {
      t: number;
      code?: string;
      players: { forEach: (cb: (p: Record<string, unknown>, id: string) => void) => void };
    };

    const players: PlayerSnapshot[] = [];
    s.players.forEach((p, id) => {
      players.push({
        id,
        x: p.x as number,
        y: p.y as number,
        aim: p.aim as number,
        alive: p.alive as boolean,
        color: p.color as string,
        username: p.username as string,
        ack: p.ack as number,
        // MIGRATION: 在此补齐你加到 PlayerSnapshot 的游戏字段，例如 hp: p.hp as number,
      });
    });

    // MIGRATION: 共享世界实体（怪/道具/子弹）在此仿 players 解码成数组并挂到快照上。

    const t = s.t || performance.now();

    // 首帧拿到 self → 补全 meta（color/username）+ 发 hello（一次）
    if (this.meta && !this.helloSent) {
      const self = players.find((p) => p.id === this.meta!.selfId);
      if (self) {
        this.meta.selfColor = self.color;
        this.meta.username = self.username;
        this.helloSent = true;
        this.cbs.onHello?.(this.meta);
      }
    }

    const tagged: TimedSnapshot = { t, players, recvAt };
    this.snapshots.push(tagged);
    while (this.snapshots.length > SNAPSHOT_BUFFER_CAP) this.snapshots.shift();

    // 重阻尼 EMA 估服务端-客户端时钟偏移（插值时间基准）
    const raw = t - recvAt;
    this.serverClockOffset = this.serverClockOffset == null ? raw : this.serverClockOffset * 0.9 + raw * 0.1;

    const snap: StateMsg = { t, players };
    if (this.meta) {
      this.predictedSelf = reconcileSelf(this.predictedSelf, snap, this.meta, this.pendingInputs);
    }
    this.cbs.onState?.(tagged);
  }

  private setStatus(s: NetStatus): void {
    this.status = s;
    this.cbs.onStatus?.(s);
  }
}
