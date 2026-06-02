// ============================================================================
// room.ts — 房间生命周期骨架 (FIXED / 禁改)
//
// 游戏无关。只通过 game/index.ts 的 6 个契约函数操作状态，不认识任何具体游戏
// 类型（无 Player/Bullet/move/shoot 字样）。换游戏时不要动这个文件。
//
// 不变量：
//   1. 玩家计数只经由 playerCount(state)，绝不直接读 state.players ——
//      否则团队制 / 无 players-map 形状的游戏会在这里崩溃。
//   2. onCreate 必须 setMetadata({ code })，且 index.ts 的 define() 必须
//      .filterBy(["code"])，二者共同实现「同 code 落同房」。漏任一个，
//      joinOrCreate 会在多房共存时把同 code 的玩家分到不同房。
//   3. 单 Container 单房：activeRoomCode 守卫，满员后拒绝创建第二间。
// ============================================================================

import { Room, Client, AuthContext } from "colyseus";
import {
  GameState,
  createState,
  addPlayer,
  removePlayer,
  registerMessages,
  step,
  playerCount,
} from "./game";
import { gameConfig } from "./game.config";

// Live stats exposed via the server's /stats endpoint (used by the Worker
// matchmaker to balance rooms across Containers).
export const roomRuntimeStats = {
  code: "",
  players: 0,
  rooms: 0,
  maxPlayers: gameConfig.maxPlayers,
};

// One Container hosts exactly one room. This module-level guard rejects a
// second onCreate in the same process.
let activeRoomCode: string | null = null;

const CODE_ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randomCode = (len = 6) => {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHA[Math.floor(Math.random() * CODE_ALPHA.length)];
  return s;
};
const sanitizeCode = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const c = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return c.length >= 4 ? c : null;
};

type CreateOpts = { code?: unknown };

export class GameRoom extends Room<GameState> {
  maxClients = gameConfig.maxPlayers;
  code = "";

  onCreate(options: CreateOpts) {
    const nextCode = sanitizeCode(options?.code) ?? randomCode();
    if (activeRoomCode) {
      throw new Error(`container already owns room ${activeRoomCode}`);
    }

    activeRoomCode = nextCode;
    this.code = nextCode;
    this.roomId = this.code;
    this.setMetadata({ code: this.code }); // load-bearing for filterBy(["code"])

    this.setState(createState(this.code));

    roomRuntimeStats.code = this.code;
    roomRuntimeStats.players = 0;
    roomRuntimeStats.rooms = 1;
    roomRuntimeStats.maxPlayers = this.maxClients;

    registerMessages(this, this.state);
    this.setSimulationInterval(() => step(this.state), 1000 / gameConfig.tickHz);
  }

  onAuth(_client: Client, opts: CreateOpts, context: AuthContext) {
    if (playerCount(this.state) >= this.maxClients) {
      throw new Error("room is full");
    }

    const headerValue = context.headers?.["x-room-code"];
    const routedCode = sanitizeCode(Array.isArray(headerValue) ? headerValue[0] : headerValue);
    const requestedCode = sanitizeCode(opts?.code);

    if (routedCode && requestedCode && routedCode !== requestedCode) {
      throw new Error(`room code mismatch: route=${routedCode} options=${requestedCode}`);
    }

    return true;
  }

  onJoin(client: Client, opts: { name?: string }) {
    if (playerCount(this.state) >= this.maxClients) {
      throw new Error("room is full");
    }
    addPlayer(this.state, client.sessionId, opts ?? {});
    roomRuntimeStats.players = playerCount(this.state);
  }

  onLeave(client: Client) {
    removePlayer(this.state, client.sessionId);
    roomRuntimeStats.players = playerCount(this.state);
  }

  onDispose() {
    if (activeRoomCode === this.code) {
      activeRoomCode = null;
    }
    roomRuntimeStats.players = 0;
    roomRuntimeStats.rooms = 0;
  }
}
