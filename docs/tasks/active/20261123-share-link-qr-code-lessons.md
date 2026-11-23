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

- `react-refresh/only-export-components` is an **error** here (`--max-warnings 0`),
  so a `.tsx` file may export components and nothing else. That forced the
  split the file layout now has: encoding/export in `src/lib/qr-code.ts`,
  React in `src/components/qr-code.tsx`, and `shareLinkUrl` into
  `src/api/share-links.ts` rather than beside `ShareDialog`. Worth knowing
  before putting a helper next to the component that uses it.
- Frontend unit tests do not resolve `@wafflebase/core/url` until
  `pnpm --filter @wafflebase/core build` has run in the workspace; without it
  `share-dialog.test.tsx` fails to collect for a reason that has nothing to
  do with the change under test.

## Review rounds

- Round 1–3: not run. This change was produced by the autonomous agent
  pipeline, which is granted no tool that can dispatch the `/self-review`
  reviewer subagent. Review is CI, `@claude review`, and a human.
