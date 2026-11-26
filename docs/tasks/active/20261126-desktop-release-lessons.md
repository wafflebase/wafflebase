# Desktop release — lessons

- **`releases/latest` belongs to the server.** This repository publishes server
  releases as "Latest", so the Tauri-docs default endpoint
  (`releases/latest/download/latest.json`) would 404 for every installed app.
  The endpoint is compiled in; a unit test now pins it to `desktop-latest`.
- **Tauri's `APPLE_CERTIFICATE` path matches the signing identity by name.**
  With a same-named older certificate in the login keychain, codesign reports
  the name as ambiguous, and passing the SHA-1 instead is refused ("does not
  match provided identity"). Only a developer machine hits this; the CI runner
  has one certificate. Local signed builds sign with `codesign --keychain`
  from a throwaway keychain instead.
- **`openssl verify` fails Developer ID certificates with "unhandled critical
  extension"** (Apple's marker OIDs). `-ignore_critical` is the right flag;
  the real proof is a `codesign --timestamp` that shows the full chain.
- **New Developer ID certificates are valid ~13 months** (issued 2026-11-26,
  expires 2027-12-26), not the five years older ones had. Renewal is yearly.
- **Generate the signing key off-keychain.** `openssl genrsa` + CSR, then
  `pkcs12 -export -legacy`: the key exists only in the `.p12`, so "which Mac
  holds the private key" cannot recur.
- **Versioning follows the release process, not the code boundary.** The
  first draft gave the shell its own `desktop-v*` version because it carries
  no server code — correct, and still the wrong call: a second number and a
  second procedure cost more than the extra updates, and riding the server's
  release made the "Latest" problem disappear. What the separate version was
  protecting (no update nags) is better bought in the update UX (silent,
  installed on quit).

## Self-review

- **Round 1** (security / blast-radius / design-fit did not run: HTTP 429
  usage limit — not a clean result). Correctness: "Check for Updates…" was
  silent while the launch check ran (`busy` early return) — fixed: a manual
  request joins the running check, state under one mutex so the join cannot
  race the finish; decisions pulled into pure `begin`/`tell` with tests. `jq
  --rawfile` would carry a `.sig` trailing newline into the manifest — fixed
  via `$(cat …)` (local e2e used `$(cat …)`, which is why it passed). Also
  fixed the minors: failed Restart Now keeps the package, `lipo -verify_arch`
  instead of grepping `-archs` order, explicit `codesign --verify` on the
  `.dmg`, `createUpdaterArtifacts` pinned, and the workflow comment that
  called the 404 window "no update" (it is a logged failure, retried daily).
  Test-adequacy "update.rs untested" — addressed by the pure decision
  functions; the Tauri glue stays covered by the local e2e only.
