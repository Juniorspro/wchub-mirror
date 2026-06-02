/**
 * [INPUT]: 依赖同目录 ./client ./prediction ./interpolation ./types
 * [OUTPUT]: net 层公开面（NetClient + 状态/回调类型 + 预测/插值函数 + 内部类型）
 * [POS]: client/src/net 入口 —— 游戏侧（App / controller / render）只从 './net' 取用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export { NetClient } from './client';
export type { NetStatus, NetClientCallbacks } from './client';
export { reconcileSelf, advanceSelfPrediction } from './prediction';
export { bracketAt, getInterpolatedPlayers, latestSnapshot } from './interpolation';
export type {
  SessionMeta,
  PendingInput,
  PredictedSelf,
  TimedSnapshot,
  IdentityStatus,
  LeaderboardRow,
} from './types';
