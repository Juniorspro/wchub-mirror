// ============================================================================
// fake-colyseus.ts — in-browser offline room.
//
// Implements just enough of colyseus.js's Client/Room surface for NetClient,
// but instead of a WebSocket it instantiates the REAL server game module
// (server/src/game via @server alias): real GameState schema, real
// registerMessages (input/equip/chat/jump/wave/betting/soccer), real step.
// Bots are schema players driven by synthesized "input" messages through the
// same validated handler humans use. Going online later = not passing
// ?offline=1; this file simply never activates.
// ============================================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  createState,
  addPlayer,
  removePlayer,
  registerMessages,
  step,
  type GameState,
} from '@server/game';
import { gameConfig } from '@server/game.config';
import { spawnBots, createBotDriver, BOT_DEFS, type BallView } from '@server/game/bots';

interface ClientLike { sessionId: string; send: (type: string, data?: any) => void }
type ServerHandler = (client: ClientLike, msg: any) => void;

class FakeRoom {
  state: GameState;
  sessionId = 'me';
  id = 'offline';

  private serverHandlers = new Map<string, ServerHandler>();
  private clientHandlers = new Map<string, Array<(d: any) => void>>();
  private stateCbs: Array<(s: GameState) => void> = [];
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private meClient: ClientLike;
  private botClients = new Map<string, ClientLike>();
  private lastBall: BallView | null = null;
  private left = false;

  constructor(joinOpts: Record<string, unknown>) {
    this.state = createState('OFFLINE');

    const serverRoom = {
      state: this.state,
      clients: [] as ClientLike[],
      onMessage: (type: string, h: ServerHandler) => { this.serverHandlers.set(type, h); },
      broadcast: (type: string, data?: any, opts?: { except?: ClientLike }) => {
        if (opts?.except?.sessionId === 'me') return;
        this.deliver(type, data);
      },
    };
    // Real game wiring: soccer ball loop, betting event, all message channels.
    registerMessages(serverRoom as any, this.state);

    // Self joins through the real contract (profanity filter, spawn, roster).
    addPlayer(this.state, 'me', joinOpts as any);
    this.meClient = { sessionId: 'me', send: (t, d) => this.deliver(t, d) };
    serverRoom.clients.push(this.meClient);

    // Bots join the same way.
    spawnBots(this.state, addPlayer);
    for (const d of BOT_DEFS) {
      const c: ClientLike = { sessionId: d.sid, send: () => {} };
      this.botClients.set(d.sid, c);
      serverRoom.clients.push(c);
    }

    const tickMs = 1000 / gameConfig.tickHz;
    // Simulation step + state fan-out (local: notify every tick).
    this.timers.push(setInterval(() => {
      step(this.state);
      for (const cb of this.stateCbs) cb(this.state);
    }, tickMs));

    // Bot brains → real input handler (validation + movePlayer + kick).
    const driver = createBotDriver(this.state, () => this.lastBall);
    this.timers.push(setInterval(() => {
      const h = this.serverHandlers.get('input');
      if (!h) return;
      for (const { sid, msg } of driver.tick(Date.now())) {
        const c = this.botClients.get(sid);
        if (c) h(c, msg);
      }
    }, tickMs));

    // Goal flair: bots celebrate + a couple wave through the real channel.
    this.onMessage('ball:goal', () => {
      driver.celebrate(2200);
      const wave = this.serverHandlers.get('wave');
      if (!wave) return;
      const sids = BOT_DEFS.map(d => d.sid);
      for (let i = 0; i < 2; i++) {
        const c = this.botClients.get(sids[(Math.random() * sids.length) | 0]);
        if (c) { try { wave(c, {}); } catch { /* rate-limited: fine */ } }
      }
    });
  }

  private deliver(type: string, data: any): void {
    if (this.left) return;
    if (type === 'ball:state' && data) {
      this.lastBall = { x: data.x, z: data.z, vx: data.vx, vy: data.vy };
    }
    const hs = this.clientHandlers.get(type);
    if (hs) for (const h of hs) { try { h(data); } catch (e) { console.error('[offline]', type, e); } }
  }

  onStateChange(cb: (s: GameState) => void): void {
    this.stateCbs.push(cb);
    cb(this.state);
  }
  onMessage(type: string, cb: (d: any) => void): void {
    const arr = this.clientHandlers.get(type) ?? [];
    arr.push(cb);
    this.clientHandlers.set(type, arr);
  }
  onLeave(_cb: (code?: number) => void): void { /* never fires offline */ }
  onError(_cb: (code: number, msg?: string) => void): void { /* never fires offline */ }
  removeAllListeners(): void { this.clientHandlers.clear(); this.stateCbs.length = 0; }

  send(type: string, payload?: any): void {
    const h = this.serverHandlers.get(type);
    if (h) { h(this.meClient, payload); return; }
    // Clock-sync convenience: echo pings when no handler is registered.
    if (type === 'ping') this.deliver('pong', payload);
  }

  async leave(_consented?: boolean): Promise<void> {
    if (this.left) return;
    this.left = true;
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
    for (const d of BOT_DEFS) removePlayer(this.state, d.sid);
    removePlayer(this.state, 'me');
  }
}

export class FakeClient {
  constructor(_endpoint?: string) {}
  async joinOrCreate(_roomName: string, opts?: Record<string, unknown>): Promise<any> {
    return new FakeRoom(opts ?? {});
  }
  async joinById(_roomId: string, opts?: Record<string, unknown>): Promise<any> {
    return new FakeRoom(opts ?? {});
  }
}
