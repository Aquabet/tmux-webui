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

```bash
npm install && npm --prefix web install
cp .env.example .env
npm run hash-password -- your-password   # generate a hash, paste it into .env
npm run build && npm start               # http://127.0.0.1:8090
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
  `↓` `⏎`) plus a text box that grows with its content. Enter sends,
  Shift+Enter inserts a newline; text goes through the system IME, so voice
  and swipe input work reliably.
- **Image upload**: the `Img` button opens the photo picker, uploads the
  image to the server (`TMUX_WEBUI_UPLOAD_DIR`) and inserts its file path
  into the input box — mention it in a message and Claude Code will read
  the image from that path.
- The layout shrinks when the soft keyboard opens, keeping the session
  sidebar toggle and window tabs reachable.

## Configuration (.env or environment variables)

On startup the server reads a **`.env` file from the working directory**
(optional, see `.env.example`); real environment variables take precedence over
`.env`. No variable expansion is performed, so `$` inside bcrypt hashes is kept
as-is — wrapping values in single quotes is recommended.

| Variable | Default | Description |
|---|---|---|
| `TMUX_WEBUI_PASSWORD_HASH` | required | bcrypt hash, generate with `npm run hash-password` |
| `TMUX_WEBUI_HOST` | `127.0.0.1` | listen address |
| `TMUX_WEBUI_PORT` | `8090` | listen port |
| `TMUX_WEBUI_SOCKET` | (default socket) | `tmux -L` socket name |
| `TMUX_WEBUI_SESSION_TTL_MS` | 7 days | login session lifetime |
| `TMUX_WEBUI_COOKIE_SECURE` | `false` | set to `true` behind an HTTPS reverse proxy |
| `TMUX_WEBUI_SESSION_FILE` | `~/.tmux-webui/sessions.json` | session token persistence path (survives restarts); empty string disables |
| `TMUX_WEBUI_UPLOAD_DIR` | `~/.tmux-webui/uploads` | where uploaded images are saved |

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
