# 多人游戏模板 — Colyseus × Cloudflare Containers

一个**可复用的实时多人游戏脚手架**：Colyseus 房间服跑在 Cloudflare Container（按需拉起、5 分钟无人自动 sleep），Cloudflare Worker + Matchmaker 在 330+ 边缘 POP 接住玩家并分配房间。

模板自带一个最小「**多人方块移动**」基线作为可运行起点，并把一个完整的多人射击作为 worked example 放在 [`examples/shooter/`](examples/shooter/)。

> **想让 coding agent（Claude Code / Codex）用它生成新游戏？** 直接读 [AGENTS.md](AGENTS.md)——那是面向 agent 的生成 SOP。本文件是给人看的总览。

## 这个模板适配哪类游戏

固定层锁定了一套拓扑：**单 Container 单房间、房间码匹配、定频 tick、服务端权威**。

- ✅ 适配：
  - **实时多人**——射击、`.io`、实时竞技、协作小游戏。
  - **回合制**——不强制用 `tickHz` 驱动，状态由 `messages.ts` 改写即可；想容忍长思考时间就把 `sleepAfter` 调大。
  - **持久化存档 + 分数榜**——通过可选 auth + storage 插件（详见 [AGENTS.md](AGENTS.md) §9），per-user 存档 / 分数榜走 Rezona `game_storage` 后端。
  - **系统并发多房间**——matchmaker DO 自动跨 Container 分房，每个房间各自占 1 个 Container（「单 Container 单房间」只约束**一个 Container 进程内**只能有 1 间房，不限制全系统房间数）。
- ❌ 不适配（需改固定层）：
  - **单 session 内大厅 / 多房间切换**（玩家在多个 colyseus room 间跳转 + 跨房通信）。
  - 按属性匹配（队伍 / 角色 / ELO 分桶）。
  - 大规模分片 / 跨 Container 通信。

## 三步做出你的游戏

1. **改配置** [`server/src/game.config.ts`](server/src/game.config.ts)：房间名、人数、tick、世界尺寸、prod host（单一真源，三端共用）。
2. **写 server 逻辑** [`server/src/game/`](server/src/game/)：`state.ts`（状态 schema）/ `messages.ts`（输入）/ `simulation.ts`（每帧规则）/ `index.ts`（六个契约函数）。
3. **写网页** [`client/index.html`](client/index.html)：渲染 + 输入（已内置桌面键鼠 + 移动端触控摇杆 + 响应式画布）。

边缘路由、匹配分配、Container 生命周期、房间生命周期骨架、部署配置都是**固定层**，不用动。详细契约与禁改清单见 [AGENTS.md](AGENTS.md)。

## 目录

```
server/   Colyseus Node 服务端
  src/
    game.config.ts   单一真源配置
    room.ts          房间生命周期骨架（固定）
    game/            ★ 你的游戏逻辑
    plugins/         （可选）auth + storage：用户身份 + 持久化存档 / 分数榜
worker/   Cloudflare Worker + wrangler.jsonc（边缘路由 + 匹配 + Container）
client/   静态 HTML 客户端（Worker 直接 serve）
e2e/                 Playwright + Node 集成测试
examples/shooter/    完整可运行的射击 worked example（含 storage 接线范例）
AGENTS.md            面向 coding agent 的生成指引
docs/                spec / 实施计划档案
```

## 顶层架构

```
玩家浏览器
   │ POST /matchmake → 拿房间码
   ▼
Cloudflare Worker（边缘 POP）
   │ Matchmaker DO 选「人最多且未满」的房，返回 code
   │ getContainer(GAME_SERVER, code).fetch() 路由 WebSocket
   ▼
Durable Object (GameServer) → 起 Container (Colyseus, port 2567)
   │  GameRoom：tick 30Hz、单房守卫、服务端权威
   │  5 分钟无人 → Container sleep（停计费）
   ▼
客户端拉 /game.config.js（Worker 下发）→ window.GAME_CONFIG
```

## 本地开发

### 服务端独跑（不需要 Cloudflare）

