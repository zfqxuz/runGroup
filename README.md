# 东方 TRPG 线上跑团平台

一个 **COC7 兼容 + 东方 Project 扩展** 的线上跑团平台。规则数值由 `RulePack` 配置驱动，
战斗可快照、可回放；支持 COC7 标准战斗与东方「千幻抄 DP」双模式。

- 规格文档：[`docs/SPEC.md`](docs/SPEC.md)
- 东方双模式设计：[`docs/TOUHOU-DUAL-MODE-DESIGN.md`](docs/TOUHOU-DUAL-MODE-DESIGN.md)
- dsh 助手技能化设计：[`docs/DSH-SKILLS.md`](docs/DSH-SKILLS.md)
- 部署说明：[`docs/DEPLOY_ECS.md`](docs/DEPLOY_ECS.md)

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Next.js 14 App Router + 自定义 `server.ts`（Next + Socket.IO 同进程） |
| 数据 | PostgreSQL 16 + Prisma 5（55 models / 22 enums / 30 migrations） |
| 校验 | Zod |
| 前端 | TailwindCSS + Zustand + Konva（战术棋盘 / 弹幕画布） |
| 规则引擎 | 自研 `@touhou/formula` / `@touhou/rules` / `@touhou/combat` |
| AI | n8n 工作流 + DeepSeek API + dsh headless 助手 |
| 测试 | Vitest（529）+ Playwright（15 条真实浏览器 E2E） |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 准备环境变量
cp apps/web/.env.example apps/web/.env
#   至少确认 DATABASE_URL / NEXTAUTH_SECRET / NEXTAUTH_URL

# 3. 起数据库
docker compose up -d db

# 4. 生成 Prisma Client + 建表
npm run db:generate --workspace @touhou/web
npm run db:deploy   --workspace @touhou/web

# 5. 启动（自定义 server，含 Socket.IO）
npm run dev
```

打开 http://localhost:3100 。默认管理员为 `bdmin`（seed 密码 `demo1234`，请在部署环境修改）。

可选 AI 能力（不配置则相关入口自动隐藏）：

```bash
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-flash"

# n8n 团本解析（推荐，见 n8n/workflows/module-import.json）
N8N_MODULE_PARSE_URL="http://n8n:5678/webhook/module-parse"

# dsh 助手旁车（生产 compose 已内置；本地也可用 DSH_HEADLESS_COMMAND）
DSH_SERVICE_URL="http://dsh:8790"
DSH_TASK_TIMEOUT_MS="300000"
```

管理后台：管理员右上角菜单 →「管理后台」→ `/admin`；dsh 白名单在 `/admin/system`。

## 功能总览

### 团本与准备
- 团本创建：标准 14 章模板 / 「从 0 新建空白」；团本广场、发布、版本快照。
- 团本导入：Markdown / 结构化块 / Excel；n8n + DeepSeek 智能解析多文件素材。
- 团本预设物化：`module-*` / `npcs.yaml` → 房间 NPC 卡、武器道具、证物、场景地图、线索、遭遇。
- 准备页：带入角色、KP 审核、装备已通过卡牌、战前符卡宣言、Token 放置、开始跑团。
- 无团本开局：可明确「不使用团本」，用房间名开局。

### 角色与成长
- COC7 车卡（属性 / 职业 / 技能 / 武器）、东方车卡（能力体系 A–D 预算）。
- 能力类别 → CoC7 技能映射（标准模式）、千幻抄能力等级与逐级消费表（DP 模式）。
- 跨局成长：成长汇总、差异标注、继承、幕间成长检定。

### 战斗
- 双模式：标准 CoC7（INITIATIVE / ATB）与东方千幻抄 DP（宣言 → 逐行动）。
- 标准模式：d100 命中、武器伤害档、重伤 / 濒死 / 死亡、战技、掩体、追逐。
- 东方 DP：4.11–6.26 规则（DP 回复 / 回避弹幕 / 掩护 / 擦弹 / 结界限时等）。
- 符卡：展开型（独立 HP / 护甲池）、消费型、LSC、章节隔离、SC 池、NPC 自带符卡。
- 符卡 `combat` 档案：`WEAPON`（d100 武器）/ `ARMOR`（护甲池）/ `SPELL`（d100 + 抵抗）。
- 已装备武器：DP 射击 / 追击 / 近战读取实际装备，服务端按装备解析伤害。
- 道具：战斗内使用已装备 ITEM 卡（治疗 / 伤害 / 状态等），服务端按卡面结算。
- 魔法：法术检定、抵抗、战斗系法术强化 DP 攻击。
- 弹幕对决：花映冢式左右分屏大舞台，按服务端 `duelSide` 稳定分边。
- 倒地处理：退场单位置灰、自动跳过行动顺序，只剩一个阵营立即结束，无需强制结算。

### 场景与协作
- 战术棋盘：方形 / 六边形网格、迷雾、墙体灯光视线、地图图层。
- Scene / Map / Token、悬浮卡交互、实时数值同步。
- 房间实时刷新、Socket 多端同步、重连恢复。

### AI / dsh
- 团本编辑悬浮球：自然语言修改团本，小版本 +1 + 版本快照。
- dsh 技能化（设计中）：把能力拆成 `module.*` / `nav.*` / `prep.*` / `kp.*` / `combat.*` 技能，
  覆盖团本调整、页面导航、准备阶段、跑团中助手、战斗解释。
- 重点方向 `kp.adjustStats`：KP 用自然语言调属性 / 技能 / HP/MP/SAN/DP，
  先 diff 预览、确认后由服务端应用，带审计与撤销。
- 详见 [`docs/DSH-SKILLS.md`](docs/DSH-SKILLS.md)。

## 目录结构

```
apps/web/
  server.ts                    自定义 HTTP server：Next + Socket.IO
  prisma/                      55 models / 22 enums / 30 migrations
  src/app/                     App Router 页面与 API
  src/components/              房间、战斗、团本、弹幕画布等 UI
  src/server/                  认证、规则加载、战斗运行时、Socket、dsh
  e2e/                         Playwright 真实浏览器用例
  scripts/                     一次性验证脚本
