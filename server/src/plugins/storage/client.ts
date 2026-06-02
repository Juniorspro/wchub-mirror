// Rezona game_storage 服务的 HTTP client。
//
// 这是一个「透明」client：只负责拼请求、带上 JWT、解析统一响应包络，
// 不在本地短路任何业务校验（512KB / limit 范围 / version 等全部交给服务端判定），
// 这样针对真实服务端的测试才有意义。
//
// 路由前缀对齐 deploy/ingress.yaml：/api/game_storage/* → game-storage 服务。
import type {
  ApiResponse,
  GameDataItem,
  GetGameDataParams,
  GetPlayerDataParams,
  GetScoreParams,
  PlayerDataItem,
  ScoreItem,
  TopScoreData,
  TopScoreParams,
  UpdateGameDataParams,
  UpdatePlayerDataParams,
  UpdateScoreParams,
} from "./types";

/** 服务端统一路由前缀 */
export const API_PREFIX = "/api/game_storage";

export interface GameStorageClientOptions {
  /** 服务根地址，例如 https://devapi.rezona.ai（不含 /api/game_storage 前缀） */
  baseUrl: string;
  /** 原始 JWT（不含 "Bearer " 前缀） */
  token: string;
  /** 额外透传的请求头，例如 x-os / X-App-Version / X-Country-Code / X-Device-ID */
  headers?: Record<string, string>;
  /** 可注入的 fetch，便于在测试里替换为假实现 */
  fetch?: typeof fetch;
  /** 单次请求超时（毫秒），默认 15000 */
  timeoutMs?: number;
}

/** client 抛出的网络/解析层错误（区别于业务错误码） */
export class GameStorageHttpError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GameStorageHttpError";
  }
}

export class GameStorageClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: GameStorageClientOptions) {
    if (!opts.baseUrl) throw new Error("baseUrl is required");
    if (!opts.token) throw new Error("token is required");
    // 去掉结尾斜杠，避免拼出 //api/game_storage
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.extraHeaders = opts.headers ?? {};
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 15000;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("global fetch unavailable; pass opts.fetch");
    }
  }

  /** 读取玩家数据：GET /player_data?game_id&user_id&key */
  getPlayerData(p: GetPlayerDataParams): Promise<ApiResponse<PlayerDataItem>> {
    return this.request<PlayerDataItem>("GET", "/player_data", {
      query: { game_id: p.gameId, user_id: p.userId, key: p.key },
    });
  }

  /** 更新玩家数据（CAS）：POST /player_data */
  updatePlayerData(p: UpdatePlayerDataParams): Promise<ApiResponse<PlayerDataItem>> {
    return this.request<PlayerDataItem>("POST", "/player_data", {
      body: {
        game_id: p.gameId,
        user_id: p.userId,
        version: p.version,
        key: p.key,
        value: p.value,
      },
    });
  }

  /** 读取游戏数据：GET /game_data?game_id&key（用户身份由服务端从 token 解析，无 user_id） */
  getGameData(p: GetGameDataParams): Promise<ApiResponse<GameDataItem>> {
    return this.request<GameDataItem>("GET", "/game_data", {
      query: { game_id: p.gameId, key: p.key },
    });
  }

  /** 更新游戏数据（CAS）：POST /game_data（无 user_id） */
  updateGameData(p: UpdateGameDataParams): Promise<ApiResponse<GameDataItem>> {
    return this.request<GameDataItem>("POST", "/game_data", {
      body: {
        game_id: p.gameId,
        version: p.version,
        key: p.key,
        value: p.value,
      },
    });
  }

  /** 读取玩家分数：GET /score?game_id&user_id */
  getScore(p: GetScoreParams): Promise<ApiResponse<ScoreItem>> {
    return this.request<ScoreItem>("GET", "/score", {
      query: { game_id: p.gameId, user_id: p.userId },
    });
  }

  /** 更新玩家分数（CAS）：POST /score */
  updateScore(p: UpdateScoreParams): Promise<ApiResponse<ScoreItem>> {
    return this.request<ScoreItem>("POST", "/score", {
      body: {
        game_id: p.gameId,
        user_id: p.userId,
        version: p.version,
        score: p.score,
      },
    });
  }

  /** 读取 TopN 排行榜：GET /score/top?game_id&limit */
  getTopScores(p: TopScoreParams): Promise<ApiResponse<TopScoreData>> {
    return this.request<TopScoreData>("GET", "/score/top", {
      query: { game_id: p.gameId, limit: p.limit },
    });
  }

  /** 统一请求：拼 URL、带头、发送、解析包络。 */
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string | number>; body?: unknown },
  ): Promise<ApiResponse<T>> {
    const url = new URL(this.baseUrl + API_PREFIX + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      ...this.extraHeaders,
    };
    let bodyText: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyText = JSON.stringify(opts.body);
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: bodyText,
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new GameStorageHttpError(
        `request failed: ${method} ${url.pathname}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    // 鉴权失败（401）等情况服务端可能返回非 JSON 体；做容错解析。
    let parsed: { code?: number; message?: string; data?: T } = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new GameStorageHttpError(
          `non-JSON response (http ${res.status}): ${raw.slice(0, 200)}`,
        );
      }
    }

    return {
      code: (parsed.code ?? -1) as ApiResponse<T>["code"],
      message: parsed.message ?? "",
      data: (parsed.data ?? null) as T | null,
      httpStatus: res.status,
    };
  }
}
