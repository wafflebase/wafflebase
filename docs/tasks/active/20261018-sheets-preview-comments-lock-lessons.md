# Lessons — Sheets: lock comments during a revision preview (#1094)

## Notes

- `PreviewSurface` containment is by z-order, and it only works for children
  that create no stacking context of their own. The sheet comment popover is
  `absolute z-30` and the overlay is `z-20`, so being a descendant of the
  surface bought nothing — the same trap `docs-detail.tsx` hit with its `z-40`
  panel. Anything z-indexed above the overlay has to be *withheld*, not covered.

## Self review

(filled in during the self-review rounds)
