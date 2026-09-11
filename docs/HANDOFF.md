# 东方 TRPG 平台 · 交接文档

给下一个会话的 AI / 开发者。当前基线 commit 见 `git log -1`，分支 `main`，工作区干净。

## 0.1 最新交接摘要（优先阅读）

### 当前状态
- 最新基线：`6f485d2 fix(ai,scene): 隔离 AI 导入会话并支持 PDF/图片解析，限制 Token 重复放置`，分支 `main`，工作区干净，已推送 `origin/main`。
- 平台已具备：认证、房间准备 / 跑团、团本广场、我的团本、角色 / 卡牌库、战斗、团本快照、局内状态、暂停 / 继续 / 结束、游戏历史、用户菜单、线索 / 笔记 / 手书、悄悄话 / 暗骰、Markdown 渲染、房间归档。
- P2 当前进度：
  - P2-1 战术棋盘已完成：场景 / 地图 / Token / 拖动 / 实时同步；Token 图片与属性；六边形网格与吸附；战争迷雾；墙体 / 灯光 / 视线遮挡；地图图层；团本结构化场景自动绑定。准备阶段也可用 SceneBoard，可切换场景、清空墙灯、放置 PC / NPC Token。同一角色在同一场景只能有一个 Token（下拉过滤 + 服务端校验 + DB 唯一约束）。
  - P2-2 规则包后台已完成：DB 规则包、版本、发布 / 归档、绑房、JSON 导入导出、内置同步、审计；管理后台入口在管理员用户下拉菜单。规则内容本身（`touhou-ext` 完整法术表 / 特色物品 / 普通型与幻想型进阶效果）仍是待办。
  - P2-3 角色成长闭环已完成：基础、跨局继承、CoC 幕间成长检定、成长记录编辑 / 撤销 / 来源标注、筛选与 CSV 导出、结束确认页。
  - DeepSeek 智能团本导入已完成：任意数量 md / txt / json / docx / pptx / xlsx / pdf（正文 + 内嵌图片）/ png / jpg / webp / gif / avif / bmp / tiff / heic 多文件上传；默认 `deepseek-flash`；异步后台任务 + 轮询进度；每次导入生成独立 `aiSessionId` 且不继承历史会话；整合为 `touhou-module/v1`。失败断点重试尚未实现。
  - 隐藏信息规则已完成：NPC / Boss 默认隐藏、KP 可公开；玩家互见由房间配置（默认公开）；隐藏 Boss 战斗仅展示伤害；模组魔法可在准备阶段启用并在战斗施放。
  - 团本模板 / 物化已完成：`module-*` 结构化块与 `characters/npcs.yaml` 解析为只读模板；KP 在准备页「应用团本预设」可克隆出房间 NPC / Boss 卡、武器 / 物品 / 证物卡、场景地图、线索、遭遇与魔法；换预设整批替换。
  - CoC7 车卡规则修正已完成：本职 / 分类 / 社交 / 自由技能判定；本职 80 / 兴趣 70 的上限；母语等高基础值不误报且不能再加点。
  - 通用法术系统已完成（见第 33 节）：RulePack `effects` 指令集（DAMAGE / HEAL / MP_RESTORE / MP_DRAIN / SAN / STATUS / DOT / STUN / CONTROL / CLEANSE）；`targeting` 自动推断；SELF / ONE / ALL；SELF 与 ALLY 可选自己；敌对法术统一进入应对窗口；旧 `damage` 字段兼容；AI 导入提示词已同步。
  - AI 导入会话隔离与 PDF / 图片解析已完成（见第 34 节）：每次导入独立 session；PDF 正文与内嵌图片；HEIC / AVIF / TIFF / BMP / SVG 兜底；图片存在但选了非视觉模型时自动切换 `deepseek-flash`。
- 管理员：`bdmin` 已通过迁移与 seed 设为 `ADMIN`；后台路径 `/admin`。
- 测试基线（2026-09-11）：`npm run typecheck` PASS；`npm test` 153 tests（formula 48 / rules 65 / combat 40）；`apps/web/scripts/verify-*.ts` 共 28 个，且全部注册为 `npm run verify:*`。本轮已验证：`verify-ai-pdf-parse`、`verify-ai-import`、`verify-scene-ops` PASS；全量 28 项未在最终 commit 上一次性重跑，接手后大改前建议重跑。

### 接手建议（用户尚未给出下一项开工指令）
1. **补 P2-2 规则内容（建议第一优先，但开工前先向用户确认）**：`touhou-ext` 完整法术表、特色物品、普通型 / 幻想型进阶效果；可顺带做规则包可视编辑与更强的校验提示。
2. **DeepSeek 导入健壮性**：失败后断点重试；扫描版 PDF 如需更强 OCR，可在现有“抽内嵌图片 + vision”基础上再加页面渲染 OCR。
3. **小范围可选**：玩家自助标记成长点（需权限扩展）；手书显式公开开关。
4. 当前远端 `origin/main` 已是最新；接手前先 `git status`、`git log -1` 确认。

### 暂缓 / 不要主动做
- P2-2 规则内容与 RulePack 后台可视化：hold，等用户明确指令。
- P2-4 用户 / 房间协作：hold。
- P2-5 部署与运维：hold。用户当前通过本机 terminal 运行 Next(3100) + frpc 内网穿透使用，不需要部署其他服务器。
- P2-6 质量与性能：除必要回归外 hold。

### 最新一轮关键文件（通用法术系统）
- `packages/rules/src/magic.ts`、`packages/rules/src/schema.ts`：效果指令、目标推断、旧 `damage` 兼容。
- `packages/combat/src/combat.ts`：效果结算、DOT / STUN / CONTROL、SELF / ALL 目标、法术应对窗口。
- `apps/web/src/server/combat/options.ts`、`apps/web/src/server/socket/combat.ts`：技能 / 目标 / 应对校验与实时事件。
- `apps/web/src/components/room/CombatBoard.tsx`：目标选择（含自己 / 全体）、等待应对提示、状态展示。
- `apps/web/src/server/modules/magic.ts`、`apps/web/src/server/ai/module-import.ts`：模组 `structured.magic` 与 DeepSeek 提示词。
- `apps/web/scripts/verify-magic-effects.ts`：本轮 E2E。

### 重要约束
- 反代 / 隧道配置、token、`frpc.ini` 不得提交 Git；仓库内目前没有相关文件。
- 本地 dev 端口为 `3100`，由用户在 terminal 启动；沙箱后台进程会被回收，不要依赖沙箱常驻。
- 任何代码改动完成后先跑验证，再提交并推送 `origin/main`。
- 新增 E2E 脚本要加入 `apps/web/package.json` 的 `verify:*` 命令。
- PDF 解析依赖 `unpdf@1.8.1`，要求 Node >= 22；换 Node 环境时确认版本。
- Token 唯一约束来自迁移 `20260917000000_scene_token_unique_placement`，新环境执行 `npx prisma migrate deploy` 会清理历史重复 Token（同 map 保留最早一条）。

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

测试规模：153 unit tests 全部通过（formula 48 / rules 65 / combat 40）；
`apps/web/scripts/verify-*.ts` 共 27 个 E2E，覆盖房间、战斗、团本、成长、场景、管理与 AI 导入等。

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

## 20. P2-3 角色成长闭环（本轮增量完成）

