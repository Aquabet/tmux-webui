# tmux-webui

English | [中文](README.zh-CN.md)

tmux in your browser: two-level navigation (session sidebar + window tabs) to
view and switch between all tmux windows, with a fully interactive terminal
(xterm.js). The browser view uses tmux grouped sessions, so it is **completely
independent** of clients attached on your machine — neither disturbs the other.

> **⚠️ Read before you deploy it.** A browser terminal is full shell access to
> the account running it. Anyone who reaches the port and gets the password owns
> your machine. Keep the default `127.0.0.1` bind and reach it over Tailscale /
> WireGuard, or put it behind a reverse proxy with TLS and access control.
> **Never expose it directly to the public internet.** See
> [Security Notes](#security-notes).

## Quick Start

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 20 | `engines` in `package.json`; older versions are untested |
| tmux ≥ 2.2 | needs `set-hook`, added in 2.2. Developed against 3.x |
| C++ toolchain | **Linux and BSD only.** `node-pty` ships prebuilt binaries for macOS and Windows but not Linux, so `npm install` compiles it: `python3`, `make`, and a C++ compiler must be present (`apt install build-essential python3` / `dnf group install c-development`) |

Both the server and tmux must run on the same machine and as the same user.

```bash
git clone https://github.com/Aquabet/tmux-webui.git && cd tmux-webui
./scripts/install.sh --systemd
```

That checks prerequisites, installs, builds, asks for an access password, and
registers a systemd user service that starts on boot. Open
<http://127.0.0.1:8090>. From then on:

```bash
systemctl --user status tmux-webui
systemctl --user restart tmux-webui
journalctl --user -u tmux-webui -f
```

Checking prerequisites *before* installing is the point: a missing compiler
costs you one line instead of a screen of `gyp ERR!`. Rerunning the script is
safe — it never overwrites an existing password or service file.

### Running it in the foreground instead

Useful while debugging, or on a machine without systemd:

```bash
./scripts/install.sh      # same, minus the service
node dist/main.js         # Ctrl-C to stop
```

`node dist/main.js help` lists all subcommands and environment variables.
Prefer a short command? `npm link` puts `tmux-webui` on your `PATH`.

### Non-interactive setup (CI, config management, AI agents)

`init` prompts on a TTY. When there is no terminal, feed the password on stdin:

```bash
printf '%s' "$TMUX_WEBUI_PASSWORD" | ./scripts/install.sh --password-stdin
# or, if the repo is already built:
printf '%s' "$TMUX_WEBUI_PASSWORD" | node dist/main.js init --password-stdin
```

- Never pass the password as an argument — it lands in shell history and is
  visible to `ps` for other users on the machine.
- Rerunning is idempotent: it overwrites the stored hash without prompting and
  keeps every other setting in `config.json`.
- Exits non-zero if the password is shorter than 8 characters.

Verify the deployment without a browser:

```bash
curl -si localhost:8090/api/sessions | head -1                 # HTTP/1.1 401 Unauthorized
curl -sc /tmp/c -X POST -H 'content-type: application/json' \
  -d "{\"password\":\"$TMUX_WEBUI_PASSWORD\"}" \
  localhost:8090/api/login -o /dev/null -w '%{http_code}\n'    # 200
curl -sb /tmp/c localhost:8090/api/sessions                    # {"success":true,...}
```

Deploying on someone's behalf? Do not change `TMUX_WEBUI_HOST` from
`127.0.0.1`, do not commit `config.json` or the hash to a repository, and set
up Tailscale or a TLS reverse proxy if the person needs remote access.

Development mode: `npm run dev` (backend) + `npm --prefix web run dev`
(frontend on port 5173, with automatic proxying).

On desktop, drag the session sidebar's right edge to resize it from 64 to
480 pixels. At its narrowest it becomes an icon-only rail; hover an icon to
see the session name. The chosen width is remembered in this browser. The
mobile drawer keeps its fixed width and existing behavior.

The settings button beside **Sessions** opens terminal appearance controls.
Choose from Tokyo Night, Catppuccin Mocha, Dracula, Nord, Solarized Dark, or
Gruvbox Dark; you can also change the terminal font, font size, line height,
and cursor shape. Changes apply immediately and are stored only in this
browser. Font choices use locally installed fonts and fall back to the system
monospace stack rather than downloading font files.

### Coding agent badges

The icon before each session name identifies what is running in its panes:

| Icon | Automatically recognized commands | Exact running/waiting status |
|---|---|---|
| Codex | `codex`, including wrapper processes | Lifecycle hooks; default terminal-title activity is also used as a fallback |
| Claude Code | `claude`, including wrapper processes | Lifecycle hooks |
| Pi | `pi`; uses Pi's official compact mark | Shipped Pi extension |
| Kimi Code | `kimi`, `kimi-code`, `kimi-cli` | Lifecycle hooks |
| OpenCode | `opencode`, including wrapper processes | Shipped OpenCode plugin |
| Terminal | Fallback when no supported agent is detected | No work-status dot |

The badge carries two independent signals:

- **Whole icon:** bright with a blue outline means a tmux client, including
  another tmux-webui, is attached to the session group; dim gray means there is
  no active frontend. Neutral Codex and Terminal marks use the same blue
  outline and background glow instead of changing their brand color.
- **Bottom-right dot:** green/pulsing (`#9ece6a`) means **running**; amber
  (`#e0af68`) means **explicitly waiting for a user response**, such as a
  permission or elicitation prompt. A normally completed turn, a stopped
  agent, or an agent whose exact status is unknown has no status dot.

These signals can differ: a detached agent can still be running, and an agent
visible in a browser can be waiting for a response. The sidebar refreshes both
within 5 seconds. Hovering a badge shows its agent, work status, and frontend
presence.

See [Agent status badges](docs/agent-status.md) for the complete behavior
matrix, detection limits, and setup. Hook/plugin-reported status requires tmux
≥ 3.0; agent identification, frontend presence, and Codex's limited title
fallback use the project's normal tmux ≥ 2.2 requirement. Install all supported
status integrations without replacing existing hooks:

```bash
node scripts/install-agent-status.mjs codex claude pi kimi opencode
```

### System resource meters

The bottom edge of the session sidebar stays pinned to two host-wide gauges:
CPU activity and RAM usage. They refresh every 3 seconds while you are logged
in. CPU is averaged across all logical cores over the sampling window; on
Linux, RAM uses `MemAvailable` so reclaimable filesystem cache is not reported
as occupied memory. Other platforms fall back to Node's available-memory
reading. The `/api/resources` data is protected by the same login as sessions.

### Coding plan usage (optional)

Set `TMUX_WEBUI_USAGE_PROVIDERS=codex,claude-quota` to add a sidebar widget
showing your coding-plan usage, similar to OpenUsage:

- **`codex`** reads the newest `rate_limits` snapshot from
  `~/.codex/sessions/**/rollout-*.jsonl` on the server — local file parsing
  only, no network, no credentials: real quota percentages with reset
  countdowns and your plan type. Snapshots whose reset window already passed
  are marked expired instead of being shown as live.
- **`claude-quota`** (shown as "Claude Code"; a different trust trade-off):
  Claude keeps no quota data on disk, so this provider reads the OAuth token
  from `~/.claude/.credentials.json` and asks Anthropic's usage endpoint for
  the official 5-hour and weekly percentages. Listing it in the allowlist is
  explicit consent to both reading that credential file and the outbound
  HTTPS request to `api.anthropic.com`. The token never reaches the browser
  or the logs; only percentages and reset times are returned. Expired tokens
  are reported as an error — the provider never refreshes tokens itself.

The feature is off by default; providers not listed in the allowlist are never
read from disk. The settings dialog's display toggles (or clicking a provider's
name in the widget) hide a provider entirely — display-only, stored in the
browser. `/api/usage` sits behind the same login as everything else.

