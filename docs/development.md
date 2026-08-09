# Development Guide

## Branching & Merge Workflow

- `main` is the stable branch. **Never commit directly to `main`.**
- Every feature / fix gets its own branch, cut from the latest `main`:
  - Naming: `<type>/<short-description>`, e.g. `feat/desktop-sidebar-collapse`, `fix/emoji-width`.
- When done, push the branch and open a PR targeting `main`.
- **Merge only once CI is green.** Wait for every check to finish and pass
  (`gh pr checks <number>`) before merging, then delete the feature branch.
  Passing tests locally is not a substitute: leftover build output in your
  working tree can produce a false green, which has already happened once in
  this repo. Fix a red CI rather than bypassing it.
- One branch, one concern: don't stack unrelated feat commits on a fix branch.

## Commit Convention

Use conventional commit messages:

```
<type>: <description>
```

Types: `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf` / `ci`.

## Versioning

Versions walk the digits of π rather than incrementing the usual way:

- Start: `3.1.0`
- Patch (bugfix, docs): bump the last position — `3.1.1`, `3.1.2`, …
- Major (features, breaking changes): take π's next digit in the middle
  position — `3.1` → `3.14` → `3.141` → `3.1415` → `3.14159`, resetting the
  patch position to `0`

Tags are plain versions — `v3.1.0`, or bare `3.1.0`; either triggers
`release.yml`, which builds a GitHub Release. The `version` field in
`package.json` must match the tag (minus the optional `v`), or the workflow
fails the release.

Because the integer part is always `3`, semver tooling reads these "major"
releases as minor bumps. That is intentional.

## Code Requirements

- New features are developed test-first (TDD); target 80%+ coverage on new code.
- Before committing: no leftover `console.log`, no hardcoded secrets (use environment variables), validate external input.
- Keep files small and focused (typically 200–400 lines), organized by feature.

## Local Checks

```bash
npm run typecheck               # backend + test TypeScript projects
npm run lint                    # Biome lint
npm run format:check            # formatting gate
npm run check:deadcode          # unused files, exports, and dependencies
npm run check:shell             # ShellCheck; requires the shellcheck binary
npm run build                   # must run BEFORE backend tests, see below
npm run test:coverage           # backend tests + coverage floor
npm --prefix web run test:coverage # frontend tests + coverage floor
npm run test:e2e                # Playwright (installs browsers separately)
```

`npm run build` has to come before `npm test`: static assets are only mounted
when `web/dist` exists, and the cache-header test in `tests/server.test.ts`
depends on the build output. CI uses this order and also runs the static,
coverage, dependency-audit, and browser E2E gates in clean jobs.

Biome intentionally skips generated npm lockfiles, archived design notes under
`docs/superpowers`, and local `.remember` agent state. Those files are either
machine-generated or outside the maintained source/documentation surface.

## Documentation

`README.md` and `README.zh-CN.md` are kept in sync. Any change to behavior,
CLI flags, environment variables, or prerequisites must land in both.

Agent-facing notes live in [CLAUDE.md](../CLAUDE.md) and
[AGENTS.md](../AGENTS.md).
