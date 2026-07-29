# AGENTS.md

Instructions for coding agents working in this repository. Humans: see
[README.md](README.md) and [docs/development.md](docs/development.md).

## What this is

A web terminal for tmux. Anyone who reaches the port and has the password gets
a shell as the user running the server. Treat every change and every
deployment step as security-relevant.

## Deploying it for someone

```bash
npm install && npm --prefix web install
npm run build
printf '%s' "$PASSWORD" | node dist/main.js init --password-stdin
node dist/main.js
```

Requires Node ≥ 20, tmux ≥ 2.2, and — on Linux — `python3`/`make`/a C++
compiler, because `node-pty` has no Linux prebuild and compiles on install.

Rules, in order of importance:

1. **Leave `TMUX_WEBUI_HOST` at `127.0.0.1`.** For remote access set up
   Tailscale or a TLS reverse proxy; never bind the service to a public
   interface.
2. **Never put the password on a command line** (`ps` and shell history expose
   it) and never commit `~/.tmux-webui/config.json`, a password, or a hash.
3. Do not weaken auth, rate limiting, or cookie flags to make something work.
   If auth is in the way, say so instead of removing it.
4. Verify before reporting success: `/api/sessions` returns 401 unauthenticated
   and 200 after login. See "Non-interactive setup" in the README.

Failure modes and their exact messages are in the README's Troubleshooting
table — read it before diagnosing from scratch.

## Changing the code

- Test-first. `npm test` (backend, spawns real tmux on an isolated socket),
  `npm --prefix web test` (frontend), `npm run typecheck`. All must pass.
- Conventional commits (`feat:` / `fix:` / `docs:` / …). Never commit to `main`;
  branch as `<type>/<short-description>` and open a PR.
- Comments explain *why*, in the style already in the file. Existing comments
  are in Chinese — match the surrounding file.
- Config is read in one place (`src/config.ts`); external input is validated
  with zod. Keep it that way.
- Both `README.md` and `README.zh-CN.md` must stay in sync when behavior,
  flags, or requirements change.
