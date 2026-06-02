# AGENTS.md — 用这个模板生成一个新的多人游戏

> 面向 coding agent（Claude Code / Codex 等）。本文件告诉你：这个模板适配哪类游戏、
> 哪些文件是你要写的、哪些绝对不要碰、怎么改、怎么验证。
> 给人看的项目说明在 [README.md](README.md)。

---

## 0. 先判断：你的目标游戏适配吗？

这个模板的固定层锁定了一套拓扑：**单 Container 单房间、房间码匹配、定频 tick、服务端权威**。系统级**支持并发多房间**——matchmaker DO 跨 Container 分房，每房一个 Container 实例；「单 Container 单房间」只约束**一个 Container 进程内**只有 1 间房（不变量 2 不允许跨房模块级状态）。

- ✅ **适配**：
  - **实时多人**——射击、`.io`、实时竞技、协作小游戏。
  - **回合制**——可以不用 `tickHz` 驱动逻辑，状态在 `messages.ts` 里改；想容忍长思考时间就把 `game.config.ts` 的 `sleepAfter` 调大（baseline `5m`，可以拉到几十分钟）。注意：所有玩家全部离线 `sleepAfter` 之后 Container 会 sleep，恢复时房间状态丢失——长局需要靠下面的「持久化存档」回灌进度。
  - **持久化存档 + 分数榜**——可选 auth + storage 插件（见 §9）。per-user 存档（`writePlayerData`/`loadPlayerData`，CAS）+ per-game 分数榜（`writeScore`/`topScores`）走 Rezona `game_storage` 后端，不需要 D1 / KV / R2。
  - **系统并发多房间**——默认就支持。Matchmaker DO 自动选「人最多且未满」的房；每间房落在不同的 Container 实例上。
- ❌ **不适配**（需要改「禁改层」，超出「只需三件事」的承诺）：
  - **单 session 内大厅 / 多房间切换**（玩家同时在多个 colyseus room 间跳转 + 跨房通信）。
  - 按属性匹配（队伍、角色、ELO 分桶）。
  - 大规模分片 / 跨 Container 通信。

如果目标游戏落在 ❌ 区，先停下来告诉用户：「这需要改动固定层，不是改配置 + 写游戏逻辑就能完成的」，再决定要不要继续。

---

## 1. 架构一图流：固定层 vs 生成层

```
玩家浏览器
  │ POST /matchmake → 拿到房间码
  ▼
Cloudflare Worker（边缘）        ← 固定，禁改
  │ Matchmaker DO 选「人最多且未满」的房
  │ getContainer(GAME_SERVER, code) 路由 WS
  ▼
Durable Object → Container（Colyseus, Node）  ← 固定，禁改
  │
  ▼
GameRoom (room.ts)              ← 固定，禁改：生命周期骨架
  │ 只调用 game/ 的 6 个契约函数
  ▼
game/ + client/                 ← ★ 这才是你要写的
```

| 路径 | 角色 | 你动它吗 |
|---|---|---|
| `worker/src/index.ts` | 边缘路由 + 匹配 + Container + 下发 /game.config.js | ❌ 禁改 |
| `worker/wrangler.jsonc` | 部署拓扑（实例规格、实例数、域名） | ⚙️ 只调旋钮（见 §4） |
| `server/Dockerfile` | 容器构建 | ❌ 禁改 |
| `server/src/index.ts` | http(/healthz /stats /game.config.js) + transport + define | ❌ 禁改 |
| `server/src/room.ts` | 房间生命周期骨架（游戏无关） | ❌ 禁改 |
| **`server/src/game.config.ts`** | 单一真源配置 | ✅ 改 |
| **`server/src/game/*.ts`** | 你的游戏逻辑（state / messages / simulation / index） | ✅ 整体重写 |
| **`client/index.html`** | 你的网页（渲染 + 输入） | ✅ 整体重写 |
| `server/src/plugins/`（auth + storage） | （可选）用户身份 + 持久化存档 / 分数榜 | ⚙️ 接线时按 §1.5 / §9 改 game 层挂钩；插件本身不改 |

