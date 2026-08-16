# CLI: honour --dry-run in docs list/get and sheets tabs list/cells get

Issue: #659

## Problem

Four read commands accept `--dry-run` and issue the request anyway:
`docs list`, `docs get <id>`, `sheets tabs list <id>`,
`sheets cells get <id> [range]`. Every sibling read command
(`docs/slides/notes content`, `files download`) prints the request and
returns. `docs/design/cli.md` §8.2 documents `--dry-run` as "prints the
request that would be sent — without executing it", so these four break
the contract a caller (or an agent pre-flight) relies on.

## Plan

- [x] `docs list` — validate `--type` first (bad input must still error under
      a dry run), then `printDryRun(config, 'GET', '/documents')`.
- [x] `docs get` — `printDryRun(config, 'GET', '/documents/<id>')`.
- [x] `sheets tabs list` — `printDryRun(config, 'GET', '/documents/<id>/tabs')`.
- [x] `sheets cells get` — mirror the three client paths the handler picks
      between: `?range=` (A1:C10), single `/cells/<ref>`, and bare `/cells`.
      Encode the range the same way `HttpClient.getCells` does, so the printed
      URL is the URL that would be sent.
- [x] Tests: extend `packages/cli/test/tabs.test.ts` (tabs list) and add
      `packages/cli/test/read-dry-run.test.ts` covering the other three
      commands — each asserts the client method is NOT called and the printed
      envelope matches.
- [x] `docs/design/cli.md` §8.2: add the read commands to the per-command
      dry-run notes.

## Review round 2 — finish the sweep the doc claimed

The doc bullet asserted "a dry run never reaches the network" as a blanket
contract, which the four fixes did not earn: the same bug survived in other
namespaces. Closing the gap rather than weakening the claim.

- [x] `notes list` / `notes get`, `slides list` / `slides get`,
      `files list` / `files get`, `sheets export` — same guard.
- [x] `api-keys create` / `list` / `revoke` — the namespace that was never
      swept, and the only one where ignoring the flag mints a live credential
      (printing its secret) or irreversibly revokes one. Its endpoints are not
      under the v1 API base, so `printDryRun` grew a `printDryRunUrl` sibling.
- [x] `HttpClient`: encode every interpolated document / tab / cell
      identifier. `fetch` resolves dot segments and truncates at `?`, so a
      crafted id sent the credentialed request outside the workspace prefix.
      The dry-run previews encode the same way, so the preview stays the
      request.

## Non-goals

- No change to `printDryRun` itself or to any command that already honours
  the flag.
- No new flags, no output-shape change.

## Acceptance criteria (from the issue)

`WAFFLEBASE_SERVER=http://127.0.0.1:1 wafflebase <cmd> --dry-run` prints the
`{ dry_run, method, url }` envelope and exits 0 for all four commands, with
no network attempt (`fetch failed` must not appear).