### The service, if you want to write it yourself

`--systemd` writes `~/.config/systemd/user/tmux-webui.service`, runs
`systemctl --user enable --now tmux-webui`, and enables lingering. The
equivalent by hand:

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
loginctl enable-linger "$USER"   # required, or the service dies when you log out
```

Two lines that are easy to get wrong:

- **`KillMode=process`** — creating a session from the UI starts the tmux
  server as a child of this service if it was not already running. Under the
  default `control-group`, restarting tmux-webui would then kill the tmux
  server and every session in it.
- **`loginctl enable-linger`** — without it a user service stops when you log
  out, so it never survives a reboot.

### Updating

The sidebar shows the version you are running. When a newer release exists it
says so and offers an **Update** button. On phones the same notice also appears
in the top bar, so it stays visible while the session drawer is closed. The
server starts the update in a separate tmux session (`tmux-webui-update`) and
the UI switches to it, so you watch it run. It has to be a separate session —
the update restarts the service, which would otherwise kill the process
performing it.
The completed output is retained; the server automatically replaces that
finished session on the next update, so you do not need to delete it manually.
**One-click updates require a service installed by this checkout's
`install.sh --systemd`.** If the unit is missing or points at another clone,
the update fails explicitly before changing the checkout.

The same thing from a shell:

```bash
./scripts/update.sh
```

It fetches, shows you the commits you are about to get, asks for confirmation,
checks out the latest **stable release tag from the remote**, reinstalls,
rebuilds, and restarts the systemd service for this directory. Even when the
checkout is already at the target tag, it reinstalls, rebuilds, and restarts to
recover from an interrupted previous update. It prints “complete” only after
the restarted service has remained active across consecutive checks.

Add `--yes` to skip the prompt (required when there is no terminal). Automated
mode requires a systemd service that points at this checkout. Interactive mode
can still build without one, but clearly reports that the current process has
not been restarted instead of claiming a complete update.

Tracking releases is deliberate: the sidebar notice compares your version
against the latest GitHub release, so updating to anything else would leave the
version it names and the code you run out of step. To follow `main` instead —
picking up commits that have not been released yet — use `./scripts/update.sh
--main`.

The script refuses to run with uncommitted changes rather than overwriting
them. The sidebar tells you when a newer release exists — see
[Update notification](#update-notification).

## Mobile

Optimized for phones (shown on touch devices / narrow screens):

- **Touch scrolling** with inertia. Works both for TUIs that use mouse
  tracking (Claude Code, htop, …— swipes are delivered as terminal scroll
  events, same bytes as a desktop mouse wheel) and for plain shells
  (scrolls the xterm scrollback).
- **Input bar** above the system keyboard: a key row (`Esc` `Tab` `^C` `↑`
  `↓` `⏎` `⌫` `Mode`) plus a text box that grows with its content. Enter
  delivers the text into the terminal without submitting it — it lands in the
  TUI's own prompt where you can still edit it; tap `⏎` when you want to
  submit. With the box empty, Enter is a plain terminal Enter. Shift+Enter
  inserts a newline. Text goes through the system IME, so voice and swipe
  input work reliably. `⌫` repeats while held; `Mode` sends Shift+Tab, which
  cycles Claude Code's mode.
- **Image upload**: the `Img` button opens the photo picker, uploads the
  image to the server (`TMUX_WEBUI_UPLOAD_DIR`) and inserts its file path
  into the input box — mention it in a message and Claude Code will read
  the image from that path. Managed uploads are private to the service user,
  expire after 7 days by default, and share a configurable 512 MiB quota.
- The layout shrinks when the soft keyboard opens, keeping the session
  sidebar toggle and window tabs reachable.

## Configuration

Three sources, highest priority first:

1. Real environment variables
2. A `.env` file in the working directory (optional, see `.env.example`)
3. `~/.tmux-webui/config.json` — written by `tmux-webui init`, mode `0600`

`config.json` is a flat JSON object using the same key names as the environment
variables, e.g. `{"TMUX_WEBUI_PORT": 9000}`. In `.env`, no variable expansion is
performed, so `$` inside bcrypt hashes is kept as-is — wrapping values in single
quotes is recommended.

| Variable | Default | Description |
|---|---|---|
| `TMUX_WEBUI_PASSWORD_HASH` | required | bcrypt hash of the access password, set by `tmux-webui init` |
| `TMUX_WEBUI_HOST` | `127.0.0.1` | listen address |
| `TMUX_WEBUI_PORT` | `8090` | listen port |
| `TMUX_WEBUI_SOCKET` | (default socket) | `tmux -L` socket name |
| `TMUX_WEBUI_SESSION_TTL_MS` | 7 days | login session lifetime |
| `TMUX_WEBUI_COOKIE_SECURE` | `false` | set to `true` behind an HTTPS reverse proxy |
| `TMUX_WEBUI_SESSION_FILE` | `~/.tmux-webui/sessions.json` | session token persistence path (survives restarts); empty string disables |
| `TMUX_WEBUI_UPLOAD_DIR` | `~/.tmux-webui/uploads` | where uploaded images are saved |
| `TMUX_WEBUI_UPLOAD_RETENTION_MS` | 7 days | remove managed uploads older than this before accepting a new image |
| `TMUX_WEBUI_UPLOAD_MAX_BYTES` | 512 MiB | total managed-upload quota; a full store rejects new uploads with HTTP 507 |
| `TMUX_WEBUI_UPDATE_CHECK` | `true` | set to `false` to never contact GitHub for release info |
| `TMUX_WEBUI_USAGE_PROVIDERS` | (empty = off) | comma-separated coding-plan usage providers to show in the sidebar (`codex`, `claude-quota`) |

### Update notification

Once logged in, the server checks the latest GitHub release at most once every
6 hours and shows a link in the sidebar, plus a compact top-bar notice on
phones, when a newer version exists. It never installs anything on its own —
updating happens when you press the button. The check is the only outbound
request this server makes; set `TMUX_WEBUI_UPDATE_CHECK=false` to disable it.

## Security Notes

A browser terminal means full shell access. **Never** expose this service
directly to the public internet:

- Keep the default `127.0.0.1` listen address; access it via Tailscale or a
  reverse proxy with HTTPS
- Set `TMUX_WEBUI_COOKIE_SECURE=true` behind a TLS-terminating proxy
- The app sends a restrictive CSP plus clickjacking, MIME-sniffing, and
  referrer-policy headers. HSTS belongs on the TLS reverse proxy, because the
  app's default listener is plain loopback HTTP
- WebSocket message size, pre-terminal buffering, and slow-client output are
  bounded. Oversized or backpressured connections are closed instead of
  consuming memory without limit
- The upload directory and managed files are forced to modes `0700` and
  `0600`. Expiry cleanup ignores symlinks and unrelated files
- The Update button runs `scripts/update.sh` from the directory the server was
  started from. The command is fixed and takes nothing from the request — no
  branch, ref, or path — so an authenticated client cannot make it run anything
  else. It is unavailable when that script is missing
- There is no default password: the server refuses to start until
  `TMUX_WEBUI_PASSWORD_HASH` is set
- Binding to a non-loopback address prints a startup warning — it is not a
  supported configuration on an untrusted network

## Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| `未找到 tmux 命令` (exits immediately) | tmux is not on `PATH` | install tmux, then start the server again |
| `TMUX_WEBUI_PASSWORD_HASH 未设置` | no password configured yet | run `init` (see [Quick Start](#quick-start)) |
| `端口 8090 已被占用` | another process holds the port | set `TMUX_WEBUI_PORT`, or stop that process |
| `没有权限监听 …` | port below 1024 without privileges | use a port ≥ 1024 and reverse-proxy to it |
| `init 需要交互式终端` | `init` ran without a TTY | use `--password-stdin`, see [Non-interactive setup](#non-interactive-setup-ci-config-management-ai-agents) |
| `gyp ERR!` during `npm install` | no C++ toolchain for `node-pty` | install `python3`, `make`, and a compiler — see [Prerequisites](#prerequisites) |
| Blank page, `404` on `/assets/…` | frontend was never built | run `npm run build` |
| `tmux server 未运行` (503 in the UI) | tmux is installed but no session exists | start one: `tmux new -d -s main` |
| Login always fails | the stored hash does not match the password | rerun `init`; note that config precedence is env > `.env` > `config.json` |
| Service is gone after a reboot or logout | lingering was never enabled | `loginctl enable-linger "$USER"` |
| Restarting tmux-webui killed your tmux sessions | the unit lacks `KillMode=process` | add it and `systemctl --user daemon-reload` |

## Testing

```bash
npm run typecheck              # backend + test TypeScript projects
npm run lint                   # Biome lint
npm run format:check           # formatting gate
npm run check:deadcode         # unused files, exports, and dependencies
npm run check:shell            # ShellCheck (requires shellcheck installed)
npm run build                  # required before backend tests
npm run test:coverage          # backend unit/integration + coverage gate
npm --prefix web run test:coverage # frontend unit + coverage gate
npm run test:e2e               # Playwright end-to-end
```

## Contributing

See the [Development Guide](docs/development.md) for the branch workflow and
code conventions. Maintainers can also use the
[Project status and roadmap](docs/project-roadmap.md) to understand the current
engineering baseline, product position, and recommended execution order.

## License

[MIT](LICENSE)
