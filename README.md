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
npm test          # 137 tests / 3 packages
npm run typecheck # 全量类型检查
```

## 开发路线

后续开发按 [`docs/SPEC.md`](docs/SPEC.md) 与 [`docs/MODULE_FORMAT.md`](docs/MODULE_FORMAT.md) 执行：

1. 准备页与开局闸门（已完成）
2. 团本管理、标准格式与 zip 导入（已完成导入 / 编辑 / 保存）
3. 当前角色与局内角色
4. 局内状态与暂停
5. 跨局成长与结束流程
6. 重连与恢复
