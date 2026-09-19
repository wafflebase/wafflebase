# CLI `templates` command — Task Tracking

Issue: [#1058](https://github.com/wafflebase/wafflebase/issues/1058)
Design: [cli.md](../../design/cli.md) · [template-gallery.md](../../design/template-gallery.md)

The template gallery ships end to end, but the CLI cannot reach it, so an
agent cannot list, publish, or instantiate a template on its own. This wires
three thin commands onto endpoints that already exist. **No backend change.**

## Scope

- [x] `wafflebase templates list` — `GET /templates` (browse)
- [x] `wafflebase templates publish <doc-id>` — `POST /documents/:id/template`
- [x] `wafflebase templates use <template-id>` — `POST /templates/:id/use`
- [x] `--dry-run` preview + `--format` for all three (the CLI's standing contract)
- [x] `schema` registry entries (`templates.list` / `.publish` / `.use`)
- [x] Docs: `docs/design/cli.md` command tree + recipes, `packages/cli/README.md`

## Design notes

- The gallery routes are the **browser** routes (`/templates`,
  `/documents/:id/template`), not `/api/v1/workspaces/:id/...`, exactly like
  API-key management. So they get their own URL builders in
  `client/url.ts` shared by `HttpClient` and the `--dry-run` preview, and the
  commands use `printDryRunUrl` rather than `printDryRun`.
- They are `JwtAuthGuard`-only on the backend, so — again like `api-keys` —
  they need `wafflebase login`, not an API key. Documented rather than worked
  around: closing that gap is a backend change and the issue scopes it out.
- `browse` requires a `scope`: `workspace` (needs the caller's workspace) or
  `public`. `list` defaults to `workspace` and sends the resolved workspace
  (global `--workspace` / session), so the common case needs no flag.
- `publish` sends **only** the options the caller passed. The backend's
  publish is an upsert that falls back to the existing listing field by field;
  sending an unset option as `null` would blank a live listing.
- `use` takes the destination from `--into`, defaulting to the resolved
  workspace.

## Out of scope

Everything behind the review pipeline (`submit` / `review` / `report` /
the admin queue) and listing edits (`PATCH`/`DELETE /templates/:id`). The
issue names three verbs; the rest are a separate gap list.

## Tests

- [x] `packages/cli/test/templates.test.ts` — per-subcommand wiring, the
      dry-run previews, query-string assembly, upstream error forwarding,
      traversal refusal on an id.

## Review

Shipped as [#1066](https://github.com/wafflebase/wafflebase/pull/1066)
(`f8e2e0521`, 2026-09-14). The boxes above went unticked at merge time and
were closed retroactively on 2026-09-19 against the tree, not against the PR
description:

- `packages/cli/src/commands/templates.ts` — the three verbs, each reaching
  the **browser** routes through `client/url.ts` builders and previewing with
  `printDryRunUrl`, as the design notes above require.
- `packages/cli/test/templates.test.ts` — the test file this section asks for.
- `packages/cli/src/schema/registry.ts:1411,1433,1449` — `templates.list`,
  `templates.publish`, `templates.use`.
- Docs: `docs/design/cli.md:882-888` (recipes), `:1048` (command tree),
  `:1535` (the query-string note), and `packages/cli/README.md:190-192`.

No backend change, as scoped.
