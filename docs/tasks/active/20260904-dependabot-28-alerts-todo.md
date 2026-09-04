# Clear the 28 open Dependabot alerts

## Context

`https://github.com/wafflebase/wafflebase/security/dependabot` has 28 open
alerts (14 high / 13 medium / 1 low). Every one has a patch available inside
its current major line — no major upgrade is required.

Two structural causes:

1. **Dependabot security updates are disabled**
   (`automated-security-fixes: {"enabled": false}`,
   `dependabot_security_updates: "disabled"`), and there is no
   `.github/dependabot.yml`. No automated PR has ever opened, so every fix so
   far has been a hand-edited `pnpm.overrides` pin.
2. **Those pins have gone stale.** Four override entries now pin to a version
   that is itself vulnerable — `fast-uri@3.1.5`, `qs@6.15.2`,
   `js-yaml@3.15.0`, `js-yaml@4.3.0`. That accounts for 14 of the 28 alerts.

Reachability was traced with `pnpm why -r`; Dependabot's `runtime` /
`development` scope labels read the declaring manifest, not the real path, and
disagree with it in places (e.g. `js-yaml` #155 is labelled runtime but is
reached only through jest coverage).

## Tasks

### A. Bump the stale override pins — 14 alerts

- [x] `fast-uri@<3.1.5: 3.1.5` → `fast-uri@<3.1.6: 3.1.6` (8 alerts)
- [x] `qs@<6.15.2: 6.15.2` → `qs@<6.16.0: 6.16.0` (4 alerts)
- [x] `js-yaml@<3.15.0: 3.15.0` → `js-yaml@<3.15.1: 3.15.1` (1 alert)
- [x] `js-yaml@>=4.0.0 <4.3.0: 4.3.0` → `>=4.0.0 <4.3.1: 4.3.1` (1 alert)

### B. Direct dependency bumps — 10 alerts

- [x] `pdfjs-dist ^6.1.200 → ^6.2.108` (`packages/frontend`) — GHSA-hq66-cqwq-w95j,
      arbitrary JS execution on opening a malicious PDF. The one change with
      real regression risk: the viewer opens user-uploaded PDFs.
- [x] `@xmldom/xmldom 0.9.10 → 0.9.12` (`packages/frontend` pinned,
      `packages/cli` caret) — 2 alerts
- [x] `mysql2` → 3.23.1, `dompurify` → 3.4.13, `mermaid` → 11.16.1 — carets
      already admit the patch, lockfile refresh only (7 alerts)

### C. New overrides for transitive build-time deps — 4 alerts

- [x] `browserslist@<4.28.7: 4.28.7` (2 alerts)
- [x] `nanoid@<3.3.18: 3.3.18`
- [x] `@humanfs/node@<0.16.8: 0.16.8`

### D. `scripts/agent/` — 6 alerts

- [x] Separate npm lockfile outside the pnpm workspace, so `pnpm.overrides`
      does not reach it. Needs its own `overrides` block or `npm update`:
      `fast-uri` → 3.1.6 (4 alerts), `qs` → 6.16.0 (2 alerts).

### E. Verification

- [x] `pnpm verify:fast`
- [x] `pnpm verify:self`
- [x] Confirm no alert-listed version survives in either lockfile
- [x] PDF viewer verified against the real pdfjs 6.3.289 — typecheck, asset
      emission, and a Node runtime smoke of the exact build the viewer imports.
      See the Review section for why the mocked unit test is not evidence here.
- [ ] Browser click-through in `pnpm dev` (canvas painting + text-layer
      positioning) — **not done**; the smoke above covers the API surface only

### F. Recurrence

- [x] Note in the PR body that Dependabot security updates should be enabled
      repo-side; without it these pins go stale again. (Repo setting, not a
      code change — cannot be done from the branch.)

## Review

All 28 alerts are cleared. Every resolved version now meets or exceeds its
advisory's `first_patched_version`, verified against both lockfiles:

