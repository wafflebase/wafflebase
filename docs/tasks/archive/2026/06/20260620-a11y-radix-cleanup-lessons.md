# a11y + Radix cleanup — lessons

## Radix Themes ≠ Radix Primitives
The request linked the **Radix Themes** docs, but the project uses **Radix
Primitives** wrapped by **shadcn/ui** (`components/ui/`, new-york, Tailwind v4).
Different products — clarify which before "reviewing Radix usage". No migration
to Themes; the Primitives + shadcn stack fits the Canvas-heavy app.

## Keyboard handlers inside a Radix menu are dead code unless you steal focus
Both table-size grid pickers live inside `DropdownMenuContent`. Radix's
`FocusScope.onMountAutoFocus` focuses the **content container** (not a tabbable
child) and the content's keydown handler **prevents `Tab`** into descendants.
So a `tabIndex={0}` grid with `onKeyDown` never receives keys — the handler is
unreachable.

**Fix pattern:** on the menu content, `onOpenAutoFocus={(e) => { e.preventDefault();
gridRef.current?.focus(); }}`. When the grid lives in a child component, query it
from a content ref: `contentRef.current?.querySelector('[role="grid"]')?.focus()`.
Then `stopPropagation()` on the handled arrow/Enter keys so the menu's own
roving-focus handler doesn't fire and steal focus back.

**Lesson:** when adding keyboard nav to a custom widget rendered inside a Radix
overlay (Menu/Popover/Dialog), verify the element actually receives focus —
don't assume `tabIndex` is enough. Test reachability, not just handler logic.

## `aria-label` vs `title` for icon buttons
`title=` is a tooltip, NOT a reliable accessible name (screen readers may ignore
it, no keyboard/touch surface). For icon-only buttons add `aria-label` for the
name AND a Radix `Tooltip` for the visible hint — they serve different users.

## Toggle conversion preserves a11y for free
Radix `Toggle` sets both `data-state=on` and `aria-pressed`, and the project's
`toggle.tsx` keys its pressed visual off `aria-pressed` too (survives the
`data-state` clobber when wrapped in `TooltipTrigger asChild`). Converting a
hand-rolled `<button aria-pressed>` to `<Toggle pressed onPressedChange>` keeps
state semantics and adds consistent styling. Override sizing via `className`
(tailwind-merge lets later `h-/w-/min-w-/p-` utilities win) to fit compact bars.

## React 19 shadcn wrappers: no forwardRef by design
The `components/ui/*` wrappers are function components (ref-as-prop). Missing
`forwardRef`/`displayName` is correct for React 19, not a defect.

## Stage 4 (Popover migration) deferred — audit overstated the value
A static audit flagged three hand-rolled popovers (sheets `CommentPopover`,
`DocsCommentPopover`, `docs-link-popover`) for migration to a new Radix
`Popover`. Deeper reading reversed the recommendation:

- **sheets CommentPopover**: bespoke right→left→stacked positioning that keeps
  the active cell uncovered (`sheet-view.tsx`). Radix's flip model can't
  replicate it — Radix would be a *downgrade*. Its only wart (a portal-exclusion
  click-outside hack) works fine.
- **docs-link-popover**: the audit called "no click-outside dismiss" a bug, but
  cursor tracking (`onCursorLinkChange`) already dismisses when the caret leaves
  the link. Every editor click is "outside" the Radix content, so naively
  enabling Radix outside-dismiss would close the popover *the instant it opens*.
- **DocsCommentPopover**: dismiss is owned by a parent collaboration hook and
  reply-input autofocus would fight Radix `FocusScope`.

All three are entangled with canvas hit-testing / editor focus / collab state
and can only be verified with a live app (DB + Yorkie + canvas). **Lesson:** a
static "should use Radix X" finding is a hypothesis, not a verdict — read the
runtime wiring (who owns open/close, what drives positioning) before adding a
dependency. Don't blindly refactor collaboration UI you can't manually verify.

## Verification gotcha
`tsc --noEmit -p tsconfig.app.json` reports many PRE-EXISTING errors in
untouched files — it is NOT the project gate. The real gate is `pnpm verify:fast`
(tokens build + lint + per-package typecheck + tests). Check that your edited
files don't appear in tsc output rather than expecting a clean run.
