# tmux-webui

[English](README.md) | 中文

浏览器里的 tmux：两级导航（session 侧边栏 + window tabs）查看并切换所有
tmux window，完整交互终端（xterm.js）。浏览器视图基于 tmux 分组会话，
与你本机 attach 的客户端**完全独立**，互不干扰。

## 快速开始

```bash
npm install && npm --prefix web install
cp .env.example .env
npm run hash-password -- 你的密码     # 生成哈希，粘贴进 .env
npm run build && npm start           # http://127.0.0.1:8090
```

开发模式：`npm run dev`（后端）+ `npm --prefix web run dev`（前端，端口 5173，自动代理）。

## 配置（.env 或环境变量）

启动时会读取**启动目录下的 `.env` 文件**（可选，见 `.env.example`）；
真实环境变量优先于 `.env`。`.env` 不做变量展开，bcrypt 哈希里的 `$` 原样保留，
建议用单引号包裹值。

| 变量 | 默认 | 说明 |
|---|---|---|
| `TMUX_WEBUI_PASSWORD_HASH` | 必填 | bcrypt 哈希，用 `npm run hash-password` 生成 |
| `TMUX_WEBUI_HOST` | `127.0.0.1` | 监听地址 |
| `TMUX_WEBUI_PORT` | `8090` | 监听端口 |
| `TMUX_WEBUI_SOCKET` | （默认 socket） | `tmux -L` socket 名 |
| `TMUX_WEBUI_SESSION_TTL_MS` | 7 天 | 登录有效期 |
| `TMUX_WEBUI_COOKIE_SECURE` | `false` | HTTPS 反代后设为 `true` |

## 安全须知

浏览器终端 = shell 完整权限。**切勿**把本服务直接裸露在公网：

- 保持默认只监听 `127.0.0.1`，通过 Tailscale 或带 HTTPS 的反向代理访问
- 反代 TLS 后设置 `TMUX_WEBUI_COOKIE_SECURE=true`

## 测试

```bash
npm test                  # 后端单元 + 集成（独立 tmux socket）
npm --prefix web test     # 前端单元
npm run test:e2e          # Playwright 全流程
```

## 参与开发

分支流程与代码规范见 [Development Guide](docs/development.md)（英文）。
