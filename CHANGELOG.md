# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versions walk the digits of π: `3.1.0` → `3.14.0` → `3.141.0` → `3.1415.0`,
with patches incrementing the last position (`3.1.1`, `3.1.2`). See
[CLAUDE.md](CLAUDE.md#版本号) for the rules.

## [Unreleased]

## [3.1.6] - 2026-07-30

### Fixed

- Codex sessions now stay visibly active while their terminal activity spinner
  is running, even when an older hook event still says idle.
- Switching browser terminals refreshes foreground indicators immediately when
  the new tmux attachment starts or the old connection closes, instead of
  waiting for the session polling interval.
- One-click updates now recover the Node.js path from the running systemd
  service, rebuild an already-checked-out release after an interrupted update,
  choose only current stable tags from the remote, and report dependency,
  build, or restart failures instead of claiming success.
- Completed update sessions retain their output without blocking the next
  update. The next click safely replaces a finished updater while preserving
  unrelated user sessions with the same name.

## [3.1.5] - 2026-07-30

### Added

- The desktop session sidebar can now be resized from 64 to 480 pixels and
  remembers its width. At its narrowest it becomes an icon-only rail while
  retaining session names in hover and accessibility labels; the mobile drawer
  keeps its existing behavior.
- The session sidebar now shows pinned CPU activity and RAM usage gauges,
  refreshed every 3 seconds from a new authenticated resource endpoint.

## [3.1.4] - 2026-07-29

### Fixed

- Phones now show a compact new-version notice and Update button in the top
  bar, so updates remain visible while the session drawer is closed. The notice
  stays hidden on desktop and when the server is already up to date.

## [3.1.3] - 2026-07-29

### Fixed

- Playwright MCP screenshots, page snapshots, and other generated files no
  longer make the working tree appear dirty and block `scripts/update.sh`.
  Genuine uncommitted changes still stop the update before checkout.
- Repeated E2E runs reliably reset their dedicated tmux server instead of
  racing the previous server's socket shutdown.

## [3.1.2] - 2026-07-29

### Added

- The session sidebar identifies Codex, Claude Code, Pi, Kimi Code, and
  OpenCode with distinct icons, falling back to a Terminal icon. Icon brightness
  shows whether the session has an active foreground, independently from the
  lower-right work-state light: green and animated while running, amber while
  waiting for input, and gray-blue when exact status is unavailable.
- Agent detection follows pane process trees so wrapper commands work, and
  treats attached tmux-webui grouped views as active foregrounds.
- `scripts/install-agent-status.mjs` installs lifecycle status integrations for
  all supported agents without replacing unrelated user hooks. English and
  Chinese setup guides document behavior, privacy boundaries, and manual
  configuration.

### Fixed

- Claude Code hooks recover their pane from the parent process tree when Claude
  does not preserve `TMUX_PANE`.
- Per-agent status storage and outer-agent ownership prevent a nested agent from
  overwriting its host agent's state and leaving a gray unknown light behind.
- Re-running the status installer repairs hook commands that point at an old
  tmux-webui checkout, including its managed Kimi configuration block.

## [3.1.1] - 2026-07-29

### Added

- The sidebar always shows the running version. When a newer release exists it
  says so and offers an Update button, which runs the update in a separate
  `tmux-webui-update` session and switches the UI to it. The command is fixed
  and takes nothing from the request; the button is absent when
  `scripts/update.sh` is not present.
- `scripts/update.sh`: checks out the latest release tag (`--main` to follow the
  branch instead), reinstalls, rebuilds, and restarts the systemd service that
  points at this directory. Refuses to run with uncommitted changes.

### Fixed

- Mobile: with no tmux sessions the sidebar toggle was not rendered, leaving no
  way to open the drawer and therefore no way to create a session.
- `scripts/install.sh` now writes a service unit with `KillMode=process`.
  Without it, restarting tmux-webui could kill a tmux server that had been
  started as its child, taking every session with it.
- Both scripts use `npm ci` instead of `npm install`, which was rewriting
  `package-lock.json` and leaving the working tree dirty.

## [3.1.0] - 2026-07-28

First public release.

### Added

- Browser terminal for tmux with two-level navigation: session sidebar and
  window tabs. The browser view uses a tmux grouped session, so it never
  disturbs clients attached on the machine.
- Fully interactive terminal (xterm.js) over WebSocket, including mouse
  tracking, resize, and scrollback history on attach.
- Password authentication (bcrypt) with rate limiting and login sessions that
  survive a server restart.
- Session and window management: create, rename, and kill from the UI.
- Mobile support: inertial touch scrolling, an input bar above the soft
  keyboard with `Esc` `Tab` `^C` `↑` `↓` `⏎` `⌫` `Mode` keys, system-IME text
  entry (voice and swipe input work), and image upload that inserts the saved
  path into the input.
- Collapsible sidebar with persisted state.
- `tmux-webui` CLI with `init`, `help`, and `version` subcommands.
- Configuration from environment variables, a `.env` file, or
  `~/.tmux-webui/config.json` (written by `init` with mode `0600`).
- Startup warning when bound to a non-loopback address.
- Update notification: the server checks the latest GitHub release (at most
  once every 6 hours, behind auth) and links to it from the sidebar. It never
  installs anything; `TMUX_WEBUI_UPDATE_CHECK=false` disables the check.

[Unreleased]: https://github.com/Aquabet/tmux-webui/compare/v3.1.6...HEAD
[3.1.6]: https://github.com/Aquabet/tmux-webui/compare/v3.1.5...v3.1.6
[3.1.5]: https://github.com/Aquabet/tmux-webui/compare/v3.1.4...v3.1.5
[3.1.4]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.4
[3.1.3]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.3
[3.1.2]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.2
[3.1.1]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.1
[3.1.0]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.0
