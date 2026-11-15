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
