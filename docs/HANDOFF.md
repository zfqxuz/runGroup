# 东方 TRPG 平台 · 交接文档

给下一个会话的 AI / 开发者。当前基线 commit 见 `git log -1`，分支 `main`，工作区干净。

## 0.1 最新交接摘要（优先阅读）

### 当前状态
- 平台已具备：认证、房间准备/跑团、团本广场、我的团本、角色/卡牌库、战斗、团本快照、局内状态、暂停/继续/结束、游戏历史、用户菜单、线索/笔记/手书、悄悄话/暗骰、Markdown 渲染、房间归档。
- P2 当前进度：
  - P2-1 战术棋盘 MVP 第一版已完成：场景、地图、Token、拖动、实时同步。
  - P2-1 增量已完成：Token 图片、名称、边框色、尺寸、旋转、显示名称/HP、KP 可见/锁定。
  - P2-3 角色成长闭环基础已完成：成长汇总、差异标注、跨局继承。
- 测试基线：`npm run typecheck`、`npm test`、全量 14 个 E2E 均通过。

### 下一步开发顺序（用户已确认）
1. **继续 P2-3**
   - CoC 幕间成长检定（成长点 / 技能成长掷骰）。
   - 成长记录编辑 / 撤销 / 来源标注补全。
   - 角色页成长历史筛选与导出。
   - KP 结束本局前的成长确认页与角色卡预览。
2. **P2-1 战术棋盘后续增量**（P2-3 完成后，再按用户指示）
   - 六边形网格与网格吸附。
   - 战争迷雾实际操作、墙体、灯光、视线遮挡。
   - 地图图层与多背景。
   - 场景与团本结构化块自动绑定。

### 暂缓 / 不要主动做
- P2-2 规则内容与 RulePack 后台：hold。
- P2-4 用户 / 房间协作：hold。
- P2-5 部署与运维：hold。用户当前通过本机 terminal 运行 Next(3100) + frpc 内网穿透使用，不需要部署其他服务器。
- P2-6 质量与性能：除必要回归外 hold。

### P2-3 关键文件
- `apps/web/src/server/game/advancement.ts`：成长校验、应用、汇总。
- `apps/web/src/app/characters/[id]/page.tsx`：角色页成长展示。
- `apps/web/src/app/rooms/[id]/end/page.tsx` + `apps/web/src/components/room/EndGamePanel.tsx`：结束与批量成长。
- `apps/web/scripts/verify-growth-inheritance.ts`：成长闭环 E2E。

### 重要约束
- 反代 / 隧道配置、token、`frpc.ini` 不得提交 Git；仓库内目前没有相关文件。
- 本地 dev 端口为 `3100`，由用户在 terminal 启动；沙箱后台进程会被回收，不要依赖沙箱常驻。
- 任何代码改动完成后先跑验证，再提交并推送 `origin/main`。
- 新增 E2E 脚本要加入 `apps/web/package.json` 的 `verify:*` 命令。

## 0. 环境约束（先读）

- bash 命令里不要出现英文感叹号，不要出现美元符号加数字，不要写 heredoc。工具会报 Error: [object Object] 或直接挂到超时。
- 写文件优先用 printf 多行，复杂脚本先 printf 到 /tmp/xxx.py，再 python3 /tmp/xxx.py。
- TypeScript 如果必须写英文感叹号相关语法（旧文档要求完全避免），用 __BANG__ 占位，写完再统一替换。
- 后台进程会被沙箱回收；dev server 必须在用户自己的终端里启动。当前本地 dev 端口为 3100（3000 留给 Codex/MCP），server.ts 会先加载 apps/web/.env 再读取 PORT。
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
- 职业库：230 个 COC7 职业 + 7 个东方千幻抄职业已落库，含年代标记、信用范围、职业点公式与本职技能文案。
- COC7 空白卡「附表 B95:K212」中的完整技能已补入规则包（格斗 / 射击 / 科学 / 技艺 / 语言 / 驾驶 / 生存等专精）。
- 房间新增 `era`（现代 / 1920）；车卡页按房间年代过滤职业；车卡时职业点与兴趣点分开计算。
- 首页新增“加入房间”；玩家输入 KP 提供的邀请码即可加入房间并进入准备页 / 跑团页。
- xlsx 人物卡导入：基础信息、属性、职业序号、技能（初始 / 成长 / 职业 / 兴趣）、信用评级与武器可一键导入个人角色库。

