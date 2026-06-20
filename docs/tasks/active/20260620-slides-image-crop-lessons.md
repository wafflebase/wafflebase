# Lessons — Slides image crop (P0)

## Architecture / domain

- **Crop is a normalized source-rect, stretched onto the element frame.**
  The renderer's `drawImage(img, sx,sy,sw,sh, 0,0,w,h)` means crop math is
  independent of the image's natural pixel size: `full`/`window` derive
  from `frame` + `crop` alone (`fullW = frame.w / crop.w`). This kept the
  whole interaction renderer-natural-size-agnostic and let the model-layer
  math be pure and trivially testable.

- **Don't abuse the ghost path for a different effect.** The renderer's
  ghost system paints ghosts *on top* at `GHOST_ALPHA`. For crop we needed
  dimmed-full *under* + bright-window *over*, which is the inverse. A
  dedicated `cropPreview?` param (mask the element, paint dim-then-clip)
  was cleaner than fighting the ghost ordering.

- **`MemSlidesStore.updateElementData` deletes keys whose value is
  `undefined`** (`memory.ts`: `Object.entries(patch)` → `delete merged[k]`
  when `v === undefined`). So `{ crop: undefined }` genuinely clears the
  crop rather than leaving a stale value. Verified before relying on it.

- **`repaintOverlay` had no `disposed` guard** (unlike `render`). Any
  interaction that keeps document `pointermove` listeners alive past
  `detach()` could paint into an orphaned overlay. New per-drag loops must
  either be torn down on detach or guard against a dead session — I did
  both (guard + self-removing pointerup).

## Process

- **Never run one git commit in the background while issuing another in
  the foreground.** I launched the docs commit with `run_in_background`
  and immediately ran the implementation commit; they raced on the index
  /lock and collapsed into a single commit with the wrong message. Commits
  mutate shared git state — run them sequentially in the foreground.

- **The rtk shell wrapper mangles `grep`/`ls` output** in this repo
  (collapses lines to `[file] N (1)` noise, hides `ls`). Use the `Read`
  tool or invoke `rg` with explicit args for file inspection; don't trust
  piped `grep` output for line numbers.

- **Self-review caught the real issues, not the tests.** The high-effort
  multi-agent review surfaced the `disposed`-guard leak, the dead `before`
  state, and the duplicated drag loop — none of which the passing tests
  flagged. Worth running before pushing.
