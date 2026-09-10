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

打开 http://localhost:3000 。

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
npm test          # 85 tests / 2 packages
npm run typecheck # 全量类型检查
```

## 下一步

- [ ] 战斗编排器（回合循环 + 动作结算 + 快照 + 种子重放）
- [ ] 权限过滤（服务端构造 DTO，PL 拿不到不该看的字段）
- [ ] Socket 事件契约与房间服务
- [ ] NextAuth 认证
- [ ] 地图 / 场景（Phase 2）
