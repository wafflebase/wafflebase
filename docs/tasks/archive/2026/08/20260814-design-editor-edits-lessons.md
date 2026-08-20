# Lessons — staged-edit model (PR 9b, #848)

## The server did not want the field the client was sending

The plan was "read the four token paths from `TokenFamilyMeta` instead of compiling them in".
Building it showed `tokenEditOf` never reads `intent.file` for any token kind — the adapter
derives the file from the FAMILY. So the client sends `family` and no path at all, which is a
smaller contract than the one the design doc asked for. Reading the consumer of a field beats
generalising it.

## Make the impossible state unrepresentable rather than checking for it

`PendingTokenRebind` became a union on `fromKind` because `fromValue` merely optional let a
`'literal'` rebind exist without one; `revertRebindIntent` then produced
`tokenValue: undefined`, `JSON.stringify` dropped the key, and the server refused the payload
— a staged undo failing at save time, on the one path that exists to make undo possible.
