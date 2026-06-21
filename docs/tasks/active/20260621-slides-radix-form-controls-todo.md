# Slides 패널 네이티브 폼 요소 → Radix 마이그레이션

## 배경

Radix 채택 검토 결과, frontend는 `components/ui/` 래퍼로 14개 Radix 패키지를
일원화해 쓰고 있으나, 최근 추가된 Slides 모션/포맷 패널이 컨벤션을 건너뛰고
네이티브 폼 요소를 직접 사용 중. 같은 파일 안에서 Slider 래퍼와 native range가
공존하는 등 일관성 누수. 본 작업은 이 누수를 정리한다.

## 대상 (grep 검증 완료)

- `app/slides/motion-panel/animation-section.tsx`
  - native `<select>` ×5 (category/effect/direction/start/easing)
  - native `<input type="range">` ×1 (duration)
  - native `<input type="checkbox">` ×1 (by paragraph)
- `app/slides/motion-panel/transition-section.tsx`
  - native `<select>` ×2 (type/speed)
- `app/slides/format-panel/text-fitting-section.tsx`
  - native `<input type="radio">` ×3 (autofit mode)
- `app/slides/format-panel/size-position-section.tsx`
  - native `<input type="radio">` ×2 (unit in/cm)

## 작업 항목

- [x] `@radix-ui/react-radio-group` 의존성 추가 (^1.4.1)
- [x] `components/ui/radio-group.tsx` 래퍼 생성 (shadcn 패턴)
- [x] `animation-section.tsx`: select→Select(×5, MotionSelect 헬퍼), range→Slider, checkbox→Checkbox
- [x] `transition-section.tsx`: select→Select ×2
- [x] `text-fitting-section.tsx`: radio→RadioGroup
- [x] `size-position-section.tsx`: unit radio→RadioGroup
- [x] aria-label 보존 (접근성/테스트 셀렉터 동등성)
- [x] `pnpm verify:fast` green (EXIT=0, 933 tests)
- [x] 프로덕션 빌드 green (EXIT=0)

## 리뷰

- 네이티브 폼 요소 전부 제거: `<select>`×7, `range`×1, `checkbox`×1, `radio`×5.
- `animation-section`의 5개 동일 구조 select는 제네릭 `MotionSelect<T>` 헬퍼로
  통합해 중복 제거. category 변경 시 effect 동시 갱신 로직은 onChange 콜백에 보존.
- Slider/Checkbox는 number[]/boolean 콜백 시그니처에 맞춰 어댑트 (값 의미 동일).
- Radix Select는 native `<select>`가 아닌 button trigger로 렌더되므로 값은
  문자열만 허용 → transition speed의 숫자 durationMs는 `String()`/`Number()` 변환.
- `text-fitting-section.test.tsx`: native `.checked` → Radix `aria-checked` 속성으로
  단언 갱신 (테스트 의도=올바른 항목 선택, 접근성 표현으로 동등 검증). 2건 수정.
- `size-position-section.test.tsx`: aria-label 조회 + fireEvent.click 동작이
  Radix radio에서도 동일하게 통과 → 수정 불필요.

## 비범위

- 사이드 패널 공유 셸 추출 (별도 설계 필요)
- CommentPopover → Radix Popover (별도 의존성 도입)
- 아이콘 라이브러리 단일화
- Sheets 텍스트 포맷 툴바 정렬

## 검토 메모

- 해당 패널을 직접 타깃하는 단위/통합 테스트 없음 (grep 확인) → 회귀 위험 낮음.
- Radix Select는 native `<select>`가 아닌 button trigger로 렌더 → DOM 변화.
  aria-label은 유지하되 셀렉터가 `select` 태그에 의존하지 않는지 확인.
