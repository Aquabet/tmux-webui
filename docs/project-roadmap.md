# Project status and roadmap

[中文](project-roadmap.zh-CN.md)

This document records the project's engineering status, product position, and
recommended execution order as of **2026-08-08**. It is a maintainer roadmap,
not a promise that every listed feature will ship. Recheck time-sensitive facts
such as dependency advisories and competing products before starting a phase.

## Executive summary

tmux-webui is a usable first release rather than a prototype. It already has a
security-conscious local deployment model, a tested tmux view lifecycle, a
mobile terminal experience, persistent login sessions, agent status badges,
and a recoverable self-update path.

The next step should not be generic terminal feature parity. Established tools
already cover that space, while agent-focused products are rapidly adding
worktree management, diff review, sandboxes, and structured agent interfaces.
tmux-webui should stay narrower:

> A private, zero-migration mobile companion for existing tmux sessions, with
> an optional inbox for coding agents that need attention.

That position preserves the project's strongest properties: it works with
sessions the user already owns, does not replace tmux, does not inspect agent
transcripts, and keeps remote access behind the user's existing private network
or TLS proxy.

## Current state

The following snapshot was verified for version `3.1.8`.

| Area | Evidence | Assessment |
|---|---|---|
| Type safety | Strict TypeScript; backend and test type checks pass | Strong |
| Production build | Backend compilation and Vite production build pass | Strong |
| Backend tests | 222 tests across 25 files pass; 85.62% line coverage | Strong |
| Frontend tests | 86 tests across 13 files pass | Strong |
| Browser tests | 6 Playwright scenarios pass against a real isolated tmux server and run in CI | Strong |
| CI | Node 20/22 tests plus quality, coverage, audit, and Chromium E2E jobs | Strong |
| Release operations | Tagged GitHub releases, update checks, and recoverable self-update flow | Strong |
| Quality gates | Biome, Knip, ShellCheck, and measured backend/frontend coverage floors | Strong |
| Adoption signal | No open issues or pull requests; external usage has not been validated | Unknown |

The test total is 314: 222 backend, 86 frontend, and 6 browser tests. Coverage
floors are set from the measured `3.1.8` baseline and enforced in CI so later
changes cannot silently reduce them.

## Architecture that should remain stable

```text
Browser
  |-- authenticated HTTP --> Express API --> tmux commands / host resources
  `-- authenticated WS ----> node-pty ----> grouped tmux view
                                      `----> existing user session

Agent lifecycle hooks/plugins
  `-- small tmux pane options --> session listing --> sidebar badges