测试规模：137 unit tests 全部通过（formula 48 / rules 57 / combat 32）；
E2E 脚本已覆盖 room-setup / combat / card-library / combat-options / character-import。

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
- 技能 ID 是 RulePack `skills[].id`。攻击技能由 `apps/web/src/server/combat/options.ts` 按房间生效规则包 + 角色已装备 WEAPON 卡推导：COC7 没装备武器时只允许 FIGHTING_BRAWL；装备武器后按 range/skillId 映射到对应射击/格斗技能；非 COMBAT 技能不会进入攻击下拉。东方的 DANMAKU/消弹/规则外施法不会出现在纯 COC 房。Socket 侧由 `validateCombatAction` 再校验一次。
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
E2E_BASE_URL=http://localhost:3100 npx tsx --env-file=.env scripts/verify-room-setup.ts
E2E_BASE_URL=http://localhost:3100 npx tsx --env-file=.env scripts/verify-combat.ts
E2E_BASE_URL=http://localhost:3100 npx tsx --env-file=.env scripts/verify-card-library.ts
E2E_BASE_URL=http://localhost:3100 npx tsx --env-file=.env scripts/verify-character-import.ts
E2E_BASE_URL=http://localhost:3100 npx tsx --env-file=.env scripts/verify-join-room.ts
npm run verify:combat-options
```

最近一次实测：

- verify-room-setup：PASS，包含东方房 ATB + 禁用 GRAZE + 准备页/跑团页切换。
- verify-combat：PASS，包含建战斗、Socket 加入、行动、防守反应、结算、快照、KP 中止。
- verify-card-library：PASS，包含批量审核 2 张、稀有度边框、共享模板复制。
- verify-combat-options：PASS，覆盖 COC 斗殴/武器限制、非战斗技能过滤、服务端行动校验。
- npm test：137 tests 通过。
- npm run typecheck：所有 workspace 通过。
- verify-character-import：PASS，动态构造 xlsx，验证属性 / 职业 / 技能 / 武器落库。
- verify-join-room：PASS，注册临时用户后用邀请码加入 DEMO01。

## 8. 第 7 项：COMPENDIUM 共享库（已完成）

- 卡牌批量通过：新增 `reviewCardEntries` server action，准备页可勾选多张待审 `RoomCardEntry` 后一次通过或驳回。
- 稀有度边框：`Card.rarity` 映射到边框色，覆盖卡牌库、房间带入卡牌、房间 NPC/Boss 卡、角色装备卡与角色页持有卡。
- KP 模板卡 / COMPENDIUM 共享库：`Card.isTemplate`（迁移 `20260910160000_card_shared_template`）标记共享模板；卡牌库新增“共享模板库”，可复制其他用户的模板到自己的个人卡库，副本通过 `templateId` 指回来源。
- E2E：`apps/web/scripts/verify-card-library.ts`，覆盖批量审核、稀有度边框、共享模板复制。

## 9. 第 8 项（本轮）：职业库、年代与 xlsx 人物卡导入

### 数据层
- 新增 `Occupation` 表与迁移 `20260910170000_occupations_and_room_era`。
- `packages/rules/src/packs/coc7-extra-skills.ts`：从空白卡「附表」生成的 COC7 额外技能（含专精），拼接到 `coc7-baseline.skills`。
- `apps/web/prisma/data/occupations.json`：230 个 COC7 职业 + 7 个东方千幻抄职业。
  - 字段：`code / name / era / creditMin / creditMax / pointsText / pointsFormula / skillsText / skillNames / relations / description`。
  - COC7 职业来自空白人物卡“职业列表”与“本职技能”表；东方职业来自用户提供的《东方千幻抄 ver1.10》第三章。
  - `era`：`BOTH / CLASSIC / MODERN`；`skillNames` 用于标记本职 / 可选技能与“任意 / 自选”位。
- `Room.era`：`CLASSIC`（UI 显示 1920 年代）或 `MODERN`；TOUHOU 允许为空。
- `Character` 新增 `occupationId / era / skillAllocation / sourceData`。
- `packages/rules/src/schema.ts` 的 `RaceSchema` 增加可选 `interestPoints`，用于千幻抄人类“兴趣技能点 = 智力 ×2.5”。

### 规则包调整
- `touhou-ext` 按用户提供的《东方千幻抄》正文补充/修正种族：
  人类、妖精、魔法使、妖兽、河童、付丧神、亡灵、妖怪、天狗、吸血鬼等。
- 按用户补充的 3.2 技能表格图片新增/改名：
  - `交涉-通用`（`NEGOTIATION`，5%）
  - `技艺-乐器`（`ART_INSTRUMENT`，5%）
  - `技艺-人偶`（`PUPPETRY`，5%）
  - `语言-符文`（`RUNE`，1%）
  - `战斗-忍术`（`NINJUTSU`，1%）
  - `战斗-弹幕`（`DANMAKU`，20%）
  - `战斗-飞行`（`FLIGHT`，20%）
  - `调查-占卜`（`DIVINATION`，5%）
  - `幻想知识` 说明补全为下分神术/阴阳术、魔法、元素法、妖术。
- 注意：还有若干普通型 / 幻想型的进阶规则文字较长，当前先落技能表与基础值；完整法术表和历史物品表仍可后续补。

### 车卡与导入
- `CharacterBuilder`：
  - 选职业（服务端按房间年代过滤后传入）。
  - 职业点按所选职业 `pointsFormula` 计算；兴趣点可使用种族 `interestPoints`。
  - 技能卡上分成“职 / 趣”两个加值列；保存时提交 `skillAllocation`，服务端重算每个技能的基础值。
- `/characters/import` 与 `importCharacterAction`：
  - 服务端 `parseCharacterWorkbook` 解析“人物卡”工作表。
  - 支持属性单元格、左右技能栏、职业序号、年代单元格和武器表。
  - 导入到个人角色库；带入房间仍走原有 `RoomCharacterEntry` KP 审核。
- E2E：`apps/web/scripts/verify-character-import.ts`，运行时动态构造最小 xlsx，不提交真实用户卡。

### 后续开发路线
完整设计见 `docs/SPEC.md`，团本格式见 `docs/MODULE_FORMAT.md`。

1. 准备页与开局闸门。
2. 当前角色与局内角色。
3. 团本管理、标准格式与 zip 导入。
4. 局内状态与暂停。
5. 跨局成长与结束流程。
6. 重连与恢复。

原东方技能的完整进阶效果、法术附表与特色物品表，作为团本管理功能完成后的扩展内容。

## 10. 最近提交

```text
d20735e feat(character): 职业库、年代属性与 xlsx 人物卡导入
25067b3 docs: 补充战斗技能过滤说明与验证
da26a5b fix(combat): 按规则包与装备过滤战斗技能
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

