# Agent 状态标记

tmux-webui 不需要额外配置就能根据前台进程识别 `codex`、`claude`、`pi`、
`kimi` 和 `opencode`。都没有识别到的 session 会显示 Terminal 图标。但 tmux
本身不知道 agent 是在处理一轮任务，还是已经回到输入框等待，因此精确状态由
lifecycle hooks 或插件上报。

hook 只往当前 tmux pane 写两个很小的 user option；它不读取 prompt、终端输出、
transcript 或凭据。

## 当前支持范围

agent 类型不需要配置即可识别。tmux-webui 会检查每个 pane 的前台命令；pane
前台是 shell 或 wrapper 时，还会检查它的后代进程名称。不会读取进程参数或
终端内容。

| Badge | 命令名 | 图标 | 精确状态来源 | 未安装状态集成时 |
|---|---|---|---|---|
| Codex | `codex`、`codex-*` | Codex 标记 | Codex lifecycle hooks；默认 terminal title 的 activity 兜底 | 通常可从默认 title 判断运行/停下，否则显示灰蓝未知灯 |
| Claude Code | `claude`、`claude-*` | Claude 标记 | Claude lifecycle hooks | 显示灰蓝未知灯 |
| Pi | `pi` | Pi 官方 compact badge | 项目附带的 Pi extension | 显示灰蓝未知灯 |
| Kimi Code | `kimi`、`kimi-code`、`kimi-cli` | Kimi 标记 | Kimi lifecycle hooks | 显示灰蓝未知灯 |
| OpenCode | `opencode`、`opencode-*` | OpenCode 标记 | 项目附带的 OpenCode plugin | 显示灰蓝未知灯 |
| Terminal | 没有识别到以上 agent | 终端窗口 | 不适用 | 不显示工作状态灯 |

不同 pane 里存在不同类型的 agent 时，一个 session 可以显示多个 badge。同类型
的多个 pane 会合并成一个 badge。

## Badge 表现形式

badge 位于 session 名称前，同时表达两条互相独立的状态。**有活跃前台不等于
agent 正在工作**，agent 工作也不要求有人连接。

### 整个图标：前台连接状态

| 外观 | 含义 |
|---|---|
| 图标明亮，带蓝色底光和轮廓 | 该 session group 至少有一个 tmux 客户端连接 |
| 图标变暗变灰，背景更暗 | 该 session group 没有 tmux 客户端连接 |

这里的客户端既包括本机 `tmux attach`，也包括任意 tmux-webui 浏览器连接。
tmux-webui 会通过临时的同组 `webui-*` session attach，因此目标 session 与
同组的所有 WebUI view 会一起计算。第二个 tmux-webui 打开该 session 后，目标
session 的图标同样会变亮。

Codex 和 Terminal 是黑白灰中性色图标。有活跃前台时用与其它 provider 相同的
蓝色轮廓和底光表达，不强行改变品牌色。当前选中的侧栏行虽然是蓝色背景，图标
仍会按前台连接状态保持明亮或变暗。

### 右下角小灯：agent 工作状态

| 小灯 | 颜色 | 含义 |
|---|---|---|
| 绿色呼吸灯 | `#9ece6a` | **运行中：**agent 正在处理一轮任务、重试或执行其它已上报的工作 |
| 琥珀色常亮 | `#e0af68` | **已停下：**agent 已完成任务，正在等待输入 |
| 灰蓝色常亮 | `#565f89` | **状态未知：**已识别 agent，但没有收到有效的精确状态 |
| 无小灯 | — | Terminal fallback，没有可上报的 agent 工作状态 |

没有活跃前台时，只会压暗图标本身；右下角状态灯的颜色和动画保持不变。因此即使
session 无人查看，后台运行的 agent 仍会清楚显示绿色呼吸灯。

常见组合：

| 整个图标 | 右下角小灯 | 实际含义 |
|---|---|---|
| 明亮 | 绿色呼吸灯 | 有人正在查看，agent 也正在工作 |
| 暗灰 | 绿色呼吸灯 | 无人查看，但 agent 仍在后台工作 |
| 明亮 | 琥珀灯 | 有人正在查看，agent 已停下等待输入 |
| 暗灰 | 琥珀灯 | 无人查看，agent 也已停下等待输入 |
| 明亮或暗灰 | 灰蓝灯 | 前台连接状态已知，但 agent 工作状态未知 |

鼠标停在 badge 上会显示 agent 名称、工作状态和是否有活跃前台。

## 快速配置

在 tmux-webui 目录执行下面命令，安装所需 agent 的状态集成：

```bash
node scripts/install-agent-status.mjs codex claude pi kimi opencode
```

安装器会把新的 matcher group 合并进现有 Codex/Claude JSON hooks，把带边界标记
的配置块追加进 Kimi TOML，并把 Pi/OpenCode 插件复制进各自的全局 extension
目录。重复执行不会产生重复配置，也不会覆盖无关设置。