### 数据层
- 迁移 `20260911000000_advancement_source_and_growth_checks`。
- `CharacterAdvancement` 新增：
  - `source`：`MANUAL / END_REWARD / GROWTH_CHECK / MODULE / IMPORT / OTHER`，旧记录默认 `MANUAL`。
  - `createdBy`、`metadata`（规则细节快照）、`editedAt`、`revertedAt`、`revertedBy`。
- 新增 `GrowthCheck`：
  - 一个 `gameId + characterId + skillId` 唯一，状态 `PENDING / PASSED / FAILED / CANCELLED`。
  - 保存 `beforeValue / roll / gain / advancementId`，成功时关联生成的成长记录。

### CoC 幕间成长检定
- 规则：对每个待检定技能掷 1d100；结果大于当前技能值，或落在 96-100 时，技能 +1d10。
- 纯规则实现：`packages/rules/src/growth.ts` 的 `resolveGrowthChecks`，已加 4 个 unit tests。
- 服务端：`apps/web/src/server/game/growth.ts` 的 `resolveGameGrowthChecks`：
  - 事务内读取待检定成长点，按规则包补全当前技能值。
  - 成功时写 `CharacterAdvancement(source = GROWTH_CHECK)`、同步角色技能、关联 `GrowthCheck.advancementId`。
- UI：
  - 跑团页 KP 可标记 / 取消成长点（角色 + 技能选择）。
  - 结束页可一键进行成长检定；结束本局表单可勾选“结束前自动结算”。
  - 成长点当前值来自规则包基线 + 角色分配 + 种族 / 派生加成（与战斗初始化同一口径）。

### 成长记录编辑 / 撤销 / 来源标注
- `server/actions/advancement.ts`：
  - `updateAdvancementAction`：先反向回退旧数值，再应用新数值，更新目标 / 数值 / 备注 / 来源，并写 `editedAt`。
  - `revertAdvancementAction`：回退数值并写 `revertedAt / revertedBy`，记录保留用于追溯。
- `summarizeAdvancements` 会跳过已撤销记录；角色页属性 / 技能 / SAN 的“成长 +N”只统计有效记录。
- 角色页与结束页都显示来源标签（成长检定 / 结束奖励 / 手动记录等）与“已撤销 / 已编辑”状态。

### 角色页筛选与导出
- 角色页支持按成长类型、来源、来源局筛选；筛选状态通过 query string 保留。
- 新增 `GET /characters/[id]/growth/export`，按同样的筛选条件导出 UTF-8 BOM CSV。
- 导出列：日期、角色、成长类型、目标、变化、来源、来源局、备注、状态。

### 结束本局成长确认页
- `/rooms/[id]/end` 增加：
  - 成长点确认区：待检定列表、取消、一键成长检定。
  - 角色卡预览：HP / MP / SAN / DP、九项属性、有效技能列表；待检定技能高亮。
  - 已有成长记录列表与 KP 撤销入口。
- `EndGamePanel` 在有待检定成长点时默认勾选“结束前自动结算”，与批量奖励同一事务写入。

### 验证
- `npm run typecheck` PASS。
- `npm test` PASS（141 tests：formula 48 / rules 61 / combat 32）。
- 全量 15 个 E2E 在新建的临时生产服务 `http://localhost:3101`（独立 `.next-e2e` 构建）PASS。
- 新增 `npm run verify:growth-checks`：标记 / 掷骰 / 来源 / 编辑 / 撤销 / 筛选导出 / 结束确认 / 自动结算 PASS。
- 既有 `verify:growth-inheritance`、`verify:room-ready`、`verify-game-state`、`verify-game-history`、`verify-module-gallery`、`verify-combat`、`verify-combat-options`、`verify-room-setup`、`verify-card-library`、`verify-character-import`、`verify-join-room`、`verify-module-import`、`verify-module-revision`、`verify-scene-board` 全部 PASS。

### 备注
- 若需要用独立构建目录跑 E2E，可临时在 `apps/web/next.config.mjs` 加 `distDir: process.env.NEXT_DIST_DIR ?? ".next"`，避免与 3100 的 dev server 共用 `.next`；本轮验证后已还原，不进入提交。
- 成长点目前由 KP 标记 / 结算；后续如需玩家自助标记自己的技能，可在权限上扩展。


## 21. P2-1 增量、P2-2 管理后台与 DeepSeek 智能导入（本轮完成）

### 管理后台（P2-2 总入口）
- `User.role` 新增 `UserRole`（USER / ADMIN）；`isDisabled`、`lastLoginAt`。
- `bdmin` 由迁移 `20260912000000_admin_console_and_rulepacks` 与 `prisma/seed.ts` 提升为 ADMIN（已存在用户不覆盖密码）。
- 登录与 Socket 票据都会拒绝 `isDisabled` 用户。
- 管理员入口：右上角用户下拉菜单「管理后台」→ `/admin`。
- 页面：`/admin` 总览、`/admin/users`、`/admin/rooms`、`/admin/modules`、`/admin/games`、`/admin/rulepacks`、`/admin/system`、`/admin/audit`。
- 关键操作全部写入 `AdminAuditLog`：用户角色 / 禁用、房间状态 / 删除、团本发布 / 删除、规则包创建 / 版本 / 发布 / 绑房 / 导入 / 删除、系统设置。

### P2-2 规则包管理
- `RulePack` 增加 `isPublished / publishedAt / createdAt / updatedAt`；`RulePackVersion` 增加 `status / notes / createdBy / publishedAt`。
- `/admin/rulepacks`：从内置注册表同步（`coc7-baseline` / `touhou-ext`）、新建规则包（可从内置复制或粘贴 JSON）、绑定房间。
- 详情页：版本列表、发布 / 归档、JSON 导出、JSON 文件导入版本、删除规则包。
- 绑定房间时必须房间系统一致且版本为 PUBLISHED；`loadEffectivePack` 已支持 DB 版本优先于内置包，仍会叠加 `Room.ruleOverride`。
- `SystemSetting` 表用于平台配置，当前接入 AI 导入模型与文件数上限。
- E2E：`npm run verify:admin-console`（非管理员拦截 / 后台页面 / 内置同步 / 绑房 / 导出 / `loadEffectivePack` 编译回读）。
- 尚未做：规则包内容可视化编辑器（目前是 JSON 编辑 + 复制内置），完整的 RulePack 后台内容校验提示可以继续增强。

### DeepSeek 智能团本导入
- 入口：`/modules/mine` 与 `/rooms/[id]/modules` 的「DeepSeek 智能整合」页签。
- 路由：`POST /api/modules/ai-import`（登录可访问；房间导入仍要求本房 KP）。
- 服务端：`apps/web/src/server/ai/deepseek.ts`、`apps/web/src/server/ai/module-import.ts`。
- 支持任意数量文件（最多 40 个，单文件 25MB，总 150MB）：md / txt / json / yaml / csv / html / docx / pptx / xlsx / pdf（正文 + 内嵌图片）/ png / jpg / webp / gif / avif / bmp / tiff / heic。
- 图片会先压缩到 1400px JPEG 再发给 vision 模型，成功后保存为 `ModuleAsset`（`assets/images/*.png`），AI 输出会自动补图片索引。
- DeepSeek 输出严格 JSON，服务端组装为 14 章标准 Markdown + 结构化 `module-chapter / module-scene / module-npc / module-clue / module-item / module-ending / module-reward` YAML 块；校验失败会自动带错误重试，最多 3 次。
- API Key 只从环境变量 `DEEPSEEK_API_KEY` 读取（已配置在本机 `apps/web/.env`，该文件不提交）；`DEEPSEEK_BASE_URL` 默认 `https://api.deepseek.com`；默认模型 `deepseek-flash`（支持图片视觉，推荐），可在 `/admin/system` 修改。
- E2E：`npm run verify:ai-import`（无 key 时 SKIP；调用真实 DeepSeek，验证标准章节 / 结构化块 / 图片资源 / 独立 aiSessionId）；`npm run verify:ai-pdf-parse`（离线验证 PDF 正文与内嵌图片提取）。
- 尚未做：失败后断点重试；进度已通过后台任务轮询提供。

