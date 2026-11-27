# Desktop app download guidance

Follow-up to #1206. The desktop app now ships with every server release
(`releases/latest/download/Wafflebase_universal.dmg`,
`Wafflebase_x64-setup.exe`; names pinned by
`scripts/test/desktop-release.test.mjs`), but nothing tells anyone it exists.

## Decisions

- Two surfaces, built in parallel: (A) a download entry on the homepage
  (`packages/frontend/src/app/home/`), (B) a guide page in the docs site at
  `packages/documentation/start/desktop.md` → `/docs/start/desktop`, beside
  the phone guide. A links to B for install notes.
- Both platforms offered, the visitor's OS first; Windows says plainly that
  it is not code-signed yet (SmartScreen "More info → Run anyway").
- The download entry is not shown inside the desktop app itself
  (`isDesktopShell()`).
- Links resolve only after the first release that carries the app (0.6.19);
  merge with or after that release.

## Todo

- [x] A: homepage download entry (nav/hero CTA + section or footer), OS-aware
  — `DesktopSection` between Developers and Open source, a quiet hero link
  and a footer entry to `/#desktop`; all three absent in the desktop shell
- [x] B: docs page `start/desktop.md` + sidebar entry (plus desktop entries
  in `start/troubleshooting.md`, "Allow desktop app sign-in" in
  `developers/self-hosting/sign-in.md`, two config rows)
- [ ] Mobile Before → After for the homepage change (CLAUDE.md)
- [x] verify:fast, self-review (3 rounds; round 3 clean), PR

## Review

- Homepage: `DesktopSection`, a hero link and a footer entry, OS-aware, gated
  by `offerDesktopDownload()` (not in the desktop shell; not before
  `FIRST_DESKTOP_RELEASE`, so an early merge shows nothing).
- Docs: `start/desktop.md` (+ troubleshooting, self-hosting sign-in/config).
- Every download link (README, docs, homepage) is checked against the
  release workflow's upload step in `scripts/test/desktop-release.test.mjs`.
- Mobile Before → After composed locally; publishing it to `assets/pr-<n>`
  awaits the maintainer's OK.
