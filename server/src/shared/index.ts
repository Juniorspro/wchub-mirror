/**
 * [INPUT]: 依赖同目录 ./constants ./math ./protocol
 * [OUTPUT]: 三端共享真源的统一桶（barrel）—— server import 相对路径，client 经 vite `@shared` alias import
 * [POS]: server/src/shared 的入口 —— 唯一对外面（@shared）暴露的聚合点
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 *
 * MIGRATION: Phase 3 把抽取出的引擎无关模块（physics/world/economy/colors…）加进本目录并在此 re-export。
 */

export * from './constants';
export * from './math';
export * from './protocol';
