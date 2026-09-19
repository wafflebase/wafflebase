# CLI `templates` command — Lessons

Issue: [#1058](https://github.com/wafflebase/wafflebase/issues/1058)

## What the endpoints forced

- **The gallery is not on `/api/v1`.** Every recent namespace
  (`folders`, `images`, `files`) hangs off the workspace-scoped v1 base, so
  `printDryRun(config, method, path)` is enough. Templates live at the browser
  routes, which is why this namespace follows `api-keys` instead: a builder in
  `client/url.ts` shared by the request and the preview, and `printDryRunUrl`.
  Two copies of a URL would let the preview drift from the request.
- **Publish is an upsert.** `TemplateService.publish` falls back to the
  existing listing per field, so the CLI must omit an option the caller did not
  pass rather than send `null`. A `templates publish <id> --title X` that also
  sent `category: null` would silently clear a live listing's category — and,
  for `visibility`, would widen a workspace listing to unlisted.
- **`browse` has no default scope.** `scope` is required by the DTO, so
  `templates list` has to pick one; `workspace` is the only one that answers
  "what has *my* workspace published", which is the question a publishing agent
  asks.

- **A browse row is not a listing.** `browse()` maps every row through
  `toCard()`, which strips `documentId` and `previewToken` — the public scope
  is anonymously enumerable and a document id is a Yorkie doc key by string
  concatenation. The CLI's `TemplateCard` type and the `templates.list` schema
  entry have to say so, or an agent scripts `.items[].documentId` and gets
  `undefined` from a command whose own schema promised the field.

## Known limitation

`publish` and `use` are `JwtAuthGuard`-only, so they need `wafflebase login`;
an API key is refused. That matches `api-keys` (also JWT-only) and is the
pre-existing backend shape — extending the v1 surface to templates is a backend
change the issue rules out. `list` is *not* JWT-only: its route takes optional
auth, so `--scope public` answers an unauthenticated caller and ignores an API
key, while `--scope workspace` is a `403` without a session.
