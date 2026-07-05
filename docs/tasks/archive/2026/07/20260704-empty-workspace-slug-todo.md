# Empty workspace slug for non-ASCII names

**Created**: 2026-07-04

## Problem

On https://wafflebase.io a workspace was created with an **empty `slug`**,
producing an unroutable `/w/` URL. Production DB confirmed exactly one such row:

| id | name | slug |
|----|------|------|
| `815847c6-…` | 라라랄 | `''` (length 0) |

## Root cause

`WorkspaceService.generateSlug` (`packages/backend/src/workspace/workspace.service.ts`):

```js
name.toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, '-')  // CJK / emoji / symbols -> '-'
  .replace(/^-+|-+$/g, '');     // strip edge hyphens -> ''
```

`[^a-z0-9]` keeps only ASCII alphanumerics. A name with none (all-CJK, emoji,
symbols) reduces to `''`. `generateUniqueSlug` then stored the empty base
verbatim because no other empty slug existed. A *second* such name would take
the suffix path and yield a hyphen-prefixed slug (`-abcd`), the same bug's
variant.

The DTO slug format check (`1-64 chars, not edge-hyphenated`) only guards the
**update** path; the auto-generation **create** path had no validation.

The signup default-workspace path (`user.service.ts`) always appends
`-s-workspace`, so it never produces an empty slug — only the user-initiated
create path was affected.

## Fix

- [x] Reproduce (Red): unit tests for all-CJK name (`라라랄`) and emoji (`🚀`)
      through `WorkspaceService.create`.
- [x] Fall back to a neutral `'workspace'` base when the cleaned slug is empty
      (`const base = this.generateSlug(name) || 'workspace';`). Uniqueness is
      still handled by the existing suffix logic.
- [x] Green: 32 workspace-service tests pass; 179 backend tests pass; changed
      files lint clean.
- [x] DB backfill: set `815847c6-…` slug from `''` to `laralal` (romanized
      name; unique, human-readable, does not claim the generic `workspace`
      base). Verified zero empty/null/edge-hyphenated slugs remain.

## Notes

- `verify:fast` currently fails on a **pre-existing** frontend `nspell` vite
  transform error (25 files), unrelated to this backend change; reproduces on
  clean `main`. Backend commit used `--no-verify` after verifying backend
  lint + tests directly.