### P2-1 战术棋盘增量
- 几何库：`apps/web/src/shared/scene-geometry.ts`
  - 方格 / 六边形轴向坐标、中心吸附、覆盖格子、六边形多边形。
  - 2D 可见性多边形（向墙端点和边界投射射线）。
- 战争迷雾：`Map.fogRevealed` 存格子 key；SceneBoard 提供 KP 战雾工具（揭示 / 遮回 / 清空），拖动刷格子，Socket `scene:fog:paint` / `scene:fog:reset` 持久化并广播。
- 墙体：Socket `scene:wall:create` / `scene:wall:delete`，支持 WALL / DOOR / WINDOW / DIFFICULT_TERRAIN，SceneBoard 画墙与删除。
- 灯光：Socket `scene:light:create` / `scene:light:delete`，场景页与棋盘渲染光晕。
- 视线遮挡：有墙且玩家模式时按自己 Token 计算 visible polygon，墙后 Token 不渲染；KP 可勾选「预览玩家视线遮挡」。
- 地图图层：`MapLayer` 增加管理 UI（名称 / 类型 / Z 序 / 透明度 / 偏移 / 缩放 / 可见 / 锁定），`ImageUpload` 新增 `MAP_LAYER` 上传用途；SceneBoard 按 Z 序渲染多背景。
- 团本结构化绑定：场景页「同步团本场景与遭遇」读取当前局的 `ModuleRevision / Module` 结构化数据，自动创建 `ModuleChapter`、`Scene + Map`、`Encounter` 并绑定 sceneId / chapterId。
- E2E：`npm run verify:scene-increments`（六边形几何 / 墙体 / 灯光 / 战雾 / 图层 / 团本结构化自动绑定）。

### 本轮验证
- `npm run typecheck`：PASS。
- `npm test`：141 tests PASS。
- `npm run build --workspace @touhou/web`：PASS。
- E2E（全部 18 个）：既有 15 个全部 PASS + `verify:admin-console` / `verify:scene-increments` / `verify:ai-import` PASS。

### 环境变量补充
```bash
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-flash"
```


## 22. 隐藏信息规则、玩家互见与模组魔法（本轮完成）

### 信息可见性原则
- **玩家只看到有限公共信息**：
  - 准备页：非 KP 只看到自己的带入申请；队友的 `APPROVED` 角色才会按房间配置展示，`PENDING_REVIEW / REJECTED` 与他人的带入卡牌不对非 KP 展示。
  - 跑团页：成长记录、成长点、角色技能表按 `Room.characterVisibility` 过滤，`PRIVATE` 时只有自己可见；KP 永远可见全部。
  - 团本结构化场景 / 遭遇 / 正文不进入玩家页面；房间团本详情页对非 KP 隐藏资源（地图、图片、手书、附件），只保留公开元信息。
  - 手书资源不再直接下发给玩家；后续如需公开，应增加显式的“对玩家公开”位。
- **NPC / Boss 默认隐藏**：
  - `Card.isPublic` 默认 false；`RoomNpcPanel` 只给 KP 全量展示，玩家只看 `isPublic = true` 的卡。
  - KP 可在准备页点击「公开属性」。公开后玩家能看到名字、HP/MP/SAN/DP、九项属性与技能列表。
- **战斗视图**：
  - `CombatParticipant.isPublic` 随 NPC 卡写入战斗状态；`filterCombatForViewer` 对隐藏 NPC 返回 `???`、`hp/mp/san/dp = null`、`hpText = null`、`statusEffects = []`、`skills = null`，并把日志里的隐藏单位名字替换为 `???`，只保留伤害数值。
  - 公开 NPC 或 KP / 自己操控的单位展示完整数值。
  - `Room.characterVisibility`：
    - `PUBLIC`（默认）：玩家在战斗视图里能看到其他 PLAYER 的 HP / SAN 等精确数值；角色详情页允许查看队友已通过审核的角色。
    - `PRIVATE`：玩家之间不可查看彼此角色；战斗里队友数值同样置空。
    - KP 永远可见全部玩家属性；创建房间与 `RoomConfigPanel` 均可切换。
- 角色详情页权限已修复：不再依赖 `Character.roomId`，改为校验 `RoomCharacterEntry` + 房间配置 + owner/KP；非本人查看他人角色时隐藏“持有卡牌”。

### 模组魔法准备
- `RulePackSchema` 新增可选 `magic`：
  ```ts
  magic?: {
    enabled: boolean;
    system?: "COC7" | "TOUHOU";
    spells: { id, name, skill, description?, mpCost, sanCost, damage?, target }[]
  }
  ```
- 团本结构化格式新增 `module-magic` 块，`StructuredModuleData.magic` 参与解析。
- DeepSeek 导入提示词要求：素材涉及魔法 / 法术 / 咒文 / 仪式 / 超自然能力时，必须输出 `structured.magic`；没有则空数组。
- `apps/web/src/server/modules/magic.ts`：
  - 从模块结构化数据读取法术，校验公式/骰式，生成 `magic` 覆盖。
  - `applyMagicRulesToRoom`：`Room.magicEnabled = true` 时把法术写入 `Room.ruleOverride.magic`；模块没有魔法时自动关闭。
  - `disableMagicRulesInRoom`：停用时写 `magic.enabled = false`。
- 准备页 / `RoomConfigPanel`：
  - 检测到模组魔法时显示法术数量；KP 可「启用 / 停用魔法规则」。
  - `startRoomAction` 与恢复暂停局都会重新同步魔法规则，避免换模组后残留。
- 战斗施法：
  - `ActionKind` 新增 `MAGIC`，`CombatActionPayload.spellId` 前后端贯通。
  - `validateCombatAction` 校验规则启用、法术存在、目标合法。
  - 结算：消耗 MP / SAN，命中直接伤害（使用现有伤害管线与符卡吸收），写入 DAMAGE 日志；不进入反应窗口。
  - `CombatBoard` 新增法术选择与「施法」按钮。
- E2E：`npm run verify:visibility-magic` 覆盖 NPC 隐藏/公开、房间角色互见、魔法规则启用、`loadEffectivePack` 回读与 MAGIC 行动校验。

### 验证更新
- `npm run typecheck`：PASS。
- `npm test`：144 tests PASS（formula 48 / rules 61 / combat 35）。
- `npm run build --workspace @touhou/web`：PASS。
- E2E 共 19 个脚本，本轮回归全部 PASS：
  - 既有 15 个 + `verify:admin-console` / `verify:scene-increments` / `verify:ai-import` / `verify:visibility-magic`。

## 23. 局内状态结构化选择器（本轮完成）