```

The architecture makes several good trade-offs:

- A browser connection creates a temporary grouped tmux session. It can select
  windows and resize independently without disturbing an attached local client.
- Terminal bytes pass through WebSocket and PTY layers. The server does not
  reinterpret shell commands or agent conversations.
- Agent integrations report small lifecycle states through tmux options. They
  do not read prompts, terminal output, transcripts, or credentials.
- Configuration is loaded in one place and external values are validated.
- Self-update accepts no branch, ref, path, or command from the HTTP request.
  The fixed updater verifies that systemd points at the current checkout before
  changing it.

These constraints are part of the product, not implementation accidents. New
features should preserve them unless a separate design review explicitly
changes the trust model.

## Strengths to build on

### Existing tmux sessions remain the source of truth

Users do not need to migrate sessions into a project-specific orchestrator.
Local tmux clients and browser views can coexist, and closing the browser does
not terminate the underlying work.

### Mobile interaction solves real terminal problems

The native input bar supports system IMEs, voice input, swipe input, terminal
control keys, repeatable backspace, and image-path insertion. Touch scrolling
handles both normal scrollback and TUIs that enable mouse tracking.

### Failure handling is unusually deliberate for an early project

The frontend reconnects WebSocket sessions with bounded exponential backoff.
The installer checks prerequisites before dependency installation. The updater
distinguishes build, service, and restart failures and does not claim success
until the restarted service stays active.

### Security defaults match the consequence of the product

The default listener is `127.0.0.1`. Login uses bcrypt, rate limiting, a
random session token, and an HttpOnly `SameSite=Strict` cookie. WebSocket
connections require a valid session and reject a mismatched browser Origin.

## Remaining gaps before broader adoption

Version `3.1.8` closed the known dependency advisories, moved browser tests and
static quality checks into CI, bounded WebSocket buffering, hardened upload
storage, and added explicit HTTP security headers. Dependabot now keeps both
npm workspaces under regular review.

### Documentation and interface language differ

The project maintains English and Chinese README files, but most visible UI
strings are Chinese. This is acceptable for a Chinese-first product, but it is
an adoption barrier if the English README remains a supported entry point.

## Product position

Generic web terminals such as [ttyd](https://github.com/tsl0922/ttyd) already
offer broad platform support, packaged installation, TLS options, file
transfer, and terminal rendering features. Agent-oriented products such as
[Agent of Empires](https://github.com/agent-of-empires/agent-of-empires),
[Agentboard](https://github.com/gbasin/agentboard), and
[Coder Mux](https://github.com/coder/mux) already pursue worktree management,
diff review, agent orchestration, remote hosts, and structured agent views.

Copying those products feature by feature would expand the security boundary
and erase tmux-webui's simplicity. The recommended wedge is:

- **Existing sessions first.** Attach to what the user already runs.
- **Private by default.** Keep loopback binding and external TLS/private
  networking as hard requirements.
- **Content-blind status.** Prefer lifecycle hooks and process identity over
  transcript parsing.
- **Mobile attention loop.** Make it fast to see which session needs a human,
  jump into it, respond, and leave.
- **Small operational footprint.** Preserve a single-user, single-host model
  until usage proves that a larger trust model is worth its cost.

## Roadmap

### Phase 0: `3.1.8` security and quality baseline

**Status: completed on 2026-08-08.** This is a maintenance release with no new
product surface.

#### P0.1 Update dependencies

Scope:

- Upgrade Express/body-parser to a fixed production dependency graph.
- Upgrade Vite, Vitest, PostCSS, nanoid, and their related plugins together.
- Add an automated dependency update service with grouped frontend-tooling
  updates to avoid noisy single-package pull requests.

Acceptance criteria:

- `npm audit --omit=dev` reports no known production vulnerabilities.
- Full audits report no high or critical findings.
- Type checks, builds, 308 unit/integration tests, and 6 browser tests pass.

#### P0.2 Run browser tests in CI

Scope:

- Add a Chromium Playwright job on one supported Node version.
- Install tmux and the Playwright browser in that job.
- Preserve the isolated `webui-e2e` tmux socket and dedicated port.

Acceptance criteria:

- Pull requests cannot merge when the login-to-terminal path fails.
- The job always tears down its tmux server and does not depend on prior output.

#### P0.3 Bound WebSocket resource use

Scope:

- Define and test an explicit maximum WebSocket message size.
- Limit the number and total bytes of frames queued before PTY setup.
- Close abusive connections with a stable close code and release their view.
- Add output backpressure or a documented bounded policy for slow clients.

Acceptance criteria:

- Oversized input cannot grow server memory without bound.
- Normal terminal paste, resize, window selection, and reconnect behavior still
  pass unit and browser tests.

#### P0.4 Harden image storage

Scope:

- Create the upload directory with owner-only permissions.
- Write uploaded files with owner-only permissions.
- Add configurable retention and a total storage quota.
- Remove expired files without following symlinks or deleting outside the
  configured directory.

Acceptance criteria:

- Tests verify modes, quota rejection, expiry, and path containment.
- Existing PNG, JPEG, WebP, and GIF uploads continue to work.

#### P0.5 Add HTTP security headers

Scope:

- Set a Content Security Policy compatible with xterm and the built assets.
- Deny framing, disable MIME sniffing, and set a conservative referrer policy.
- Document which TLS and HSTS responsibilities remain with the reverse proxy.

Acceptance criteria:

- Server tests assert every header.
- Production terminal rendering, WebSocket connections, and inline SVG icons
  continue to work.

#### P0.6 Add missing quality gates

Scope:

- Configure a TypeScript-aware linter and formatter.
- Add ShellCheck for repository shell scripts.
- Add dead-code detection and measured test coverage.
- Pick thresholds from the current baseline, then prevent regression.

Acceptance criteria:

- The checks run locally through documented commands and in CI.
- Generated output and platform-specific scripts have narrow, explained
  exclusions rather than global disables.

### Phase 1: `3.14.0` agent attention inbox

This phase turns the existing status badges into a focused workflow without
turning tmux-webui into an agent orchestrator.

#### P1.1 Add an attention view

- Sort or filter sessions by `waiting`, `running`, and no reported status.
- Put sessions explicitly waiting for a response first.
- Show the last status transition time, not terminal or prompt content.
- Preserve the ordinary tmux session/window navigation as the default view.

#### P1.2 Add opt-in browser notifications

- Notify only on meaningful transitions into `waiting`.
- Deduplicate repeated hook reports.
- Keep notification text content-blind: agent, session name, and state only.
- Start with notifications while the application is open or backgrounded.
  Closed-app Web Push requires a separate security and key-management design.

#### P1.3 Diagnose agent integrations

- Show whether each provider has recently reported a lifecycle event.
- Distinguish missing integration, stale state, and an idle agent.
- Link directly to the matching setup section in the agent status guide.

#### P1.4 Add session search and keyboard navigation

- Filter sessions and windows without changing tmux names.
- Provide predictable next/previous attention shortcuts.
- Keep all actions accessible on touch devices and to keyboard-only users.

#### P1.5 Localize the interface

- Move visible strings and accessibility labels into a small typed message
  catalog.
- Ship English and Simplified Chinese with browser-language detection and an
  explicit override.
- Keep server error codes stable enough that the client can translate known
  errors without hiding unknown diagnostic messages.

Phase acceptance criteria:

- A user can notice a waiting agent, open the correct session, respond, and
  return to the session list in under three interactions on a phone.
- No feature reads or stores terminal history, prompts, or agent transcripts.
- Notification permission is requested only after an explicit user action.
- All new behavior has frontend tests and at least one browser-level flow.

### Phase 2: distribution and validation

Do this alongside Phase 1 rather than waiting for a large feature release.

#### P2.1 Make the product legible before installation

- Add current desktop and phone screenshots to the README.
- Record a short demo covering login, switching sessions, mobile input, and a
  waiting-agent handoff.
- State the single-host, single-user, private-network position near the top.

#### P2.2 Choose one supported package path

The current Git checkout and systemd installer are reliable but require more
steps than competing tools. Evaluate one primary distribution path first:

- an npm global package that can install and manage the user service, or
- release archives with a small installer that verifies checksums.

Do not add several partially maintained channels at once. The chosen path must
retain prerequisite checks, password-stdin support, safe service ownership,
and verifiable updates.

#### P2.3 Recruit external users

Start with 5 to 10 users who already run tmux and at least one supported coding
agent. Measure:

- installation completion rate and time to first terminal;
- failures caused by Node, node-pty compilation, tmux, systemd, or networking;
- mobile reconnect and input failures;
- how often waiting status leads to a useful response;
- which missing capability prevents continued use.

Prefer direct interviews and issue reports before adding product telemetry to
a tool that exposes shell access.

## Explicit non-goals

These are outside the recommended roadmap unless user evidence changes the
position:

- Direct public-internet exposure.
- Multi-user accounts, role-based access control, or shared terminals.
- Remote SSH host inventory and credential management.
- Git worktree orchestration, built-in agent loops, or Docker sandbox control.
- Transcript parsing, prompt history, or terminal-content indexing.
- A full IDE, editor, or diff-review system.
- Replacing tmux as the owner of sessions, windows, panes, or persistence.

Each item expands the trust boundary enough to require a separate product and
security review, not just another endpoint.

## Recommended execution order

| Order | Deliverable | Why now |
|---|---|---|
| 1 | Dependency upgrades and automated updates | Removes known risk and future maintenance drift |
| 2 | Browser E2E in CI | Protects the real login-to-terminal path |
| 3 | WebSocket, upload, and HTTP hardening | Bounds authenticated abuse and local data exposure |
| 4 | Quality gates | Makes the current clean baseline durable |
| 5 | Attention inbox and notifications | Extends the project's strongest differentiator |
| 6 | UI localization and search | Improves reach and daily navigation |
| 7 | Packaging and external validation | Tests whether the product earns continued investment |

## Decision rule for new ideas

Before adding a roadmap item, ask:

1. Does it make existing tmux sessions easier to use remotely?
2. Does it shorten the mobile loop from “agent needs me” to “I responded”?
3. Can it work without reading terminal content or taking ownership of the
   user's development workflow?
4. Does it preserve loopback-by-default deployment?
5. Can its failure modes be tested without risking the user's real tmux
   sessions?

Ideas that fail several of these checks may still be valuable, but they likely
belong in a different product or require an explicit change in strategy.

## Related documentation

- [README](../README.md): installation, configuration, and user-facing behavior
- [Development guide](development.md): branch, test, release, and documentation rules
- [Agent status badges](agent-status.md): provider detection and lifecycle integrations
- [Design specification](superpowers/specs/2026-07-02-tmux-webui-design.md): original product design
- [Implementation plan](superpowers/plans/2026-07-02-tmux-webui.md): original TDD implementation plan
