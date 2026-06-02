// game_storage 服务的类型定义，严格对齐服务端契约：
//   tools/game_storage/api/{common,player_data,game_data,score}.api
//   tools/game_storage/internal/values/errors.go

/** 错误码（对齐 internal/values/errors.go） */
export enum StorageCode {
  OK = 0,
  InvalidParam = 1001, // 缺字段 / 类型错 / limit 超限 / path 非法
  NotFound = 1002, // 玩家数据 / 分数记录不存在
  VersionConflict = 1003, // CAS 失败，data 返回服务端当前最新值
  ValueTooLarge = 1004, // value 超过 512 KiB
  Internal = 5000, // 服务端内部错误
}

/** value 最大字节数：524288 = 512 KiB（对齐 Limits.PlayerValueMaxBytes 默认值） */
export const MAX_VALUE_BYTES = 524288;
/** TopN limit 取值范围 [1, 20]（对齐 Limits.TopNMaxLimit 默认值） */
export const TOP_N_MIN_LIMIT = 1;
export const TOP_N_MAX_LIMIT = 20;

/** 玩家数据条目 */
export interface PlayerDataItem {
  key: string;
  value: string;
  version: number;
  /** RFC3339 UTC，例如 2026-05-25T10:30:00Z */
  updated_at: string;
}

/**
 * 游戏数据条目（GET/POST /game_data 的返回体，与 PlayerDataItem 同形）。
 * 区别于 player_data：用户身份不由 user_id 入参指定，而是服务端从 JWT 解析。
 */
export type GameDataItem = PlayerDataItem;

/** 分数条目 */
export interface ScoreItem {
  score: number;
  version: number;
  updated_at: string;
}

/** 排行榜单条记录 */
export interface TopScoreEntry {
  rank: number;
  user_id: number;
  name: string;
  avatar: string;
  score: number;
  updated_at: string;
}

/** 排行榜数据 */
export interface TopScoreData {
  list: TopScoreEntry[];
}

/**
 * 统一响应包络。
 * 服务端返回体形如 { code, message, data }；data 在出错时为 null。
 * httpStatus 是 HTTP 状态码（鉴权失败时为 401，业务错误一般仍是 200）。
 */
export interface ApiResponse<T> {
  code: StorageCode;
  message: string;
  data: T | null;
  httpStatus: number;
}

export interface GetPlayerDataParams {
  gameId: number;
  userId: number;
  key: string;
}

export interface UpdatePlayerDataParams {
  gameId: number;
  userId: number;
  /** 客户端持有的版本号，首次写入传 0 */
  version: number;
  key: string;
  value: string;
}

export interface GetGameDataParams {
  gameId: number;
  key: string;
}

export interface UpdateGameDataParams {
  gameId: number;
  /** 客户端持有的版本号，首次写入传 0 */
  version: number;
  key: string;
  value: string;
}

export interface GetScoreParams {
  gameId: number;
  userId: number;
}

export interface UpdateScoreParams {
  gameId: number;
  userId: number;
  /** 客户端持有的版本号，首次写入传 0 */
  version: number;
  score: number;
}

export interface TopScoreParams {
  gameId: number;
  /** 范围 [1, 20] */
  limit: number;
}
