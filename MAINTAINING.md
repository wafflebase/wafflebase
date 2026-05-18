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

1. Go to https://github.com/wafflebase/wafflebase/releases/new
2. Click **"Choose a tag"** and type `vX.Y.Z` to create a new tag on publish
3. Set the target branch to `main`
4. Set the release title to `vX.Y.Z`
5. Click **"Generate release notes"** to draft notes from merged PRs
6. Rewrite the auto-draft into the format described in
   [Release Notes Format](#release-notes-format) below
7. Click **"Publish release"**

### Release Notes Format

Release notes are hand-written in English following the structure
established by recent releases (`v0.3.6`, `v0.3.7`, `v0.4.0`). Use
GitHub's auto-generated draft as a checklist of merged PRs, then
rewrite into the template:

```text
## Highlights

- **<headline 1>** — one-sentence framing of the biggest user-facing change.
- **<headline 2>** — second headline if there is another major theme.
- ~3–5 bullets total; keep them user-facing, skip internal refactors.

## <Area 1 — e.g. Slides — PPTX import>

- Short description of the change (#PR)
- ...

## <Area 2 — e.g. Sheets / Formulas>

- ...

## Contributors

Thanks to everyone who contributed to this release:

- @hackerwins
- @<contributor> — #<PR>, #<PR>
- @<first-timer> — #<PR> 🎉 first contribution

---

**Full Changelog**: https://github.com/wafflebase/wafflebase/compare/<prev-tag>...<this-tag>
```

Style rules:

- **Group by area, not by PR**. Common area headings: `Slides`,
  `Sheets / Formulas`, `Docs`, `CLI / REST API`, `Infrastructure`.
  When an area has a clear theme, qualify it (e.g. `Slides — PPTX
  import`, `Slides — Mobile`, `Slides — Editing & UX`). One bullet
  per shipped change, ending with `(#NNN)` linking to the PR.
- **Highlights are user-facing**. Skip doc-only changes, internal
  refactors, CI/lint cleanups, and test reorganisations from
  `## Highlights`. They may still appear under area sections if they
  carry user-visible weight (e.g. a new package surface).
- **Contributors section is required**. List every non-bot author of
  a merged PR between the previous and current tag. Order: maintainer
  (`@hackerwins`) first, then everyone else alphabetically by login.
  Mark first-time contributors with `🎉 first contribution`. The
  maintainer line carries no PR list (too noisy); everyone else gets
  their PR numbers after an em-dash.
- **Identify first-time contributors** by checking whether each login
  has any commits before the previous tag:

  ```bash
  # Replace v0.X.Y with the previous tag.
  for u in <login1> <login2>; do
    count=$(git log v0.X.Y --author="$u" --oneline | wc -l | tr -d ' ')
    echo "$u: pre-tag commits=$count"
  done
  ```

  A count of `0` means it is their first merged contribution — mark
  them with `🎉 first contribution`.
- **Full Changelog** link at the bottom always uses the compare URL
  between the previous and current tag.

Useful commands while drafting:

```bash
# All PRs merged since the last tag, with authors:
gh pr list --state merged --base main \
  --search "merged:>=<YYYY-MM-DD-of-last-tag>" \
  --json number,title,author --limit 200

# Unique authors since the last tag:
git log <prev-tag>..HEAD --pretty=format:'%an|%ae' | sort -u

# Plain commit list for sanity:
git log <prev-tag>..HEAD --oneline
```

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
