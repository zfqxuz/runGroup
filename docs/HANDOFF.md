# 东方 TRPG 平台 · 交接文档

给下一个会话的 AI / 开发者。当前基线 commit：`947432d`，分支 `main`，工作区干净。

## 0. 环境约束（先读）

- bash 命令里不要出现英文感叹号，不要出现美元符号加数字，不要写 heredoc。工具会报 Error: [object Object] 或直接挂到超时。
- 写文件优先用 printf 多行，复杂脚本先 printf 到 /tmp/xxx.py，再 python3 /tmp/xxx.py。
- TypeScript 如果必须写英文感叹号相关语法（旧文档要求完全避免），用 __BANG__ 占位，写完再统一替换。
- 后台进程会被沙箱回收；dev server 必须在用户自己的终端里启动。
- Docker Hub 出口受限，镜像用 docker.m.daocloud.io 前缀拉取后重新 tag。
- npm 走内网镜像，装包加 --cache /tmp/npmcache。
- Prisma 改 schema 必须先写 migration，再 npx prisma migrate deploy；本地执行需要显式 DATABASE_URL。

## 1. 当前状态

平台已经是可运行的 Next.js + Socket.IO + PostgreSQL 单体，完成到：

- 认证、房间列表、建房、开房配置、车卡、建卡、带入审核。
- 规则包驱动：coc7-baseline / touhou-ext，均带预设角色数据。
- 房间准备页与跑团页已拆分。
- 战斗可发起、可审批、可 Socket 操作、可中止，战斗快照持久化。
- 卡牌批量审核、稀有度边框、COMPENDIUM 共享模板与复制已完成。

测试规模：137 tests 全部通过（formula 48 / rules 57 / combat 32）。

## 2. 本轮完成（第 4 节 1 至 6 项）

### 第 1 项：开房配置页端到端验证
- 新增 `apps/web/scripts/verify-room-setup.ts`。
- 真实 HTTP：注册、登录、提交 /rooms/new server action，创建东方房 + ATB + 禁用 GRAZE，然后用 loadEffectivePack 读回确认。
- 现在还额外验证：LOBBY 访问房间页会 307 跳准备页，KP 提交开始跑团后房间页 200。
- 运行方式见第 7 节。

### 第 2 项：预设角色数据
- `RulePackSchema` 新增 `presets` 数组，新增 `PresetCharacterSchema`（属性、技能、HP/MP/SAN/DP、tier、rarity、race、tags）。
- coc7-baseline 与 touhou-ext 各内置：路人 / 巡警 / 妖精 / 强者。
- 规则包版本升到 1.1.0，touhou-ext extends coc7-baseline@1.1.0。
- presets 是数组，深合并时整体替换，避免模组预设串包。

### 第 3 项：KP 准备 NPC / Boss 卡
- 页面：`/rooms/[id]/npcs/new`，仅 KP 可访问。
- 支持从本房有效规则包预设挑选，也支持自建。
- 落库为 `Card.type = NPC`、`Card.scope = ROOM`，不会进个人卡库。
- 房间准备页有本场 NPC / Boss 列表，可删除。

### 第 4 项：战斗发起与 CombatRequest 审批
- Room 新增 `allowPlayerCombatRequest Boolean @default(true)`，迁移：`20260910150000_room_allow_player_combat`。
- `/rooms/[id]/combat/new`：KP 直接发起；PL 可选自己审核通过的角色提交 CombatRequest。
- `/rooms/[id]/combat/requests/[requestId]`：仅 KP，可驳回，或选择敌方单位后通过并开战。
- 服务端校验控制权：PC 只能由 owner 选择，NPC/Boss 只能由本房 KP 选择。
- 开战后 `Room.status` 进入 COMBAT，战斗结束后回到 PLAYING。

### 第 5 项：战斗事件分派器
- `packages/combat/src/combat.ts` 现在真实读取 `pack.pack.combat.events[eventId].defaultEnabled`。
- 覆盖：GRAZE 擦弹、COUNTER 消弹、SPELLCARD_BREAK_CLEARS_DANMAKU 符卡击破清弹、OUT_OF_RULE_SPELL 规则外施法。
- ActionKind 增加 OUT_OF_RULE。
- 新增 `packages/combat/src/__tests__/events.test.ts`，4 个事件分支测试。

### 第 6 项：战斗界面 / Socket
- 战斗页面从独立路由改为内联在房间页：`/rooms/[id]` 有 active combat 时直接渲染 CombatBoard。
- 旧路由 `/rooms/[id]/combat/[combatId]` 现在只重定向回房间页。
- Socket 事件：`combat:join`、`combat:action`、`combat:reaction`、`combat:force-resolve`、`combat:abort`。
- `CombatBoard` 包含 ATB 进度条、顺序制出手顺序、行动面板、防守反应窗口、战斗日志、KP 强制结算、KP 中止战斗。
- 服务端 filterCombatForViewer 接入 KP/PL 视图；ParticipantView 新增 skills 字段，仅自己/KP 可见。
- 每次战斗变化写 CombatSnapshot；Combat.ruleSnapshot 存 RulePack，加载时重新编译。

## 3. 本轮追加的产品调整（用户要求）

- 准备页与房间页拆开：LOBBY 在 `/rooms/[id]/prepare`，PLAYING 在 `/rooms/[id]`。
- 准备阶段服务端禁止发言和掷骰：Socket 的 chat:send / dice:roll 检查 Room.status，LOBBY 直接拒绝。
- RoomConfigPanel 在准备页和房间页都渲染，所有成员随时可见规则包、车卡方式、战斗模式、事件开关、邀请码。
- 战斗轮次按归属：PC 由 owner 操作，NPC/Boss 由本房 KP 操作；同一玩家有多个就绪单位时，行动面板提供单位选择器。
- KP 有中止战斗按钮，中止后 phase 置 ENDED、写快照、房间回到 PLAYING。