## 11. 第 9 项（本轮）：准备闸门与团本导入管理（已完成）

### 准备阶段
- `RoomMember.ready` 迁移：`20260910180000_room_member_ready`。
- `toggleReadyAction`：准备页成员可切换自己的 ready。
- `startRoomAction` 服务端校验：
  - 所有非旁观成员 `ready = true`。
  - 每名 PL 至少有一张 `APPROVED` 角色带入记录。
  - 不满足条件时房间保持在 `LOBBY`。
- 准备页新增成员准备状态列表、准备按钮和 `readyCount / requiredCount`。

### 团本管理与导入
- 新增页面：
  - `/rooms/[id]/modules`
  - `/rooms/[id]/modules/[moduleId]`
- 新增接口：
  - `POST /api/modules/import`
  - `saveModuleAction`
- 数据模型：
  - `Module` 增加 slug / system / era / sourceType / metadata / importReport 等字段。
  - 新增 `ModuleAsset`，迁移：`20260910190000_module_assets`。
- 标准格式解析：
  - 支持 `.md` 与 `.zip`。
  - 校验 `touhou-module/v1` Front Matter。
  - 校验 14 个标准章节。
  - 资源路径自动规范化。
  - 支持图片、地图、handout、音频、视频、PDF 等白名单资源。
