**Created**: 2026-11-25

# Lessons — console breadcrumb argument scrubbing

## The issue's premise ran ahead of `main`

#1198 describes the scrubber as already redacting `event.message`, exception
values, spans and breadcrumb `message` "after #1194". None of that is on `main`
at `3a6f8c24a`: the hook covers `request.url`, the `Referer`/`Referrer` header,
`transaction`, and breadcrumb `data.url|from|to` only, and `redactUrlsInText`
— the helper the proposal calls by name — does not exist. So the branch had to
write that helper, and it also has to redact `crumb.message` itself: console
instrumentation records the joined message beside the raw arguments, so
scrubbing only `data.arguments` while waiting on #1194 ships the same token in
the field the Sentry UI displays. Leaving it to another branch would have made
the change read as covering console crumbs without closing the leak.

## A bound in a redaction path has to fail closed

Every ceiling in the first draft passed over-budget data through unredacted: an
8 KiB text cap returned long strings verbatim, and the argument/field counters
stopped rewriting after 16 and 32. The argument holding the token is as likely
to be the seventeenth as the first, so the budgets are gone (the SDK's
`normalizeEvent` has already bounded how much there is to walk) and the one
remaining bound — how many capability-shaped spans get parsed — replaces the
span in full past the limit. The span budget is also spent on candidates only:
`URL_SPAN` matches any `/`, so `2026/11/25` and `src/lib/x.ts` used to exhaust
it before a real URL was reached.

## `redactCapabilityTokens` is a URL function, not a text function

Handing it `"image load failed: /documents/x/file?token=secret"` parses the
whole sentence as a relative URL, so the prose comes back percent-encoded.
That is why free text needs a span-finding wrapper, and why the wrapper
substitutes only spans whose redaction actually changed something — otherwise
every incidental `/w/jiyu` in a log line would be rewritten through
`new URL()` normalization.

Spans also have to survive escaping. A serializer that escapes forward slashes
writes a share link as `\/shared\/tok`; with `\` as a span delimiter that is two
spans, neither of them a prefix followed by a token. So the backslash lives
inside the span and is undone before parsing — `new URL()` reads `\` as an
authority delimiter and would turn `\/shared\/tok` into the host `shared`.

## Rounds

- Round 1–3 (`/self-review`): not run. This run is headless with no tool that
  can dispatch a reviewer subagent; CI, `@claude review` and a human are the
  reviewers. Recorded here so a skipped round does not read as a clean one.