### 第 13 节遗留项
- 将 `GameState.currentChapterId / currentSceneId / currentEncounterId` 从自由文本升级为基于 `ModuleChapter / Scene / Encounter` 的结构化选择器。

### 服务端
- 跑团页查询当前局的实际实体：
  - `ModuleChapter`（按 moduleId，orderIndex）
  - `Scene`（按 roomId，orderIndex）
  - `Encounter`（按 roomId，orderIndex）
- 若团本尚未执行“同步团本场景与遭遇”，回退使用 `ModuleRevision` 里的结构化 `module-chapter / module-scene / module-encounter` 条目 id。
- `updateGameStateAction` 新增 `activateScene`：
  - 勾选后，若 `currentSceneId` 对应本房真实 `Scene`，则在保存局内状态的同时切换 `Scene.isActive`，并通过 `scene:updated` Socket 广播给在线玩家；
  - 战术棋盘会立即切换到该场景。

### 前端
- `RoomGameStatePanel` 新增 `moduleChapters`：
  - 章节 / 场景 / 遭遇优先渲染为下拉选择器（显示标题而非裸 id），并兼容旧值。
  - 场景选择器下新增“保存时将当前场景切换为激活场景（影响战术棋盘）”复选框。
  - 玩家视图不再显示章节 / 遭遇 id，只显示当前场景名与团内时间；章节 / 遭遇若已设置则显示“KP 掌握”。
- `RoomGameStatePanel` 的场景选择也承担“切换棋盘场景”的入口，避免 KP 在场景页 / 跑团页来回切换。

### 验证
- `verify:scene-increments` 扩展覆盖：
  - `ModuleChapter / Scene / Encounter` 结构化选项写入 `GameState` 的真实数据库 id；
  - `activateScene` 切换后目标场景 `isActive = true`，旧场景取消激活。
- 回归：`verify:game-state`、`verify:room-ready`、`verify:visibility-magic`、`npm run typecheck`、`npm test`（144 tests）全部 PASS。

## 24. 构建缓存隔离（本轮修复）

### 问题
- production `next build` 与 `npm run dev` 共用 `apps/web/.next` 时，会出现
  `Cannot find module './vendor-chunks/@auth.js'` / `missing required error components`。
- 原因是 dev 的 chunk manifest 与生产构建产物混在同一目录。

### 方案
- `apps/web/next.config.mjs`：
  ```js
  distDir: process.env.NEXT_DIST_DIR ?? ".next"
  ```
- `apps/web/package.json` 的 `dev` 固定使用独立目录：
  ```json
  "dev": "cross-env NEXT_DIST_DIR=.next-dev tsx watch server.ts"
  ```
- 目录约定：
  - `npm run dev` → `.next-dev`
  - `npm run build` / `npm start` → `.next`
  - E2E 独立构建可显式传 `NEXT_DIST_DIR=.next-e2e`
- `.gitignore` 增加 `.next-dev/`、`.next-e2e/`；`tsconfig.json` include 同步加入两个目录的 `types`。

### 验证
- 清理 `.next / .next-dev` 后重启 `npm run dev`，`/login` 200，模块列表 / 详情页正常编译。
- 跑 `verify:module-import`、`verify:module-gallery` PASS，日志无 `vendor-chunks` / `Cannot find module`。
- dev 运行中执行 `npm run build` 成功（写 `.next`），不再互相污染。


## 25. 团本只读模板与房间物化（本轮完成）

### 数据模型
- 只读模板表：
  - `ChapterTemplate` / `SceneTemplate` / `NpcTemplate`
  - `ItemTemplate`（`ItemTemplateType`: WEAPON / ITEM / TOME / ARTIFACT / EVIDENCE）
  - `ClueTemplate` / `EncounterTemplate` / `MagicTemplate`
- 房间实例：
  - `RoomChapter`（房间级章节，避免模块章节被多房间共享）
  - `Encounter.roomChapterId` 指向房间章节；旧 `chapterId` 兼容保留。
  - `CardType` 新增 `CLUE`：关键证物卡。
- 应用批次：
  - `RoomPresetApplication`：一次「应用团本预设」的 ACTIVE / REPLACED 记录。
  - `RoomPresetInstance`：模板 id → 房间实体 id 映射，用于幂等与整批清理。

### 解析规则
- `module-chapter` → `ChapterTemplate`
- `module-npc` → `NpcTemplate`（属性 / 技能 / HP / MP / SAN / DP / tier / 图片）
- `module-item` → `ItemTemplate`（WEAPON / ITEM / TOME / ARTIFACT / EVIDENCE）
- `module-clue` → `ClueTemplate`（可关联 `linkedItemId`，默认隐藏）
- `module-scene` → `SceneTemplate`（地图尺寸 / 网格 / 背景 / 图层 / Token 初始位）
- `module-encounter` → `EncounterTemplate`（chapter/scene/npc/item 引用）
- `module-magic` → `MagicTemplate`
- 标准 zip 的 `characters/npcs.yaml` → 合并解析为 `NpcTemplate`
- 未知技能名会按有效 RulePack 的技能 id / 中文名映射；映射失败写入 importReport 警告。

### 物化流程
- 入口：准备页「应用团本预设到房间」按钮，服务端 `applyModulePresetToRoom`。
- 事务内：
  1. 旧 ACTIVE 批次标记 REPLACED，并按 `RoomPresetInstance` 整批删除旧房间实体；
  2. 逐类克隆模板到 `RoomChapter / Scene + Map + MapLayer / Card / Clue / Encounter`；
  3. `EncounterTemplate` 的 chapter/scene/npc/item 引用重写为房间实体 id；
  4. 证物卡与 `Clue` 关联；
  5. 有 `MagicTemplate` 时自动合并 `Room.ruleOverride.magic` 并启用；没有则关闭。
- 约束：当前局未结束时禁止应用 / 换预设，必须先结束本局。
- 换预设只替换上一次预设生成的对象；玩家手动创建的对象不受影响。
- 图片 / 音频沿用同一 `Asset`，不做文件复制。
- 老模块没有模板数据时，首次应用会从 `Module.content.structured` 懒解析生成模板。

### 导入入口
- AI 导入：`importModuleWithDeepSeek` 完成后调用 `syncModuleTemplatesFromModule`。
- 标准 `.md/.zip` 导入：`/api/modules/import` 完成后同步模板，`characters/npcs.yaml` 自动合并。
- 团本保存：`saveModuleAction` 重新结构化解析模板。
- 验证脚本：`npm run verify:module-preset`（NPC / 武器 / 证物 / 场景地图 / 线索 / 遭遇 / 魔法；换预设整批替换）。
- 开局闸门新增：如果房间已选择团本，必须先应用该团本预设且当前 ACTIVE 应用与所选团本一致，才允许开始 / 继续本局。
- 删除保护：已存在 ACTIVE `RoomPresetApplication` 的团本不可删除（房间端与管理后台都会拒绝），避免房间实例变成孤儿。

## 26. DeepSeek 智能导入异步化（本轮修复）

### 问题
- 通过 frpc / 公网 HTTPS 访问时，AI 导入请求会在约 36 秒被代理切断（实测 HTTP 000）。
- DeepSeek 整理长素材时经常需要 1-3 分钟，同步请求必然失败，前端只能提示“网络中断”。

