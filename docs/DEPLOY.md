# 发布部署文档

## 服务端口

| 服务 | 端口 | 进程 |
|------|------|------|
| 前端（nginx 静态服务） | `5173` | nginx |
| 后端（Go API） | `5174` | jjs-server |

## 目录结构

```
/opt/jjs/
├── frontend/              # 前端静态文件（由 nginx 直接托管）
│   ├── index.html
│   └── assets/
├── backend/
│   ├── jjs-server         # Go 后端二进制
│   ├── config.json        # 后端配置文件
│   └── server_output.log  # 后端运行日志
```

## 部署步骤

### 1. 构建前端

```bash
cd jjs-web
pnpm build
```

产物在 `jjs-web/dist/`。

### 2. 构建后端

```bash
cd jjs-server
GOOS=linux GOARCH=amd64 go build -o bin/jjs-server ./cmd/server
```

产物为 `jjs-server/bin/jjs-server`。

### 3. 上传前端

```bash
scp -r jjs-web/dist/* <server>:/opt/jjs/frontend/
```

### 4. 上传并重启后端

```bash
# 停止旧进程
ssh <server> "fuser -k 5174/tcp"

# 上传新二进制
scp jjs-server/bin/jjs-server <server>:/opt/jjs/backend/

# 启动
ssh <server> "chmod +x /opt/jjs/backend/jjs-server && cd /opt/jjs/backend && nohup ./jjs-server > server_output.log 2>&1 &"
```

### 5. 验证

```bash
ssh <server> "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5173/ && echo ' frontend' && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:5174/api/health && echo ' backend'"
```

预期输出：`200 frontend` `200 backend`。

## 后端配置

配置文件位于 `/opt/jjs/backend/config.json`，格式：

```json
{
  "mysql_dsn": "<数据库连接串>",
  "jwt_secret": "<JWT密钥>",
  "jwt_expire": "168h",
  "port": "5174",
  "frontend_dir": "../frontend"
}
```

## nginx 配置

站点配置 `/etc/nginx/sites-enabled/jjs`：

```nginx
server {
    listen 5173;

    root /opt/jjs/frontend;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:5174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /ws {
        proxy_pass http://127.0.0.1:5174;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

重载 nginx：

```bash
ssh <server> "nginx -t && nginx -s reload"
```