| package | was | now | required |
| --- | --- | --- | --- |
| `pdfjs-dist` | 6.1.200 | 6.3.289 | 6.2.108 |
| `mermaid` | 11.16.0 | 11.17.2 | 11.16.1 |
| `mysql2` | 3.23.0 | 3.24.3 | 3.23.1 |
| `dompurify` | 3.4.12 | 3.4.14 | 3.4.13 |
| `@xmldom/xmldom` | 0.9.10 | 0.9.12 | 0.9.12 |
| `browserslist` | 4.28.1 | 4.28.7 | 4.28.7 |
| `nanoid` | 3.3.17 | 3.3.18 | 3.3.18 |
| `@humanfs/node` | 0.16.6 | 0.16.8 | 0.16.8 |
| `fast-uri` | 3.1.5 | 3.1.6 / 3.1.7 | 3.1.6 |
| `qs` | 6.15.2 | 6.16.0 | 6.16.0 |
| `js-yaml` | 3.15.0 / 4.3.0 | 3.15.1 / 4.3.1 | 3.15.1 / 4.3.1 |

`npm audit` in `scripts/agent/` reports 0 vulnerabilities.

### The one judgement call: the mermaid carrier patterns

`packages/notes/src/view/mermaid.ts` keeps verbatim copies of mermaid's
**non-exported** `directiveRegex` / `frontMatterRegex`, and
`preview.test.ts` pins them to an exact installed version. Bumping mermaid
failed that test by design — the tripwire exists so nobody moves the constant
without re-diffing, since recognizing *less* than the engine does leaves a live
config-directive carrier.

So it was re-diffed rather than re-baselined. Against 11.17.2's shipped bundle:

- `directiveRegex` — byte-identical to `DIRECTIVE_RE`
- `frontMatterRegex` — byte-identical to `FRONTMATTER_RE`
- `htmlLabels` still appears only at the config root and on `flowchart` /
  `class`, the three `SECURE_KEYS` already pins. No new nested section.

The constant moved to `11.17.2` only after that, and the finding is recorded in
its doc comment so the next bump starts from a known-good diff point.

### Why the versions overshot the advisory minimums

`pnpm update` resolves to the newest release inside the declared caret, so
`mermaid`, `mysql2`, `dompurify` and `pdfjs-dist` landed above their minimum
patch. Nothing here widens a range that was not already declared — a clean
`pnpm install` on any fresh checkout would have picked the same versions.

### pdfjs-dist is the only change with real regression risk

6.1.200 → 6.3.289 crosses two minors, and the viewer opens user-uploaded PDFs.
`pdf-viewer.test.tsx` **fully mocks `pdfjs-dist`**, so a green suite proves
nothing about the real API. Checked separately:

- `frontend:check` / `frontend:build` typecheck the viewer against 6.3.289's
  real declarations (`pdf.d.mts` is a re-export stub onto `types/src/pdf.d.ts`),
  and every name the viewer uses is present there.
- `frontend:build` emitted 169 cmaps + 16 standard fonts, so the `pdfjs-assets`
  Vite plugin still resolves the package's asset layout.
- A Node smoke against the exact build the viewer imports
  (`pdfjs-dist/legacy/build/pdf.mjs`) parsed a real 2-page PDF: `getDocument`,
  `numPages`, `getViewport({scale})`, `getTextContent`, `TextLayer`,
  `GlobalWorkerOptions` and `loadingTask.destroy()` all behave as the viewer
  expects.

### Completed

- [x] A. Stale override pins bumped — 14 alerts
- [x] B. Direct dependency bumps — 10 alerts
- [x] C. New transitive overrides — 4 alerts
- [x] D. `scripts/agent/` npm `overrides` block — 6 alerts
- [x] E. `pnpm verify:fast` and `pnpm verify:self` both green (all 16 lanes)
- [x] E. Both lockfiles confirmed free of alert-listed versions
- [x] E. PDF viewer verified by typecheck + asset emission + runtime smoke
      (see above) rather than by the mocked unit test
- [x] F. Recurrence noted in the PR body

### Not done

- **Enabling Dependabot security updates is a repository setting**, not a code
  change, so it cannot land on this branch. Until someone flips it, these pins
  go stale again exactly as they did here. Raised in the PR body.
- No browser-driven click-through of the PDF viewer in `pnpm dev`; the runtime
  smoke above covers the pdf.js API surface but not canvas painting or text
  layer positioning in a real browser.
