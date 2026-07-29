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

```bash
./scripts/update.sh
```

It fetches, shows you the commits you are about to get, asks for confirmation,
checks out the **latest release tag**, reinstalls, rebuilds, and restarts the
systemd service if one points at this directory. Add `--yes` to skip the prompt
(required when there is no terminal).

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
  the image from that path.
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
| `TMUX_WEBUI_UPDATE_CHECK` | `true` | set to `false` to never contact GitHub for release info |

### Update notification

Once logged in, the server checks the latest GitHub release at most once every
6 hours and shows a link in the sidebar when a newer version exists. It never
installs anything — run [`./scripts/update.sh`](#updating) when you want it. The
check is the only outbound request this server makes; set
`TMUX_WEBUI_UPDATE_CHECK=false` to disable it.

## Security Notes

A browser terminal means full shell access. **Never** expose this service
directly to the public internet:

- Keep the default `127.0.0.1` listen address; access it via Tailscale or a
  reverse proxy with HTTPS
- Set `TMUX_WEBUI_COOKIE_SECURE=true` behind a TLS-terminating proxy
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
npm test                  # backend unit + integration (isolated tmux socket)
npm --prefix web test     # frontend unit
npm run test:e2e          # Playwright end-to-end
```

## Contributing

See the [Development Guide](docs/development.md) for the branch workflow and
code conventions.

## License

[MIT](LICENSE)
