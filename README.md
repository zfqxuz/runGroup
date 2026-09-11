# 东方 TRPG 平台

COC7 兼容的东方 Project 线上跑团平台。规则数值全部由 `RulePack` 配置驱动，
战斗过程可快照、可回放。

规格文档见 [`docs/SPEC.md`](docs/SPEC.md)，当前版本 **Spec v1.3**。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Next.js 14 App Router + 自定义 `server.ts`（Next + Socket.IO 同进程）|
| 数据 | PostgreSQL 16 + Prisma 5 |
| 校验 | Zod |
| 前端 | TailwindCSS + Zustand + Konva |
| 测试 | Vitest + Playwright |

## 快速开始

```bash
# 1. 安装依赖
npm install --cache /tmp/npmcache

# 2. 起数据库
docker compose up -d db

# 3. 生成客户端 + 建表
npm run db:generate --workspace @touhou/web
npm run db:deploy   --workspace @touhou/web

# 4. 启动（自定义 server，含 Socket.IO）
npm run dev
```

打开 http://localhost:3100（可在 apps/web/.env 里调整 PORT/HOST）。

可选：启用 DeepSeek 智能团本导入，在 `apps/web/.env` 增加：

```bash
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
DEEPSEEK_MODEL="deepseek-flash"   # 支持图片视觉；文本推理可换 deepseek-v4-pro
```

管理后台入口：管理员用户（`bdmin`）右上角下拉菜单 →「管理后台」→ `/admin`。

## 目录结构

```
apps/web/
  server.ts              自定义 HTTP server：Next + Socket.IO
  prisma/
    schema.prisma        v1.1 数据模型
    migrations/          初始迁移（含 2 个部分唯一索引）
  src/
    app/                 App Router 页面
    server/db/prisma.ts  Prisma 单例
packages/
  formula/               配置表达式引擎（纯函数 + 骰子，白名单 AST）
```

## 已落地的地基

- [x] npm workspaces 工程结构
- [x] Next.js 14 + 自定义 server + Socket.IO（已验证 ack 往返）
- [x] PostgreSQL 数据模型（32 张表/枚举）与初始迁移（含 2 个部分唯一索引）
- [x] Prisma Client 单例
- [x] `@touhou/formula` 配置表达式引擎（48 tests）
- [x] `@touhou/rules` RulePack 配置驱动规则引擎（37 tests）
  - Zod Schema + extends 链深合并
  - derived 拓扑排序 + 环检测
  - COC7 判定（边界全覆盖）
  - 伤害管线（顺序由配置声明）
  - ATB 事件调度（解析解，非轮询）
- [x] 内置规则包 `coc7-baseline` / `touhou-ext`

## 测试

```bash
npm test          # 144 tests / 3 packages
npm run typecheck # 全量类型检查
```

## 开发路线

准备页、开局闸门、团本管理、Game / GameState、暂停 / 继续 / 结束、
跨局成长、重连恢复、团本广场、游戏历史、P0/P1 跑团能力均已完成第一版。

后续 P2 计划见 [`docs/HANDOFF.md`](docs/HANDOFF.md) 第 17 / 22 节，当前进度：

1. 战术棋盘 / 场景地图：MVP + 六边形网格、迷雾、墙体灯光视线、地图图层、团本结构化绑定均已完成
2. 角色成长系统闭环（已完成：成长汇总、差异标注、跨局继承、幕间成长检定）
3. 规则内容补全与 RulePack 后台管理：后台、版本、发布、绑房、导入导出已完成；DeepSeek 可在团本准备阶段整理并启用模组魔法规则（structured.magic）
4. DeepSeek 智能团本导入（已完成：多文件素材整合为 14 章标准团本 + 模组魔法规则）
5. 隐藏信息：NPC/Boss 默认隐藏、KP 公开、玩家互见配置与战斗伤害脱敏（已完成）
6. 用户 / 房间协作与权限
7. 部署、CI、备份与可观测性
8. E2E 全量入 CI、Socket 多实例与性能加固