安装后重启 Codex 和 Claude Code；Codex 还要执行 `/hooks` 审核并信任新命令。
Pi 可以执行 `/reload` 立即加载 extension；Kimi Code 和 OpenCode 需要重启。

## 要求与刷新

- 只识别 agent 类型沿用项目的 tmux ≥ 2.2 要求。
- 通过 hook/plugin 上报精确状态需要 tmux ≥ 3.0，因为 pane options 是 3.0
  加入的；Codex 有限的默认 title 兜底不使用 pane options。
- 侧栏每 5 秒轮询一次，前台连接和 agent 工作状态的变化最多延迟 5 秒。

先取得 hook 脚本的绝对路径：

```bash
realpath scripts/agent-status-hook.sh
```

下面用 `/absolute/path/to/tmux-webui` 代替仓库绝对路径，请换成刚才输出路径的
仓库部分。如果设置文件里已经有 hooks，要把下面的 matcher group 合并进对应
event 数组，不要覆盖整个文件。

## Codex CLI

把下面的 hooks 加进 `~/.codex/hooks.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh codex idle"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh codex running"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh codex idle"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh codex clear"
          }
        ]
      }
    ]
  }
}
```

启动或重启 Codex 后，执行一次 `/hooks` 审核并信任这些 command hooks；Codex
不会运行尚未信任的 hook。

## Claude Code

把下面内容合并进 `~/.claude/settings.json`：

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude idle"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude running"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude idle"
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude idle"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude clear"
          }
        ]
      }
    ]
  }
}
```

改完设置后重启 Claude Code。

## Kimi Code

把下面规则追加进 `~/.kimi-code/config.toml`：

```toml
[[hooks]]
event = "SessionStart"
command = "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh kimi idle"

[[hooks]]
event = "UserPromptSubmit"
command = "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh kimi running"

[[hooks]]
event = "Stop"
command = "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh kimi idle"

[[hooks]]
event = "StopFailure"
command = "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh kimi idle"

[[hooks]]
event = "Interrupt"
command = "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh kimi idle"

[[hooks]]
event = "SessionEnd"
command = "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh kimi clear"
```

改完配置后新开一个 Kimi Code session。

## Pi

Pi 会自动加载 `~/.pi/agent/extensions/` 中的 JavaScript extension。复制项目附带的
extension，然后重启 Pi：

```bash
mkdir -p ~/.pi/agent/extensions
cp /absolute/path/to/tmux-webui/integrations/pi-status.js \
  ~/.pi/agent/extensions/tmux-webui-status.js
```

extension 在 `agent_start` 时上报 running，并等到 `agent_settled` 才上报 idle，
因此自动重试、自动 compact 和排队中的 follow-up 都会算在运行时间内。

## OpenCode

OpenCode 会自动加载 `~/.config/opencode/plugins/` 中的全局插件。复制项目附带的
插件，然后重启 OpenCode：

```bash
mkdir -p ~/.config/opencode/plugins
cp /absolute/path/to/tmux-webui/integrations/opencode-status.js \
  ~/.config/opencode/plugins/tmux-webui-status.js
```

插件会聚合 OpenCode 的 `session.status`、`session.idle` 和 `session.error` 事件；
只要同一个 OpenCode 实例里任一 session 正在执行或重试，侧栏就显示运行中。

## 边界情况

一个 session 里可以有多个 agent pane。侧栏会按 agent 类型各显示一个图标；
只要同类任一 pane 在运行，就显示**运行中**。只有所有已识别的同类 pane 都明确
上报 idle，才显示**已停下**。

如果一个 agent 在自己的 pane 内启动另一个受支持的 agent，该 pane 的 badge
和状态归外层 agent；内层 lifecycle hook 会被忽略，不能留下另一种 agent 的
过期状态。

强制杀进程可能跳过清理 hook。agent 退出、shell 重新成为 pane 的前台进程后，
badge 仍会随即消失；下一轮正常任务也会纠正遗留的运行中状态。终端标题可能在
进程退出后残留，所以实现会刻意忽略标题，不能拿它证明 agent 仍在运行。
wrapper 脚本也能识别：tmux-webui 会检查 pane shell 下方的进程名，但不会读取
进程参数或终端内容。

部分 Claude Code 版本不会把 `TMUX_PANE` 保留到 hook 子进程。仓库自带的 hook
会用父进程链匹配 tmux pane 的根进程来找回 pane；确实在 tmux 外运行时仍会
静默退出。

Codex hook 尚未信任时，会有限度地使用默认 terminal title 的 `activity` 项：
出现 spinner 表示运行中；非空标题里没有 activity spinner 就表示已停下。如果
你自定义 Codex、从 title 中移除了 `activity` 项，需要配置 hooks，因为 tmux
本身已经无法可靠区分这两个状态。
