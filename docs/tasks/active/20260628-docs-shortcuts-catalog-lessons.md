# Docs Keyboard Shortcuts Catalog Drift — Lessons

## What happened

The roadmap item "6.6 Full Keyboard Shortcuts mapping" looked far from done on
paper, but the infrastructure (single catalog, shared help modal, ⌘/Ctrl+/) was
already shipped. The real gap was **catalog drift**: runtime bindings live in a
plain `switch` in `text-editor.ts`, which is invisible to any static check, so
five implemented shortcuts never appeared in the help modal.

## Lessons

- **A checkbox in a roadmap is not ground truth.** Audit the actual code before
  estimating remaining work — here "0% / not started" was really "80% done, plus
  a drift bug." Reading `handleKeyDown` end-to-end found gaps the first survey
  missed (the initial pass only caught headings; word-nav, word-delete, and
  paste-formatting were also undocumented).

- **Non-symbolic dispatch invites drift.** A `switch`-based key handler has no
  introspectable table, so the catalog and the bindings can diverge silently.
  Mitigation used: a test that pins the known binding set + a header-comment
  dual-edit convention (same approach Slides already adopted).

- **Cross-platform honesty in a shortcuts reference.** `Cmd+Backspace` line-delete
  is Mac-only in the handler; documenting it cross-platform would mislead
  Windows/Linux users. Added a `WordMod` token (⌥ Mac / Ctrl elsewhere) so the
  word-level combos render correctly per platform instead of faking `Alt`.

- **TDD caught the WordMod formatting** before it shipped — the failing
  `formatCombo('WordMod+…')` test forced the token into `formatCombo`, which is
  easy to forget when only adding catalog rows.
