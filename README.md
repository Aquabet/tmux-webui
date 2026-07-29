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

Requires **Node.js ≥ 20** and **tmux** on the same machine.

```bash
npx tmux-webui init   # set the access password (stored hashed in ~/.tmux-webui/config.json)
npx tmux-webui        # http://127.0.0.1:8090
```

Or install it once: `npm install -g tmux-webui`, then `tmux-webui`.

`tmux-webui help` lists all subcommands and environment variables.

### From source

```bash
git clone https://github.com/Aquabet/tmux-webui.git && cd tmux-webui
npm install && npm --prefix web install
npm run build
node dist/main.js init && node dist/main.js
```

Development mode: `npm run dev` (backend) + `npm --prefix web run dev`
(frontend on port 5173, with automatic proxying).

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
installs anything — update with `npm update -g tmux-webui` (or `git pull` for a
source checkout). The check is the only outbound request this server makes; set
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
