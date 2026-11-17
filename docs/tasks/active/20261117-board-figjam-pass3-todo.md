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

- [ ] **A. Ink core**
  - Marker is a real tool: `M`, a top-level toolbar button with a colour
    and width chosen before drawing, and it stays armed until Esc.
  - A finger draws while the marker is armed.
  - Freeform hit-testing follows the path, not the bbox.
  - Smoothing, screen-px decimation and simplification.
  - Shift draws a straight line.
  - Highlighter and stroke eraser.
- [ ] **B. Sticky flow**
  - Mod+Enter and Tab add a sticky next to the selected one.
  - Free-spot search covers more than one row.
  - A multi-line text paste makes one sticky per line.
  - Paste lands in the viewport.
  - S/M/L and wide presets.
  - Text size on the selected sticky.
  - A `role: 'sticky'` marker.
  - Author tag and anonymous mode.
- [ ] **C. Connectors**
  - A connector dropped on a shape body glues to the nearest site.
  - Align and distribute skip connectors.
  - Connector labels.
- [ ] **D. Sections**
  - Shift+S draws a titled section that carries what it contains.
  - Hide and lock.
  - Delete keeps the contents.
  - Fit and navigation can target a section.
  - The Miro importer turns `frame` into a section.
- [ ] **E. Presence and facilitation**
  - Peer cursors v2: throttle, spring, arrow and name tag.
  - Off-screen indicator.
  - Follow / spotlight.
  - Cursor chat (`/`) and emotes.
  - Shared timer.
  - Find out why the first click after a popover closes is swallowed.
- [ ] **F. Board polish and utilities**
  - Pastel default shapes on the board and board vocabulary.
  - Fit leaves room for the minimap; the zoom label stops saying Fit
    after a pan.
  - Tidy up into a grid; select similar.
  - PNG and PDF export.
- [ ] **H. Stamps, voting, comments**
  - Stamps on elements.
  - A voting session with limits and hidden votes.
  - Board comments through the shared comments module.

## Wave 2 (on the merged wave 1)

- [ ] **G. Live ink**
  - The live stroke travels in presence.
  - Laser pointer.
  - Compact stroke storage.
  - Lasso.
  - Shape recognition.
- [ ] **I. Dock and agents**
  - Bottom tool dock with a curated shape list.
  - Board templates (retro, brainstorm).
  - CLI board commands that let an agent cluster and summarise stickies.

## Integration

- [ ] Merge every branch and resolve conflicts.
- [ ] `pnpm verify:fast` and `verify:self` green.
- [ ] Browser smoke in `pnpm dev` (brainstorm and sketch scenarios).
- [ ] Design doc § Third pass updated with what shipped.
- [ ] `/self-review` rounds logged in lessons.
- [ ] PR opened.
