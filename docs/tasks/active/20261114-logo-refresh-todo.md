# Logo refresh — one mark everywhere

The in-app mark (3×3 syrup squares on a butter tile, drawn from the
`--wb-*` variables) lost its outline in dark mode, where `--wb-syrup-deep`
flips to butter. The favicon was an unrelated Lucide `grid-2x2-plus` with a
white stroke, invisible on a light browser tab. The docs site and README had
no mark at all.

## Plan

- [x] Round 1: syrup tile + butter pockets + cream A1 pocket. Applied, then
      rejected by the user as dated (two-tone tile of rounded squares reads
      as a keypad / clip art).
- [x] Benchmark (Anthropic, Notion, Linear, Vercel, Google Workspace,
      Microsoft 365, Slack) and propose three one-color directions: Facet
      (45° waffle grid), Pressed (tile with pocket holes), Selected Cell
      (cell in a selection frame). Dropped on the way: `#` (Slack/hashtag),
      W with a crossbar (reads as ₩), w + dot (reads as a person).
- [x] User chose **A. Facet**.
- [x] Wordmark font check: six candidates rendered in the lockup. Chose
      Fraunces 500 at `opsz` 144, -0.025em (`.wordmark`); no new font load.
- [x] `WaffleLogo` → Facet in `--wb-syrup`.
- [x] `public/icon.svg` (with a dark-scheme rule), `public/apple-touch-icon.png`,
      `<link rel="apple-touch-icon">`.
- [x] Docs site: `themeConfig.logo`, favicon, nav title in the wordmark style.
- [x] README header mark.
- [x] DESIGN.md: Mark section, Wordmark type role, sidebar note.
- [x] Verify: homepage nav light/dark, sign-in, docs nav light/dark rendered.
- [x] No visual baseline covers the homepage, sign-in or sidebar.
- [x] `pnpm verify:fast`

## Review

Four copies of one geometry (component, favicon, touch icon, docs SVG) and
two copies of the wordmark style (app `.wordmark`, docs nav title);
DESIGN.md names all of them.