---

## 2. 接缝契约：`game/index.ts` 必须导出这 6 个

`room.ts`（固定层）只认识这 6 个函数，**不认识** `GameState` 内部结构。任何游戏都实现同一组：

```ts
createState(code: string): GameState               // 构造初始状态
addPlayer(state, sessionId, opts): void            // onJoin：把玩家放进 state
removePlayer(state, sessionId): void               // onLeave：移除
registerMessages(room, state): void                // 注册全部 onMessage 输入处理
step(state): void                                  // 一个模拟 tick（room 按 tickHz 调用）
playerCount(state): number                         // 玩家数（满员校验 / stats）
```

### 三条不变量（违反会在固定层崩溃或静默出错）

1. **玩家计数只经由 `playerCount(state)`。** `room.ts` 绝不直接读 `state.players`。如果你的游戏没有顶层 `players` map（如团队制 `state.teams[].members`），重写 `playerCount` 即可，固定层不用动。
2. **每房「非 schema 服务端内部状态」放 `registerMessages` 的闭包里**（如射击冷却 `lastShotTick`、自增 id）。**禁止用模块级 `let` / 静态变量**——同一 Container 进程可共存多房，模块级状态会跨房串味、污染冷却/计数。
3. **`game.config.ts` 必须是纯数据**（`as const`），**不得 import `game/` 或 `@colyseus/schema`**。worker 用自己的 tsconfig typecheck 这个被 import 的文件，而 worker tsconfig 没有 `experimentalDecorators`——引入带 `@type` 装饰器的类型会让 **worker 构建直接失败**。

---

## 3. 生成 SOP（三步）

### 第 1 步：改配置 `server/src/game.config.ts`

调 `roomName` / `maxPlayers` / `tickHz` / `world` / `player` / `prodHost`。游戏内部常量（子弹速度、伤害、半径…）**不需要**全塞进 config——留在各 game 文件顶部即可（见 `examples/shooter`）。

**`prodHost` 域名（部署前必须替换占位符）**：模板预置的是占位符 `your-game-name-xxxxxxxx.rezona-394.workers.dev`，不能直接部署。格式固定为：

```
<名称前缀>-<8位hex>.rezona-394.workers.dev
```

- `rezona-394`：固定账号子域，**禁改**。
- `<名称前缀>`：和用户确认一个名字（小写字母/数字/连字符，如 `my-shooter`）。
- `<8位hex>`：部署前生成一次 `openssl rand -hex 4`，附在前缀后避免与账号下其他 worker 撞名。
- ⚠️ **两处必须逐字一致**：`game.config.ts` 的 `prodHost` 第一段（前缀+hex） == `worker/wrangler.jsonc` 的 `name`。改一处就同步改另一处，否则 client 连的域名与实际部署的 worker 对不上。

### 第 1.5 步（可选）：是否需要存储 / 用户系统？

**创建游戏时必须主动问用户：「这个游戏需要玩家存档 / 分数榜吗？」** 需要才接线 storage 插件（见 §9）；不需要就跳过，baseline 不受影响。

接线只动**游戏层**与**例子客户端**，禁改层不动：
1. `game/index.ts` 的 `addPlayer` 里 `attachIdentity(state, sessionId, decodeIdentity(opts))`，`removePlayer` 里 `detachIdentity(state, sessionId)`。
2. 计分/存档事件处（服务端权威，如击杀加分后）`void writeScore(identity, score)` / `void writePlayerData(...)`——**fire-and-forget，绝不 await/阻塞 tick**。
3. 客户端：通过 Rezona App JS Bridge 主动调取 token / gameId / 登录状态（见 §9 契约），join opts 带上。
4. **登录策略**（creator 选）：有存储 / 榜单 / 内购的游戏建议**要求登录**（bridge 可用 + guest 时强制 `login`，用户取消则阻断 join）。无登录需求的游戏跳过即可，guest 入房 = 无存储但可玩。
5. ⚠️ **部署时把 `worker/src/index.ts` 的 `GameServer.enableInternet` 改为 `true`**——否则 Container 无法访问 storage 后端。这是开启存储时唯一需要碰禁改层的旋钮。