- 导入后的团本可在管理页继续编辑正文、元信息与版本并保存。
- 资源通过 `/api/assets/modules/...` 提供访问。

### 新增 E2E
- `npm run verify:room-ready`
- `npm run verify:module-import`

最近验证结果：

- 准备闸门 E2E：PASS
- 团本导入 E2E：PASS
- 原 room-setup / combat / card-library / character-import / join-room / combat-options：PASS
- `npm run typecheck`：PASS
- `npm run build --workspace @touhou/web`：PASS

### 继续按 Spec 推进
后续按 `docs/SPEC.md`：

1. 当前角色与局内角色。
2. `Game` / `GameState` 与暂停、继续。
3. 跨局成长与结束流程。
4. 重连与恢复。

## 12. 第 10 项：当前角色、Game / GameState 与暂停继续结束（已完成基础）

### 数据层
- 新增 `Game`、`GameState`、`GameCharacter`、`CharacterAdvancement` 表和迁移 `20260910200000_games`。
- `RoomStatus` 增加 `PAUSED`。
- `RoomMember.activeCharacterId` 已接入准备页与跑团页。

### 流程
- 准备页可从已通过审核的角色中选择“当前角色”。
- KP 开始新局时会：
  - 创建 `Game` 与 `GameState`。
  - 为每名 PL 创建 `GameCharacter`，读取当前角色 HP / MP / SAN / DP。
- KP 可以在跑团页暂停本局：
  - 暂停后房间状态为 `PAUSED`，自动回到准备页。
  - 所有非旁观成员 ready 重置。
- 全员重新准备后，KP 点击“继续跑团”：
  - 读取已有 `Game` 与 `GameState`。
  - 恢复为 `PLAYING`，不创建新局。
- KP 可以结束本局：
  - `Game.status = ENDED`。
  - 房间回到 `LOBBY`，可以准备下一局。
  - 角色、物品和成长记录不会因结束本局而删除。

### E2E
`npm run verify:room-ready` 已扩展覆盖：

- 未 ready 不能开始。
- 有 PL 缺少通过审核角色不能开始。
- 当前角色保存。
- 开始新局并创建 GameCharacter。
- 暂停、全员重新准备、继续。
- 结束本局回到 LOBBY。

当前验证结果：

- `verify:room-ready`：PASS
- `verify:module-import`：PASS
- 其他既有 E2E：PASS
- `npm run typecheck`：PASS
- `npm run build --workspace @touhou/web`：PASS

### 下一阶段
- `CharacterAdvancement` 的成长录入与角色页标注。
- `GameState` 的章节 / 场景 / 遭遇 / 时间 / 旗标编辑 UI。
- 断线重连时返回完整 GameState 与战斗快照。
- 团本管理页的删除、复制与资源替换。

## 13. 第 11 项（本轮）：局内状态、成长与团本管理收尾（已完成）

### 局内状态
- 新增 `updateGameStateAction`：
  - KP 可编辑当前章节、场景、遭遇、团内时间。
  - 旗标 / 计数器 / 自定义状态使用 JSON 文本保存，服务端校验必须是对象。
  - 使用 `GameState.version` 做乐观锁，版本不一致会拒绝保存并提示刷新。
- 跑团页新增 `RoomGameStatePanel`：
  - 所有成员可查看当前章节、场景、遭遇、团内时间与状态摘要。
  - KP 可展开表单更新状态。

### 成长记录
- 新增 `recordAdvancementAction`：
  - KP 可为本局角色记录 `ATTRIBUTE / SKILL / SAN / ITEM / RELATIONSHIP / OTHER` 成长。
  - 属性 / 技能 / SAN 会同步到基础角色卡，同时写入 `CharacterAdvancement` 作为来源标注。
- 角色详情页显示完整成长记录、来源局与备注。
- 准备页当前角色下方显示最近 5 条成长标注。

### 重连与状态同步
- `room:join` 现在返回：
  - 完整 `GameState`
  - `activeCombatId`
  - 当前角色摘要
