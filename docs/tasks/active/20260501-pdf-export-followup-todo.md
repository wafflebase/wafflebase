---
title: PDF export — font fallback and regression coverage follow-up
date: 2026-05-01
status: not-started
parent: 20260501-pdf-export-parity (archived)
---

# PDF export follow-up

Split out from `20260501-pdf-export-parity` after table content parity
fixes shipped in #168 / #170 / #171.

## Remaining work

- [ ] Investigate remaining font fallback / glyph issues observed after
      table content parity landed (Korean / mixed-script runs).
- [ ] Add focused regression tests once the broken font/glyph cases are
      reduced to minimal repro fixtures.

## References

- Design: [`docs/design/docs/docs-pdf-export.md`](../../design/docs/docs-pdf-export.md)
- Parent todo (archived): `docs/tasks/archive/2026/05/20260501-pdf-export-parity-todo.md`
- Parent lessons (archived): `docs/tasks/archive/2026/05/20260501-pdf-export-parity-lessons.md`
