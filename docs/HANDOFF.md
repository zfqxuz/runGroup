# 东方 TRPG 平台 · 交接文档

给下一个会话的 AI / 开发者。当前基线 commit 见 `git log -1`，分支 `main`，工作区干净。

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
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-room-setup.ts
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-combat.ts
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-card-library.ts
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-character-import.ts
E2E_BASE_URL=http://localhost:3000 npx tsx --env-file=.env scripts/verify-join-room.ts
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
