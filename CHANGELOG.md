# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Versions walk the digits of π: `3.1.0` → `3.14.0` → `3.141.0` → `3.1415.0`,
with patches incrementing the last position (`3.1.1`, `3.1.2`). See
[CLAUDE.md](CLAUDE.md#版本号) for the rules.

## [Unreleased]

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

[Unreleased]: https://github.com/Aquabet/tmux-webui/compare/v3.1.3...HEAD
[3.1.3]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.3
[3.1.2]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.2
[3.1.1]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.1
[3.1.0]: https://github.com/Aquabet/tmux-webui/releases/tag/v3.1.0
