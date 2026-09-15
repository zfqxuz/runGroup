# 阿里云 ECS 部署清单（GitHub Actions + Docker + PostgreSQL）

> 目标：ECS 单机 Docker 跑应用和 PostgreSQL，GitHub Actions 构建镜像并部署。
> 本机数据迁移是一次性 `pg_dump / pg_restore`，不是 `prisma migrate deploy`。

## 1. ECS 需要准备什么

以下以 ECS 公网 IP `8.141.16.85`、部署目录 `/opt/touhou-trpg` 为例。

### 1.1 安全组入方向

- `22/tcp`：SSH，GitHub Actions 部署用。GitHub 托管 runner 出口 IP 是动态的，最简单是放行 `0.0.0.0/0` 且只允许密钥登录；更严格的做法是定期同步 GitHub Meta 的 IP 段。
- `80/tcp`、`443/tcp`：如果使用 Nginx / Caddy 做域名和 HTTPS。
- `3000/tcp`：只有在不用反代、直接通过 `http://8.141.16.85:3000` 访问时才需要放行。
- `5432/tcp` **不要**对公网放行。

### 1.2 安装 Docker 和 Compose 插件

Alibaba Cloud Linux 4 上建议安装 Docker CE（`docker compose version` 能输出 v2 即可）：

```bash
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo docker run hello-world
```

如果 `docker compose` 不存在，再安装 compose 插件或独立的 `docker-compose`。

### 1.3 创建目录和 .env

```bash
sudo mkdir -p /opt/touhou-trpg/uploads
cd /opt/touhou-trpg
sudo touch .env
sudo chmod 600 .env
# 应用容器固定用 UID 10001 运行，绑定的 uploads 目录要给写权限
sudo chown -R 10001:10001 uploads
```

`.env` 里至少需要：

```bash
APP_IMAGE=registry.cn-hangzhou.aliyuncs.com/<你的 ACR 命名空间>/touhou-trpg:latest
POSTGRES_USER=touhou
POSTGRES_PASSWORD=<强密码，建议只含 URL 安全字符>
POSTGRES_DB=touhou_trpg
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://8.141.16.85:3000
HOST=0.0.0.0
PORT=3000
DEEPSEEK_API_KEY=<可选>
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

当前 `deploy.yml` 会在每次部署时自动重写 `APP_IMAGE`，其他值保留。

### 1.4 首次启动数据库（先不启动应用）

把仓库里的 `docker-compose.prod.yml` 放到 `/opt/touhou-trpg/`，然后：

```bash
cd /opt/touhou-trpg
sudo docker compose -f docker-compose.prod.yml up -d db
```

## 2. 数据迁移（一次性）

> 迁移期间停止写入：本机 `npm run dev` 停掉，服务器应用不要启动。

### 2.1 本机导出（WSL 里）

当前本机数据库在 Docker 容器 `touhou-trpg-db` 中：

```bash
docker exec -t touhou-trpg-db pg_dump \
  -U touhou -d touhou_trpg -Fc \
  -f /tmp/touhou_trpg.dump

docker cp touhou-trpg-db:/tmp/touhou_trpg.dump ./touhou_trpg.dump

# 上传文件也要迁移（线索图片、团本图片等）
tar --exclude='uploads/ai-jobs' -czf uploads.tar.gz -C apps/web uploads
```

### 2.2 上传到 ECS

```bash
scp -i admin.pem touhou_trpg.dump uploads.tar.gz root@8.141.16.85:/opt/touhou-trpg/
```

### 2.3 服务器恢复

```bash
cd /opt/touhou-trpg

# 恢复上传文件
mkdir -p uploads
tar -xzf uploads.tar.gz -C /tmp
# 本机导出结构是 uploads/<文件>，按实际解压结果放好：
cp -a /tmp/uploads/. /opt/touhou-trpg/uploads/
sudo chown -R 10001:10001 /opt/touhou-trpg/uploads

# 恢复数据库（空库恢复，包含 schema 和 _prisma_migrations）
docker compose -f docker-compose.prod.yml cp touhou_trpg.dump db:/tmp/touhou_trpg.dump
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U touhou -d touhou_trpg --clean --if-exists --no-owner --role=touhou \
  /tmp/touhou_trpg.dump

# 校验：迁移记录和业务数据都在
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U touhou -d touhou_trpg -c "select count(*) from _prisma_migrations;"
```

恢复完成后，再通过 GitHub Actions 部署应用。如果 dump 里已经包含全部 schema 和 `_prisma_migrations`，这次可以跳过 `prisma migrate deploy`。

## 3. GitHub Actions 需要配置什么

### 3.1 Repository secrets

| Secret | 说明 |
| --- | --- |
| `ACR_USERNAME` | 阿里云容器镜像服务用户名 |
| `ACR_PASSWORD` | ACR 固定密码 / 访问凭证 |
| `ACR_NAMESPACE` | ACR 命名空间 |
| `ECS_HOST` | `8.141.16.85` |
| `ECS_USER` | ECS 登录用户，Alibaba Cloud Linux 常见为 `root`，以实际镜像为准 |
| `ECS_SSH_KEY` | 登录私钥内容（例如 `admin.pem` 全文，包含 BEGIN/END 行） |
| `ECS_PORT` | 可选，默认 22 |

### 3.2 Repository variables（可选）

| Variable | 说明 |
| --- | --- |
| `ACR_REGISTRY` | 默认 `registry.cn-hangzhou.aliyuncs.com`，ECS 不在杭州时按地域改 |
| `DEPLOY_DIR` | 默认 `/opt/touhou-trpg` |

### 3.3 GitHub Environment

给 `production` environment 加保护规则（例如需要 reviewer 才能部署），并确保 `ECS_*` / `ACR_*` secrets 不对普通 PR 暴露。

## 4. 部署流程

`push main` 或手动触发 `Deploy Production`：

1. `verify`：类型检查 + 测试；
2. `build-and-push`：构建 `apps/web/Dockerfile`，推送到 ACR；
3. `deploy`：SSH 到 ECS，更新 `.env` 中的 `APP_IMAGE`，`docker compose pull app`、`up -d`；
4. 默认执行 `prisma migrate deploy` 作为后续 schema 变更手段。
   - **首次数据迁移**：手动触发 workflow，把 `run_migrations` 设为 `false`，等恢复完数据后再让应用启动；下次正常部署再设回 `true`。

## 5. 反代 / HTTPS 注意

如果暂时直接访问 `http://8.141.16.85:3000`，把 compose 的端口改成 `"3000:3000"`，并在安全组放行 3000。

推荐用 Nginx / Caddy 反代到 `127.0.0.1:3000`，同时记得：

- `/api/socket` 必须允许 WebSocket Upgrade，否则实时同步和 BGM 会断；
- AI 团本导入单次素材上限 150MB，反代要放开请求体大小（例如 `client_max_body_size 160m;`）。

Nginx 关键配置示例：

```nginx
server {
  listen 80;
  server_name your-domain.com;

  client_max_body_size 160m;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /api/socket {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

启用 HTTPS 后，`.env` 里的 `NEXTAUTH_URL` 要同步改成公网域名。
