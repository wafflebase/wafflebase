# Slides shape inline text — lessons

## Yorkie proxy semantics — `in` operator is unreliable across batches

`'foo' in eAny.data` returned `false` even after a prior `doc.update`
batch wrote `eAny.data.foo`. The proxy's `has` trap apparently doesn't
honor fields added by prior batches. Effect: a presence check at the
top of `YorkieSlidesStore.withShapeText` false-negatived, the
"no-op-on-no-change" early return fired, and the second `withShapeText`
call silently skipped the write. The diagnostic was opaque — tests just
saw stale read values, never an exception.

**Rule for this codebase.** Detect prior-batch field presence via
`yorkieToPlain(eAny.data.foo) !== undefined`, not the `in` operator.
For shape text specifically, see
`packages/frontend/src/app/slides/yorkie-slides-store.ts`
`withShapeText` — the comment block above `priorTextPlain` documents
why.

## Yorkie nested-field replacement leaks prior state

After the first `eAny.data.text = { ... }` write created the field,
overwriting it again via `eAny.data.text = { ...different }` in a
later batch left readers (`store.read()` + `yorkieToPlain`) seeing the
ORIGINAL value. Splitting into:

```
const existing = eAny.data.text as { blocks?, ... } | undefined;
if (existing) existing.blocks = clone(next);    // mutate sub-field
else eAny.data.text = clone({ ..., blocks: next });  // create
```

made the second write visible. Per-key mutation on an existing CRDT-
backed object propagates as expected; wholesale object replacement on
top of an existing subtree is opaque. Same rule as `updateElementData`
(`yorkie-slides-store.ts:1010-1020`), but extended to nested-object
fields too.

## "Drop on empty" is a destructive op under LWW

The first draft of `withShapeText` called `delete eAny.data.text` when
the body ended up empty. Code review caught this: under concurrent
edits, a peer typing into the same shape can have its content wiped
because `delete` is a wholesale-field LWW op (worse than the per-field
LWW the sibling `withTextElement.blocks` does). Rule going forward:
**don't delete CRDT fields you can write into emptily.** Persist an
empty body instead — the renderer's `isBlocksEmpty` short-circuit
makes it visually invisible, and `<p:txBody>` cruft is only a
PPTX-export concern (which doesn't exist yet).

## Filtering "the editing element" needs to be element-kind aware

`editor.ts:render()` removed the editing element from the slide
canvas to avoid double-painting text. For text elements that's
correct — the element IS just text. For shapes, the fill/stroke is
the bulk of the visual; filtering the whole shape made it disappear
during edit, which the user immediately noticed. The fix:
element-kind-aware filtering — drop text elements entirely, but for
shapes clone with `data.text` removed so fill/stroke keep painting
underneath the editor canvas.

## In-place text-box editor canvas vs. renderer canvas alignment

`mountSlidesTextBox` defaults to `allowEditorGrow = autofit !== 'shrink'`,
so 'none' autofit still grows the editor canvas to fit text. On mount
the docs editor measures the initial text and fires
`onContentHeightChange(textH)`, which **shrinks** the editor canvas to
text height and re-anchors text at `originY = 0`. The renderer keeps
the full inner frame and middle-anchors text → visible "jump" on
commit. Fix: added an explicit `growMode?: 'auto' | 'never'` opt;
shape edit passes `'never'` so the editor canvas stays at the
mount-time `frame.h` and the middle anchor agrees with the renderer.

**Rule.** When a docs text-box is in a slot whose **slide frame** does
NOT track content, the editor canvas mustn't track content either —
otherwise the live anchor calc diverges from the post-commit anchor
calc. `autofit === 'none'` alone isn't enough because the docs editor
treats 'none' as "grow live, don't commit growth"; a separate signal
is needed.

## Test the visual contract, not just the wiring

The first-pass `shape-renderer-text.test.ts` y-inset test asserted
only a lower bound (`y >= 7`). A renderer regression that painted
text 30 px below the inset would pass. Code review caught it. Rule:
when asserting paint positions, bound from above and below so a
regression that drifts in either direction fails.

## Don't over-rely on Cmd/text element seeding patterns

`buildInsertElement` seeds text-element inlines with
`style: { color: DEFAULT_TEXT_COLOR }` (an explicit role binding).
My shape seed used `style: {}` (implicit, relying on the
`makeColorResolver` `#000000` → role remap). Both render the same,
but the asymmetry is confusing; code review flagged it. Picked the
explicit-role form for consistency.