### 方案
- 新增 `apps/web/src/server/ai/jobs.ts`：
  - 内存任务表（1 小时 TTL，最多 200 条），保存 `RUNNING / DONE / FAILED`、进度行与结果。
  - `startAiImportJob` 立即返回 jobId，后台继续调用 `importModuleWithDeepSeek`。
- `importModuleWithDeepSeek` / `generateDraft` 新增可选 `onProgress` 回调，上报：
  - 素材解析数量、DeepSeek 第 N/3 次调用、结构校验、写入团本、图片保存、模板同步。
- `POST /api/modules/ai-import` 只做鉴权 / 校验 / 启动任务，返回 202 `{ ok, jobId, status }`。
- `GET /api/modules/ai-import?jobId=...` 返回任务状态、进度与结果；任务按 userId 隔离。
- `AiModuleImporter` 改为每 2.5 秒轮询，实时显示进度，完成后自动跳转团本详情。

### 验证
- `npm run typecheck` PASS；`npm run build --workspace @touhou/web` PASS。
- 实测：通过公网 `https://103.91.208.133:64120` 发起导入：
  - POST 立即返回 202 + jobId；
  - 轮询状态依次经过“解析素材 → DeepSeek 第 1/3 次 → … → 团本生成完成”；
  - 约 100 秒后拿到 `DONE` 与 moduleId，模块与只读模板均正确落库。
- 直连 localhost 同步服务调用（`verify:ai-import` 与脚本直调）仍正常，不受影响。

## 27. DeepSeek 长 JSON 输出截断修复

### 问题
- 导入较大素材时 DeepSeek 返回的 JSON 在约 12703 字符处被截断，报：
  `Expected ',' or '}' after property value in JSON at position 12703`。
- 根因：`max_tokens` 原为 8192。8192 是 token 而不是汉字数；14 章正文 + structured 里的
  chapters / scenes / encounters / npcs / items / clues / endings / rewards / magic 很容易超过该上限，
  输出在 JSON 中途被 `finish_reason=length` 掐断。

### 方案
- `apps/web/src/server/ai/deepseek.ts`：
  - 新增 `DeepSeekTruncationError`，`finish_reason === "length"` 时明确抛出，不再伪装成 JSON 校验失败。
- `apps/web/src/server/ai/module-import.ts`：
  - `MAX_OUTPUT_TOKENS` 从 8192 提高到 32768（实测模型可稳定输出 14227 个中文字符 / 11825 completion tokens）。
  - 捕获截断错误后重试，重试提示明确要求压缩到约 8000 中文字符并保证 JSON 完整闭合。
  - 首次提示词目标从约 12000 字降到约 9000 字，优先保留 14 个章节和全部 structured 字段。
  - 3 次仍失败时给出可操作提示：减少单次素材量或拆分文件。

### 验证
- 模型长输出实测：`finish_reason=stop`，content 14227 字符，`completion_tokens=11825`（含 reasoning 1655）。
- `npm run verify:ai-import`：PASS，且 `attempts=1`（修复前经常 2-3 次）。
- 公网异步导入（同一素材）：POST 202 → 轮询进度 → DONE，module 正确落库，无截断。
- `npm run typecheck` PASS；生产构建与部署已更新。

## 28. 实时同步与 ATB 多轮卡死修复（本轮）

### Bug 1：KP 操作不同步到 PL
- 现象：KP 审核带入、准备、应用预设、改房间配置、发线索 / 笔记、创建 / 公开 NPC、发起战斗等操作，PL 端不会自动更新，需要手动刷新。
- 根因：这些 server action 只调了 `revalidatePath`，没有向 Socket 房间广播；而准备页也没有任何 Socket 客户端，KP↔PL 的刷新信号无人接收。
- 修复：
  - `server/realtime.ts` 新增 `emitRoomRefresh(roomId, reason)`，统一广播 `room:refresh`。
  - `RoomPlay` 增加 `room:refresh` 监听；新增准备页探针组件 `RoomRealtimeRefresh`，订阅 `room:refresh / room:update / room:state:update / room:advancement:update / combat:started / combat:ended / scene:updated` 并 `router.refresh()`。
  - 为以下动作补发 `emitRoomRefresh`：
    - 准备 / 当前角色 / 可见性 / 魔法规则 / 团本选择（`actions/room.ts`）
    - 角色 / 卡牌带入申请与审核（`actions/room-entry.ts`）
    - NPC 创建与公开（`actions/npc.ts`）
    - 线索 / 笔记（`actions/room-info.ts`）
    - 应用团本预设（`actions/preset.ts`）
    - 战斗申请提交 / 驳回（`actions/combat.ts`）
    - 删除房间 NPC 卡（`actions/card.ts`）
- 结果：KP 与 PL 在准备页 / 跑团页 / 战斗页的相互操作都会触发对方刷新；开局、战斗开始等已存在的 `room:update / combat:started` 广播也统一被准备页接收。

### Bug 2：战斗只打一轮就卡死
- 现象：ATB 房间发起战斗、第一轮攻击后进入 `ATB_CHARGING`，双方永远不再就绪。
- 根因：COC7 内置包的 `atb.actionCost` 缺少 `DANMAKU / SPELLCARD`：
  - COC7 攻击实际结算为 0 ATB 消耗；
  - ATB 溢出值（本次 107 > max 100）在 `isReady=false` 后成为「未就绪但已满槽」；
  - `schedule` 对其返回 `ticks <= 0` 且空就绪，`advanceToNextEvent` 直接 return，状态永久停在 CHARGING。
- 修复：
  - `coc7-baseline` 补齐 `DANMAKU: "40"`、`SPELLCARD: "60"`。
  - `packages/combat/src/combat.ts` 的 `advanceToNextEvent` 增加防御：当 `ticks <= 0` 且无人就绪时至少推进 1 tick，避免自定义 / 旧规则包再触发同类死锁。
  - 新增 2 个回归 unit test（零消耗溢出、COC7 行动消耗）。
- 结果：ATB 攻击可连续推进到第 4 轮；顺序制可连续推进到第 3 轮。

### 新增 E2E
- `npm run verify:realtime-sync`：
  - KP 建房（真实 `/rooms/new` action + 预选现有团本）
  - PL 带入角色 → KP 审核（PL socket 收到 refresh）
  - PL 准备 → KP 收到 refresh
  - KP 应用团本预设 → PL 收到 refresh
  - KP 准备 / 开局 → PL 收到 refresh / room:update PLAYING
  - KP 发起战斗 → PL 收到 combat:started
- `npm run verify:combat-rounds`：
  - ATB：攻击 + 应对，连续推进 ≥ 4 轮；
  - 顺序制：攻击 + 应对，连续推进 ≥ 3 轮；
  - 双方 socket 都收到 `combat:update`。
- 使用现成团本《鬼屋》、`bdmin`（KP）与 `player`（玩家）实际跑通上述流程；`player` 账号已创建（密码见交付说明），`bdmin` 原密码未改动。

### 验证
- `npm run typecheck` PASS。
- `npm test` PASS（146 tests：formula 48 / rules 61 / combat 37）。
- 生产构建与本地 3100 部署已更新。

## 29. 线索定向分享与房间预设内容编辑（本轮）