## 4. 主要路由

| 路由 | 作用 |
|---|---|
| / | 房间列表 + 快速建房 + 待审角标 |
| /rooms/new | 开房配置页 |
| /rooms/[id]/prepare | 准备页：车卡、卡牌、带入审核、NPC 准备、房间配置、开始跑团 |
| /rooms/[id] | 跑团页：发言、掷骰、内联战斗 |
| /rooms/[id]/npcs/new | KP 准备 NPC / Boss |
| /rooms/[id]/combat/new | 发起战斗 / 提交战斗申请 |
| /rooms/[id]/combat/requests/[requestId] | KP 审批战斗申请 |
| /characters /cards 等 | 个人角色库与卡牌库 |

## 5. Socket 事件

- 聊天：room:join、chat:send、chat:message。
- 掷骰：dice:roll。
- 战斗：combat:join、combat:action、combat:update、combat:reaction-request、combat:reaction、combat:force-resolve、combat:abort、combat:aborted。
- Socket 入口：`apps/web/src/server/socket/index.ts`，战斗部分：`apps/web/src/server/socket/combat.ts`。

## 6. 关键设计 / 已知坑

- `apps/web/server.ts` 在动态 import socket 之前会 `process.loadEnvFile(.env)`。这保证 Next 路由签发 Socket 票据和 Socket 服务端校验票据用的是同一个 NEXTAUTH_SECRET。改动这里要特别小心。
- `auth()` 现在会回查用户行是否存在。孤儿 JWT 会当成未登录，避免 room.create 之外的所有外键错误。
- 房间状态：LOBBY 只能准备；PLAYING 才能聊天/掷骰/开战；COMBAT 中房间页内联战斗；战斗结束回 PLAYING。
- 战斗状态持久化：Combat + CombatSnapshot；Socket 进程内存里有 runtime cache，服务重启后从最新快照恢复。
- 行动控制关系见 `apps/web/src/server/combat/runtime.ts`：PC 的控制者是 Character.userId，NPC 的控制者是本房所有 KP。
- 技能 ID 是 RulePack `skills[].id`。战斗界面会从有效规则包取技能列表，并按当前行动单位过滤。COC7 没有 DANMAKU，不要拿东方技能去打 COC7 战斗。
- 创建战斗时会用规则引擎补全角色所有基础技能值，再叠加角色实际分配值，所以旧角色不会因为没加点就命中 0。已有旧战斗要中止后重新发起才会应用。
- 战斗反应窗口是 MVP：有 pendingReactions 时等待反应；KP 可以强制结算。
- E2E 脚本只用于本地，不要提交真实用户数据；脚本在 finally 里清房间和用户。

## 7. 如何验证

```bash
cd ~/WebstormProjects/runGroup
docker compose up -d db
cd apps/web
DATABASE_URL=postgresql://touhou:touhou@localhost:5432/touhou_trpg?schema=public npx prisma migrate deploy
DATABASE_URL=postgresql://touhou:touhou@localhost:5432/touhou_trpg?schema=public npm run db:seed
cd ../..
npm run typecheck
npm test
```

启动开发服务（必须在用户终端）：

```bash
npm run dev
```

E2E 脚本需要服务已在运行：

```bash
cd apps/web
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-room-setup.ts
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-combat.ts
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-card-library.ts
```

最近一次实测：

- verify-room-setup：PASS，包含东方房 ATB + 禁用 GRAZE + 准备页/跑团页切换。
- verify-combat：PASS，包含建战斗、Socket 加入、行动、防守反应、结算、快照、KP 中止。
- verify-card-library：PASS，包含批量审核 2 张、稀有度边框、共享模板复制。
- npm test：137 tests 通过。
- npm run typecheck：所有 workspace 通过。

## 8. 第 7 项：COMPENDIUM 共享库（已完成）

- 卡牌批量通过：新增 `reviewCardEntries` server action，准备页可勾选多张待审 `RoomCardEntry` 后一次通过或驳回。
- 稀有度边框：`Card.rarity` 映射到边框色，覆盖卡牌库、房间带入卡牌、房间 NPC/Boss 卡、角色装备卡与角色页持有卡。
- KP 模板卡 / COMPENDIUM 共享库：`Card.isTemplate`（迁移 `20260910160000_card_shared_template`）标记共享模板；卡牌库新增“共享模板库”，可复制其他用户的模板到自己的个人卡库，副本通过 `templateId` 指回来源。
- E2E：`apps/web/scripts/verify-card-library.ts`，覆盖批量审核、稀有度边框、共享模板复制。

## 9. 最近提交

```text
ca85efe feat(card): 完成卡牌批量审核、稀有度边框与共享模板
4c58cfe chore: 迁移 npm 解析地址并添加演示 seed
947432d fix(combat): 技能选项按单位过滤并补全基础值，新增战斗中止
0947ca0 feat(room): 准备页与跑团页拆分，战斗界面内联到房间页
022da62 fix(socket): 服务启动时加载 .env，票据签名与校验使用同一密钥
4ca3536 fix(auth): 校验会话用户仍存在，避免孤儿 JWT 触发外键错误
14b1cef feat(combat): 战斗发起审批、Socket 通道与战斗界面
d4d0d73 feat(combat): 战斗事件分派器按 defaultEnabled 生效
807cc9f feat(room): KP 从预设或自建准备本场 NPC/Boss 卡
297b7dc feat(rules): 内置预设角色数据（路人 / 巡警 / 妖精 / 强者）
13949b8 test(room): 开房配置页端到端验证（东方房 ATB + 禁用擦弹）
```
