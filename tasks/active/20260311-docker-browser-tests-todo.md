---
title: Docker-based browser visual test environment
created: 2026-03-11
---

# Docker-Based Browser Visual Test Environment

## Goal

Unify browser visual/interaction test rendering across macOS (local) and
Ubuntu (CI) using a Docker container with consistent font rendering.

## Tasks

- [x] Create `Dockerfile.playwright` with Playwright official image
- [x] Create `scripts/run-browser-tests-docker.sh` wrapper script
- [x] Modify `scripts/verify-browser-lanes.mjs` to skip Chromium check in Docker
- [x] Modify `packages/frontend/scripts/verify-visual-browser.mjs` to warn on non-Docker baseline updates
- [x] Add npm scripts to `packages/frontend/package.json`
- [x] Add `verify:browser:docker` to root `package.json`
- [x] Add `verify-browser` job to `.github/workflows/ci.yml`
- [x] Update `CLAUDE.md` with Docker test command
- [x] Update `design/harness-engineering.md` with Phase 23 documentation
- [ ] Regenerate baselines in Docker (deferred: requires Docker runtime)
- [ ] Verify Docker tests pass (deferred: requires Docker runtime)

## Review

All infrastructure files created. Baseline regeneration requires running
`bash scripts/run-browser-tests-docker.sh visual:update` with Docker.
