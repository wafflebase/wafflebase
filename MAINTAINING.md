# Maintaining Wafflebase

This document describes the release process and maintenance procedures.

## Release Process

### Prerequisites

- Push access to the `main` branch
- GitHub CLI (`gh`) installed and authenticated
- npm publish token configured as `NPM_TOKEN` secret
- Docker Hub credentials configured as `DOCKER_USERNAME` / `DOCKER_PASSWORD` secrets

### 1. Pre-release Checks

Make sure `main` is clean and all CI checks pass:

```bash
git checkout main
git pull origin main
pnpm verify:self
```

### 2. Update Version Numbers

Bump the version in all packages that will be published:

```bash
# Root
# packages/cli/package.json (published to npm)
# packages/backend/package.json (if applicable)
```

Commit and push the version bump:

```bash
git add -A
git commit -m "Bump version to vX.Y.Z"
git push origin main
```

### 3. Create a GitHub Release

1. Go to https://github.com/anthropics/wafflebase/releases/new (Replace with your repo URL)
2. Click **"Choose a tag"** and type `vX.Y.Z` to create a new tag on publish
3. Set the target branch to `main`
4. Set the release title to `vX.Y.Z`
5. Click **"Generate release notes"** to draft notes from merged PRs
6. Review and edit the notes as needed
7. Click **"Publish release"**

### 4. What Happens Automatically

Creating a GitHub release triggers these workflows:

| Workflow | Artifact | Tag |
|----------|----------|-----|
| `npm-publish.yml` | `@wafflebase/cli` on npm | version from `packages/cli/package.json` |
| `docker-publish.yml` | `yorkieteam/wafflebase` on Docker Hub | `vX.Y.Z` + `latest` |

The frontend is deployed to GitHub Pages on every push to `main` (not tied to releases).

### 5. Post-release Verification

After the workflows complete, verify the artifacts:

```bash
# Check npm package
npm info @wafflebase/cli

# Check Docker image
docker pull yorkieteam/wafflebase:vX.Y.Z
```

### 6. Announce

Write release notes on the GitHub release page. `--generate-notes` creates a
draft from merged PRs — review and edit before publishing if needed.

## Ongoing Maintenance

### Docker Image

- Every push to `main` publishes `yorkieteam/wafflebase:latest`
- Release tags also publish a versioned tag (e.g., `v0.1.0`)

### CLI Package

- Published only on GitHub release events
- Version is read from `packages/cli/package.json`

### Frontend

- Deployed to GitHub Pages (`wafflebase.io`) on every push to `main`
- CNAME configured in the `publish-ghpage.yml` workflow