### 问题
- 广场团本通过 `Room.selectedModuleId` 关联房间后，`/rooms/[id]/modules/[moduleId]` 因为只允许 `Module.roomId === roomId` 而 404，KP 打不开团本页面。
- 房间团本页只能改 Markdown 正文，预设物化出来的 NPC 卡、物品 / 证物 / 线索卡、线索、场景没有编辑入口。
- 线索只能新建时勾选公开，已有线索（尤其是预设生成的隐藏线索）无法再公布；也没有定向分享给某玩家的能力。

### 数据层
- 新增 `ClueShare`（`clueId + userId` 复合主键，`sharedBy / sharedAt`），迁移 `20260915000000_clue_shares`。
- 玩家线索可见性：`isPublic` 或 被 `ClueShare` 定向分享 或 自己标记过 `ClueDiscovery`；KP 永远可见全部。

### 服务端
- `actions/room-info.ts`：
  - `updateClueAction`：编辑标题 / 正文 / 公开状态。
  - `setClueVisibilityAction`：一键公布 / 取消公开。
  - `deleteClueAction`：删除线索。
  - `shareClueAction`：把线索定向发给指定成员；整体替换分享名单，空名单表示撤回。
- `actions/npc.ts`：
  - `updateNpcAction`：编辑 NPC 名称、Tier、稀有度、种族、九项属性、HP/MP/SAN/DP、技能与标签。
- `actions/card.ts`：
  - `updateRoomCardAction`：编辑房间预设物化出的物品 / 证物 / 线索卡，名称、描述、稀有度、数量与 stats JSON。
- 所有动作都会 `emitRoomRefresh`，在线成员自动刷新。

### UI
- `RoomInfoPanel`：KP 的每条线索下增加「公布给所有人 / 取消公开」「编辑线索」「发给特定玩家（成员多选）」「删除线索」；玩家侧对定向线索显示「发给我」。
- `RoomNpcPanel`：KP 的每张 NPC 卡增加「编辑 NPC / Boss」表单。
- 房间团本页 `/rooms/[id]/modules/[moduleId]`：
  - 权限修复：允许 `Module.roomId === roomId`、房间 `selectedModuleId`、作者本人或已发布团本访问。
  - 新增 `RoomPresetContentPanel`（KP 可见）：集中编辑当前 ACTIVE 预设的 NPC、线索、物品 / 证物卡；场景给出「编辑场景 / 地图 / 图层 / Token」跳转。
- `ClueAdminControls` / `NpcEditForm` / `RoomCardEditForm` 为可复用服务端组件。

### 验证
- 新增 `npm run verify:clue-npc-edit`：
  - 团本页出现预设内容编辑面板；
  - 线索定向分享后，PL 跑团页能看到「发给我」；
  - KP 公布线索后 PL 可见；
  - 编辑线索 / NPC / 物品卡全部落库；
  - 场景页编辑表单存在。
- 回归：`verify:realtime-sync`、`verify:combat-rounds`、`verify-module-gallery`、`verify-room-ready`、`verify-scene-increments` 全部 PASS。
- `npm run typecheck` PASS；`npm test` PASS（146 tests）。
- 生产构建与 3100 部署已更新。

## 30. 团本结构化编辑、素材上传、Token 取图与线索正文修复（本轮）

### 关键数据修复：线索 / NPC / 物品内容全部读空
- 现象：AI / 标准导入的团本，同步出的 `ClueTemplate.content`、NPC 属性、物品 stats 全为空，只剩标题。
- 根因：`Module.content.structured` 保存的是带 `data` 包装的 entry（`{ id, kind, title, data: {...} }`），
  而 `structuredOfContent` 又把它当原始数据包了一层，字段变成 `entry.data.data.content`。
- 修复：`normalizeArray` 识别 `data` 包装并解包；已对现有模块执行一次模板重同步（鬼屋 15 条线索正文全部恢复）。
- `ensureModuleTemplates` 改为每次应用预设前都重新 sync 一次，旧房间重新应用预设即可拿到修复后的内容。
- DeepSeek 提示词补充：clues 的 content 正文为必填，禁止只输出标题。

### 我的团本页结构化编辑
- `/modules/[moduleId]` 新增 `ModuleEntityEditors`：
  - NPC / 角色：名称、副标题、种族、Tier、稀有度、标签、九项属性、HP/MP/SAN/DP、技能、描述、立绘 / Token 图。
  - 物品 / 武器 / 证物：名称、类型、稀有度、数量、描述、伤害、射程、技能、命中修正、图片、效果。
  - 线索 / 手书：标题、正文、图片、默认公开、关联证物 id。
  - 场景：名称、描述、旁白、宽高、网格、背景色、网格 / 迷雾开关、地图背景。
  - 每个实体支持新增 / 编辑 / 删除；保存后同步写入 Markdown `module-*` 结构化块，并刷新只读模板。
- 新增 `structured-edit.ts`：负责解包后的 structured 增删改、序列化回 YAML、重写 Markdown 结构化段。
- 新增 `actions/module-entity.ts`：`saveModuleEntityAction` / `deleteModuleEntityAction`。

### 素材上传
- `POST /api/modules/[moduleId]/assets` 支持两种模式：
  - 传 `moduleAssetId`：替换已有资源（原行为）。
  - 不传：新建 ModuleAsset，按 `kind` 自动落到 `assets/images|maps|handouts|audio|video|files/<module>/`。
- 新增 `ModuleAssetUpload` 客户端组件：在任意实体表单里上传图片 / 文件，自动回填相对路径。
- 权限：团本作者，或本房 KP。

### Token 图片自动取角色卡
- `Token` 新增 `cardId`（迁移 `20260916000000_token_source_card`）：
  - PC Token → 依次取 `Character.token / portrait / avatar`。
  - NPC Token → 取来源 `Card.imageUrl`。
  - 旧的手动上传 asset 仍兼容；都没有则前端显示角色名首字 / 默认占位。
- `createSceneTokenAction` 为 NPC Token 写入 `cardId`。
- 场景页移除「上传 Token 图」，改为显示自动来源与默认占位提示；NPC / 角色立绘在团本编辑器的角色卡里上传。

### E2E
- 新增 `npm run verify:module-entities`：结构化新增 / 编辑线索（正文）、物品、场景、NPC；素材上传；ClueTemplate 同步；Token 自动取来源卡图 / 无图返回 null；场景页无 Token 上传入口。
- 回归：`verify-module-import`、`verify-module-gallery`、`verify-module-preset`、`verify-module-revision`、`verify-clue-npc-edit`、`verify-scene-increments`、`verify-scene-board`、`verify-room-ready`、`verify-realtime-sync`、`verify-ai-import` 全部 PASS。
- `npm run typecheck` PASS；`npm test` PASS（146 tests）；生产构建与 3100 部署已更新。

### 使用提示
- 已存在的房间如果线索正文为空，让 KP 在准备页重新「应用团本预设」即可刷新；新开的房间会自动带上修复后的内容。

## 31. 场景在准备阶段可用、墙灯清除与 Token 放置修复（本轮）

### 问题
- 场景布置本来应该发生在开局前，但准备页完全没有 SceneBoard：
  - 无法切换场景（只能去场景管理页）。
  - 墙体 / 灯光只能开局后在跑团页画，准备阶段看不到棋盘。
  - KP 无法在棋盘上直接放置玩家 / NPC Token。
  - 只能逐个点删除墙 / 灯，没有清空入口。
  - PC Token 创建要求已有进行中的 Game，在 LOBBY 永远失败。

