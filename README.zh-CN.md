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

### 前置依赖

| 依赖 | 说明 |
|---|---|
| Node.js ≥ 20 | `package.json` 的 `engines` 声明，更低版本未测试 |
| tmux ≥ 2.2 | 用到 2.2 引入的 `set-hook`；开发环境是 3.x |
| C++ 编译工具链 | **仅 Linux / BSD 需要。** `node-pty` 只为 macOS 和 Windows 提供预编译产物，Linux 下 `npm install` 会现场编译，需要 `python3`、`make` 和 C++ 编译器（`apt install build-essential python3` / `dnf group install c-development`） |

服务和 tmux 必须在同一台机器、同一个用户下运行。

```bash
git clone https://github.com/Aquabet/tmux-webui.git && cd tmux-webui
./scripts/install.sh --systemd
```

这条命令会查依赖、安装、构建、让你设访问密码，并注册成开机自启的 systemd
user service。然后打开 <http://127.0.0.1:8090>。之后日常操作：

```bash
systemctl --user status tmux-webui
systemctl --user restart tmux-webui
journalctl --user -u tmux-webui -f
```

**在装任何东西之前先查依赖**是这个脚本的意义：缺编译器时你只花一行提示，
而不是一屏 `gyp ERR!`。重复执行是安全的——已有的密码和 service 文件都不会被覆盖。

### 前台运行

调试时、或机器上没有 systemd 时用：

```bash
./scripts/install.sh      # 同上，但不装 service
node dist/main.js         # Ctrl-C 停止
```

`node dist/main.js help` 列出全部子命令和环境变量。
嫌命令长可以 `npm link`，之后直接敲 `tmux-webui`。

### 非交互部署（CI、配置管理、AI agent 代跑）

`init` 默认要交互式终端。没有终端时，密码从标准输入喂进去：

```bash
printf '%s' "$TMUX_WEBUI_PASSWORD" | ./scripts/install.sh --password-stdin
# 仓库已经构建过的话：
printf '%s' "$TMUX_WEBUI_PASSWORD" | node dist/main.js init --password-stdin
```

- **不要**把密码作为命令行参数传——会进 shell 历史，同机器上别的用户还能从 `ps` 看到。
- 可重复执行：直接覆盖已存的哈希，不询问，`config.json` 里其它配置保留。
- 密码短于 8 位时退出码非 0。

不开浏览器验证部署结果：

```bash
curl -si localhost:8090/api/sessions | head -1                 # HTTP/1.1 401 Unauthorized
curl -sc /tmp/c -X POST -H 'content-type: application/json' \
  -d "{\"password\":\"$TMUX_WEBUI_PASSWORD\"}" \
  localhost:8090/api/login -o /dev/null -w '%{http_code}\n'    # 200
curl -sb /tmp/c localhost:8090/api/sessions                    # {"success":true,...}
```

**替别人部署时**：不要把 `TMUX_WEBUI_HOST` 从 `127.0.0.1` 改掉，不要把
`config.json` 或密码哈希提交进仓库；对方需要远程访问就配 Tailscale 或带 TLS 的反代。

开发模式：`npm run dev`（后端）+ `npm --prefix web run dev`（前端，端口 5173，自动代理）。

桌面端可拖动 session 侧栏右边缘，在 64–480 像素之间调整宽度。拖到最窄时会
变成仅图标栏，悬停图标仍可查看 session 名称；浏览器会记住所选宽度。手机端抽屉
保持原来的固定宽度和交互。

### Coding agent 状态标记

session 名称前的图标表示 pane 里运行的程序：

| 图标 | 自动识别的命令 | 精确区分运行中/已停下 |
|---|---|---|
| Codex | `codex`，包括 wrapper 进程内的 Codex | Lifecycle hooks；默认 terminal title 的 activity 也可作兜底 |
| Claude Code | `claude`，包括 wrapper 进程内的 Claude | Lifecycle hooks |
| Pi | `pi`，使用 Pi 官方 compact mark | 项目附带的 Pi extension |
| Kimi Code | `kimi`、`kimi-code`、`kimi-cli` | Lifecycle hooks |
| OpenCode | `opencode`，包括 wrapper 进程 | 项目附带的 OpenCode plugin |
| Terminal | 没有识别到以上 agent 时的普通终端 | 不显示工作状态灯 |

一个 badge 同时表达两条互相独立的状态：

- **整个图标：**明亮并带蓝色轮廓表示 session group 有 tmux 客户端连接，
  包括本机 tmux 和其它 tmux-webui；变暗变灰表示没有活跃前台。Codex 和
  Terminal 本身是中性色图标，因此用同样的蓝色轮廓和底光表达“有前台”，
  不修改图标品牌色。
- **右下角小灯：**绿色呼吸灯（`#9ece6a`）表示**运行中**；琥珀灯
  （`#e0af68`）表示**已停下、等待输入**；灰蓝灯（`#565f89`）表示已识别
  agent，但精确状态未知。

