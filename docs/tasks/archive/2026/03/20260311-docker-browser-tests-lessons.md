---
title: Docker-based browser visual test environment — lessons
created: 2026-03-11
---

# Lessons

## Playwright Docker Image

- Playwright publishes official Docker images with all browser dependencies
  pre-installed. Using these avoids manual font/dependency setup.
- Version tag in `Dockerfile.playwright` must match `package.json` to avoid
  browser version mismatch errors.

## Host Bind-Mount Strategy

- Bind-mounting the host workspace avoids the need for `COPY`/`pnpm install`
  inside the container, keeping the image lightweight and build fast.
- Must use `--user "$(id -u):$(id -g)"` to prevent root-owned files on host.

## Chromium Detection

- `verify-browser-lanes.mjs` checks for Chromium via `accessSync` on the
  executable path. Inside Docker, the Playwright image bundles Chromium at a
  different path than `node_modules`, so the check must be skipped via
  `WAFFLEBASE_DOCKER_BROWSER=true`.
