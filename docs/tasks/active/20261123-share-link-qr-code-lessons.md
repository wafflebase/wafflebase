# Share link QR code (#1193) — lessons

**Created**: 2026-11-23

## Notes

- A QR code is unreadable when the dark modules follow the app theme: a
  scanner needs dark-on-light with a quiet zone. The component therefore
  pins `#000` on `#fff` in both themes and relies on the surrounding card
  for theme fit, instead of using `currentColor`.
- PNG export goes through a canvas drawn from the same boolean matrix the
  SVG uses, so the two exports cannot disagree about what was encoded.
- `navigator.clipboard.write` with an image blob is unsupported in some
  browsers (and in jsdom); the copy path reports the failure as a toast
  rather than throwing.

## Review rounds

- Round 1–3: not run. This change was produced by the autonomous agent
  pipeline, which is granted no tool that can dispatch the `/self-review`
  reviewer subagent. Review is CI, `@claude review`, and a human.
