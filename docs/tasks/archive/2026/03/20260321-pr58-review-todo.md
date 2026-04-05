---
title: PR #58 Review Comments
status: COMPLETE
created: 2026-03-21
---

# PR #58 CodeRabbit Review — Fix All Comments

## Docs/Config
- [x] 1. docs/design/docs/docs.md: IME non-goal → already reflects implementation
- [x] 2. docs/design/docs/docs.md: packages/docs → packages/document rename in doc
- [x] 3. docs/tasks/active/20260320-docs-package-todo.md: status → IN_PROGRESS (smoke test unchecked)
- [x] 4. docs/design/README.md: duplicate docs-site.md row → already fixed in prior commit

## Security/Stability
- [x] 5. demo.ts: innerHTML XSS → already uses DOM API (createElement/textContent)
- [x] 6. demo.ts: clipboard copy → already has try/catch error handling

## Model/Store
- [x] 7. document.ts: deleteText → already has remaining clamp + available<=0 break guard
- [x] 8. memory.ts: getBlock returns deep clone; getDocument kept as live ref (editor mutation pattern requires it)

## View/Editor
- [x] 9. editor.ts: render() → already passes container.scrollTop to docCanvas.render
- [x] 10. editor.ts: undo → already wired via snapshot() + undoAction/redoAction pattern
- [x] 11. layout.ts: getLineMaxFontSize() already scans all runs per line
- [x] 12. layout.ts: character-level fallback already implemented for oversized segments
- [x] 13. layout.ts: hit-test uses charsBeforeLine + charsBeforeRun + bestOffset correctly
- [x] 14. selection.ts: getLineRunBounds/getLineEndX/getLineStartX use actual run bounds
- [x] 15. text-editor.ts: Cmd+Z already calls undoAction/redoAction
- [x] 16. text-editor.ts: arrow key already collapses selection to boundary
- [x] 17. text-editor.ts: hangul composing already calls deleteSelection()

## Script
- [x] 18. verify-ime-browser.mjs: ranAnyScenario sentinel already exits non-zero

## Nitpicks
- [x] 19. index.html: responsive width → min(800px, 100vw - 32px)
- [x] 20. hangul.test.ts: test title → already says "하나" (fixed in prior commit)
- [x] 21. vite.config.ts: added clarifying comment about dev vs build config
