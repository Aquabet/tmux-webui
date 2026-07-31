# Agent status badges

tmux-webui can identify foreground `codex`, `claude`, `pi`, `kimi`, and
`opencode` processes without any extra setup. A session with none of them gets
a Terminal icon. tmux itself cannot tell whether an agent is handling a turn
or waiting at its input box, so exact status comes from lifecycle hooks or
plugins.

The hook writes only small tmux pane options: a provider-scoped status plus
compatibility agent/status fields. It does not read prompts, terminal output,
transcripts, or credentials.

## Supported badges

Type detection is automatic. tmux-webui checks each pane's foreground command
and, when the pane is running a shell or wrapper, the names of descendant
processes. It does not inspect process arguments or terminal content.

| Badge | Command names | Icon | Exact status source | Without status integration |
|---|---|---|---|---|
| Codex | `codex`, `codex-*` | Codex mark | Codex lifecycle hooks; default terminal-title activity fallback | Usually running/waiting from the default title; otherwise no status dot |
| Claude Code | `claude`, `claude-*` | Claude mark | Claude lifecycle hooks | No status dot |
| Pi | `pi` | Official Pi compact badge | Shipped Pi extension | No status dot |
| Kimi Code | `kimi`, `kimi-code`, `kimi-cli` | Kimi mark | Kimi lifecycle hooks | No status dot |
| OpenCode | `opencode`, `opencode-*` | OpenCode mark | Shipped OpenCode plugin | No status dot |
| Terminal | No supported agent found | Terminal window | Not applicable | No work-status dot |

A session can show several badges when different agent kinds are present in
different panes. Panes of the same kind are collapsed into one badge.

## What the badge means

The badge is placed before the session name and carries two independent state
signals. **Frontend presence does not mean the agent is working**, and agent
work does not require an attached frontend.

### Whole icon: frontend presence

| Appearance | Meaning |
|---|---|
| Bright icon, blue-tinted background and outline | At least one tmux client is attached to this session group |
| Dim gray icon, dark background | No tmux client is attached to this session group |

An attached client can be a local `tmux attach` or any tmux-webui browser
connection. tmux-webui attaches through a temporary grouped `webui-*` session,
so the target session and every grouped WebUI view are counted together. If a
second tmux-webui opens the session, the original session badge therefore
becomes bright too.

Codex and Terminal are neutral black/white marks. Their active state uses the
same blue outline and background glow as the colored providers, rather than
recoloring the logo. The selected sidebar row has a blue background, but the
icon remains bright or dim according to frontend presence.

### Bottom-right dot: agent work status

| Dot | Color | Meaning |
|---|---|---|
| Green, pulsing | `#9ece6a` | **Running:** the agent is processing a turn, retrying, or doing other reported work |
| Amber, steady | `#e0af68` | **Waiting:** the agent explicitly needs a user response, such as permission or elicitation |
| No dot | — | A turn completed normally, the agent stopped, its exact state is unknown, or this is a Terminal fallback |

Only the icon itself is dimmed when there is no frontend. The bottom-right dot
keeps its normal color and animation, so a detached session can still clearly
show a running agent.

Common combinations:

| Whole icon | Dot | Interpretation |
|---|---|---|
| Bright | Green/pulsing | Someone is viewing the session and the agent is working |
| Dim gray | Green/pulsing | Nobody is viewing the session, but the agent is still working in the background |
| Bright | Amber | Someone is viewing the session and the agent needs a user response |
| Dim gray | Amber | Nobody is viewing the session and the agent needs a user response |
| Bright or dim | No dot | The turn completed, the agent stopped, or its exact work status is unavailable |

Hovering the badge shows its agent name, work status, and whether it has an
active frontend.

## Quick setup

From the tmux-webui directory, install integrations for the agents you use:

```bash
node scripts/install-agent-status.mjs codex claude pi kimi opencode
```

The installer merges new matcher groups into existing Codex and Claude JSON
hooks, appends a marked block to Kimi's TOML configuration, and copies the Pi
and OpenCode plugins into their global extension directories. It is
idempotent and does not replace unrelated settings.

