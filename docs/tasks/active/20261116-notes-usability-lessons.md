# Notes usability pass — lessons

- **Check which checkout the dev server serves.** `localhost:5173` was a
  sibling checkout (`wafflenotes`), so the first browser look after editing
  showed unchanged UI. `lsof -a -p <pid> -d cwd` on the listener answers it;
  run this branch on spare ports (frontend 5176 with
  `VITE_BACKEND_API_URL`, backend 3001 with `PORT` + `FRONTEND_URL`).
- **`pnpm add` inside one package prunes the workspace.** Run a root
  `pnpm install` afterwards, or other packages' `node_modules` links dangle.
- **A branch backend needs fresh engine `dist/`s** (`core`, `sheets`, `docs`,
  `slides`, `board`), or `nest start` fails on stale exports.
- **The source editor was CommonMark, the preview GFM.** Theming the editor
  is what exposed it: `[x]` highlighted as a link. Look at real content in
  the source pane, not just the preview.
- **jsdom drops `max()` / `calc()` inline styles**, so a padding assertion on
  one passes in the browser and fails in Vitest. Assert the class instead.
- Self-review round 1: one blocker (test-adequacy) — `setHeading` missing from the read-only no-write test and from an end-to-end API test. Fixed: added it to the read-only guard and a store-level API test.
- **The commit-msg hook caps body lines at 80 chars.** A failed commit after
  a green `verify:fast` is that hook, not a flaky test — wrap the body with
  `$'...\n...'` before suspecting the suite.
- Self-review round 2 (design fit, via requesting-code-review): two should-fix — `ul.contains-task-list` hid bullets on plain items in a mixed list; heading read/set touched `#` lines inside code fences. Fixed both (item-scoped marker rule; GFM syntax-tree code check + tests). Also: search-match outline off syrup, theme `mode` doc, design doc notes preview-only mounts. Deferred: shared shortcut catalog, radiogroup semantics for view modes, setext heading detection.
- Self-review round 2 panel: one blocker (test-adequacy) — no test for leaving Preview on a phone. Fixed: toolbar test taps the pressed Preview toggle in `view` mode and expects `edit`.
- Self-review round 3 (final): one blocker (correctness) — `inCode` read the lazily-parsed tree, so a long multi-line `setHeading` could write into a fence past the parsed range. Fixed: `ensureSyntaxTree` to the selection end, lines still unparsed are skipped; test with a fence past the initial parse (verified the tree stops 18 chars short of it). Loop ended at the 3-round bound; this fix has not had a panel round.
