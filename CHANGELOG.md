# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-07-28

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
- `tmux-webui` CLI with `init`, `help`, and `version` subcommands; published to
  npm so it runs via `npx tmux-webui`.
- Configuration from environment variables, a `.env` file, or
  `~/.tmux-webui/config.json` (written by `init` with mode `0600`).
- Startup warning when bound to a non-loopback address.

[Unreleased]: https://github.com/Aquabet/tmux-webui/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Aquabet/tmux-webui/releases/tag/v0.1.0
