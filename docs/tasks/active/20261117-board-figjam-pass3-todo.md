# Board FigJam pass 3: brainstorming and sketching

A three-way audit on 2026-11-17 compared the board with FigJam for a
brainstorm and for a sketch:

- FigJam research
- a code audit with file:line evidence
- a hands-on browser session running a retro and a wireframe

Its findings and the plan are in
`docs/design/board/board-figjam-parity.md` § Third pass. All of it ships
in one PR, built by parallel agents on separate worktrees and merged
into `board-figjam-pass3`.

## Wave 1 (parallel)

- [x] **A. Ink core**
  - Marker is a real tool: `M`, a top-level toolbar button with a colour
    and width chosen before drawing, and it stays armed until Esc.
  - A finger draws while the marker is armed.
  - Freeform hit-testing follows the path, not the bbox.
  - Smoothing, screen-px decimation and simplification.
  - Shift draws a straight line.
  - Highlighter and stroke eraser.
- [x] **B. Sticky flow**
  - Mod+Enter and Tab add a sticky next to the selected one.
  - Free-spot search covers more than one row.
  - A multi-line text paste makes one sticky per line.
  - Paste lands in the viewport.
  - S/M/L and wide presets.
  - Text size on the selected sticky.
  - A `role: 'sticky'` marker.
  - Author tag and anonymous mode.
- [x] **C. Connectors**
  - A connector dropped on a shape body glues to the nearest site.
  - Align and distribute skip connectors.
  - Connector labels.
- [x] **D. Sections**
  - Shift+S draws a titled section that carries what it contains.
  - Hide and lock.
  - Delete keeps the contents.
  - Fit and navigation can target a section.
  - The Miro importer turns `frame` into a section.
- [x] **E. Presence and facilitation**
  - Peer cursors v2: throttle, spring, arrow and name tag.
  - Off-screen indicator.
  - Follow / spotlight.
  - Cursor chat (`/`) and emotes.
  - Shared timer.
  - Find out why the first click after a popover closes is swallowed.
- [x] **F. Board polish and utilities**
  - Pastel default shapes on the board and board vocabulary.
  - Fit leaves room for the minimap; the zoom label stops saying Fit
    after a pan.
  - Tidy up into a grid; select similar.
  - PNG and PDF export.
- [x] **H. Stamps, voting, comments**
  - Stamps on elements.
  - A voting session with limits and hidden votes.
  - Board comments through the shared comments module.

## Wave 2 (on the merged wave 1)

- [x] **G. Live ink**
  - The live stroke travels in presence.
  - Laser pointer.
  - Compact stroke storage.
  - Lasso.
  - Shape recognition.
- [x] **I. Dock and agents**
  - Bottom tool dock with a curated shape list.
  - Board templates (retro, brainstorm).
  - CLI board commands that let an agent cluster and summarise stickies.

## Integration

- [x] Merge every branch and resolve conflicts.
- [x] `pnpm verify:fast` and `verify:self` green.
- [x] Browser smoke in `pnpm dev` (brainstorm and sketch scenarios).
- [x] Design doc § Third pass updated with what shipped.
- [x] `/self-review` rounds logged in lessons.
- [ ] PR opened.

## Review

- **Built by:** 10 implementation agents in two waves, plus an
  integrator, three fix agents and a browser tester.
- **Merges:**
  - Every branch was merged into `board-figjam-pass3`.
  - `origin/main` was merged in, carrying #1170, the phone fit. Its "+"
    insert sheet was folded into the dock.
  - `verify:self` was green after every merge.
- **Browser smoke** (:5180 / :3001, about 20 checks):
  - It found 2 major and 6 minor bugs, all fixed with regression tests.
  - Of those, m4 (Tidy up stacking two rows) could not be reproduced, and
    a guard test was added for it.
- **Self-review:** 3 rounds, the bound.
  - Round 1: 6 findings, all fixed.
  - Round 2: 1 new finding, fixed; design-fit and security lenses failed
    on infrastructure.
  - Round 3: the rebuttals were upheld in our favour; 5 new findings came
    in, all fixed after the loop.
- **Not done:**
  - The mobile Before → After captures and a browser re-check of the
    fixes.
  - Docker's localhost:8080 forward to Yorkie stopped answering, so no
    board loads locally.
  - Both are listed as pending in the PR.
