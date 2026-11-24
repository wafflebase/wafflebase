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

- **Run `pnpm install` only to add the one dependency, and read the lockfile
  diff.** The first push re-resolved unrelated entries — new `deprecated:`
  notes (one a multi-line `|-` block) and a vitest `@types/node` peer drift —
  and the agent-install lockfile allow-list refuses a multi-line scalar, so
  `scripts:tests` went red on a change that had nothing to do with it. The
  fix was main's lockfile plus the three `uqr` hunks.
- **A capability URL never goes in a DOM attribute.** Sentry's `ui.click`
  breadcrumb serializes `aria-label`/`title`/`alt`/`name` into
  `crumb.message`, which the scrubber did not reach. Label the element
  generically and keep the URL in text content.

## Review rounds

- Round 1–3: not run. This change was produced by the autonomous agent
  pipeline, which is granted no tool that can dispatch the `/self-review`
  reviewer subagent. Review is CI, `@claude review`, and a human.
- Panel round 1 (d14d12e1f): 5 blocking. Maintainer fix round: lockfile
  restored to main + `uqr`; URL removed from `aria-label`/`title`;
  breadcrumb `message` redaction in `sentry.ts`; `shareLinkUrl` honours
  `VITE_FRONTEND_BASENAME`; tests now check the quiet zone and finder
  patterns and click the export actions. Also took the suggestions to defer
  `revokeObjectURL` and to catch a rejected PNG render.