Restart Codex and Claude Code after installation. Codex also requires `/hooks`
to review and trust the new commands. Pi can load the extension immediately
with `/reload`; restart Kimi Code and OpenCode.

## Requirements and refresh

- Agent identification works with the project's normal tmux ≥ 2.2 requirement.
- Hook/plugin-reported status needs tmux ≥ 3.0 because that release added pane
  options. Codex's limited default-title fallback does not use pane options.
- The sidebar polls every 5 seconds, so a transition can take up to 5 seconds
  to appear. This applies to frontend brightness and the work-status dot.

Use an absolute path to the hook script:

```bash
realpath scripts/agent-status-hook.sh
```

The examples below use `/absolute/path/to/tmux-webui`; replace it with the
printed path's repository prefix. If a settings file already contains hooks,
merge these matcher groups into the existing event arrays instead of replacing
the file.

## Codex CLI

Add these hooks to `~/.codex/hooks.json`:

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
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh codex waiting"
          }
        ]
      }
    ],
    "PostToolUse": [
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

Start or restart Codex, then run `/hooks` once to review and trust the command
hooks. Codex skips untrusted hooks.

## Claude Code

Merge the following into `~/.claude/settings.json`:

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
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude waiting"
          }
        ]
      }
    ],
    "Elicitation": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude waiting"
          }
        ]
      }
    ],
    "ElicitationResult": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/tmux-webui/scripts/agent-status-hook.sh claude running"
          }
        ]
      }
    ],
    "PostToolUse": [
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

Restart Claude Code after changing its settings.

## Kimi Code

Append these rules to `~/.kimi-code/config.toml`:

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

Start a new Kimi Code session after changing the configuration.

## Pi

Pi loads JavaScript extensions from `~/.pi/agent/extensions/`. Copy the shipped
extension there, then restart Pi:

```bash
mkdir -p ~/.pi/agent/extensions
cp /absolute/path/to/tmux-webui/integrations/pi-status.js \
  ~/.pi/agent/extensions/tmux-webui-status.js
```

It reports `running` on `agent_start` and waits for `agent_settled` before
reporting idle (no dot), so automatic retry, compaction, and queued follow-up
work are included in the running period. Pi has no global lifecycle event for
arbitrary extension-owned UI prompts, so amber appears only when an integration
explicitly reports `waiting`.

## OpenCode

OpenCode automatically loads global plugins from
`~/.config/opencode/plugins/`. Copy the shipped plugin there, then restart
OpenCode:

```bash
mkdir -p ~/.config/opencode/plugins
cp /absolute/path/to/tmux-webui/integrations/opencode-status.js \
  ~/.config/opencode/plugins/tmux-webui-status.js
```

The plugin aggregates OpenCode's `session.status`, `session.idle`,
`session.error`, `permission.asked`, and `permission.replied` events. Busy or
retrying is running, a pending permission/question is waiting, and an idle or
completed session has no dot.

## Edge cases

A session may contain several agent panes. The sidebar shows one icon per agent
kind; a kind is **running** if any of its panes is running. An explicit
`waiting` report is amber only when no same-kind pane is running. `idle` means
the turn completed and is intentionally omitted from the API status, producing
no dot.

If an agent launches another supported agent inside its own pane, the outer
agent owns that pane's badge and status. Inner lifecycle hooks are ignored so
they cannot leave a different agent's stale state behind.

An abrupt process kill can skip cleanup hooks. Exiting the agent still removes
the badge as soon as the shell becomes the pane's foreground process; a later
normal turn also corrects a stale running state. A stale terminal title is
intentionally ignored because it is not proof that an agent is still running.
Wrapper scripts are supported: tmux-webui checks process names below each pane
shell, without reading process arguments or terminal content.

Some Claude Code releases do not preserve `TMUX_PANE` in hook subprocesses.
The shipped hook handles this by matching the hook's parent-process chain to
tmux pane root processes; it still exits silently when it is genuinely outside
tmux.

The default Codex and Claude Code terminal-title activity spinner provides a
limited running fallback. Codex `Action Required` is an explicit waiting signal;
a static title is only idle and never turns amber. If you customize the title,
configure hooks because tmux can no longer distinguish these states reliably.
