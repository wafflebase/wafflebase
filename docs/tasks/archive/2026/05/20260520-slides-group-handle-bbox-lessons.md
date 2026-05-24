# Lessons — slides group handle bbox + rotation UX

## Diagnosis lesson: instrument before guessing

The "left/top off after re-select" bug was almost diagnosed wrong twice.
Both times the math looked correct on inspection. The console-log
session — `[pointerdown]`, `[refitPoppedScope]`, `[refit/y]`,
`[overlay/group]`, `[startResize/group]` — surfaced the actual cause in
the first scroll: `[refit/y]` never fired. The empty-canvas click path
in `onPointerDown` bypassed `selection.click` entirely, so the refit
hook (which was wired into `selection.click` call sites) never ran.

Lesson: when the user reports a UX bug whose math looks fine,
instrument the actual code path **before** more code reading. The
shortest answer is often "this branch never runs."

## Math invariant: `T_new(P_old − shift) = T_old(P_old)`

The rotation-preserving refit comes out of writing the equality and
solving for `O_new`:

```
T_old(P) = R_θ(S · (P − C_old)) + O_old
T_new(P) = R_θ(S · (P − C_new)) + O_new
```

With `P_new = P_old − shift`, `C_old = (refSize.w/2, refSize.h/2)`,
`C_new = (localW/2, localH/2)`, `shift = (lx, ly)`, the children-
invariance condition resolves to:

```
O_new = O_old − R_θ(S · (C_old − shift − C_new))
```

The earlier (wrong) draft of this formula had the sign flipped and
produced visibly wrong frame positions in the round-trip test. **Always
unit-test the math with a concrete numeric round-trip before wiring it
into the editor** — the sign error would have shipped if I'd only
verified by inspection.

## UI reuse: ghost pattern fits more gestures than "move"

`paintMoveGhost(ghosts, handleElements)` was built for shape-move drags
(handles anchor to start frame, ghost previews the drop position). The
same primitive serves rotate without changes — `ghosts` carry the
rotated frame, `handleElements` stay at the start frame. Whenever a
gesture is "show the result without committing until release," reach
for `paintMoveGhost` before writing a parallel preview path.

## DOM ownership: lifetime ≠ visibility

The rotate-angle tooltip lives on `overlay.parentElement`, not the
overlay itself, because `renderOverlay` does `innerHTML = ''` on every
call. Anything that needs to persist across overlay rebuilds has to
live one level up. Symmetric obligation: `detach()` must remove it
explicitly — the overlay-owned listeners + children get cleaned up
"for free" by the next mount; parent-owned elements do not.

The reviewer caught this on the first pass — I'd shipped the tooltip
without `detach()` cleanup. Quick lookup rule: **any DOM element
appended OUTSIDE the parent the editor renders into needs explicit
teardown.**

## Yorkie proxy: spread-merge vs full-replace

`updateElementFrame` uses `{ ...eAny.frame, ...patch }` (merge) because
its API takes `Partial<Frame>`. `refitGroup` uses `{ ...newFrame }`
(full replace) because the refit fully recomputes every field. Both
work with Yorkie's proxy — the gotcha is mismatching the contract. A
`Partial`-shaped API that internally does full-replace would
silently drop unspecified fields and produce subtle bugs.

## Scope-pop is a "settle point", not a transition

Drill-out (Esc, click outside, etc.) is the natural moment to
materialize editor-only display state (the dynamic AABB) into the
store. Doing it on every child mutation generates CRDT churn and undo
noise; doing it never lets snap/align/multi-select operate on stale
geometry. The Selection class stays pure; the editor wires the
"capture beforeScope → invoke `selection.click` → diff → refit popped
groups" pattern at every scope-pop entry point. **Adding a new
scope-pop trigger means adding the same three-step pattern there
too** — checked: keyboard Esc, pointer-down element hit, pointer-down
empty canvas, context-menu, all covered.
