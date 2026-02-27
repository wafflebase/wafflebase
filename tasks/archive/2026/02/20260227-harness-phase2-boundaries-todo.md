# TODO

- [x] Define phase-2 architecture-boundary scope for frontend and backend
- [x] Add frontend architecture lint config and script
- [x] Add backend architecture lint config and script
- [x] Wire architecture lint into root verification lane
- [x] Run architecture and fast-lane verification commands
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added frontend architecture lint profile (`eslint.arch.config.js`) and
  `pnpm frontend lint:arch`:
  - `api` cannot import from `app/components/hooks`
  - `hooks` cannot import from `app`
  - `components` cannot import from `app`
  - `components/ui` cannot import from `app/api`
  - `types` and `lib` cannot import from higher layers
- Added backend architecture lint profile (`eslint.arch.config.mjs`) and
  `pnpm backend lint:arch`:
  - disallow absolute imports of `*.controller` and `*.module`
  - keep `database` isolated from feature modules
  - keep `auth` isolated from document/datasource/share-link modules
  - keep `user` isolated from auth/document/datasource/share-link modules
- Added root `pnpm verify:architecture` and wired it into
  `pnpm verify:fast`.
- Updated command docs in `README.md` and `CLAUDE.md`.
- Verification:
  - `pnpm verify:architecture` passed
  - `pnpm verify:fast` passed
