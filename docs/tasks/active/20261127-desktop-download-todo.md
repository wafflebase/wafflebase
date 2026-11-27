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

- [ ] A: homepage download entry (nav/hero CTA + section or footer), OS-aware
- [x] B: docs page `start/desktop.md` + sidebar entry (plus desktop entries
  in `start/troubleshooting.md`, "Allow desktop app sign-in" in
  `developers/self-hosting/sign-in.md`, two config rows)
- [ ] Mobile Before → After for the homepage change (CLAUDE.md)
- [ ] verify:fast, self-review, PR

## Review

(pending)
