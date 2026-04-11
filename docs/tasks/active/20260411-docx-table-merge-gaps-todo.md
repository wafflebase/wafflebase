# DOCX 테이블 병합/구조 import 보강

**Status:** in-progress
**Branch:** `fix-docx-import-bugs`
**Scope:** `packages/docs/src/import/docx-importer.ts`, `packages/docs/src/import/docx-style-map.ts`

## 배경

`a7bac962` 에서 가로 병합 placeholder padding, `40539722` 에서 nested `tblGrid` leak을
고쳤다. 테이블 병합 import 전반을 리뷰한 결과, merge 계약을 깨는 엣지 케이스와
주변 스타일 gap이 남아 있음. 한 번에 한 건씩 고치며 회귀 테스트 추가한다.

## 병합 정확성 (priority: high)

- [x] **1. `w:gridBefore` / `w:gridAfter`** — `trPr` 안의 `gridBefore(w:val=N)` / `gridAfter` 를
      처리해서 row 시작/끝에 `colSpan=0` placeholder N개를 채운다. 없으면 해당 row는
      `cells.length < numCols` 가 되어 click/layout 이 어긋남. 한국 공공문서에 흔함.
      → `readGridSkip` 헬퍼로 trPr 스킵 값을 읽고 row 시작/끝에 covered cell 삽입.
- [x] **2. vMerge 모양 불일치 방어** — row N의 `vMerge=restart` 가 `gridSpan=3` 인데
      후속 row 의 `vMerge=continue` 가 `gridSpan=1` 이면 placeholder 수가 어긋남.
      restart 당시 gridSpan을 tracker 에 기록하고, continue 에서 더 작으면 그만큼 강제로
      늘려서 row 가 정사각형을 유지하게 한다.
      → tracker 에 `colSpan` 추가, continue 에서 `Math.max(cellSpan, owner.colSpan)` 적용.
- [ ] **3. 고아 vMerge continue** — tracker 가 없는 상태에서 `vMerge=continue` 가 오면
      (일부 파일에서 발견) 해당 tc를 standalone owner 로 승격. 조용히 unreachable
      covered cell을 만들지 않는다.
- [ ] **4. gridSpan 경계 초과 clamp** — `colSpan` 이 남은 컬럼 수를 넘으면
      `Math.min(colSpan, numCols - colIdx)` 로 잘라서 `colIdx` 가 `numCols` 를 넘지
      못하게 한다. `numCols === 0` (tblGrid 누락) 인 경우 row 의 실제 tc 개수로 폴백.
- [ ] **5. 최종 row shape normalize** — row 끝에서 `cells.length < numCols` 면 꼬리에
      placeholder 를 패딩하고, `> numCols` 면 잘라낸다. 위 1~4가 누락해도 downstream
      계약을 지키는 안전망.

## 테이블 스타일/구조 gap (priority: medium)

- [ ] **6. `w:tcMar`** (cell margin/padding) → `CellStyle.padding` 반영
- [ ] **7. `w:vAlign`** (cell 수직 정렬) → `CellStyle.verticalAlign`
- [ ] **8. `w:tblBorders` 상속** — cell 에 `tcBorders` 가 없으면 tblBorders 로 폴백
- [ ] **9. `w:trHeight`** → `TableData.rowHeights`

## 검토 후 결정

- [ ] **10. `w:tblW` / `w:tcW` 반영 여부** — 현재 `tblGrid` ratio 만 쓴다. 필요성 판단.
- [ ] **11. header/footer 내부 테이블 지원 여부**
- [ ] **12. 중첩 테이블 flatten → native render 로드맵에 추가**

## 작업 규칙

- 각 항목마다 fixture 기반 vitest 추가 → 구현 → `pnpm --filter @wafflebase/docs test docx-importer` 로 확인.
- 항목 단위로 commit (subject ≤70 char, body 는 "왜" 설명).
- 전부 끝나면 `docs/design/docs/docs-docx-import-export.md` 의 테이블 섹션 업데이트.
- 완료 전 `pnpm verify:fast` 통과.

## Review

(each item appended here on completion)
