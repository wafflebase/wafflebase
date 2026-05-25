# Docker Publish — native arm64 runners (no QEMU)

## Problem

The v0.4.2 release Docker build hangs and fails. `Docker Publish` runs:

- Previous releases (v0.4.1 / v0.4.0 / v0.3.x): ~2–3 min, success.
- v0.4.2 (run 26367212237): attempt 1 ran exactly 6h (16:54:50 → 22:55:08)
  and was cancelled by GitHub's hard 6-hour job limit; attempt 2 grinding again.

### Root cause

The workflow builds `linux/amd64,linux/arm64` in a single job on an amd64
runner. arm64 is produced via **QEMU emulation**. The `Dockerfile` pins the
**builder** stage to `--platform=$BUILDPLATFORM` (native, fast) but the
**runtime** stage is NOT pinned, so for the arm64 target these run emulated:

- `pnpm install --frozen-lockfile --prod`
- `npx prisma@6.6.0 generate`  ← notoriously slow/hangs under QEMU arm64

Normally these layers are **cache hits** from `cache-from: type=registry,ref=:latest`
(`type=inline`), so the emulated RUNs never execute → ~3 min. The release was
preceded by #294 ("Bump deps", rewrote `pnpm-lock.yaml` 687 lines + 6
package.json) and #295 (version bump, touched lockfile + all package.json),
which **invalidated those cached layers**. The release then executed the arm64
runtime stage emulated for the first time → exceeded the 6h limit. `type=inline`
cache also can't recover (no multi-arch / intermediate-stage caching).

## Fix

Build each platform on a **native runner** (no QEMU), push by digest, merge a
multi-arch manifest. Repo is public → `ubuntu-24.04-arm` is free.

## Tasks

- [ ] Rewrite `.github/workflows/docker-publish.yml`:
  - [ ] `build` matrix: `linux/amd64`→`ubuntu-24.04`, `linux/arm64`→`ubuntu-24.04-arm`
  - [ ] `push-by-digest=true`, export + upload digest artifact per arch
  - [ ] `cache-from/to: type=gha,mode=max,scope=<arch>` (replaces broken inline cache)
  - [ ] `timeout-minutes` safety net on build + merge jobs
  - [ ] `merge` job: download digests, `docker/metadata-action` tags
        (`latest` always; `<release tag>` on release), `buildx imagetools create`
  - [ ] preserve trigger semantics: push→`:latest`, release→`:<tag>` + `:latest`
- [ ] Validate workflow YAML (actionlint if available)
- [ ] `pnpm verify:fast`
- [ ] Self code review over branch diff
- [ ] Open PR; cancel the stuck run 26367212237

## Notes / tradeoffs

- `type=gha` keeps Docker Hub clean (vs `type=registry` cache tags). GHA cache is
  ref-scoped, so release (tag ref) builds get a cold cache and rebuild natively
  (~minutes, acceptable); main pushes reuse their scope and stay fast.
- No `setup-qemu-action` needed — every stage now builds natively.
