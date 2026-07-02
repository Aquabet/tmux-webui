# tmux-webui 设计文档

日期：2026-07-02
状态：待用户审阅

## 目标

一个自托管的 tmux Web UI：在浏览器中查看本机 tmux 的所有 session 与 window，
以两级导航切换，并提供**完整交互终端**（可输入）。浏览器视图与本机已 attach 的
tmux 客户端**完全独立**，互不干扰。支持公网访问（经反代/Tailscale），带密码认证。

## 需求确认记录

| 决策点 | 结论 |
|---|---|
| 交互深度 | 完整交互终端（xterm.js，可输入） |
| 访问范围 | 公网（HTTPS 由反代/Tailscale 负责） |
| Tab 粒度 | 两级导航：侧边栏 session，顶部 tab 为该 session 的 windows |
| 视图独立性 | 完全独立（tmux 分组会话实现） |
| 实现方案 | 方案 A：Node.js + node-pty + 分组会话（用户离席，按推荐默认采纳，可推翻） |

## 架构

```
浏览器 (React + xterm.js)
   │  HTTPS/WSS（反代/Tailscale 提供加密）
   ▼
Node.js 后端 (Express + ws)，默认监听 127.0.0.1
   │  每个终端视图一个 PTY
   ▼
node-pty ──> tmux new-session -t <目标session> -s webui-<id>  (分组会话)
   ▼
tmux server（用户现有 sessions）
```

核心思想：让 tmux 自己负责终端渲染、滚屏、转义序列；后端只做认证过的
"字节搬运工"，将 PTY 字节流与 WebSocket 双向直通。

## 后端组件（TypeScript）

- `src/tmux/` — tmux 命令封装与输出解析
  - `list.ts`：`tmux list-sessions -F` / `list-windows -F` 定制格式，解析为
    `{ sessions: [{ name, attached, windows: [{ index, name, active }] }] }`
  - `view.ts`：创建分组会话（`new-session -d -t <session> -s webui-<id>`，
    并 `set-option destroy-unattached on`）、`select-window`、清理残留 `webui-*`
  - 解析函数为纯函数，便于单元测试
- `src/auth/` — 认证
  - 密码校验：bcrypt 哈希来自环境变量 `TMUX_WEBUI_PASSWORD_HASH`
  - 会话：httpOnly + secure + sameSite=strict cookie，内存 session store
  - 登录限速：同 IP 5 次/分钟
- `src/ws/` — WebSocket 终端通道
  - 升级前校验认证 cookie，未认证直接拒绝
  - 连接参数：`session`（必填）、`window`（可选）
  - 建立后：spawn PTY 运行 `tmux attach -t webui-<id>`（先创建分组会话）
  - 消息协议：二进制帧 = 终端字节流；JSON 文本帧 = 控制消息
    （`{type:"resize",cols,rows}`、`{type:"select-window",index}`）
- `src/server.ts` — Express 装配：静态文件、REST、WS 升级
  - `POST /api/login`、`POST /api/logout`
  - `GET /api/sessions` — session→windows 树（需认证）

## 前端组件（Vite + React + TypeScript）

- 登录页（单密码输入）
- 主界面：
  - 左侧边栏：session 列表（名称 + attached 标记），手机端收为抽屉
  - 顶部 tabs：当前 session 的 windows（active 高亮）
  - 主区域：xterm.js + fit addon，随窗口 resize 并上报后端
- 状态管理：React state + 每 5 秒轮询 `/api/sessions` 刷新列表
- 切 window：发送 `select-window` 控制消息（不重连）
- 切 session：关闭当前 WS，新建连接
- WS 断线：指数退避自动重连，终端区显示重连状态

## 关键机制

1. **独立视图**：每个浏览器终端连接对应一个 tmux 分组会话。分组会话共享原
   session 的 window 列表，但"当前 window"独立，因此浏览器切换不影响本机客户端。
2. **生命周期**：`destroy-unattached on` 使断线后 tmux 自动销毁分组会话；
   后端启动时及每次新连接前清扫无主的 `webui-*` 会话兜底。
3. **resize 策略**：分组会话仅被单个客户端 attach，PTY 尺寸即浏览器终端尺寸，
   不与本机客户端争抢尺寸（tmux 按 session 分组独立计算尺寸）。

## 错误处理

- tmux server 未运行 / 无 session：`/api/sessions` 返回明确错误码，前端显示引导文案
- 目标 session 在连接期间被 kill：PTY 退出 → WS 关闭并附带原因 → 前端提示并刷新列表
- WS 意外断开：前端自动重连；后端确保对应 PTY 与分组会话被清理
- 所有 tmux 子进程调用设置超时，失败时返回用户可读错误，不泄漏内部路径

## 安全

- 认证：bcrypt 密码哈希（env 注入，不落盘明文）；未配置哈希时拒绝启动并提示生成命令
- 传输：应用默认绑定 `127.0.0.1`（可配置），HTTPS/WSS 由反代或 Tailscale 承担
- Cookie：httpOnly、secure、sameSite=strict
- 限速：登录接口 IP 限速；WS 升级需已认证
- 终端即 shell 完整权限 —— 文档中明确警示：切勿在无认证情况下暴露到公网

## 测试策略

- 单元测试（Vitest）：tmux 输出解析、命令构造、认证逻辑（目标 80%+ 覆盖）
- 集成测试：用独立 socket（`tmux -L webui-test`）起临时 tmux server，
  验证 list / 分组会话创建销毁 / select-window，全程不触碰用户真实 session
- E2E（Playwright）：登录 → 看到 session 列表 → 切 window → 输入回显 关键流

## 非目标（YAGNI）

- 不做多用户/多账号体系（单密码即可）
- 不做 pane 级拆分显示（tmux 自己会渲染 pane 边框）
- 不做 session/window 的创建、重命名、关闭等管理操作（第一版只读结构 + 交互终端）
- 不做终端回放/录制
