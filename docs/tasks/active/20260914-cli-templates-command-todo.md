# CLI `templates` command — Task Tracking

Issue: [#1058](https://github.com/wafflebase/wafflebase/issues/1058)
Design: [cli.md](../../design/cli.md) · [template-gallery.md](../../design/template-gallery.md)

The template gallery ships end to end, but the CLI cannot reach it, so an
agent cannot list, publish, or instantiate a template on its own. This wires
three thin commands onto endpoints that already exist. **No backend change.**

## Scope

- [ ] `wafflebase templates list` — `GET /templates` (browse)
- [ ] `wafflebase templates publish <doc-id>` — `POST /documents/:id/template`
- [ ] `wafflebase templates use <template-id>` — `POST /templates/:id/use`
- [ ] `--dry-run` preview + `--format` for all three (the CLI's standing contract)
- [ ] `schema` registry entries (`templates.list` / `.publish` / `.use`)
- [ ] Docs: `docs/design/cli.md` command tree + recipes, `packages/cli/README.md`

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

- [ ] `packages/cli/test/templates.test.ts` — per-subcommand wiring, the
      dry-run previews, query-string assembly, upstream error forwarding,
      traversal refusal on an id.