两条状态可以不同：无人查看的 agent 仍可在后台运行；浏览器正在查看的 agent
也可能已经停下等待输入。侧栏最多 5 秒刷新一次；鼠标停在 badge 上会显示 agent
名称、工作状态和前台连接状态。

完整组合、检测边界和配置方法见
[Agent 状态标记](docs/agent-status.zh-CN.md)。通过 hook/plugin 上报精确状态需要
tmux ≥ 3.0；agent 类型、前台连接和 Codex 有限的 title 兜底沿用 tmux ≥ 2.2。
下面的命令可合并全部状态集成，不会覆盖已有 hooks：

```bash
node scripts/install-agent-status.mjs codex claude pi kimi opencode
```

### 系统资源仪表

session 侧栏最下边缘固定显示两枚主机级仪表：CPU 活跃度和 RAM 占用，每 3 秒
刷新一次。CPU 按采样窗口内所有逻辑核心的平均值计算；Linux 上 RAM 使用
`MemAvailable`，不会把可回收的文件缓存误报成已占用内存，其它平台回退到
Node 提供的可用内存值。`/api/resources` 与 session 列表使用相同的登录鉴权。

### 想自己写 service 的话

`--systemd` 做的事是：写 `~/.config/systemd/user/tmux-webui.service`、
`systemctl --user enable --now tmux-webui`、开启 linger。等价的手写版本：

```ini
[Unit]
Description=tmux-webui
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/tmux-webui
Environment=PATH=/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env node %h/tmux-webui/dist/main.js
Restart=on-failure
RestartSec=5
KillMode=process

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now tmux-webui
loginctl enable-linger "$USER"   # 必须，否则退出登录后服务被杀
```

其中两行容易漏，漏了会出事：

- **`KillMode=process`**——从界面新建 session 时，若 tmux server 还没运行，
  它会作为本服务的子进程被拉起。默认的 `control-group` 模式下，重启 tmux-webui
  会把整个 cgroup 杀光，**连带干掉 tmux server 和里面所有会话**。
- **`loginctl enable-linger`**——不开的话 user service 在你退出登录时就停了，
  重启机器后根本不会自启。

### 更新

侧栏底部常驻显示当前版本。有新版本时会提示，并出现**更新按钮**；手机端也会在
顶栏显示紧凑提示，因此 session 抽屉关闭时仍能看到。点击后服务端在独立的 tmux
session（`tmux-webui-update`）里执行更新，界面自动切过去，你能看着它跑完。
必须放在独立 session 里——更新会重启服务，也就是杀掉执行它的进程。
结束后的输出会保留；下次点击更新时，服务端会自动替换这个已经结束的 session，
不需要手动删除。**一键更新要求服务由本仓库的 `install.sh --systemd` 安装**；
若 systemd unit 缺失或指向另一个 clone，更新会在改动代码前明确失败。

命令行里做同样的事：

```bash
./scripts/update.sh
```

它会拉取远端、列出即将更新的提交、等你确认，然后切到远端最新的**稳定版
release tag**、重装依赖、重新构建，并重启指向本目录的 systemd 服务。即使代码
已经位于目标 tag，也会重新安装、构建和重启，以修复上次中断留下的半完成状态。
重启后必须连续确认服务运行中才会打印“完成”。

加 `--yes` 跳过确认（无终端时必须加）；自动模式要求能够重启指向本目录的 systemd
服务。交互模式在没有匹配服务时仍可构建，但最后会明确提示当前进程尚未重启，
不会把它报告成完整更新。

**跟 release 而不是 main 是刻意的**：侧栏提示比的就是 GitHub 最新 release，
更新到别处会让"提示里说的版本"和"实际跑的代码"对不上。想跟 `main`（拿到
尚未发布的提交）用 `./scripts/update.sh --main`。

工作区有未提交改动时脚本会拒绝执行，不会覆盖你的修改。

