// 每房「服务端专属、不同步」的 sessionId → Identity 注册表。
// 以 state 实例为 WeakMap key —— 每房天然隔离、不进 @colyseus/schema、
// state 被回收时自动释放。游戏无关：state 类型仅取 object，不 import GameState。
import type { Identity } from "../auth/identity";

const rooms = new WeakMap<object, Map<string, Identity>>();

function bag(state: object): Map<string, Identity> {
  let m = rooms.get(state);
  if (!m) {
    m = new Map();
    rooms.set(state, m);
  }
  return m;
}

export function attachIdentity(state: object, sessionId: string, identity: Identity | null): void {
  if (!identity) return;
  bag(state).set(sessionId, identity);
}

export function getIdentity(state: object, sessionId: string): Identity | null {
  return rooms.get(state)?.get(sessionId) ?? null;
}

export function detachIdentity(state: object, sessionId: string): void {
  rooms.get(state)?.delete(sessionId);
}
