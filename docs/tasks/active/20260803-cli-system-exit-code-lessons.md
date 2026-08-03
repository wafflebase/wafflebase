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
