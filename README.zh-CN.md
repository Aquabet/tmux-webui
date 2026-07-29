# tmux-webui

[English](README.md) | 中文

浏览器里的 tmux：两级导航（session 侧边栏 + window tabs）查看并切换所有
tmux window，完整交互终端（xterm.js）。浏览器视图基于 tmux 分组会话，
与你本机 attach 的客户端**完全独立**，互不干扰。

> **⚠️ 部署前必读。** 浏览器终端等于运行它的那个账号的完整 shell 权限——
> 任何人只要能连到端口并拿到密码，就等于拿到你的机器。请保持默认只监听
> `127.0.0.1`，通过 Tailscale / WireGuard 访问，或用带 TLS 和访问控制的反向
> 代理。**切勿直接暴露到公网。** 详见[安全须知](#安全须知)。

## 快速开始

```bash
npm install && npm --prefix web install
cp .env.example .env
npm run hash-password -- 你的密码     # 生成哈希，粘贴进 .env
npm run build && npm start           # http://127.0.0.1:8090
```

开发模式：`npm run dev`（后端）+ `npm --prefix web run dev`（前端，端口 5173，自动代理）。

## 手机端

针对手机做了专门优化（触屏/窄屏设备自动启用）：

- **触摸滚动**（带惯性）：对开启 mouse tracking 的 TUI（Claude Code、htop
  等）滑动会作为终端滚动事件送达，与桌面滚轮字节一致；普通 shell 则滚动
  xterm scrollback 回看历史输出。
- **输入条**：系统键盘上方一排辅助键（`Esc` `Tab` `^C` `↑` `↓` `⏎`）+ 随内容
  自动长高的输入框。回车发送，Shift+回车换行；文字走系统输入法，语音、
  滑动输入都可靠。
- **图片上传**：`Img` 按钮拉起相册，图片上传到服务器
  （`TMUX_WEBUI_UPLOAD_DIR`）并把文件路径插入输入框——消息里带上路径，
  Claude Code 会自行读取该图片。
- 软键盘弹出时布局自动收缩，侧栏开关与 window tabs 始终可见可点。

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
| `TMUX_WEBUI_SESSION_FILE` | `~/.tmux-webui/sessions.json` | 登录 token 落盘路径（重启不掉登录），留空禁用 |
| `TMUX_WEBUI_UPLOAD_DIR` | `~/.tmux-webui/uploads` | 手机上传图片的保存目录 |

## 安全须知

浏览器终端 = shell 完整权限。**切勿**把本服务直接裸露在公网：

- 保持默认只监听 `127.0.0.1`，通过 Tailscale 或带 HTTPS 的反向代理访问
- 反代 TLS 后设置 `TMUX_WEBUI_COOKIE_SECURE=true`
- 没有默认密码：未设置 `TMUX_WEBUI_PASSWORD_HASH` 时服务直接拒绝启动
- 绑定非回环地址会在启动时打印告警——在不可信网络上这不是受支持的配置

## 测试

```bash
npm test                  # 后端单元 + 集成（独立 tmux socket）
npm --prefix web test     # 前端单元
npm run test:e2e          # Playwright 全流程
```

## 参与开发

分支流程与代码规范见 [Development Guide](docs/development.md)（英文）。

## 许可证

[MIT](LICENSE)
