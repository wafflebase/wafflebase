# Lessons — CLI system exit code (#586)

## What the bug really was

A documented contract with no implementation and no test. The docs were
written alongside the CLI design, the `outputError` helper landed with a
hardcoded `1`, and nothing connected the two. The gap survived because
every test asserted `exitCode === 1` — i.e. the tests encoded the bug.

## Design notes

- **Classify at the throw site, decide at the output site.** Sniffing
  `error.message` for `"fetch failed"` in `outputError` would have been a
  smaller diff but would break the moment undici changes its wording.
  A `SystemError` class carrying `exitCode` keeps the knowledge where the
  failure is actually known.
- **`exitCode` as an error property** composes with the existing `code`
  pass-through in `errorCode()`: one `SystemError` gives both the
  machine-readable `code` in the JSON body and the process exit code.
- **5xx is a system error.** The docs only said "network, auth", but a
  server fault is not a user error by any reading — the docs were
  widened rather than the classification narrowed.
- **`quiet` must classify too.** The quiet branch of `outputError`
  returns early; it is exactly the branch scripts use, so leaving it at a
  hardcoded `1` would have defeated the purpose.

## Descoped mid-review

Two security controls were drafted here and then removed, because both
are separate designs rather than exit-code classification:

- **Nonce-bound loopback login callback** (CLI `?nonce=` → stored in
  `CliAuthStore` → echoed on the `127.0.0.1` redirect). It is a
  cross-package OAuth protocol change: a CLI that hard-requires the echo
  cannot log in against any already-deployed backend, and the nonce as
  drafted leaked through the printed OAuth URL and the browser process
  argv anyway. A real fix needs a negotiated rollout (backend first,
  CLI tolerant until a floor version) and its own guard/callback specs.
- **SSRF gate on export image `src`** (`assertFetchableImageUrl`).
  Name-based blocking is not a boundary: `fetch` follows redirects, any
  attacker-controlled DNS record can point at loopback, and the literal
  matching both under-blocked (`[::ffff:7f00:1]`) and over-blocked
  (public hostnames beginning `fc`/`fd`/`fe8`). It also broke existing
  self-hosted documents whose stored `src` is an absolute internal URL
  that is not byte-identical to `--server`. A correct version resolves
  addresses and revalidates per redirect hop.

What survives from that work is the part that belongs to #586: image
downloads go through `fetchOrThrow`/`httpError`, so an unreachable image
host exits `2` and presigned query strings stay out of stderr.