```bash
cd server
npm install
npm run dev            # 监听 :2567
# 客户端用 standalone 本地模式直连 ws://localhost:2567
```

### Worker + Container 一起跑（需要 Docker）

```bash
cd worker
npm install
npx wrangler dev       # http://localhost:8787
```

## 测试

```bash
cd server && npm run build
node test-config.mjs            # 配置结构
# 起服务后：
node test-join.mjs              # 入房/离房
node test-client.mjs            # 移动同步 + 非法输入
node test-maxclients.mjs        # 单房容量上限
node test-share.mjs             # 同 code 落同房
cd ../e2e && node movement-test.mjs   # 真机浏览器：键盘+触控+跨端同步
node share-test.mjs                    # 真机浏览器：分享码落同房
```

接线了可选插件（auth + storage）后再跑这一组：

```bash
cd server
node test-auth.mjs              # JWT decode / verify + identity
node test-registry.mjs          # 每房 WeakMap 身份注册表
node test-storage.mjs           # storage facade × mock（CAS / token 透传 / round-trip）
cd ../e2e
node storage-auth-test.mjs      # 浏览器全链路 × mock storage（含 rezonaBridge stub）
# 可选真实 devapi 抽查（需 token）：
GAME_STORAGE_TOKEN=<jwt> node storage-real-devapi-test.mjs
```

shooter 例子套回模板后跑：`node test-shoot.mjs`（套回流程见 [AGENTS.md](AGENTS.md) §8）。

## 部署到 Cloudflare

```bash
# 部署前先替换两处占位符（必须逐字一致）：
#   server/src/game.config.ts 的 prodHost  → <名称前缀>-<8位hex>.rezona-394.workers.dev
#   worker/wrangler.jsonc      的 name     → <名称前缀>-<8位hex>
# <8位hex> 用 `openssl rand -hex 4` 生成一次，避免账号下 worker 撞名。
cd worker
npx wrangler login
npx wrangler deploy    # 首次会构建并推镜像，约 1-3 分钟
# 访问 https://<名称前缀>-<8位hex>.rezona-394.workers.dev
```

## 关键设计点

| 决策 | 选择 | 原因 |
|---|---|---|
| 房间 ↔ Container 映射 | `getContainer(ns, roomId)` | 同 room 始终落同实例，状态一致 |
| 首次加入 | `POST /matchmake` | 服务端权威选人数最多且未满的房 |
| Sleep 策略 | `sleepAfter = "5m"` | 无人即停，长尾不付钱 |
| 实例规格 | `basic` (1/4 vCPU, 1 GiB) | 16 人房够用；大房需上调（见 AGENTS.md 耦合提醒）|
| 配置单一真源 | `server/src/game.config.ts` | server/worker/client 三端共用，改一处生效 |

## 可选插件：用户系统 + 持久化存档

需要玩家存档 / 分数榜时，用 `server/src/plugins/`（auth + storage）：**服务端权威写入** Rezona `game_storage` 后端（per-user 存档 CAS + 分数榜 TopN）。客户端通过 Rezona App webview 暴露的 `rezonaBridge` 主动调取 `{token, gameId}`、可选触发登录窗。接线方式、JS Bridge 调用契约、登录策略、`enableInternet` 旋钮见 [AGENTS.md](AGENTS.md) §1.5 与 §9；可跑范例见 [examples/shooter](examples/shooter/)（击杀写分 + TopN）。

## 成本估算（100 房间，每房日均 active 2h）

单房 ≈ **$1.65/月**（Memory $0.54 + CPU $1.08 + Disk $0.03），100 房 ≈ **$165/月** + Workers Paid $5 底座 + egress（1 TB 免费）。

## 扩展方向

区域匹配、跨 Container 通信、反作弊、单 session 内多房间切换 / 大厅、按属性匹配（队伍 / ELO）——这些超出模板 baseline，属于真实项目的进一步工作。哪些游戏类型适配、哪些需要改禁改层，见 [AGENTS.md](AGENTS.md) §0。