完整可跑范例：`examples/shooter`（击杀写分 + TopN）。

### 第 2 步：重写 `server/src/game/` 四个文件

- **`state.ts`**：定义会同步给客户端的 schema（用 `@colyseus/schema` 的 `@type`）。
- **`messages.ts`**：`registerMessages(room, state)` 注册全部输入处理。**所有客户端输入都不可信**，用 `sanitize*` / `clamp` 校验后再改 state。
- **`simulation.ts`**：`step(state)` 跑你的逐帧规则（服务端权威）。没有逐帧规则就只 `state.tick++`。
- **`index.ts`**：导出 §2 的 6 个契约函数。

### 第 3 步：重写 `client/index.html`

- 顶部已 `<script src="/game.config.js">` → 读 `window.GAME_CONFIG`。画布内部分辨率 = `world`，显示尺寸自适应视口——**别动这套响应式逻辑**。
- 「固定区」（连接 / 匹配 / 分享 URL）基本不用动。
- 「生成区」（渲染 `render()` + 输入循环）按你的游戏重写。

---

## 4. 两类配置 + 耦合提醒

| 配置 | 文件 | 管什么 |
|---|---|---|
| 运行时 / 游戏值 | `server/src/game.config.ts` | roomName, maxPlayers, tickHz, world, player, port, sleepAfter, prodHost |
| 部署拓扑 | `worker/wrangler.jsonc` | `instance_type`, `max_instances`, `name`, migrations |

⚠️ **资源耦合**：`maxPlayers` / `tickHz` / `world` 与 wrangler 的 `instance_type` 有资源耦合。`basic`（1/4 vCPU, 1 GiB）约够 16 人小世界。把 `maxPlayers` 调到几百做大房游戏时，**必须同步升级 `instance_type`**，否则运行时 OOM / 拒服。「单一真源」指游戏值收敛到一处，**不等于「只改一个文件」**——大改规模时记得看 wrangler。

⚠️ **域名耦合**：`game.config.ts` 的 `prodHost` 第一段（`<名称前缀>-<8位hex>`）必须与 `worker/wrangler.jsonc` 的 `name` 逐字一致。两处都是待替换占位符 `your-game-name-xxxxxxxx`，部署前一起改（见 §3 第 1 步）。

---

## 5. 输入模式：桌面 + 移动端都要支持

baseline 的 `client/index.html` 已给两条输入路径，二者都产生 `{dx, dy}` 并走同一条 `move` 通道：

- **桌面**：WASD / 方向键。
- **移动端**：虚拟摇杆（触点拖动，`touch-action: none` 防滚动缩放）。

为你的游戏加新手势（瞄准、开火、技能）时，**保持桌面 + 触控两条路径并存**。完整范例见 `examples/shooter`（触控瞄准 + 点按开火）。

---

## 6. 安全红线

- **服务端权威**：所有状态变更只在 server（`messages.ts` / `simulation.ts`）发生，客户端只发输入、只渲染。
- **不信任客户端**：每个输入字段都要校验（数值用 `clamp` 夹范围、`Number.isFinite` 挡 NaN/Infinity、字符串截长度）。参考 baseline 的 `sanitizeAxis`。
- 不要把服务端内部状态（冷却、随机种子）同步给客户端。

---

## 7. 验证（每步都要做）

