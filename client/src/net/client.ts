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

export interface TopVoterSnapshot {
  readonly sid: string;
  readonly name: string;
  readonly contribution: number;
  readonly team: string;
  readonly teamCode: string;
  readonly camp: string;  // 'HOME' | 'DRAW' | 'AWAY' | ''
  /** Player's avatar tint + outfit at broadcast time. Drives the
   *  podium statue's appearance. */
  readonly color: string;
  readonly textureItems: string;
  readonly accessoryItems: string;
}

export interface TeamStandingSnapshot {
  readonly position: number;
  readonly team: string;
  readonly code: string;
  readonly played: number;
  readonly won: number;
  readonly draw: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalDifference: number;
  readonly points: number;
}
export interface GroupStandingSnapshot {
  readonly group: string;
  readonly teams: ReadonlyArray<TeamStandingSnapshot>;
}

/** Server-side fixture snapshot pushed via `event:fixtures`. Mirrors the
 *  shape the betting event broadcasts — kept here so the store can be
 *  typed without depending on server code. */
export interface BettingFixtureSnapshot {
  readonly id: string;
  readonly homeTeam: string;
  readonly awayTeam: string;
  readonly homeCode: string;
  readonly awayCode: string;
  readonly kickoffMs: number;
  readonly status: string;
  readonly scoreHome: number;
  readonly scoreAway: number;
  readonly minute: number;
  readonly result: 'HOME' | 'DRAW' | 'AWAY' | null;
  readonly poolHome: number;
  readonly poolDraw: number;
  readonly poolAway: number;
  readonly countHome: number;
  readonly countDraw: number;
  readonly countAway: number;
  readonly phase: 'AWAIT_BET' | 'BET_WINDOW' | 'LIVE' | 'RESOLVED';
}