- `room:state:update` / `room:advancement:update` 通过 Socket 广播；在线客户端会刷新服务端页面状态。
- 客户端重连后发现 GameState 版本或战斗 ID 变化，会自动刷新页面，恢复到当前局内位置。
- 战斗快照仍由 `CombatBoard` 通过 `combat:join` 恢复，Socket 重连后会自动重新加入战斗。

### 团本管理
- 准备页不再内嵌团本编辑器：只展示本房团本列表、当前局绑定关系，并提供“团本管理 / 新建”入口。
- KP 开始新局时可在开始表单中选择已有团本；`startRoomAction` 会绑定所选 `moduleId`。
- 团本管理页新增“新建空白团本”，自动生成标准 14 章节模板。
- 团本详情页新增：
  - 复制团本。
  - 删除团本；被进行中的局使用时拒绝删除。
  - 资源替换 / 删除；通过 `POST/DELETE /api/modules/[moduleId]/assets` 完成。
- 团本列表页新增复制 / 删除入口。
- 删除团本或资源时，只有失去全部引用后才会清理底层 `Asset` 与文件。
- E2E `verify:module-import` 已扩展到覆盖：复制、资源替换、占用保护、删除清理。

### 本轮验证
- `npm run typecheck`：PASS
- `npm test`：137 tests PASS
- `npm run build --workspace @touhou/web`：PASS
- E2E：
  - `verify:room-ready`：PASS
  - `verify:module-import`：PASS（新增团本管理覆盖）
  - `verify:game-state`：PASS（新增）
  - 其余既有 E2E：PASS

### 下一阶段建议
- 将 `GameState.currentChapterId / currentSceneId / currentEncounterId` 从自由文本升级为基于 `ModuleChapter / Scene / Encounter` 的结构化选择器。
- 团本版本化：局开始时保存模块内容快照，局进行中更新团本时不覆盖已开局快照。
- 进行中的局删除资源时保留旧资源直到本局结束。
- 实时战斗发起 / 战斗结束的 Socket 广播，避免其他在线玩家需要刷新页面。
- KP 结束本局前的成长确认页 / 批量奖励录入。

## 14. 第 12 项（本轮）：团本广场、我的团本与游戏历史（已完成）

### 数据模型
- 迁移 `20260910210000_module_gallery_and_room_selected_module`。
- `Module` 新增：
  - `ownerId` / `owner`
  - `background`
  - `occupationRecommendation`
  - `publishedAt`
  - 已有 `isPublished` 用于发布状态。
- `Room` 新增 `selectedModuleId` / `selectedModule`，用于持久化准备页当前选择的团本。
- 迁移会把旧的房间团本 `ownerId` 回填为房间 owner。

### 团本所有权与广场
- 现有导入 / 空白新建都会写入 `ownerId`。
- 每个人都可以在“我的团本”创建、导入、编辑、发布自己的团本。
- 只有 `ownerId === 当前用户` 才能编辑、发布、删除团本。
- 团本广场 `/modules`：
  - 只展示 `isPublished = true` 的团本。
  - 只显示公开字段：背景、年代、规则系统、简介、职业推荐。
  - 不显示正文、资源、KP 信息。
  - 支持“用这个团本建房”和“公开预览”。
- “我的团本” `/modules/mine`：
  - 与“我的角色”“我的卡牌”“游戏历史”并列在主导航。
  - 支持新建空白团本、导入标准包、发布 / 取消发布、编辑、删除。
- 团本详情 `/modules/[moduleId]`：
  - 作者可完整编辑和替换资源。
  - 已发布团本对登录用户公开预览，但不会泄露正文。
  - 非公开正文仅作者与本房 KP 可见。

### 房间团本选择
- 准备页的公开信息全员可见；完整正文仅 KP / 作者可见。
- KP 可在准备页保存“本局团本”选择。
- 开始新局时会使用 `Room.selectedModuleId`；也可在开始请求里临时指定 `moduleId`。
- 从广场“用这个团本建房”会预选团本并写入新房间的 `selectedModuleId`。
- 也支持“先建房再选团本”。

### 游戏历史
- 新增 `/history`：列出自己参与过、`Game.status = ENDED` 的历史局。
- 新增 `/history/[gameId]`：
  - 校验房间成员身份。
  - 只读展示使用团本的公开字段、最终 `GameState`、局内角色、成长记录与最近历史消息。
  - 非成员访问返回 404。

