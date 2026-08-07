# Lessons — CLI `--quiet` preserves body and error envelope

Issue: [#660](https://github.com/wafflebase/wafflebase/issues/660)

## What we learned

- A boolean flag named after a *display* concern (`quiet`) had been
  threaded all the way down into the two functions that emit the
  command's *data*. Every call site passed it, so the bug read as
  intentional at each individual site — it only looked wrong against
  the documented contract in `docs/design/cli.md` §9.
- The fix that survives is deleting the parameter, not ignoring it.
  A `quiet` argument that is accepted and dropped invites the next
  reader to "restore" the check.
- The rest of the CLI already had this right: `writeBinary` and
  `runDocsContent` both gate only their stderr notices and always
  write the bytes/text. The regression was isolated to
  `output/formatter.ts`.

## Follow-ups

None. The error envelope in `docs/design/cli.md` §9 also documents a
`command` field (`{"error":{"code","message","command":"docs.content"}}`)
that `outputError` does not emit; that gap is out of scope here.
