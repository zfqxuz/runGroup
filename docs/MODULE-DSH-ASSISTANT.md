# 团本 dsh 助手（悬浮球）

## 用户侧

- 团本编辑页（`/rooms/[id]/modules/[moduleId]`、`/modules/[moduleId]`）右下角会出现 `DSH` 悬浮球。
- 点击弹出对话框，用户用自然语言提出修改意见；对话框会实时显示「思考过程」和阶段进度，完成后返回最终结论。工具调用细节不逐条展开，但用户能感受到 ai 在推进。
- 每成功修改一轮，团本小版本号 +1（例如 `1.0.0 → 1.1.0`），并保存一个版本快照。
- 只有管理员在 `/admin/system` 的「dsh 团本助手白名单」里配置的用户（用户名或用户 id）才能看到悬浮球。

## 约束

系统提示词明确写死了：

- 当前团本 id / 标题 / 系统 / 年代 / 当前版本；
- 可改动：`content.text`、`content.structured` 下的 npcs / clues / items / scenes / chapters / encounters / magic / rewards / endings，以及用户明确要求时的 title / synopsis / background / occupationRecommendation；
- 不可改动：id、system、era、roomId、ownerId、assets、isPublished、sourceType、metadata、version 等系统字段；
- 数据来源：只能读取工作目录里的 `module.json` 与 `task.md`，禁止网络与其它文件；
- 输出：写 `result.json`（完整团本 + `reply`），`reply` 不含思维链。

## 服务端调用

`apps/web/src/server/dsh/`：

- `runner.ts`：优先 `DSH_SERVICE_URL`（旁车 HTTP，`/run/stream` 流式，回退 `/run`），否则本地拉起 `DSH_HEADLESS_COMMAND`（默认 `dsh --profile headless`）；通过 `onEvent` 把 reasoning/进度交给 API 层。
- `module-assistant.ts`：拼系统提示词、写工作目录、校验结果、写回数据库、小版本 +1、同步模板、保存版本快照、审计。
- `access.ts`：白名单读取与判断。

`DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 与 n8n 解析共用。

## 旁车

`ops/dsh-service/` 提供一个 headless dsh 的 HTTP 包装，实现 `GET /health` 与 `POST /run`。

生产部署由 `.github/workflows/deploy.yml` 负责：在 GitHub Runner 上构建镜像并推送到阿里云 ACR
（与 app 共用同一个 ACR 仓库，标签为 `dsh-<commit-sha>` / `dsh-latest`），
ECS 只 `pull` 并 `up -d --no-deps dsh`。`docker-compose.prod.yml` 里 dsh 服务**没有 `build:`**。

> 生产 ECS 是 1.6G 内存单机，绝不要在 ECS 上执行 `docker compose up -d --build dsh`：
> 那会重新 `npm i -g @deepseek-ai/dsh`，把 app / PostgreSQL / n8n 一起拖垮。

dsh 旁车默认 `DSH_MAX_CONCURRENT=1`，compose 还给容器加了 `512m / 1 CPU` 限制。

应用侧生产环境默认：

```env
DSH_SERVICE_URL=http://dsh:8790
DSH_TASK_TIMEOUT_MS=300000
```

应用调用 `POST /api/modules/[moduleId]/dsh` 时返回 NDJSON 流：前端边接收 `progress` / `thinking` 边渲染思考过程，收到 `final` 后再落最终回复并刷新版本号。

注意：**文件导入时的“团本解析”走 n8n 工作流（`N8N_MODULE_PARSE_URL`），n8n 直接调 DeepSeek API，
不经过 dsh 旁车**；dsh 负责的是编辑页悬浮球里“解析当前 module.json 并按自然语言修改”。
两条链路相互独立，只共用 `DEEPSEEK_API_KEY` 等模型配置。

## 验证

```bash
# 需要本地 dsh 可用
DSH_E2E=1 E2E_NO_WEBSERVER=1 bash apps/web/scripts/run-e2e-web.sh e2e/dsh-assistant.spec.ts
```

覆盖：悬浮球 → 对话框 → dsh 修改 → 小版本 +1；以及管理员白名单配置。

## 后续：从「团本助手」到「dsh 技能平台」

当前这条链路只是 dsh 的第一个技能 `module.edit`。后续会把 dsh 能力拆成可组合、
可授权、可审计的 Skill，覆盖团本调整、页面导航、准备阶段、跑团中助手与战斗解释，
其中 KP 可以自然语言调属性（`kp.adjustStats`）。

完整设计见 [`DSH-SKILLS.md`](DSH-SKILLS.md)。
