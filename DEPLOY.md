# Docker 部署

## 服务器准备

服务器需要安装 Docker 和 Docker Compose 插件。

Ubuntu/Debian 可以参考：

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
```

## 上传项目

把整个项目目录上传到服务器，例如在本机项目目录执行：

```bash
scp -r . root@你的服务器IP:/opt/xiangqi
```

也可以用 Git、宝塔面板、SFTP 上传，只要服务器上保留这些文件即可：

```text
Dockerfile
docker-compose.yml
package.json
pnpm-lock.yaml
server.js
public/
```

## 一键启动

服务器上执行：

```bash
cd /opt/xiangqi
docker compose up -d --build
```

访问：

```text
http://你的服务器IP:3000/room/test
```

两个人打开同一个房间地址即可同步，例如：

```text
http://你的服务器IP:3000/room/love
```

## 常用命令

```bash
docker compose ps
docker compose logs -f
docker compose restart
docker compose down
```

更新代码后重新部署：

```bash
docker compose up -d --build
```

## 配 Nginx 域名

如果你要用域名访问，可以用 Nginx 代理到 Docker 暴露的 3000 端口：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Socket.IO 需要 `Upgrade` 和 `Connection` 这两行，否则实时同步可能失败。

## HTTPS

有域名后可以用 Certbot：

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```
