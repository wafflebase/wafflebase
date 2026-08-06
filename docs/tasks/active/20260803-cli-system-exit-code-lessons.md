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
  *named* in the timeout message, and the backend refuses `?mode=cli`
  without a nonce (`400`) instead of treating the binding as optional —
  fail-closed on both ends, with the failure legible. Refusing without
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
  range — and the allowance for the configured server compares
  **origins**, so a self-hosted absolute `src` no longer has to be
  byte-identical to `--server`. What is still open is documented rather
  than implied: rebinding between lookup and connect.

The lesson worth keeping: "this belongs in another PR" is only true if
the other PR exists. A control removed from a diff that ships the code
it was protecting is not deferred, it is deleted.
