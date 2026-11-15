# Impeccable audit fixes — lessons

- The dev server on :5173 belonged to another checkout (`waffledocs`). Check
  the process cwd (`lsof -p <pid> | grep cwd`) before trusting a rendered
  audit of localhost.
- A render-tick `setState({...obj})` that looks like waste can be the only
  thing re-running a layout effect (the sheet comment popover follows its cell
  on scroll that way). Find every consumer of the state before memoizing its
  identity.
- A class-only "full-screen on mobile" switch for a docked panel inverts its
  stacking against everything it was a sibling of (the revision preview, the
  mobile edit bar). Mobile panels need a designed bottom sheet, not `fixed
  inset-0`.

## Self-review

- Round 1: blocked on correctness (activeCellForComment memo stopped the
  comment popover following scroll), blast-radius (mobile history overlay hid
  the revision preview it drives), test-adequacy (lazy upload deps, slides
  resizer migration). Reverted the memo and the mobile panel overlay; added
  `upload-queue-lazy-deps.test.ts`; extracted `attachPanelResizer` with unit
  tests. Also took the non-blocking docs-engine smooth scroll. Deferred: Miro
  dialog still pulls the board engine statically (sync `mapMiroItems`).
- Round 2: panel blocked on test-adequacy (factory mocks in the lazy-deps
  test hid a renamed export) — added `vi.importActual` checks on the real
  modules. The superpowers code reviewer (round 2's second seat) found the
  font-size pill's steppers were deliberately ring-less (the pill's
  `focus-within` ring covers them) and the tab rename input's underline is its
  focus indicator — both reverted to `outline-none`; a splitter `pointerdown`
  no longer cancels focus moves, so `mousedown` is cancelled too; a stale
  importer chunk now asks for a reload; deep links prefetch the PrivateRoute
  chunk (`isPrivatePath`). Left as known limitation: the 44px coarse-pointer
  dialog close box can overlap a long title.
- Before replacing `outline-none` with a focus ring, read the surrounding
  comment: a compound control (the font-size pill) may carry focus on its
  container on purpose. The audit's grep cannot see that.
