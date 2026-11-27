---
paths:
  - "packages/slides/**"
---

# Slides

- Keep `packages/slides` free of Yorkie and React deps. The Yorkie adapter (`YorkieSlidesStore`) and React shell live in `packages/frontend/src/app/slides/`.
- Route every canvas `fillStyle`/`strokeStyle` through `resolveColor(themeColor, theme)` (`src/model/theme.ts`); never paint a raw `ThemeColor`.
