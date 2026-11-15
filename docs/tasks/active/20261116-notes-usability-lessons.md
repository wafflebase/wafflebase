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