有新版本时侧栏会提示，见[更新提示](#更新提示)。

## 手机端

针对手机做了专门优化（触屏/窄屏设备自动启用）：

- **触摸滚动**（带惯性）：对开启 mouse tracking 的 TUI（Claude Code、htop
  等）滑动会作为终端滚动事件送达，与桌面滚轮字节一致；普通 shell 则滚动
  xterm scrollback 回看历史输出。
- **输入条**：系统键盘上方一排辅助键（`Esc` `Tab` `^C` `↑` `↓` `⏎` `⌫`
  `Mode`）+ 随内容自动长高的输入框。回车把文字送进终端但**不代按回车**——
  文字落在对端自己的输入框里还能继续改，要提交再点 `⏎`；输入框为空时回车
  才等价于给终端按一下回车。Shift+回车换行。文字走系统输入法，语音、滑动
  输入都可靠。`⌫` 可长按连删；`Mode` 发送 Shift+Tab，切换 Claude Code 的 mode。
- **图片上传**：`Img` 按钮拉起相册，图片上传到服务器
  （`TMUX_WEBUI_UPLOAD_DIR`）并把文件路径插入输入框——消息里带上路径，
  Claude Code 会自行读取该图片。
- 软键盘弹出时布局自动收缩，侧栏开关与 window tabs 始终可见可点。

## 配置

三处来源，优先级由高到低：

1. 真实环境变量
2. 启动目录下的 `.env` 文件（可选，见 `.env.example`）
3. `~/.tmux-webui/config.json`——`tmux-webui init` 写入，权限 `0600`

`config.json` 是扁平 JSON 对象，键名与环境变量完全一致，例如
`{"TMUX_WEBUI_PORT": 9000}`。`.env` 不做变量展开，bcrypt 哈希里的 `$` 原样保留，
建议用单引号包裹值。

| 变量 | 默认 | 说明 |
|---|---|---|
| `TMUX_WEBUI_PASSWORD_HASH` | 必填 | 访问密码的 bcrypt 哈希，由 `tmux-webui init` 写入 |
| `TMUX_WEBUI_HOST` | `127.0.0.1` | 监听地址 |
| `TMUX_WEBUI_PORT` | `8090` | 监听端口 |
| `TMUX_WEBUI_SOCKET` | （默认 socket） | `tmux -L` socket 名 |
| `TMUX_WEBUI_SESSION_TTL_MS` | 7 天 | 登录有效期 |
| `TMUX_WEBUI_COOKIE_SECURE` | `false` | HTTPS 反代后设为 `true` |
| `TMUX_WEBUI_SESSION_FILE` | `~/.tmux-webui/sessions.json` | 登录 token 落盘路径（重启不掉登录），留空禁用 |
| `TMUX_WEBUI_UPLOAD_DIR` | `~/.tmux-webui/uploads` | 手机上传图片的保存目录 |
| `TMUX_WEBUI_UPDATE_CHECK` | `true` | 设为 `false` 则完全不访问 GitHub 查版本 |

### 更新提示

登录后服务端最多每 6 小时查一次 GitHub 最新 release，有新版就在侧栏显示链接，
手机端还会在顶栏显示紧凑提示。默认**不自动安装**，要不要更新由你点
[更新按钮](#更新)决定。这是本服务唯一的对外请求，设
`TMUX_WEBUI_UPDATE_CHECK=false` 可关闭。

## 安全须知

浏览器终端 = shell 完整权限。**切勿**把本服务直接裸露在公网：

- 保持默认只监听 `127.0.0.1`，通过 Tailscale 或带 HTTPS 的反向代理访问
- 反代 TLS 后设置 `TMUX_WEBUI_COOKIE_SECURE=true`
- 更新按钮执行的是服务启动目录下的 `scripts/update.sh`。命令是固定的，
  不接受请求里的任何内容（分支、ref、路径都不行），已登录的客户端也无法让它
  跑别的东西；脚本不存在时该功能不出现
- 没有默认密码：未设置 `TMUX_WEBUI_PASSWORD_HASH` 时服务直接拒绝启动
- 绑定非回环地址会在启动时打印告警——在不可信网络上这不是受支持的配置

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `未找到 tmux 命令`（启动即退出） | PATH 里没有 tmux | 装上 tmux 再启动 |
| `TMUX_WEBUI_PASSWORD_HASH 未设置` | 还没设访问密码 | 跑 `init`，见[快速开始](#快速开始) |
| `端口 8090 已被占用` | 端口被别的进程占了 | 设 `TMUX_WEBUI_PORT`，或停掉那个进程 |
| `没有权限监听 …` | 用了 1024 以下的端口 | 换 ≥1024 的端口，用反代对外 |
| `init 需要交互式终端` | 无 TTY 环境跑了 `init` | 改用 `--password-stdin`，见[非交互部署](#非交互部署ci配置管理ai-agent-代跑) |
| `npm install` 报 `gyp ERR!` | 缺 `node-pty` 需要的 C++ 工具链 | 装 `python3`、`make` 和编译器，见[前置依赖](#前置依赖) |
| 页面空白、`/assets/…` 404 | 前端没构建 | 跑 `npm run build` |
| 界面提示 `tmux server 未运行`（503） | 装了 tmux 但没有会话 | 先起一个：`tmux new -d -s main` |
| 密码总是登录失败 | 存的哈希与密码对不上 | 重跑 `init`；注意优先级是 环境变量 > `.env` > `config.json` |
| 重启机器或退出登录后服务没了 | 没开 linger | `loginctl enable-linger "$USER"` |
| 重启 tmux-webui 把 tmux 会话一起杀了 | unit 缺 `KillMode=process` | 补上并 `systemctl --user daemon-reload` |

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
