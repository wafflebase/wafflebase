**Created**: 2026-11-25

# Lessons — console breadcrumb argument scrubbing

## The issue's premise ran ahead of `main`

#1198 describes the scrubber as already redacting `event.message`, exception
values, spans and breadcrumb `message` "after #1194". None of that is on `main`
at `3a6f8c24a`: the hook covers `request.url`, the `Referer`/`Referrer` header,
`transaction`, and breadcrumb `data.url|from|to` only, and `redactUrlsInText`
— the helper the proposal calls by name — does not exist. So the branch had to
write that helper, and `crumb.message` is deliberately left to #1194 rather
than fixed twice.

## `redactCapabilityTokens` is a URL function, not a text function

Handing it `"image load failed: /documents/x/file?token=secret"` parses the
whole sentence as a relative URL, so the prose comes back percent-encoded.
That is why free text needs a span-finding wrapper, and why the wrapper
substitutes only spans whose redaction actually changed something — otherwise
every incidental `/w/jiyu` in a log line would be rewritten through
`new URL()` normalization.

## Rounds

- Round 1–3 (`/self-review`): not run. This run is headless with no tool that
  can dispatch a reviewer subagent; CI, `@claude review` and a human are the
  reviewers. Recorded here so a skipped round does not read as a clean one.
