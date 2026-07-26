# Development Guide

## Branching & Merge Workflow

- `main` is the stable branch. **Never commit directly to `main`.**
- Every feature / fix gets its own branch, cut from the latest `main`:
  - Naming: `<type>/<short-description>`, e.g. `feat/desktop-sidebar-collapse`, `fix/emoji-width`.
- When done, push the branch and open a PR targeting `main`.
- Merge to `main` only after the PR is approved, then delete the feature branch.
- One branch, one concern: don't stack unrelated feat commits on a fix branch.

## Commit Convention

Use conventional commit messages:

```
<type>: <description>
```

Types: `feat` / `fix` / `refactor` / `docs` / `test` / `chore` / `perf` / `ci`.

## Code Requirements

- New features are developed test-first (TDD); target 80%+ coverage on new code.
- Before committing: no leftover `console.log`, no hardcoded secrets (use environment variables), validate external input.
- Keep files small and focused (typically 200–400 lines), organized by feature.

## Local Checks

```bash
cd web
npx vitest run    # unit tests
npx tsc --noEmit  # type check
```
