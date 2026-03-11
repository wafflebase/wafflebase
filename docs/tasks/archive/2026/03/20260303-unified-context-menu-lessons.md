# Unified Context Menu — Lessons Learned

## Decisions

- Chose Radix ContextMenu over custom implementation for consistency with
  existing shadcn/ui pattern used across the frontend.
- Mobile long-press triggers a synthetic `contextmenu` event rather than
  using Radix's controlled `open` prop, keeping the trigger path unified.
- Tab bar switches from DropdownMenu to ContextMenu for true right-click
  behavior.

## Observations

- Radix ContextMenu responds to synthetic `MouseEvent("contextmenu")` events
  dispatched from touch handlers, confirming the unification approach works.
- The `ContextMenuTrigger` component must wrap a DOM element (not a Canvas
  directly) — wrapping the container div works well.
- Pre-commit hook enforces 70-char max on commit subject lines; plan commit
  messages accordingly.
- Visual regression baselines for composite screenshots change when any
  individual scenario card changes (e.g. chart scenarios shifted because
  context menu card dimensions changed).
- Removing the vanilla JS ContextMenu from Worksheet deleted ~140 lines of
  DOM manipulation code, replaced by the shared React component.
