---
title: ui-review-polish
target-version: 0.3.3
---

# UI Review Polish

Follow-up improvements from the 2026-04-11 full-app UI design review.
Work is sequenced small-visible → structural so the user can give feedback
between each item.

## Scope

Landing, login, documents list, spreadsheet editor toolbar, docs editor
toolbar, app shell header, theme coverage.

Out of scope: landing live-demo fallback (production demo is seeded, no
work needed).

## Tasks

- [ ] 1. Login 카드화 + micro-links
  - Wrap `login-form.tsx` in shadcn `Card` at ~400px max-width
  - Add footer row with Terms / Privacy / GitHub links (micro text)
  - Screenshot before/after
- [ ] 2. 랜딩 히어로 타이포 + 비교표 라벨 통일
  - Apply `text-balance` (or max-width tweak) so hero title breaks cleanly
  - Unify comparison table cells: single icon + short label per cell,
    no ✓/✗ mixed with text
- [ ] 3. Documents 리스트 타입 배지/아이콘
  - Show Sheets vs Docs indicator on list items (`packages/frontend/src/app/workspaces/workspace-documents.tsx` and `documents/page.tsx`)
  - Pick icon convention (Table vs FileText) and apply consistently
- [ ] 4. 스프레드시트 포매팅 툴바 그룹 시각 구분
  - Visually separate logical groups in `components/formatting-toolbar.tsx`
    beyond the existing vertical `Separator` lines
- [ ] 5. 공용 Toolbar 프리미티브 추출
  - Introduce `components/ui/toolbar.tsx` (Toolbar, ToolbarGroup, ToolbarButton, ToolbarSeparator)
  - Refactor `formatting-toolbar.tsx` and `docs-formatting-toolbar.tsx` to use it
  - Ensure same button height / spacing tokens across Sheets + Docs
- [ ] 6. 헤더 라우트 handle 기반 title
  - Replace path-string matching in `app/Layout.tsx` with React Router
    route `handle` metadata
- [ ] 7. 랜딩 라이트 모드 지원
  - `app/home` respects current theme (currently hard-dark)
  - Verify homepage sections, demo iframe, footer all toggle cleanly

## Verification

- `pnpm verify:fast` before each commit
- Manual screenshots per task via puppeteer harness
- User confirms visually before moving on to next task

## Review Notes

(to be filled as tasks complete)
