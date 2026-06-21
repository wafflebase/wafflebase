# Lessons — Slides Radix 폼 컨트롤 마이그레이션

## 테스트 위치 grep 범위

- **실수**: 마이그레이션 전 테스트 영향도 조사 시 `packages/frontend/src`만
  grep해 `tests/` 디렉터리의 `text-fitting-section.test.tsx`를 놓침. 또한
  literal "Do not autofit"로 검색했으나 테스트는 `/do not autofit/i` 정규식 →
  대소문자 불일치로 미검출.
- **규칙**: 컴포넌트 변경 영향도 조사 시 (1) `src`와 `tests` 양쪽을 grep, (2)
  aria-label은 case-insensitive로 검색, (3) 컴포넌트 이름(`SizePositionSection`)과
  파일 경로 양쪽으로 검색.

## Radix 마이그레이션 시 테스트 단언 변화

- native `<select>`/`<input>` → Radix는 DOM 구조가 바뀜:
  - radio: `<input type=radio>.checked` → `role=radio` 버튼의 `aria-checked` 속성.
  - select: `<select>` 태그 소멸 → button trigger. `select`/`option` 셀렉터 의존 테스트는 깨짐.
- `fireEvent.click(getByLabelText(...))`와 aria-label 조회는 양쪽에서 동일하게 동작 →
  상호작용 테스트는 대체로 무수정 통과. **상태(.checked/.value) 직접 단언만** 갱신 필요.
- 이 repo는 jest-dom 미설정 → `toBeChecked()`/`toHaveAttribute()` 없음.
  `.getAttribute('aria-checked')`로 직접 단언.

## Radix Select 값 타입

- Radix Select의 value/onValueChange는 **문자열 전용**. 숫자 상태(durationMs)를
  바인딩할 땐 `String(value)`로 내려보내고 `Number(value)`로 되돌려야 함.

## 반복 select 정리

- 동일 구조 select 5개는 제네릭 `MotionSelect<T extends string>` 로컬 헬퍼로
  통합해 중복 제거. label→aria-label 파생(`Animation ${label.toLowerCase()}`)으로
  기존 접근성 이름 보존.
