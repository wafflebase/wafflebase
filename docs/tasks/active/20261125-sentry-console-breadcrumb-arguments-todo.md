**Created**: 2026-11-25

# Scrub capability tokens out of console breadcrumb arguments

Issue #1198. `scrubCapabilityTokens` (`packages/frontend/src/sentry.ts`) reaches
breadcrumb `data.url|from|to` but not `crumb.data.arguments`, the raw argument
array Sentry's console instrumentation records beside the joined `message`.
Several frontend URLs carry a capability as `?token=` (`fileUrl()` in
`src/api/files.ts`, the share-link image resolver in
`src/app/spreadsheet/image-cache.ts`), and ~30 non-test frontend files call
`console.error`/`console.warn`, so a logged argument holding such a URL would
ship the token with the next event. Defence in depth: no call site has been
confirmed to do it.

## Plan

- [ ] `redactUrlsInText(text)` in `packages/frontend/src/lib/redact-url.ts` —
      find URL-shaped spans inside free text and run each through the existing
      `redactCapabilityTokens`. Needed because that helper parses its whole
      input as a URL, so handing it a sentence percent-encodes the prose.
      Substitute only when a span actually changed, so a non-capability URL is
      never normalized in place.
- [ ] Walk `crumb.data.arguments` in the breadcrumb loop: string entries, plus
      own string fields one level deep. Bounded (entry count, field count,
      text length). No serialization of arbitrary objects.
- [ ] `sentry.test.ts` case: a console crumb whose argument holds
      `/documents/x/file?token=secret`.
- [ ] `redact-url.test.ts` cases for the new helper.

## Out of scope

- `crumb.message`, `event.message`, exception values and spans. The issue
  describes those as already covered by #1194; on `main` as of this branch
  #1194 has not merged, so they are still unredacted. Doing them here would
  duplicate that PR.