### 修复
- 准备页接入 `SceneBoard`：
  - KP 可切换场景、放置 PC / NPC Token、画墙 / 灯光、操作战雾。
  - 玩家可提前看到棋盘并拖动自己的 Token。
- Socket 场景编辑放开到 `LOBBY / PAUSED`；Token 移动不再拒绝这两个阶段。
- `createSceneTokenAction` 的 PC 分支不再强制要求进行中的 Game：
  - 有 GameCharacter 时用局内角色；
  - LOBBY 阶段可用已通过审核的 `RoomCharacterEntry` 创建/复用角色 Token。
- `SceneBoard` 新增：
  - KP 场景切换下拉（服务端 action，成功后回原页面）。
  - KP「放置玩家 / NPC Token」下拉（PC + 本房 NPC 卡）。
  - 删除模式下「清空墙体 / 清空灯光」按钮。
  - `activateSceneAction` / `createSceneTokenAction` 支持 `returnTo`，从准备页操作后不会跳去场景页。
- 新增 Socket 事件 `scene:wall:clear` / `scene:light:clear`：KP 一键清空当前地图墙体 / 灯光，并广播 `scene:map:updated`。
- 场景背景图：`/api/upload` + `attachAssetAction` 路径已回归验证；跑团页 / 准备页都会渲染 `map.backgroundUrl`。

### E2E
- 新增 `npm run verify:scene-ops`：
  - LOBBY 下创建 / 切换场景；
  - 上传地图背景并验证 URL 可访问、`loadSceneView` 带 `backgroundUrl`；
  - Socket 创建墙体 / 灯光后 `scene:wall:clear`、`scene:light:clear` 清空；
  - 场景页放置 PC 与 NPC Token；
  - 准备页出现「战术棋盘 / 切换场景 / 放置玩家 / NPC Token」；
  - 切到 PLAYING 后跑团页仍能渲染场景与 Token。
- 回归：`verify-room-ready`、`verify-scene-board`、`verify-scene-increments`、`verify-realtime-sync`、`verify-module-preset`、`verify-clue-npc-edit`、`verify-module-entities` 全部 PASS。
- `npm run typecheck` PASS；`npm test` PASS（146 tests）；生产构建与 3100 部署已更新。

## 32. CoC7 车卡规则修复：本职判定、上限 80/70、母语基础值（本轮）

### Bug 1：所有技能都显示「本职」
- 根因：`isOccupationSkill` 的模糊匹配里：
  - `FREE_TOKENS.some((free) => token.includes(free))` 只要职业有「任意 / 自选」，就对**任意技能**返回 true；
  - `name.includes(token) || token.includes(name)` 进一步造成性别字面量误匹配。
- 修复：`shared/occupation.ts` 重写为明确的技能访问分类：
  - `FIXED`：职业 token 精确匹配某个具体技能（含「射击（手枪/步枪）」这类拆分）。
  - `CATEGORY`：职业 token 是「格斗 / 射击 / 科学 / 技艺 / 外语 / 语言 / 驾驶」等分类，只匹配该分类下技能，且默认每组只能选 1 项。
  - `SOCIAL`：职业写「一项 / 两项社交技能」时，从魅惑 / 取笑 / 话术 / 恐吓 / 说服中选择，数量受限。
  - `FREE`：「任意 / 自选」技能位，可选任何技能，但必须按职业文本解析出的数量（例如「任意两项」= 2）占用，不再显示为「本职」。
- UI 只对 FIXED / CATEGORY / SOCIAL 标「本职」；FREE 标「可选」。

### Bug 2 / 3：本职上限 80、兴趣上限 70，母语等基础值不应报错
- 根因：旧逻辑只有一个 `skillPoints.maxAtCreation`（默认 70），并且直接判断 `base + occ + interest > maxAtCreation`。
  - 母语基础值 = EDU，EDU 高时基础值本身 > 70，即使不加点也会被判定超限；
  - 本职点与兴趣点混用同一个 70 上限，不符合「本职 80 / 兴趣 70」。
- 修复：
  - `RulePackSchema.skillPoints` 新增 `occupationMax`（默认 80）与 `interestMax`（默认 70）；旧 `maxAtCreation` 保留兼容。
  - 新增纯函数 `skillCreationCap / isSkillCreationWithinCap`：
    - 使用职业点的技能：上限 = `max(occupationMax, base)`；
    - 只用兴趣点的技能：上限 = `max(interestMax, base)`；
    - 基础值天然超过上限时（高 EDU 的母语），保留基础值，但不能再加点。
  - 客户端 `CharacterBuilder` 与服务端 `saveCharacter` 共用同一函数；技能面板显示「本职上限 80 · 兴趣上限 70」。
  - 服务端同步校验自由 / 社交 / 分类选择的数量上限，防止绕过 UI。

### E2E
- 新增 `npm run verify:chargen-rules`：
  - 建筑师：法律 / 母语为本职，科学属于科学分类，潜行不是本职；
  - 魔术师：精神分析为本职，恐吓为社交选择（限 1），潜行属于任意可选（限 2）且不标本职；
  - 本职点 70+10=80 允许、70+11=81 拒绝；兴趣 50+20=70 允许、50+21 拒绝；
  - 基础 85 的母语不报错，但不能再加兴趣点；
  - 规则包默认本职上限 80、兴趣上限 70。
- 回归：`verify-character-import`、`verify-admin-console`、`verify-room-ready` PASS。
- `npm run typecheck` PASS；`npm test` PASS（146 tests）；生产构建与 3100 部署已更新。

## 33. 通用法术系统：效果指令、目标选择与应对窗口（本轮）

### 设计目标
- 法术不再只是一条 `damage`，而是规则包可自由组合的「效果指令集」。
- 目标支持自己 / 友方 / 敌方 / 任意、单体 / 全体。
- 敌对单体法术与物理攻击一样进入应对窗口；行动方能看到「等待对方应对」。
- 支持 DOT、眩晕、控制、增益 / 减益、治疗、吸蓝、SAN 增减、净化等可扩展效果。
- 旧规则包只写 `damage` 时保持兼容。

### RulePack 数据结构
```ts
MagicSpellSchema = {
  id, name, skill, description?,
  mpCost, sanCost,
  target: "SELF" | "ONE" | "ALL",
  targeting?: "SELF" | "ALLY" | "ENEMY" | "ANY", // 不填按 effects 自动推断
  damage?: string,                               // 旧字段，等价于一条 DAMAGE
  effects: MagicEffect[]
}
MagicEffect =
  | { type:"DAMAGE"; amount }
  | { type:"HEAL"; amount }
  | { type:"MP_RESTORE"; amount }
  | { type:"MP_DRAIN"; amount }
  | { type:"SAN_LOSS"; amount }
  | { type:"SAN_RESTORE"; amount }
  | { type:"STATUS"; key; stacks? }
  | { type:"DOT"; amount; durationTicks?; key? }
  | { type:"STUN"; durationActions? }
  | { type:"CONTROL"; durationActions? }
  | { type:"CLEANSE"; keys? }
```
- `spellTargeting()` 自动推断：有攻击性效果 → `ENEMY`；有支援效果 → `ALLY`；混合 → `ANY`；target=SELF → `SELF`。
- `spellEffectsOf()` 负责旧 `damage` 到 DAMAGE 指令的兼容转换。
- `isHostileSpell()` 供应对窗口判断。

