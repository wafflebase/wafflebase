# DOCX import bug fixes (v0.3.3) — todo

## Summary

Two preexisting bugs in the DOCX importer surfaced during the
v0.3.2 browser smoke test against a real-world `form.docx`
(1.2 MB, 46 tables, 513 `<w:strike w:val="0"/>` runs). Both are
import-path only (no server / schema / infra impact) and will
ship in v0.3.3.

Release cut for v0.3.3 is out of scope for this task file.
See `docs/design/project_wafflebase_release_policy.md` — v0.3.3
is expected to be a routine image bump.

## Bug A — `w:val="0"` treated as ON for bold / italic / strikethrough

**File:** `packages/docs/src/import/docx-style-map.ts:21-23`

The current code checks only for element presence:

```typescript
if (getW(rPr, 'b')) style.bold = true;
if (getW(rPr, 'i')) style.italic = true;
if (getW(rPr, 'strike')) style.strikethrough = true;
```

OOXML uses `<w:b w:val="0"/>`, `<w:i w:val="0"/>`,
`<w:strike w:val="0"/>` (and the equivalent `w:val="false"`) to
**explicitly clear** an inherited style. Missing `w:val` means ON.

The already-landed fixes for underline (bare `<w:u/>` vs
`<w:u w:val="none"/>`) and highlight (`<w:highlight w:val="none"/>`)
show the correct pattern to follow.

**Impact in `form.docx`:** 509 runs with `w:b w:val="0"`, 509 with
`w:i w:val="0"`, 513 with `w:strike w:val="0"` — all incorrectly
forced ON, which is why heavy strikethrough noise appears over
large sections of the document.

### Fix

Extract a small helper:

```typescript
/**
 * True when an on/off OOXML toggle is on. A missing val defaults
 * to on (matches Word); "0" and "false" turn it off.
 */
function isToggleOn(el: Element | null): boolean {
  if (!el) return false;
  const v = getWAttr(el, 'val');
  return v !== '0' && v !== 'false';
}
```

Replace the three presence checks with `isToggleOn(getW(rPr, ...))`.

### Tests

- [ ] `<w:b/>` → `bold: true`
- [ ] `<w:b w:val="1"/>` → `bold: true`
- [ ] `<w:b w:val="true"/>` → `bold: true`
- [ ] `<w:b w:val="0"/>` → `bold` not set
- [ ] `<w:b w:val="false"/>` → `bold` not set
- [ ] Same matrix for `w:i` / `italic`
- [ ] Same matrix for `w:strike` / `strikethrough`

## Bug B — `tbl.getElementsByTagNameNS('w:gridCol')` leaks nested tables

**File:** `packages/docs/src/import/docx-importer.ts:212-219`

```typescript
const gridCols = tblEl.getElementsByTagNameNS(W, 'gridCol');
```

`getElementsByTagNameNS` is **recursive** and returns every
descendant `w:gridCol`, including those inside nested tables.
The `<w:tr>` walk already uses direct-child traversal
(`tblEl.childNodes` + `localName === 'tr'`) so the asymmetry is
the root cause.

**Impact in `form.docx`:** 6 top-level tables have inflated column
counts:

| idx | own cols | recursive cols | nested | result width |
|---|---|---|---|---|
| 6  | 3 | 16 | 4 nested | ~19% |
| 7  | 1 | 12 | 4 nested | ~8%  |
| 9  | 1 | 12 | 4 nested | ~8%  |
| 11 | 1 | 12 | 4 nested | ~8%  |
| 13 | 1 | 12 | 4 nested | ~8%  |
| 15 | 1 | 12 | 4 nested | ~8%  |
| 17 | 1 | 5  | 2 nested | ~20% |

All of these are "별첨 n-k 인적사항" forms — the 1-column outer
table collapses to ~8% of the content width with every row
wrapping vertically in a narrow strip.

### Fix

Walk direct children to find the first `<w:tblGrid>`, then walk
its direct children for `<w:gridCol>`. Helper for clarity:

```typescript
function directChildByLocalName(parent: Element, name: string): Element | null {
  for (let i = 0; i < parent.childNodes.length; i++) {
    const n = parent.childNodes[i];
    if (n.nodeType === 1 && (n as Element).localName === name) {
      return n as Element;
    }
  }
  return null;
}
```

Use it to find `<w:tblGrid>` directly under `<w:tbl>`, then iterate
its direct-child `<w:gridCol>` elements.

### Tests

- [ ] Single-column 1-row table → `columnWidths === [1]`
- [ ] 3-column top-level table → ratios proportional to grid
- [ ] **Regression:** 1-column outer table containing a nested
      5-column table → outer `columnWidths === [1]`
      (nested cols are ignored because nested tables flatten to text)
- [ ] Table with no `<w:tblGrid>` at all → `columnWidths === []`
      (or safe fallback; not expected in real docs but shouldn't throw)

## Execution

- [ ] Write failing tests for Bug A (style-map), confirm red
- [ ] Implement Bug A fix, confirm green
- [ ] Write failing tests for Bug B (importer), confirm red
- [ ] Implement Bug B fix, confirm green
- [ ] `pnpm --filter @wafflebase/docs test`
- [ ] `pnpm verify:fast` passes
- [ ] Commit Bug A and Bug B as separate commits for clean history
- [ ] Open PR against `main`
- [ ] After merge, archive this task file

## Out of scope

- Actually cutting the v0.3.3 release (separate follow-up — it
  will be a routine image bump)
- Re-importing `form.docx` in production to verify end-to-end
  rendering (will happen on the smoke test for v0.3.3)
- Adding `form.docx` itself as a test fixture (1.2 MB is too
  heavy; inline minimal XML matches the existing test style
  in `packages/docs/test/import/`)
- Table 5 ("컨트리뷰션 가이드") — its narrow spacer columns
  are present in the source document and Word renders the
  same layout. Not a bug.
