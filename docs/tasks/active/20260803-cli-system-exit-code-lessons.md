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

## Descoped, then rebuilt properly

Two security controls were drafted here, removed as out-of-scope, and
then reinstated when review held that shipping the surrounding code
without them was worse than the scope creep. Both were rebuilt against
the objections that got them descoped, which is the useful part:

- **Nonce-bound loopback login callback** (CLI `?nonce=` → stored in
  `CliAuthStore` → echoed on the `127.0.0.1` redirect). The original
  version made a CLI pointed at an older backend hang the full 30s and
  then throw an unclassified timeout. Now the missing-nonce case is
  *named* in the timeout message, and the CLI refuses a callback that
  does not echo its nonce — fail-closed where it counts, with the
  failure legible. (The backend's matching `400` for a nonce-*less*
  request was walked back later; see below.) Refusing without
  settling still matters: a hostile local page must not be able to
  cancel a pending login either. The nonce does travel in the printed
  OAuth URL and the browser argv, so it does not defend against a
  same-user local process — that is the OAuth `state` threat model, not
  a regression.
- **SSRF gate on export image `src`** (`assertFetchableImageUrl`). The
  first version failed on all three counts raised against it, and each
  is now a test: names are *resolved* before the verdict (so an
  attacker-controlled DNS record pointing at loopback is refused), every
  redirect hop is revalidated (`redirect: 'manual'`), address rules run
  only against literals — expanded to eight words, so `::ffff:7f00:1`
  and `::ffff:127.0.0.1` are one address and `fc2.com` is not an IPv6
  range — and the configured server stays reachable regardless of how
  its URL is spelled. What is still open is documented rather than
  implied: rebinding between lookup and connect.

The lesson worth keeping: "this belongs in another PR" is only true if
the other PR exists. A control removed from a diff that ships the code
it was protecting is not deferred, it is deleted.

## What the review panel then found (and what it changed)

- **A gate that fails open is not a gate.** `assertFetchableImageUrl`
  returned — i.e. allowed — when the pre-resolution threw, on the theory
  that "the fetch will report it anyway". But the gate and the fetch
  resolve *independently*, so an attacker-run nameserver that stalls the
  first lookup and answers the second with `127.0.0.1` walked straight
  through, and any resolver hiccup silently disabled the control. It now
  fails closed as `NETWORK_ERROR`, which costs nothing: the exit class
  is the same one the fetch would have produced.
- **Address rules have to reach through the transition ranges.** The
  IPv6 table matched `fc00::/7` and `fe80::/10` but not the prefixes
  that *embed* an IPv4 address — on a host behind a NAT64 gateway,
  `64:ff9b::a9fe:a9fe` is the metadata service. Same for 6to4 and
  Teredo, and on the v4 side for `224.0.0.0/4` and `240.0.0.0/4`.
- **Compare identities, not spellings.** Allowing the configured server
  by *origin string* silently broke dev and self-hosted exports: the
  frontend persists image `src` absolute, so a document says
  `http://localhost:3000/...` while the CLI may be pointed at
  `--server http://127.0.0.1:3000`. The exemption now matches resolved
  address + port, which covers every spelling of the same listener and
  still grants nothing beyond it.
- **A security requirement that breaks published clients has to earn
  it.** `@wafflebase/cli` is on npm, so a `400` for a nonce-less
  `?mode=cli` would break every installed CLI on the next deploy. The
  fail-closed instinct was right but pointed at the wrong end: the
  binding that defends a login is the CLI's own check, and an attacker
  minting a code for a port they control just picks their own nonce, so
  server-side rejection buys nothing it costs. Malformed → `400`,
  absent → serve and warn, hard `400` once old CLIs are out of support.
- **Classification has to follow the network calls out of the package.**
  Every CLI `fetch` was routed through `fetchOrThrow`, but the PDF
  exporter downloads Noto KR fonts from inside `@wafflebase/docs` with a
  raw `fetch` — so an offline export of a Korean document still exited
  `1`. `PdfFonts` now takes a `fetchImpl`, and the CLI injects a
  classifying one. The seam is a *transport* the classifier wraps, not a
  replacement for it: the first version let the test's stub bypass the
  very code under test, and the test passed for the wrong reason.
- **A refactor's motivation is a test.** Rerouting the API-key endpoints
  through `send()` (so a refreshable session is not reported as an auth
  failure just because of which base a call used) shipped with nothing
  exercising `HttpClient`. `test/http-client.test.ts` now pins the
  refresh-and-retry across that base, the session-file persistence, and
  the `encodeURIComponent` on revoke.
