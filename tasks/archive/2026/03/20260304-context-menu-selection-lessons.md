# Context Menu Selection UX — Lessons

## Key Insight
Right-click (`button === 2`) needs special handling at multiple layers:
1. **Canvas layer** (worksheet.ts): Prevent `selectStart()` from resetting selection
2. **React layer** (sheet-context-menu.tsx): Handle cell selection for contextmenu
3. **Touch layer** (use-mobile-sheet-gestures.ts): Select cell before synthetic event

The existing code already had header-level within-selection checks in the React
layer but was missing them in the canvas layer and for cell-level clicks.