```bash
# 1. server 编译
cd server && npm run build        # tsc，必须 0 错误
node test-config.mjs              # config 字段结构 + 客户端下发 payload 检查

# 2. 本地跑通（标准库行为；这些测试都 game-agnostic，换游戏后仍应通过）
PORT=2567 node dist/index.js &    # 或 npm run dev
node test-join.mjs                # 两人入房 / 离房计数
node test-client.mjs              # 移动同步 + 非法输入不崩
node test-maxclients.mjs          # 单房容量上限（满员拒绝第 N+1 个）
node test-share.mjs               # 同 code 落同房

# 3. worker + container（需要 Docker 守护进程在跑；先 `docker info` 确认）
cd ../worker && npx wrangler dev   # http://localhost:8787
#   Docker 不可用就跳到第 4 步（Playwright 不需要 Docker）

# 4. 真机/浏览器（含移动端触控）
cd ../e2e && node movement-test.mjs   # 键盘 + 触控 + 跨端同步
node share-test.mjs                   # 浏览器：分享码落同房

# 5. 部署（需要人类持有的 Cloudflare 凭据 + Docker）
cd ../worker && npx wrangler login    # 一次性；CI 用 CLOUDFLARE_API_TOKEN 环境变量
npx wrangler deploy                   # 首次构建并推镜像，约 1-3 分钟

# 6. 接线了可选插件（auth + storage）后再跑这一组
cd ../server
node test-auth.mjs                    # JWT decode/verify + identity
node test-registry.mjs                # 每房 WeakMap 身份注册表
node test-storage.mjs                 # storage facade × mock（CAS / token 透传 / round-trip）
cd ../e2e && node storage-auth-test.mjs    # 浏览器全链路 × mock storage（含 rezonaBridge stub）
# 可选真实 devapi 抽查（需手持 token）：
# GAME_STORAGE_TOKEN=<jwt> node storage-real-devapi-test.mjs
```

---

## 8. Worked example：从移动 baseline 扩展出射击

`examples/shooter/` 是一个**完整可运行**的成品——把 baseline 一步步扩展成多人射击。它演示了上面所有契约/不变量的真实用法：

- `state.ts`：`Player` 加 `aim/hp/score/deadUntil`，新增 `Bullet`，`GameState` 加 `bullets`。
- `messages.ts`：加 `aim` / `shoot`；**冷却 `lastShotTick` 放在 `registerMessages` 闭包**（不变量 2）。
- `simulation.ts`：`step()` 实现子弹推进、碰撞伤害、击杀计分、定时重生。
- `client/index.html`：渲染子弹/血条/瞄准/计分；输入加触控瞄准 + 点按开火（不变量：桌面 + 移动端并存）。

套回模板跑起来：

```bash
cp examples/shooter/server/game/*.ts  server/src/game/
cp examples/shooter/client/index.html client/index.html
cd server && npm run build
PORT=2567 node dist/index.js &        # 先起服务，否则 test-shoot 连不上
COLYSEUS_URL=ws://localhost:2567 node test-shoot.mjs
```

要从头学怎么扩展，对照 baseline 的 `server/src/game/` 和 `examples/shooter/server/game/` 做 diff——差异就是「加一个游戏机制」需要动的全部地方。

---

## 9. 可选插件：auth + storage（服务端权威）

两个**可选**插件，默认不参与 baseline。`server/src/plugins/auth/` 解析用户身份，`server/src/plugins/storage/` 代用户读写 Rezona game_storage 后端。

### 数据流（服务端权威）

```
Rezona App webview 宿主（暴露 rezonaBridge）
  ▲ getAccessToken / getGameId / login                ← 客户端主动调
  │
客户端 H5（onJoin 前异步取 token+gameId）
  │ joinOrCreate(room, { name, code, token, gameId }) ← 搭车 join opts
  ▼
room.ts(禁改) → addPlayer(state, sid, opts) → decodeIdentity(opts) → 每房 registry
计分事件 → writeScore(identity, score) → devapi/api/game_storage/*
```

客户端只搬运 token；服务端 decode 出 userID、代用户写分，**分数不可被客户端伪造**。

### Rezona App JS Bridge 调用契约

客户端通过 **Rezona App webview** 暴露的 `rezonaBridge` 调原生：

**H5 → Native 请求**：
```js
window.webkit.messageHandlers.rezonaBridge.postMessage({
  action: "<actionName>", requestId: "<unique>", version: "1.0", params: { /* optional */ }
})
// Flutter WebView shim：window.rezonaBridge.postMessage(JSON.stringify(payload))
```