n8n/workflows/                 n8n 团本解析工作流
ops/dsh-service/               headless dsh 的 HTTP 旁车
packages/
  formula/                     配置表达式引擎（纯函数 + 骰子，白名单 AST）
  rules/                       RulePack Zod Schema / 编译 / 内置 coc7-baseline、touhou-ext
  combat/                      战斗与追逐引擎
docs/                          设计、规则校对、部署、E2E 报告
```

## 测试

```bash
npm run typecheck                  # 全量类型检查
npm test                           # Vitest：529 条
npm run test:e2e --workspace @touhou/web   # Playwright 真实浏览器 E2E
```

当前 E2E 覆盖：双模式符卡（武器 / 护甲 / 魔法）、DP 宣言与弹幕、Demo 团本、
倒地跳过与自动结束、能力提示、花映冢分屏、双人弹幕战（不同攻击 / 应对 / 弹幕类型）、
双人武器 + 道具 + 魔法局。

## 部署与 CI

- GitHub Actions：`verify`（typecheck + Vitest）→ `build-and-push`（app + dsh 镜像推送到阿里云 ACR）→ `deploy`（ECS `docker compose pull && up -d`）。
- **ECS 只拉镜像，不在生产主机上 build / npm install**；生产机 1.6G 内存，构建会把 app / DB / n8n 拖垮。
- n8n 工作流由 `deploy-n8n.yml` 单独部署。
- 详见 [`docs/DEPLOY_ECS.md`](docs/DEPLOY_ECS.md)。

## 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | 房间 / 局 / 团本 / 局内状态规格 |
| [`docs/MODULE_FORMAT.md`](docs/MODULE_FORMAT.md) | 团本 Markdown 与结构化块格式 |
| [`docs/TOUHOU-DUAL-MODE-DESIGN.md`](docs/TOUHOU-DUAL-MODE-DESIGN.md) | 标准 COC7 / 千幻抄 DP 双模式设计 |
| [`docs/TOUHOU-DP-ECONOMY.md`](docs/TOUHOU-DP-ECONOMY.md) | DP 经济与行动消耗 |
| [`docs/MODULE-DSH-ASSISTANT.md`](docs/MODULE-DSH-ASSISTANT.md) | 现有 dsh 团本助手实现 |
| [`docs/DSH-SKILLS.md`](docs/DSH-SKILLS.md) | dsh 技能化设计（全阶段） |
| [`docs/DEPLOY_ECS.md`](docs/DEPLOY_ECS.md) | ECS / ACR / compose 部署 |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | 当前进度与后续计划 |

## 路线

1. 草稿与地图层：场景绑定、迷雾、VBL 已完成第一版。
2. 角色成长闭环已完成。
3. RulePack 后台与版本管理已完成。
4. 智能团本导入（n8n + DeepSeek）已完成。
5. 隐藏信息与战斗脱敏已完成。
6. 团本预设物化已完成。
7. dsh 技能化：`nav.*` / `kp.adjustStats` / `combat.*` 分阶段落地。
8. E2E 全量入 CI、Socket 多实例与性能加固。