### 新增 E2E
- `npm run verify:module-gallery`：发布 / 广场预览 / 非作者不可编辑 / 直接建房 / 先建房再选团本。
- `npm run verify:game-history`：历史列表 / 只读详情 / 非成员不可见。

### 本轮验证
- `npm run typecheck`：PASS
- `npm test`：137 tests PASS
- `npm run build --workspace @touhou/web`：PASS
- 全部既有 E2E：PASS
- 新增 E2E：`verify:module-gallery`、`verify:game-history` PASS

## 15. P0（本轮）：团本快照、资源保护、结束确认、恢复加固（已完成）

### 数据层
- 迁移 `20260910220000_module_revisions`：新增 `ModuleRevision` / `ModuleRevisionAsset`，`Game` 增加 `moduleRevisionId`。
- 开局 `startRoomAction` 调 `ensureModuleRevision`：按团本内容 + 资源生成内容哈希并复用/创建快照。
- `GameState.moduleVersion` 继续写快照版本；跑团页、准备页提示、历史页改从 `loadGameModuleView` 读取。
- 旧局没有 `moduleRevisionId` 时回退读取实时 `Module`，并在继续暂停局时自动补快照。

### 进行中局资源保护
- `deleteAssetIfOrphan` 会检查 `ModuleRevisionAsset -> ModuleRevision -> Game.status`。
- 只要有 `PREPARING / PLAYING / PAUSED / COMBAT` 的局引用旧 Asset，替换 / 删除资源时不会清理文件。
- 局全部结束后才允许清理；快照引用保留 `relativePath / url`，`assetId` 由外键 `SET NULL` 置空。

### 结束本局与批量奖励
- 新增 `/rooms/[id]/end` 确认页和 `EndGamePanel` 批量录入组件。
- 新增 `endGameWithAdvancementsAction`：一个事务内写入多条 `CharacterAdvancement`、同步属性 / 技能 / SAN、结束 `Game`、关闭未结束 `Combat`，房间回 `LOBBY`。
- 跑团页「结束本局」改为跳转确认页；`verify-room-ready` 已覆盖批量 SAN 奖励。
- 异常恢复：房间状态卡在 PLAYING / COMBAT / PAUSED 但没有进行中 Game 时，结束页仍可打开并确认重置回 LOBBY。
- 房间解散：首页每个房主自己的房间卡片新增「解散房间」按钮，二次确认后删除房间；非房主不显示入口。

### 暂停 / 重启恢复
- `saveCombatState` 每次落盘时按活跃 `Game` 同步 `GameCharacter` 的 HP / MP / SAN / DP / status。
- `pauseGameAction` 若 Runtime 还在内存，会先强制 `saveCombatState` 再置 PAUSED。
- `server.ts` 把 `.env` 加载提前到读取 `PORT` / `HOST` 之前；本地 dev 端口现在为 3100。

### 验证
- `npm run typecheck` PASS；`npm test` 137 PASS；`npm run build --workspace @touhou/web` PASS。
- 新增 `npm run verify:module-revision`：快照 / 进行中资源保护 / 结束后清理 PASS。
- `verify:room-ready` 扩展为：开局快照 / 编辑团本不影响本局 / 批量成长结束 / 历史快照 / 异常重置 / 解散房间 PASS。
- `verify:combat` 扩展为：清空 Runtime 后从 `CombatSnapshot` 恢复，并校验 `GameCharacter` 同步 PASS。
- 全量 12 个 E2E 在 `http://localhost:3100` PASS。

## 16. P1（本轮）：实时广播、结构化导航、线索笔记、悄悄话、Markdown、归档（已完成第一版）

### 实时广播
- 新增 `room:update`、`combat:started`、`combat:ended` 事件。
- `RoomPlay` / `CombatBoard` 收到后自动 `router.refresh()`，在线玩家不再需要手动刷新。
- 开局、暂停、继续、结束本局、战斗创建 / 结束 / 中止都会广播。

