// Browser shim for the server-only "colyseus" package. The game-layer
// modules (soccer.ts, messages.ts, event.ts) import { Room } from "colyseus"
// purely as a TYPE for their function signatures; nothing instantiates it.
// Aliased in vite.config so bundling server/src/game/* into the offline
// client never pulls the Node server library.
export class Room<TState = unknown> {
  state!: TState;
  clients: unknown[] = [];
  broadcast(..._args: unknown[]): void {}
  onMessage(..._args: unknown[]): void {}
}
export type Client = { sessionId: string; send: (type: string, data?: unknown) => void };