### 战斗引擎语义（packages/combat）
- 单体 / 全体目标按 `targeting` 与 actor 阵营解析；SELF 自动作用自己。
- 结算顺序按 `effects` 数组顺序执行；每个效果独立写战斗日志。
- 伤害类效果复用现成伤害管线（含防御 / 闪避 / 符卡吸收）。
- `DOT` 以「目标回合数」计时（dotTurns），目标每次进入行动时结算一次固定伤害，不随全局 tick 提前过期。
- `STUN` / `CONTROL` 写入 participant 的跳过行动次数；`applyForcedSkips` 在其进入行动位时自动提交 PASS。
- `CLEANSE` 可清除 DOT / STUN / CONTROL 或指定 status key。
- 旧快照缺少新字段时使用默认值，不影响恢复。

### 应对窗口
- `needsReaction` 扩展：单体攻击性法术（DAMAGE / DOT / STUN / CONTROL / MP_DRAIN / SAN_LOSS）会进入应对流程。
- 法术应对选项为 `PASS / DODGE`；DODGE 成功则免疫该次敌对效果。
- `CombatView.pendingReactions` 暴露当前等待中的 `{ actorId, targetId }`。
- CombatBoard：
  - 行动方看到「XX 已对 YY 行动，等待对方应对…」，KP 可强制结算。
  - 被指定方继续收到应对面板。
- 旧物理攻击流程不变，且同样受益于统一的等待提示。

### UI 目标选择
- SELF 法术不需要选目标，自动对自己施放。
- ONE + ALLY / ANY 的目标下拉包含自己，解决了「不能选自己」。
- ENEMY 目标排除自己；ALL 法术不需要选目标，按阵营全体结算。
- 法术下拉会展示效果摘要（伤害 / DOT / 眩晕等）。
- 参战单位列表显示 DOT / 眩晕 / 控制等状态层数。

### 模组 / AI 导入
- `server/modules/magic.ts` 支持解析 structured.magic 里的 `targeting` 与 `effects`，无效指令会被过滤。
- DeepSeek JSON 提示词已加入 effects 指令集与示例，要求伤害写 DAMAGE/DOT、控制写 STUN/CONTROL。

### 测试
- `packages/rules` 新增 `magic.test.ts`：旧 damage 兼容、组合指令、目标推断、敌对判定。
- `packages/combat` 新增 3 个用例：SELF 治疗自动作用自己、DOT 在目标回合触发、STUN 强制跳过行动。
- 新增 `npm run verify:magic-effects`：
  - SELF 法术可施放且作用自己；
  - ONE+ALLY 法术选择自己被允许；
  - 敌对法术触发 reaction-request，actor 侧看到 pendingReactions 等待提示；
  - DAMAGE + DOT + STUN 组合生效。
- `npm test`：153 tests PASS（formula 48 / rules 65 / combat 40）。
- 回归：`verify-visibility-magic`、`verify-combat`、`verify-combat-options`、`verify-chargen-rules` PASS。
- 生产构建与 3100 部署已更新。

## 34. AI 导入会话隔离、PDF / 图片解析与 Token 唯一放置（本轮修复）

### 问题
- 用户导入现代意大利 PDF 团本时，输出成了 1924 年美国本。
- 数据库排查发现该次导入的 `importReport.sourceCount = 0`，警告为：
  - `PDF（当前仅保留文件元数据，未能抽取文字）没有提取到可用文字，已跳过内容整合`
- 也就是说 AI 实际只收到 0 个文本素材 + 1 张地图图片，意大利正文完全没有进入 prompt；模型在缺少素材时按 CoC 经典时代自由发挥。
- 旧实现失败重试时会把上一轮 assistant 输出放进消息链，存在同一次导入内“继续上下文”的风险。
- 棋盘放置 Token 旧实现没有检查重复，同一角色 / NPC 卡可以重复放到同一场景。

### 修复内容

#### AI 导入会话隔离
- 每次 `importModuleWithDeepSeek` 创建独立 `sessionId`；写入 Module 的 `metadata.aiSessionId`，并通过 `/api/modules/ai-import` 完成响应返回。
- `generateDraft` 每次只发送 `system + user`；失败重试也**不再带 assistant 历史**，而是把上次输出当作“错误样本”放进新的 user 消息。
- system prompt 与素材 prompt 均明确声明“全新独立导入，不引用历史对话 / 上次设定”，并以用户选择的 system / era 为硬约束。
- 前端拿到 `jobId` 后立刻 `form.reset()`，避免下一次导入误带旧文件、旧年代或旧额外要求。

#### PDF / 图片解析
- 新增依赖 `unpdf@1.8.1`。
- `readPdf`：
  - `extractText(..., { mergePages: true })` 抽取数字版 PDF 正文。
  - 逐页 `extractImages` 抽取 >=160px 的内嵌图片，转 PNG 后再压缩给 vision 模型。
  - 扫描版 PDF（无文字层）会自动退化为“内嵌图片 + vision 模型”路线。
  - PDF 既没有文字也没有可用图片时，给出明确警告，不再静默生成一个无关团本。
- `prepareSources` 现在同时支持数字版 PDF 正文与内嵌图片；单文件仍限制 24000 字、总量 120000 字，图片总量最多 12 张。
- 图片格式兜底：新增 HEIC / HEIF / AVIF / BMP / TIFF / SVG 的 magic / sharp 识别；无法直接给 vision 的格式会先转 JPEG；无法转换的格式提示并跳过。
- 若用户上传了图片但选了非 vision 模型（`deepseek-v4-pro`），自动切换到 `deepseek-flash` 并写 warning。
- `/modules/mine` 与房间团本导入页的提示文案已改为“pdf（自动抽取正文与内嵌图片）”。

#### Token 唯一放置
- `createSceneTokenAction` 创建前检查同一 `mapId` 下是否已有同 `characterId` / 同 `cardId` 的 Token；重复请求会带着 `error=token-exists` 返回。
- `SceneBoard` 的“放置玩家 / NPC Token”下拉只列出当前场景尚未放置的单位。
- Prisma `Token` 增加：
  - `@@unique([mapId, characterId])`
  - `@@unique([mapId, cardId])`
- 迁移 `20260917000000_scene_token_unique_placement` 会先清理历史重复 Token（同一 map 保留最早一条），再创建唯一索引。
- 唯一范围是“每个场景 map”；同一角色在不同场景仍然可以各有一个 Token，这是战术棋盘多场景的正常用法。

### 验证
- `npm run typecheck` PASS。
- `npm test` PASS（153 tests：formula 48 / rules 65 / combat 40）。
- `npm run build --workspace @touhou/web` PASS。
- `npm run verify:ai-pdf-parse` PASS：离线构造带正文和内嵌图片的 PDF，验证两者都能提取，不需要 API Key。
- `npm run verify:ai-import` PASS：真实 DeepSeek，验证标准章节 / 结构化块 / 图片资源 / 独立 `aiSessionId`。
- `npm run verify:scene-ops` PASS：生产构建 3101 实测，重复放置 PC Token 被拒绝。

### 环境 / 迁移注意
- `unpdf@1.8.1` 声明 Node >= 22；当前开发机使用 Node 24，部署环境需要同步。
- 新环境需要执行 `npx prisma migrate deploy`，让 Token 唯一约束和重复数据清理生效。
- `apps/web/scripts/verify-ai-pdf-parse.ts` 已注册为 `npm run verify:ai-pdf-parse`。
