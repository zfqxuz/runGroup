# dsh 团本助手旁车（headless 无浏览器客户端）

给应用提供 `POST /run`：接收 `{ task, files, timeoutMs }`，在临时目录写入 files，
调用 `dsh --profile headless <task>`，返回 `{ exitCode, stdout, stderr, result }`。
`result` 来自工作目录里的 `result.json`。思维链只出现在 stderr，业务前端不会展示。

## 构建与启动

```bash
docker build -t touhou-dsh-headless ops/dsh-service
docker run -d --name touhou-trpg-dsh --restart unless-stopped \
  -e DEEPSEEK_API_KEY=... \
  -e DEEPSEEK_BASE_URL=https://api.deepseek.com \
  -e DEEPSEEK_MODEL=deepseek-flash \
  touhou-dsh-headless
```

## 接到应用

在应用环境（`/opt/touhou-trpg/.env`）里加：

```env
DSH_SERVICE_URL=http://touhou-trpg-dsh:8790
DSH_TASK_TIMEOUT_MS=300000
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
