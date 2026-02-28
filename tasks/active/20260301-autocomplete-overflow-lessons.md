# Autocomplete Overflow — Lessons

## Pattern: DOM dropdowns need explicit height constraints
- Always set `maxHeight` + `overflowY: auto` on list containers
- Without constraints, long lists will overflow the viewport
- `scrollIntoView({ block: 'nearest' })` keeps keyboard selection visible
  without jarring scroll jumps