export interface NetClientCallbacks {
  onStatus?: (status: NetStatus) => void;
  onHello?: (meta: SessionMeta) => void;
  onEvent?: (event: ServerEvent) => void;
  onState?: (snapshot: TimedSnapshot) => void;
  onIdentity?: (status: IdentityStatus) => void;
  /** Fired when ANY player (including self) jumps. The server validates
   *  + rate-limits and broadcasts back; clients trigger the visual hop
   *  on the avatar matching `sessionId`. */
  onJump?: (sessionId: string) => void;
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
  /** Last input-seq the server confirmed it applied. Used by reconcile
   *  to drop already-applied pending inputs from the replay buffer.
   *  Filled from a targeted `ack` message — formerly lived in the
   *  per-player schema and was broadcast wastefully to every peer. */
  private confirmedAck = 0;
  /** Cold identity + outfit cache (was per-tick schema, now event-driven
   *  via `roster-*` messages). The schema only carries x/y/aim now;
   *  every PlayerSnapshot we build merges in the matching roster row.
   *  Populated on first connect via `roster-request`, then patched by
   *  `roster-update` broadcasts when anyone equips or renames. */
  private readonly roster = new Map<string, {
    username: string;
    color: string;
    textureItems: string;
    accessoryItems: string;
  }>();
  /** Sids we've already asked for one-off roster fills. Prevents request
   *  storms when the same player appears in the schema before the
   *  server has responded. */
  private readonly rosterRequested = new Set<string>();
  /** Server-confirmed jump events queued for the next render frame to
   *  drain. Each entry is the sessionId of the player that jumped — the
   *  render loop maps it to that avatar and triggers the visual hop. */
  readonly pendingJumps: string[] = [];
  /** Server-confirmed compliment events: from → to. Render loop drains
   *  one per frame: triggers a floating-heart visual on the recipient,
   *  and if THIS client is the recipient, awards the coin bonus. */
  readonly pendingCompliments: Array<{ from: string; to: string }> = [];
  /** Server-confirmed wave emote events. Plays a wave animation on the
   *  matching avatar (the sender's). */
  readonly pendingWaves: string[] = [];
  /** Server-pushed match fixtures (with live scores + pool sizes). The
   *  HUD reads this through the store to render the match ticker +
   *  betting popup. Snapshot fan-out below. */
  bettingFixtures: ReadonlyArray<BettingFixtureSnapshot> = [];
  /** Group-stage standings (12 groups × 4 teams for the 2026 WC). Pushed
   *  via `event:standings`. Updated daily from the server poller. */
  bettingStandings: ReadonlyArray<GroupStandingSnapshot> = [];
  /** Server-wide top-up pool — sum of every bet in this room session,
   *  drives the milestone ladder + monument display. */
  bettingPool = 0;
  /** Milestone tier indexes already crossed + paid out. */
  bettingPoolUnlocked: readonly number[] = [];
  /** One-shot queue: targeted milestone rewards waiting for the render
   *  loop to award coins + show toast. scope = 'server' for the shared
   *  pool tiers, 'personal' for the player's own contribution tiers. */
  readonly pendingMilestoneRewards: Array<{
    scope: 'server' | 'personal';
    tier: number; threshold: number; reward: number; label: string;
  }> = [];
  /** Personal lifetime contribution + unlocked personal-tier indexes. */
  bettingMyContribution = 0;
  bettingMyUnlocked: readonly number[] = [];
  /** Top-10 voters by lifetime contribution, sorted DESC. Server
   *  broadcasts on each bet and on join. */
  bettingTopVoters: ReadonlyArray<TopVoterSnapshot> = [];
  /** Targeted bet confirmations from the server. Queue drained by the
   *  render loop to deduct from local balance + show confirmation toast. */
  readonly pendingBetConfirms: Array<{ matchId: string; camp: string; amount: number }> = [];
  /** Targeted resolve payouts (one entry per match result you bet on).
   *  Render loop credits coins + shows the result toast. */
  readonly pendingBetResults: Array<{
    matchId: string; result: string; payout: number; profit: number; camp: string;
  }> = [];
  /** Soccer ball server-authoritative state. Server broadcasts 'ball:state'
   *  on every kick + every motion tick (~20Hz while moving, 0Hz at rest).
   *  Render loop reads `ballState` each frame and lerps the ball mesh
   *  toward the target. `ballRecvAt` is wall-clock ms of receipt for
   *  interpolation delay. */
  ballState: {
    x: number; z: number; vx: number; vy: number;
    kicker: string; kickerName: string;
    scoreN: number; scoreS: number;
  } = { x: 158, z: 32, vx: 0, vy: 0, kicker: '', kickerName: '', scoreN: 0, scoreS: 0 };
  ballRecvAt = 0;
  /** Goal events queued for the render loop to drain — show banner +
   *  if this client was the kicker, award the goal-reward coins. */
  readonly pendingBallGoals: Array<{
    scorerSid: string; scorerName: string;
    side: 'N' | 'S'; scoreN: number; scoreS: number; reward: number;
  }> = [];
  private inputSeq = 0;

  serverClockOffset: number | null = null;
  identityStatus: IdentityStatus | null = null;
  private lastInputSentAt = 0;

  constructor(callbacks: NetClientCallbacks = {}) {
    this.cbs = callbacks;
  }