### 结构化局内导航
- 新增 `server/modules/structure.ts`：解析 ` ```yaml module-scene / module-encounter / module-clue / module-item / module-ending / module-reward / module-npc ` 受控块。
- 团本保存 / 导入时写入 `content.structured`；`GameModuleView` 暴露 `structured`，旧团本在读取时动态解析。
- `RoomGameStatePanel` 的当前章节 / 场景 / 遭遇在存在结构化数据时改为下拉选择，否则退回自由输入。
- 正在进行的局读取的是开局 `ModuleRevision` 中的结构化数据。

### 线索 / 笔记 / 手书
- 新增 `RoomInfoPanel` 与 `actions/room-info.ts`。
- KP 可发布线索、设置是否公开；玩家可标记已发现，写入 `ClueDiscovery`。
- 玩家可写自己的 `Note`；KP 可写 KP 专属笔记。
- 团本快照中的 `HANDOUT` 资源会在房间页作为手书列表展示。

### 悄悄话与暗骰
- `ChatChannel` 增加 `WHISPER`，`Message.targetId` 接入聊天流程。
- 玩家可对指定成员发悄悄话；Socket 使用 `user:<userId>` 房间只推送给发送者与目标。
- 掷骰新增 `PUBLIC / DARK / SECRET`：
  - `DARK`：发送者 + KP 可见。
  - `SECRET`：仅发送者可见。
- 历史消息加载会按当前用户过滤悄悄话与私密掷骰。

### Markdown 渲染
- 新增 `ModuleMarkdown`（`react-markdown` + `remark-gfm`），不使用 raw HTML，避免 XSS。
- 团本详情页与房间团本详情页的只读正文改渲染 Markdown。

### 房间归档
- 新增 `archiveRoomAction`：房主可将房间置为 `ENDED`，同时结束进行中的局与战斗，房间数据保留。
- 首页把「已归档」房间单独分组展示；归档房间页为只读，Socket 发言 / 掷骰会被拒绝。
- 「解散房间」仍是物理删除，两者语义区分：归档保留数据，解散删除数据。

### 验证
- `npm run typecheck` PASS；`npm test` 137 PASS；`npm run build --workspace @touhou/web` PASS。
- `verify-game-state` 扩展：线索 / 笔记 / 悄悄话 / 暗骰 / 私密掷骰 PASS。
- `verify-room-ready` 扩展：归档 / 解散房间 PASS。
- `verify-combat` 扩展：房间频道 `combat:ended` / `room:update` 广播 PASS。
- 全量 12 个 E2E 在 `http://localhost:3100` PASS。

## 17. 后续开发计划（P2）

当前 P0 / P1 第一版已完成，下面是建议的后续优先级。

### P2-1 战术棋盘 / 场景地图（建议最高优先级）
现状：`Scene` / `Map` / `MapLayer` / `Token` / `Wall` / `Light` 模型已经存在，但还没有 UI 和 server actions。
目标：
- KP 创建 / 编辑 / 切换场景，绑定背景与音乐。
- 地图上传、网格、图层、初始视野。
- 角色 / NPC / Boss 绑定 Token，支持拖动和锁定。
- 战争迷雾、墙体、灯光 MVP。
- Socket 实时同步 Token 与场景变化。
- E2E：KP 建场景 → 放 Token → 另一客户端实时看到。

### P2-2 规则内容补全与 RulePack 管理
- 补全 `touhou-ext` 的完整法术表、特色物品、普通型 / 幻想型进阶效果。
- RulePack 从代码注册表升级为数据库管理：创建、版本、发布、绑房、导入导出、审计。
- 规则包管理页面与权限。
- E2E：自定义规则包建房并生效。

### P2-3 角色成长闭环
- 角色详情页的成长记录消费 / 展开。
- 成长点、成长检定、技能提升、SAN 奖励可视化。
- 跨局 `CharacterAdvancement` 与基础卡的差异标注。
- E2E：结束一局并确认成长，再开下一局继承。

### P2-4 用户与房间协作
- 邀请链接 / 申请加入 / 审批加入。
- KP 转让、成员移出、旁观者管理、角色权限细化。
- 房间设置、黑名单、操作日志。