**Native → H5 响应**（统一回调）：
```js
window.RezonaBridge.onNativeResponse({
  requestId, code, message, data
})
// code: 0=ok, 400=bad param, 404=unknown action, 500=internal, 503=dependency unavailable
```

本插件需要的 4 个 action：

| action | data 字段 | 备注 |
|---|---|---|
| `getLoginStatus` | `{ isLoggedIn: bool, identity: "user"\|"guest" }` | 决定要不要调 `login` |
| `login` | `{ loggedIn: bool, alreadyLoggedIn: bool }` | 异步等用户操作；503 = 宿主未注册回调 |
| `getAccessToken` | `{ accessToken: "<raw JWT>" }` | **不含 `Bearer ` 前缀**；guest 返 `""` |
| `getGameId` | `{ gameId: "<string>" }` | **字符串**——server 端 `decodeIdentity` 用 `Number()` 容错 |

### 登录策略（creator 决定）

- 有存储 / 榜单 / 内购 → **建议要求登录**：bridge 可用 + guest 时强制 `login`，用户取消则阻断 join（显式提示）。
- 纯娱乐无存储 → 跳过 auth，guest 直接入房。
- bridge 不可用（浏览器直开 / 非 webview）→ URL 参数兜底 `?token=&gameId=`，仅本地/测试用；**严禁在生产 URL 出现 token**（落 referer / 浏览历史会泄漏）。
- 完整范例：`examples/shooter/client/index.html`（doJoin 异步取 token+gameId 段）。

### 关键约束

- **token 绝不进 `@colyseus/schema` state**（会同步给所有客户端）。身份存每房 `WeakMap` registry（`storage/registry.ts`），不同步、每房隔离。
- **写操作 fire-and-forget**：`writeScore`/`writePlayerData` 内部 CAS 读-改-写、吞错，调用方 `void` 调用，绝不阻塞 `step()` 热路径。
- **JWT 默认 decode-only**：`decodeIdentity` 只解码取 userID（devapi 自身会鉴权 token）。设环境变量 `AUTH_ACCESS_SECRET`（逗号分隔支持多 secret 轮转）可用 `verifyToken` 验签硬化。
- **插件配置走 env**（`GAME_STORAGE_BASE_URL`、`AUTH_ACCESS_SECRET`），**不进 game.config.ts**（保持 baseline 配置纯净）。
- **`enableInternet=true`**：Container 默认禁外网，开存储必须在 `worker/src/index.ts` 把 `GameServer.enableInternet` 设为 `true`。

### facade API（`server/src/plugins/storage`）

| 函数 | 作用 |
|---|---|
| `decodeIdentity(opts)` | join opts → `Identity\|null`（同步，decode-only） |
| `attachIdentity/getIdentity/detachIdentity(state, sid[, id])` | 每房身份登记/取用/移除（registry 自 `storage/registry.ts` re-export） |
| `writeScore(identity, score)` | CAS 写分（冲突重试一次），fire-and-forget |
| `writePlayerData(identity, key, value)` | CAS 写存档（走 `/player_data`，带 user_id 入参） |
| `loadPlayerData(identity, key)` | 读存档，无则 null |
| `writeGameData(identity, key, value)` | CAS 写游戏数据（走 `/game_data`，用户身份由服务端从 token 解析，不传 user_id） |
| `loadGameData(identity, key)` | 读游戏数据，无则 null |
| `topScores(identity, limit)` | 读 TopN（limit∈[1,20]） |

### 测试

- `server/test-auth.mjs` / `server/test-registry.mjs` / `server/test-storage.mjs`：插件单元 + facade×mock 集成（确定性，先 `npm run build`）。
- `e2e/storage-auth-test.mjs`：浏览器全链路（stub rezonaBridge + join 带 token/gameId × mock storage）。
- `e2e/storage-real-devapi-test.mjs`：可选真实 devapi 抽查（`GAME_STORAGE_TOKEN=<jwt>` 才跑）。
