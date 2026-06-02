// storage 插件 facade：给游戏层暴露高层操作。所有写操作 CAS 读-改-写、
// 吞错（log + 不抛），保证调用方可 fire-and-forget、绝不阻塞游戏 tick。
import { GameStorageClient } from "./client";
import { StorageCode } from "./types";
import type { TopScoreEntry } from "./types";
import type { Identity } from "../auth/identity";

export { attachIdentity, getIdentity, detachIdentity } from "./registry";
export type { Identity } from "../auth/identity";

const BASE_URL = process.env.GAME_STORAGE_BASE_URL ?? "https://devapi.rezona.ai";

function clientFor(identity: Identity): GameStorageClient {
  return new GameStorageClient({ baseUrl: BASE_URL, token: identity.token });
}

function warn(op: string, msg: unknown): void {
  console.warn(`[storage] ${op}:`, msg instanceof Error ? msg.message : msg);
}

/** 写分数（CAS 读-改-写，冲突重试一次）。fire-and-forget 安全。 */
export async function writeScore(identity: Identity, score: number): Promise<void> {
  try {
    const c = clientFor(identity);
    const cur = await c.getScore({ gameId: identity.gameId, userId: identity.userID });
    let version = cur.code === StorageCode.OK ? cur.data?.version ?? 0 : 0;
    let res = await c.updateScore({ gameId: identity.gameId, userId: identity.userID, version, score });
    if (res.code === StorageCode.VersionConflict) {
      version = res.data?.version ?? version;
      res = await c.updateScore({ gameId: identity.gameId, userId: identity.userID, version, score });
    }
    if (res.code !== StorageCode.OK) warn("writeScore", `code=${res.code} ${res.message}`);
  } catch (err) {
    warn("writeScore", err);
  }
}

/** 写玩家存档（CAS 读-改-写，冲突重试一次）。fire-and-forget 安全。 */
export async function writePlayerData(identity: Identity, key: string, value: string): Promise<void> {
  try {
    const c = clientFor(identity);
    const cur = await c.getPlayerData({ gameId: identity.gameId, userId: identity.userID, key });
    let version = cur.code === StorageCode.OK ? cur.data?.version ?? 0 : 0;
    let res = await c.updatePlayerData({ gameId: identity.gameId, userId: identity.userID, version, key, value });
    if (res.code === StorageCode.VersionConflict) {
      version = res.data?.version ?? version;
      res = await c.updatePlayerData({ gameId: identity.gameId, userId: identity.userID, version, key, value });
    }
    if (res.code !== StorageCode.OK) warn("writePlayerData", `code=${res.code} ${res.message}`);
  } catch (err) {
    warn("writePlayerData", err);
  }
}

/** 读玩家存档；不存在或出错返回 null。 */
export async function loadPlayerData(identity: Identity, key: string): Promise<string | null> {
  try {
    const c = clientFor(identity);
    const res = await c.getPlayerData({ gameId: identity.gameId, userId: identity.userID, key });
    return res.code === StorageCode.OK ? res.data?.value ?? null : null;
  } catch (err) {
    warn("loadPlayerData", err);
    return null;
  }
}

/**
 * 写游戏数据（CAS 读-改-写，冲突重试一次）。fire-and-forget 安全。
 * 与 writePlayerData 的区别：走 /game_data，用户身份由服务端从 token 解析（不传 user_id）。
 */
export async function writeGameData(identity: Identity, key: string, value: string): Promise<void> {
  try {
    const c = clientFor(identity);
    const cur = await c.getGameData({ gameId: identity.gameId, key });
    let version = cur.code === StorageCode.OK ? cur.data?.version ?? 0 : 0;
    let res = await c.updateGameData({ gameId: identity.gameId, version, key, value });
    if (res.code === StorageCode.VersionConflict) {
      version = res.data?.version ?? version;
      res = await c.updateGameData({ gameId: identity.gameId, version, key, value });
    }
    if (res.code !== StorageCode.OK) warn("writeGameData", `code=${res.code} ${res.message}`);
  } catch (err) {
    warn("writeGameData", err);
  }
}

/** 读游戏数据；不存在或出错返回 null。 */
export async function loadGameData(identity: Identity, key: string): Promise<string | null> {
  try {
    const c = clientFor(identity);
    const res = await c.getGameData({ gameId: identity.gameId, key });
    return res.code === StorageCode.OK ? res.data?.value ?? null : null;
  } catch (err) {
    warn("loadGameData", err);
    return null;
  }
}

/** 读 TopN 榜；出错返回空数组。 */
export async function topScores(identity: Identity, limit: number): Promise<TopScoreEntry[]> {
  try {
    const c = clientFor(identity);
    const res = await c.getTopScores({ gameId: identity.gameId, limit });
    return res.code === StorageCode.OK ? res.data?.list ?? [] : [];
  } catch (err) {
    warn("topScores", err);
    return [];
  }
}