### P2-5 部署与运维
- 完成 `.github/workflows/deploy.yml` 中 SAE AppId / secrets 的接入。
- 区分 staging / production，自动执行 `prisma migrate deploy` 与必要的 seed。
- 数据库备份、回滚、健康检查、日志告警。
- Docker 镜像、CI、localhost:3100 与生产端口文档同步。

### P2-6 质量与性能
- 全量 E2E 并入 CI。
- Socket 多实例、断线重连、消息背压与限流。
- 上传文件安全、资源访问鉴权、慢查询与索引优化。
- 核心页面加载性能与错误边界。

## 18. P2-1 战术棋盘 MVP（第一版已完成）

### 已落地
- 新增 `/rooms/[id]/scenes` 场景管理页，KP 可以：
  - 创建场景并自动创建默认地图。
  - 切换当前场景、编辑场景名、描述、旁白、天气、时段。
  - 编辑地图宽高、格子大小、格子类型、背景色、初始 X/Y/缩放、显示网格 / 迷雾开关。
  - 上传场景背景与地图背景。
  - 从本局 GameCharacter / 本房 NPC 卡添加 Token。
  - 管理 Token：上传 Token 图、改名、边框色、尺寸、旋转、显示名称 / HP 条，KP 可切换可见与锁定。
  - 删除 Token / 删除场景。
- 跑团页新增 `SceneBoard`：
  - 渲染当前激活场景的地图、背景、网格、迷雾遮罩和 Token。
  - Token 显示名称、头像 / 图片、边框色、HP 条。
  - KP 可拖动全部 Token；玩家可拖动自己的角色 Token；锁定 / 不可见 Token 不可拖动。
  - 拖动结束后通过 `scene:token:move` Socket 事件移动并广播。
- Socket：
  - 新增 `scene:token:move` 客户端事件与 `scene:token:updated` 房间广播。
  - 新增 `scene:updated` 广播，场景切换 / 编辑后在线客户端自动刷新。
- 资源：
  - `/api/upload` 新增 `SCENE_BG` / `MAP` 用途。
  - `attachAssetAction` 支持设置场景背景与地图背景，旧背景失引后自动清理。

### 验证
- `npm run typecheck` PASS。
- `npm test` PASS。
- 新增 `npm run verify:scene-board`：创建场景 / 添加 Token / 编辑 Token / 玩家 Socket 拖动 / KP 实时收到广播 PASS。
- 全量 E2E 13 项在 `http://localhost:3100` PASS。

### 后续 P2-1 增量
- 六边形网格与网格吸附。
- 战争迷雾实际操作（探索区域 / 手动揭示）。
- 墙体、灯光、视线遮挡。
- 地图图层与多背景切换。
- 场景与团本结构化块的自动绑定。

## 19. P2-3 角色成长闭环（基础完成）

### 角色页成长汇总
- 角色详情页属性区显示成长加成，例如 `成长 +2`。
- 技能区显示技能成长加成，例如 `成长 +10`。
- SAN 上限显示 SAN 累计成长。
- 成长记录区新增汇总卡：总记录、属性变化数、技能提升数、SAN 累计。
- 成长记录按来源局分组，可展开 / 收起；属性目标显示中文名，技能 / 物品 / 关系显示原始标注。

### 跨局继承
- `CharacterAdvancement` 继续作为成长事实来源。
- 属性 / 技能 / SAN 成长会即时同步到基础角色卡。
- 结束本局后开新局时，`startRoomAction` 创建的新 `GameCharacter` 会读取成长后的 `Character.hp / mp / san / dp`，实现跨局继承。
- E2E 覆盖：开局 → 记录 SAN / 技能成长 → 角色页显示差异 → 结束本局 → 再开一局继承。

### 新增 E2E
- `npm run verify:growth-inheritance`：成长记录 / 差异标注 / 结束本局 / 跨局继承 PASS。

### 验证
- `npm run typecheck` PASS。
- `npm test` PASS。
- 全量 14 个 E2E 在 `http://localhost:3100` PASS。

### P2-3 后续增量
- 成长点 / 成长检定（CoC 幕间成长掷骰）。
- 成长记录编辑 / 撤销 / 来源标注补全。
- 角色页成长历史筛选与导出。
- KP 结束本局前的成长确认页与角色卡预览。
