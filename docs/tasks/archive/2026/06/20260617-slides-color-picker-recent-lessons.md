# Lessons — slides color picker recent colors

- **Native `<input type="color">` `onChange` is the live `input` event**, firing
  on every drag/keystroke — not a discrete commit. Any handler that closes a
  popover on `onChange` will snap shut on the first live change. Separate
  "live apply" from "commit/close".
- **`onBlur` on a native color input fires even when the OS dialog is
  cancelled.** Re-applying the input value on blur unconditionally clobbers a
  non-srgb (role/theme) value with the input's `#000000` default. Gate blur on a
  dirty flag armed at focus / set by a real live change.
- **`migrateDocument` runs on every Yorkie read and rebuilds `meta` from known
  fields**, silently dropping any new optional `Meta` field. New persisted meta
  fields must be copied through migrate (mirror `unit` / `pxPerPt`), or they
  vanish on the next read.
- **Store mutators require an open batch** (`requireBatch`). When recording a
  side value (recent color) alongside a primary mutation, keep it inside the
  same `store.batch(...)` so they share one undo unit and don't throw.
- **`@wafflebase/slides` has a dual entry: browser `src/index.ts` and a DOM-free
  `src/node.ts` subset.** The `.` export resolves to the node entry under Node,
  and the slides `.integration.ts` suite runs `YorkieSlidesStore` under Node — so
  any new symbol that store (transitively) imports from `@wafflebase/slides` must
  be re-exported from **both** entries, not just `index.ts`. Symptom: CI
  `verify-integration` fails with `does not provide an export named '…'` while
  `verify-self` / `verify:fast` pass (they don't run the Node-resolved
  integration suite). Only pure (no DOM) symbols belong in `node.ts`.
- **Decouple independent UI signals into separate flags** (`commit` for close vs
  `record` for recents) rather than overloading one boolean — it removed the
  blur-before-click close race cleanly.
- **A live Yorkie CRDT array proxy throws on `toJSON` *inside* `doc.update`.**
  `yorkieToPlain` (which calls `toJSON`) works for reads outside a mutation but
  fails the second time you read-modify-write a nested array within `update`.
  Read existing entries by index/`.length` instead (as `removeGuide` does). This
  bug only showed in YorkieStore (dev/prod) — MemStore unit tests passed, so
  add a real in-memory `new yorkie.Document(...)` roundtrip test for any new
  persisted field, not just a MemStore test.