  /** 连接 Colyseus 房间。token/gameId 搭车 join opts（服务端 decodeIdentity 用，做身份/存档）。
   *  `outfit` also rides the join opts: server addPlayer accepts
   *  textureItems/accessoryItems so a returning player walks in already
   *  wearing their persisted outfit instead of flashing the default.
   *  `name` is the display name (host-App username when available) — the
   *  server prefers the token's userName over this when a token decodes,
   *  so inside the App the name can't drift from the real account. */
  async connect(
    roomCode: string,
    token?: string,
    gameId?: number,
    outfit?: { textureItems: string; accessoryItems: string },
    name?: string,
  ): Promise<void> {
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
      const displayName = (name ?? '').trim().slice(0, 16) || 'player';
      const opts: Record<string, unknown> = { code: roomCode, name: displayName };
      if (token) opts.token = token;
      if (gameId != null) opts.gameId = gameId;
      if (outfit) {
        if (outfit.textureItems) opts.textureItems = outfit.textureItems;
        if (outfit.accessoryItems) opts.accessoryItems = outfit.accessoryItems;
      }

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
        // Seed with the requested display name; tryFireHello overwrites it
        // with the server's roster row (authoritative — the server may have
        // preferred the token's userName over what we sent).
        username: displayName,
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
      // Targeted ack from the server — used by reconcileSelf to prune
      // already-applied pending inputs. See server messages.ts.
      room.onMessage('ack', (seq: unknown) => {
        const n = typeof seq === 'number' ? seq : Number(seq);
        if (Number.isFinite(n) && n > this.confirmedAck) this.confirmedAck = n;
      });
      room.onMessage('jump', (m: { from?: unknown } | undefined) => {
        const from = typeof m?.from === 'string' ? m.from : '';
        if (!from) return;
        this.pendingJumps.push(from);
        this.cbs.onJump?.(from);
      });
      room.onMessage('compliment', (m: { from?: unknown; to?: unknown } | undefined) => {
        const from = typeof m?.from === 'string' ? m.from : '';
        const to = typeof m?.to === 'string' ? m.to : '';
        if (!from || !to) return;
        this.pendingCompliments.push({ from, to });
      });
      room.onMessage('wave', (m: { from?: unknown } | undefined) => {
        const from = typeof m?.from === 'string' ? m.from : '';
        if (!from) return;
        this.pendingWaves.push(from);
      });
      // Roster snapshot — server's reply to our `roster-request`. Bulk
      // fill (initial connect, no sid filter) OR single-record fill
      // (when a new sid appeared in the schema). Either way, just merge.
      room.onMessage('roster-snapshot', (m: { players?: unknown } | undefined) => {
        const list = Array.isArray(m?.players) ? m!.players as unknown[] : [];
        for (const entry of list) {
          if (!entry || typeof entry !== 'object') continue;
          const r = entry as Record<string, unknown>;
          const sid = typeof r.sid === 'string' ? r.sid : '';
          if (!sid) continue;
          this.roster.set(sid, {
            username: typeof r.username === 'string' ? r.username : 'anon',
            color: typeof r.color === 'string' ? r.color : '#7bb6e8',
            textureItems: typeof r.textureItems === 'string' ? r.textureItems : '',
            accessoryItems: typeof r.accessoryItems === 'string' ? r.accessoryItems : '',
          });
        }
        // First time we have self's identity → maybe fire hello.
        this.tryFireHello();
      });
      // Roster delta — broadcast on equip / rename. Only the changed
      // fields are present; merge them into the cache.
      room.onMessage('roster-update', (m: { sid?: unknown; fields?: unknown } | undefined) => {
        const sid = typeof m?.sid === 'string' ? m.sid : '';
        if (!sid) return;
        const fields = (m?.fields && typeof m.fields === 'object') ? m.fields as Record<string, unknown> : {};
        const cur = this.roster.get(sid) ?? {
          username: 'anon', color: '#7bb6e8', textureItems: '', accessoryItems: '',
        };
        if (typeof fields.username === 'string') cur.username = fields.username;
        if (typeof fields.color === 'string') cur.color = fields.color;
        if (typeof fields.textureItems === 'string') cur.textureItems = fields.textureItems;
        if (typeof fields.accessoryItems === 'string') cur.accessoryItems = fields.accessoryItems;
        this.roster.set(sid, cur);
      });
      // Ask the server for the full roster as soon as the room opens.
      // The schema's `players` map gives us positions, but identities
      // and outfits come back via this initial bulk fill (then incremental
      // roster-update on changes).
      room.send('roster-request');

      // Betting event subscriptions.
      room.onMessage('event:fixtures', (m: { fixtures?: unknown } | undefined) => {
        const list = Array.isArray(m?.fixtures) ? m!.fixtures as unknown[] : [];
        const out: BettingFixtureSnapshot[] = [];
        for (const f of list) {
          if (!f || typeof f !== 'object') continue;
          const r = f as Record<string, unknown>;
          if (typeof r.id !== 'string') continue;
          out.push({
            id: r.id,
            homeTeam: String(r.homeTeam ?? ''),
            awayTeam: String(r.awayTeam ?? ''),
            homeCode: String(r.homeCode ?? ''),
            awayCode: String(r.awayCode ?? ''),
            kickoffMs: Number(r.kickoffMs) || 0,
            status: String(r.status ?? 'SCHEDULED'),
            scoreHome: Number(r.scoreHome) || 0,
            scoreAway: Number(r.scoreAway) || 0,
            minute: Number(r.minute) || 0,
            result: (r.result === 'HOME' || r.result === 'DRAW' || r.result === 'AWAY') ? r.result : null,
            poolHome: Number(r.poolHome) || 0,
            poolDraw: Number(r.poolDraw) || 0,
            poolAway: Number(r.poolAway) || 0,
            countHome: Number(r.countHome) || 0,
            countDraw: Number(r.countDraw) || 0,
            countAway: Number(r.countAway) || 0,
            phase: (r.phase === 'AWAIT_BET' || r.phase === 'BET_WINDOW' || r.phase === 'LIVE' || r.phase === 'RESOLVED') ? r.phase : 'AWAIT_BET',
          });
        }
        this.bettingFixtures = out;
      });
      room.onMessage('event:bet-update', (m: { matchId?: unknown; poolHome?: unknown; poolDraw?: unknown; poolAway?: unknown; countHome?: unknown; countDraw?: unknown; countAway?: unknown } | undefined) => {
        const id = typeof m?.matchId === 'string' ? m.matchId : '';
        if (!id) return;
        // Patch the cached fixture in place so live odds reflect immediately.
        const idx = this.bettingFixtures.findIndex((f) => f.id === id);
        if (idx < 0) return;
        const cur = this.bettingFixtures[idx];
        const next: BettingFixtureSnapshot = {
          ...cur,
          poolHome: Number(m?.poolHome) || cur.poolHome,
          poolDraw: Number(m?.poolDraw) || cur.poolDraw,
          poolAway: Number(m?.poolAway) || cur.poolAway,
          countHome: Number(m?.countHome) || cur.countHome,
          countDraw: Number(m?.countDraw) || cur.countDraw,
          countAway: Number(m?.countAway) || cur.countAway,
        };
        const arr = [...this.bettingFixtures];
        arr[idx] = next;
        this.bettingFixtures = arr;
      });
      room.onMessage('event:bet-ok', (m: { matchId?: unknown; camp?: unknown; amount?: unknown } | undefined) => {
        const matchId = typeof m?.matchId === 'string' ? m.matchId : '';
        const camp = typeof m?.camp === 'string' ? m.camp : '';
        const amount = Number(m?.amount);
        if (!matchId || !camp || !Number.isFinite(amount)) return;
        this.pendingBetConfirms.push({ matchId, camp, amount });
      });
      room.onMessage('event:resolve-self', (m: { matchId?: unknown; result?: unknown; payout?: unknown; profit?: unknown; camp?: unknown } | undefined) => {
        const matchId = typeof m?.matchId === 'string' ? m.matchId : '';
        const result = typeof m?.result === 'string' ? m.result : '';
        const payout = Number(m?.payout);
        const profit = Number(m?.profit);
        const camp = typeof m?.camp === 'string' ? m.camp : '';
        if (!matchId || !result) return;
        this.pendingBetResults.push({ matchId, result, payout, profit, camp });
      });
      room.onMessage('event:standings', (m: { groups?: unknown } | undefined) => {
        const list = Array.isArray(m?.groups) ? m!.groups as unknown[] : [];
        const out: GroupStandingSnapshot[] = [];
        for (const g of list) {
          if (!g || typeof g !== 'object') continue;
          const gr = g as Record<string, unknown>;
          const groupName = typeof gr.group === 'string' ? gr.group : '';
          if (!groupName) continue;
          const teams: TeamStandingSnapshot[] = [];
          const teamArr = Array.isArray(gr.teams) ? gr.teams as unknown[] : [];
          for (const t of teamArr) {
            if (!t || typeof t !== 'object') continue;
            const tr = t as Record<string, unknown>;
            teams.push({
              position: Number(tr.position) || 0,
              team: typeof tr.team === 'string' ? tr.team : '',
              code: typeof tr.code === 'string' ? tr.code : '',
              played: Number(tr.played) || 0,
              won: Number(tr.won) || 0,
              draw: Number(tr.draw) || 0,
              lost: Number(tr.lost) || 0,
              goalsFor: Number(tr.goalsFor) || 0,
              goalsAgainst: Number(tr.goalsAgainst) || 0,
              goalDifference: Number(tr.goalDifference) || 0,
              points: Number(tr.points) || 0,
            });
          }
          teams.sort((a, b) => a.position - b.position);
          out.push({ group: groupName, teams });
        }
        out.sort((a, b) => a.group.localeCompare(b.group));
        this.bettingStandings = out;
      });
      room.onMessage('event:pool-update', (m: { pool?: unknown; unlocked?: unknown } | undefined) => {
        const pool = Number(m?.pool);
        if (Number.isFinite(pool) && pool >= 0) this.bettingPool = pool;
        const arr = Array.isArray(m?.unlocked) ? m!.unlocked as unknown[] : [];
        const ids: number[] = [];
        for (const n of arr) {
          const v = typeof n === 'number' ? n : Number(n);
          if (Number.isFinite(v)) ids.push(v);
        }
        this.bettingPoolUnlocked = ids;
      });
      room.onMessage('event:milestone-reward', (m: { scope?: unknown; tier?: unknown; threshold?: unknown; reward?: unknown; label?: unknown } | undefined) => {
        const scope = (m?.scope === 'personal') ? 'personal' as const : 'server' as const;
        const tier = Number(m?.tier);
        const threshold = Number(m?.threshold);
        const reward = Number(m?.reward);
        const label = typeof m?.label === 'string' ? m.label : '';
        if (!Number.isFinite(tier) || !Number.isFinite(reward)) return;
        this.pendingMilestoneRewards.push({ scope, tier, threshold, reward, label });
      });
      room.onMessage('event:top-voters', (m: { entries?: unknown } | undefined) => {
        const list = Array.isArray(m?.entries) ? m!.entries as unknown[] : [];
        const out: TopVoterSnapshot[] = [];
        for (const e of list) {
          if (!e || typeof e !== 'object') continue;
          const r = e as Record<string, unknown>;
          if (typeof r.sid !== 'string') continue;
          out.push({
            sid: r.sid,
            name: typeof r.name === 'string' ? r.name : '',
            contribution: Number(r.contribution) || 0,
            team: typeof r.team === 'string' ? r.team : '',
            teamCode: typeof r.teamCode === 'string' ? r.teamCode : '',
            camp: typeof r.camp === 'string' ? r.camp : '',
            color: typeof r.color === 'string' ? r.color : '#7bb6e8',
            textureItems: typeof r.textureItems === 'string' ? r.textureItems : '',
            accessoryItems: typeof r.accessoryItems === 'string' ? r.accessoryItems : '',
          });
        }
        this.bettingTopVoters = out;
      });
      room.onMessage('event:personal-update', (m: { contribution?: unknown; unlocked?: unknown } | undefined) => {
        const c = Number(m?.contribution);
        if (Number.isFinite(c) && c >= 0) this.bettingMyContribution = c;
        const arr = Array.isArray(m?.unlocked) ? m!.unlocked as unknown[] : [];
        const ids: number[] = [];
        for (const n of arr) {
          const v = typeof n === 'number' ? n : Number(n);
          if (Number.isFinite(v)) ids.push(v);
        }
        this.bettingMyUnlocked = ids;
      });
      // Ask for the initial snapshot.
      room.send('event:request-fixtures');

      // ─── Soccer ball — server-authoritative position + kicks ──────────
      room.onMessage('ball:state', (m: {
        x?: unknown; z?: unknown; vx?: unknown; vy?: unknown;
        kicker?: unknown; kickerName?: unknown;
        scoreN?: unknown; scoreS?: unknown;
      } | undefined) => {
        if (!m) return;
        this.ballState = {
          x: Number(m.x) || 158,
          z: Number(m.z) || 32,
          vx: Number(m.vx) || 0,
          vy: Number(m.vy) || 0,
          kicker: typeof m.kicker === 'string' ? m.kicker : '',
          kickerName: typeof m.kickerName === 'string' ? m.kickerName : '',
          scoreN: Number(m.scoreN) || 0,
          scoreS: Number(m.scoreS) || 0,
        };
        this.ballRecvAt = Date.now();
      });
      room.onMessage('ball:goal', (m: {
        scorerSid?: unknown; scorerName?: unknown;
        side?: unknown; scoreN?: unknown; scoreS?: unknown; reward?: unknown;
      } | undefined) => {
        if (!m) return;
        this.pendingBallGoals.push({
          scorerSid: typeof m.scorerSid === 'string' ? m.scorerSid : '',
          scorerName: typeof m.scorerName === 'string' ? m.scorerName : '',
          side: m.side === 'N' || m.side === 'S' ? m.side : 'N',
          scoreN: Number(m.scoreN) || 0,
          scoreS: Number(m.scoreS) || 0,
          reward: Number(m.reward) || 0,
        });
      });
      room.send('ball:request');

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
    this.confirmedAck = 0;
    this.roster.clear();
    this.rosterRequested.clear();
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
    const myAck = this.confirmedAck;
    const selfSid = this.meta?.selfId ?? '';
    // Build a set of sids currently in the schema so we can prune
    // roster entries for players who left (no broadcast needed —
    // disappearance from the map IS the leave signal).
    const liveSids = new Set<string>();
    s.players.forEach((p, id) => {
      liveSids.add(id);
      // BANDWIDTH: identity + outfit no longer travel in the schema.
      // Fall back to roster cache; if we don't have a record yet, ask
      // the server for this one sid (rate-limited by rosterRequested).
      let r = this.roster.get(id);
      if (!r) {
        if (!this.rosterRequested.has(id) && this.room) {
          this.rosterRequested.add(id);
          this.room.send('roster-request', { sid: id });
        }
        r = { username: 'anon', color: '#7bb6e8', textureItems: '', accessoryItems: '' };
      }
      players.push({
        id,
        x: p.x as number,
        y: p.y as number,
        aim: p.aim as number,
        // BANDWIDTH: alive/color/username/outfit removed from per-tick
        // schema. alive is hard-coded true (no death mechanic); the
        // rest come from the roster cache.
        alive: true,
        color: r.color,
        username: r.username,
        ack: id === selfSid ? myAck : 0,
        textureItems: r.textureItems,
        accessoryItems: r.accessoryItems,
      });
    });
    // Prune roster + request-set for players who disconnected.
    for (const sid of this.roster.keys()) {
      if (!liveSids.has(sid)) {
        this.roster.delete(sid);
        this.rosterRequested.delete(sid);
      }
    }

    // MIGRATION: 共享世界实体（怪/道具/子弹）在此仿 players 解码成数组并挂到快照上。

    const t = s.t || performance.now();

    // 首帧拿到 self → 补全 meta（color/username）+ 发 hello（一次）。
    // BANDWIDTH: color + username are no longer in the schema, so we
    // also need the roster row for selfId before we can fire hello with
    // real values (vs. 'anon' / default color). If the roster snapshot
    // hasn't arrived yet, defer — `tryFireHello` is called again from
    // the roster-snapshot handler, whichever lands second wins.
    this.tryFireHello();

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

  /** Fire the onHello callback once we have BOTH the schema (so we know
   *  the room's playing field — selfId already came from sessionId) AND
   *  the roster row for self (the cold identity fields that used to be
   *  in the schema). Called from both onStateChange and the
   *  roster-snapshot/roster-update handlers; only the second arrival
   *  actually fires. */
  private tryFireHello(): void {
    if (!this.meta || this.helloSent) return;
    const r = this.roster.get(this.meta.selfId);
    if (!r) return;
    this.meta.selfColor = r.color;
    this.meta.username = r.username;
    this.helloSent = true;
    this.cbs.onHello?.(this.meta);
  }

  private setStatus(s: NetStatus): void {
    this.status = s;
    this.cbs.onStatus?.(s);
  }
}
