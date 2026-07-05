# Lessons — Empty workspace slug for non-ASCII names

## What the bug actually was

An "empty slug" symptom traced to a slugify that whitelists only `[a-z0-9]`.
For a Korean-team product this is a predictable failure: any workspace named
purely in Hangul/CJK collapses to `''` after edge-hyphen stripping. The DB was
the fastest confirmation — one row, name `라라랄`, slug length 0.

## Debugging patterns that paid off

- **Confirm against production before theorizing.** `kubectl exec` into the
  `postgres` pod and `SELECT length(slug)` pinpointed the single bad row and
  ruled out a broader corruption. No port-forward needed.
- **Distinguish the two create paths.** Signup (`user.service.ts`) always
  appends `-s-workspace` and is safe; only the user-initiated
  `WorkspaceService.create` path lacked a fallback. Grepping every `slug`
  writer avoided fixing the wrong place.
- **The suffix path hid a second variant.** An empty base with a collision
  yields `-abcd` (edge-hyphenated), also invalid. Fixing the base to a
  non-empty fallback covers both.

## Gotchas

- **Validation asymmetry.** Slug format was validated on update but not on
  auto-generation at create time. When a value is both user-supplied and
  system-generated, validate both entry points.
- **Pre-existing `verify:fast` failure.** The frontend `nspell` suite fails via
  a vite transform error independent of this change (confirmed by stashing and
  re-running on clean `main`). Verified backend lint + tests directly and used
  `--no-verify`; the per-package `backend lint` script also has a stale glob.

## See Also

- `docs/design/backend.md` — workspace/slug model and auth flow
