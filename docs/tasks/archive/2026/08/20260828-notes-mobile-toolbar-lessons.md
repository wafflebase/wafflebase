# Notes mobile toolbar — lessons

## `overflow-x-auto` hides a layout bug rather than solving it

The notes toolbar never *looked* broken in code review: nothing was
clipped, no console error, no failing test. The strip just scrolled. What
that cost was specific — `ml-auto` puts the view-mode and keymap
dropdowns at the far end of the scroll area, so the controls that decide
what the screen shows were the ones you had to drag sideways to reach.

A scrolling container is a legitimate overflow *fallback*; it is not a
mobile layout. When a toolbar's controls are ranked (some primary, some
not), the fix is to drop the low-rank ones into a menu, not to let the
whole strip slide.

## `aria-label` on a `div` is dead weight

`Toolbar` renders a plain `div`. The notes toolbar had passed
`aria-label="Note toolbar"` since it was written, and it did nothing: an
`aria-label` on an element with no role is not exposed. The tell was that
`getByRole('toolbar', { name: 'Note toolbar' })` found nothing on a
toolbar that plainly had that label in the source.

Worth grepping for: `aria-label` on a bare container element is almost
always either a no-op or a missing `role`.

## A menu is not a toolbar button — focus is the difference

Moving a control from the strip into a dropdown looks like pure layout,
and it isn't. Radix returns focus to the trigger when the menu closes, so
every relocated action stopped handing the caret back to the editor —
worst exactly where the change was aimed, since on a phone losing the
caret drops the soft keyboard.

The evidence was already in the file: `TableDropdown` was the one existing
menu here, and it calls `editor.focus()` by hand. **A local workaround in
sibling code is a spec.** When relocating controls into a construct that
one neighbour already compensates for, find out what it is compensating
for before assuming the move is free — and fix it once at the container
(`onCloseAutoFocus`) rather than per item.

## "No escape hatch" can point either way — check which

The reasoning that justified demoting the share-link mount was: that route
has no view menu, so a bad layout there is inescapable. True, and exactly
backwards. With no view menu, the split *is* the only thing that renders a
preview — so the demotion didn't rescue a trapped user, it removed the
feature and left them trapped without it.

The tell was available before writing the line: the value was hardcoded,
and hardcoded values usually encode a constraint. `git log -S` on that line
would have surfaced the commit that chose it. **When a change makes one
surface behave like another, check what the first surface has that the
second doesn't** — here, a toolbar. A guard copied across a boundary
without its context stops being a guard.

## A comment describing intent is not the same as code enforcing it

`onCheckedChange={() => onModeChange(m)}` carried the comment "Ignore the
toggled-off case: a mode is always selected." It ignored nothing — Radix
fires for the checked item too, and the handler reported unconditionally.
That was harmless only while the displayed mode always equalled the stored
one. Introducing a demotion split those two apart and turned a documented
no-op into silent data loss.

Two lessons. Adding an indirection (effective vs. stored value) means
auditing every reader of the old value for the assumption that they were
the same thing. And a comment claiming a behaviour is a place to check
whether the code does it, not evidence that it does.

## Verify the harness before believing the harness

Four separate red runs on this branch were all environment, not code:

| Symptom | Cause |
|---|---|
| `seg is not a function` across `src/api/*` | stale `@wafflebase/core` dist |
| `Property 'lakehouseSource' does not exist` | Prisma client not generated |
| `Cannot find module '@duckdb/node-api'` | optional native deps not installed |
| `has no exported member 'toRgbHexColor'` | stale `@wafflebase/docs` dist |

Each looked like a real break. The cheap discriminator is
`git stash -u && <same command>`: if a clean tree fails identically, it is
not yours. That test is what separated these four from the one failure on
this branch that *was* mine (below) — worth spending the two minutes
before debugging anything.

The general shape: this monorepo typechecks and tests **against built
`dist/`**, so any package whose `index.ts` moved needs a build before its
consumers are believable. Related: [[reference_slides_export_build_step]].

## A new test file is a load change

`text-edit-section.test.ts` cold-imports the slides toolbar's module graph
on vitest's default 5s budget. Adding an unrelated test file to the suite
pushed it over — it failed two of three full runs while passing every time
in isolation.

The isolation pass is the diagnosis, not the acquittal. "Passes alone,
fails in the suite" means the test measures contention, and the honest fix
is to widen the budget of the test that measures the wrong thing, not to
shrink the file that exposed it. A per-test timeout with a comment saying
what it is *not* asserting keeps the next person from re-tightening it.
