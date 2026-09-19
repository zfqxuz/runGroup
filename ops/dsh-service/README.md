# dsh 团本助手旁车（headless 无浏览器客户端）

给应用提供：

- `GET /health`：轻量健康检查，返回 `{ ok: true, service: "dsh-headless", activeTasks, maxConcurrent }`；
- `POST /run`：接收 `{ task, files, timeoutMs }`，在临时目录写入 files，调用
  `dsh --profile headless <task>`，返回 `{ exitCode, stdout, stderr, result }`。
  `result` 来自工作目录里的 `result.json`。
- `POST /run/stream`：与 `/run` 相同的入参，但以 NDJSON 流式返回：
  - `{"type":"progress","text":"..."}`：阶段进度；
  - `{"type":"thinking","text":"..."}`：dsh 的 reasoning，供前端实时显示“思考过程”；
    工具调用等 `dsh:` 内部通道不会逐条展开；
  - `{"type":"result", ...}`：最终结果；
  - `{"type":"error","message":"..."}`：执行失败。

默认一次只执行一个 dsh 任务（`DSH_MAX_CONCURRENT=1`），避免单机内存被打满。

## 生产部署（推荐）

镜像由主部署 workflow `.github/workflows/deploy.yml` 在 GitHub Runner 上构建，
推送到阿里云 ACR 的同一个仓库，用 `dsh-<commit-sha>` / `dsh-latest` 标签区分 app 镜像。
ECS 只负责 `docker compose pull dsh && docker compose up -d --no-deps dsh`。

`docker-compose.prod.yml` 中 dsh 服务只写 `image: ${DSH_IMAGE:-...}`，**没有 `build:`**。
生产 ECS 是 1.6G 内存的单机，同机还跑着 app / PostgreSQL / n8n：

> 绝不要在 ECS 上执行 `docker compose up -d --build dsh`。
> 那会在生产机上重新 `npm i -g @deepseek-ai/dsh`，直接把主机资源打满。

CI 每次部署会把新的 `DSH_IMAGE` 写进 `/opt/touhou-trpg/.env`，无需手工维护。
如果镜像拉取失败，compose 会回退到 ECS 本地已有的 `touhou-dsh-headless:latest`。

## 本地构建/调试

本地开发可以自行 build（不要在 ECS 上做）：

```bash
docker build -t touhou-dsh-headless ops/dsh-service
docker run -d --name touhou-trpg-dsh --restart unless-stopped \
  -e DEEPSEEK_API_KEY=... \
  -e DEEPSEEK_BASE_URL=https://api.deepseek.com \
  -e DEEPSEEK_MODEL=deepseek-flash \
  -p 8790:8790 \
  touhou-dsh-headless
```

## 接到应用

生产 compose 已经默认设置：

```env
DSH_SERVICE_URL=http://dsh:8790
DSH_TASK_TIMEOUT_MS=300000
DSH_MAX_CONCURRENT=1
```

如果 dsh 直接装在应用容器内、不走旁车，则改为：

```env
DSH_HEADLESS_COMMAND=/path/to/dsh
DSH_HEADLESS_ARGS=--profile headless
DSH_HOME=/dsh-home
DSH_WORKSPACE_ROOT=/tmp/touhou-dsh
```

`DSH_SERVICE_URL` 与 `DSH_HEADLESS_COMMAND` 二选一；两者都没有时功能自动关闭，
团本编辑页不会显示悬浮球。
