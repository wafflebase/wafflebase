# Before → After captures — lessons

- **The session payload is the user.** The app reads name/email from the
  JWT, not the database; a token minted with a placeholder name and empty
  email left every editor on "Loading…". Read the real row (`--user` id →
  Prisma) instead of inventing one.
- **zsh `$var:r` is a modifier.** `"$C:refs/heads/…"` expanded `:r` and
  mangled the refspec; brace it (`"${C}:refs/…"`) or push from Node.
- **Real right-clicks in Playwright pick menu items.** Open context menus
  with a dispatched `contextmenu` event in capture steps.
