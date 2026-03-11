#!/usr/bin/env bash
# Run browser visual/interaction tests inside a Docker container to ensure
# consistent font rendering across macOS and Linux (CI).
#
# Usage:
#   bash scripts/run-browser-tests-docker.sh [mode]
#
# Modes:
#   visual          — run visual baseline comparison
#   visual:update   — regenerate visual baselines
#   interaction     — run interaction regression tests
#   all             — run visual + interaction (default)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODE="${1:-all}"
IMAGE_NAME="wafflebase-playwright"
NM_VOLUME="wafflebase-playwright-nm"

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------

if ! command -v docker &>/dev/null; then
  echo "[docker-browser] ERROR: Docker is not installed or not in PATH."
  echo "[docker-browser] Install Docker Desktop: https://www.docker.com/products/docker-desktop"
  exit 1
fi

if ! docker info &>/dev/null; then
  echo "[docker-browser] ERROR: Docker daemon is not running."
  exit 1
fi

# ---------------------------------------------------------------------------
# Validate Playwright version match
# ---------------------------------------------------------------------------

DOCKERFILE_VERSION=$(sed -n 's/.*playwright:v\([0-9.]*\).*/\1/p' "$REPO_ROOT/Dockerfile.playwright")
PKG_VERSION=$(node -e "
  const pkg = require('$REPO_ROOT/packages/frontend/package.json');
  const v = (pkg.devDependencies || {}).playwright || '';
  console.log(v.replace(/^[\\^~]/, ''));
")

if [ -n "$DOCKERFILE_VERSION" ] && [ -n "$PKG_VERSION" ] && [ "$DOCKERFILE_VERSION" != "$PKG_VERSION" ]; then
  echo "[docker-browser] WARNING: Playwright version mismatch!"
  echo "  Dockerfile.playwright: $DOCKERFILE_VERSION"
  echo "  package.json:          $PKG_VERSION"
  echo "  Update Dockerfile.playwright to match package.json."
  exit 1
fi

# ---------------------------------------------------------------------------
# Build Docker image
# ---------------------------------------------------------------------------

echo "[docker-browser] Building Docker image..."
docker build -t "$IMAGE_NAME" -f "$REPO_ROOT/Dockerfile.playwright" "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Determine command based on mode
# ---------------------------------------------------------------------------

case "$MODE" in
  visual)
    DOCKER_CMD="node ./scripts/verify-browser-lanes.mjs"
    DOCKER_ENV="-e WAFFLEBASE_DOCKER_BROWSER=true"
    ;;
  visual:update)
    DOCKER_CMD="node ./packages/frontend/scripts/verify-visual-browser.mjs"
    DOCKER_ENV="-e WAFFLEBASE_DOCKER_BROWSER=true -e UPDATE_VISUAL_BROWSER_BASELINE=true"
    ;;
  interaction)
    DOCKER_CMD="node ./packages/frontend/scripts/verify-interaction-browser.mjs"
    DOCKER_ENV="-e WAFFLEBASE_DOCKER_BROWSER=true"
    ;;
  all)
    DOCKER_CMD="node ./scripts/verify-browser-lanes.mjs"
    DOCKER_ENV="-e WAFFLEBASE_DOCKER_BROWSER=true"
    ;;
  *)
    echo "[docker-browser] Unknown mode: $MODE"
    echo "  Valid modes: visual, visual:update, interaction, all"
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Run container
# ---------------------------------------------------------------------------

# Host node_modules contains macOS-only native bindings (e.g. @rollup/rollup-
# darwin-arm64). Named volumes shadow each node_modules directory so pnpm
# install inside the container produces Linux-native bindings without touching
# the host. The named volume is reused across runs for fast subsequent starts.

echo "[docker-browser] Running browser tests (mode=$MODE)..."
# shellcheck disable=SC2086
docker run --rm \
  -v "$REPO_ROOT:/workspace" \
  -v "${NM_VOLUME}-root:/workspace/node_modules" \
  -v "${NM_VOLUME}-sheet:/workspace/packages/sheet/node_modules" \
  -v "${NM_VOLUME}-frontend:/workspace/packages/frontend/node_modules" \
  -v "${NM_VOLUME}-backend:/workspace/packages/backend/node_modules" \
  $DOCKER_ENV \
  "$IMAGE_NAME" \
  bash -c "pnpm install --frozen-lockfile && $DOCKER_CMD"

echo "[docker-browser] Done."
