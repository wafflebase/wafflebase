# Docs Pending Inline Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inline-style toolbar actions take effect at a collapsed caret in the Docs editor — the next typed characters pick up the toggled style, and the pending state is dropped on any non-typing caret move.

**Architecture:** One new view-local controller (`view/pending-style.ts`) holds `{ style, anchorBlockId, anchorOffset }`. `editor.ts` records pending state when `applyStyle` is called with no selection and merges it into `getSelectionStyle` for toolbar feedback. `text-editor.ts` consumes the pending state after every `doc.insertText`, applying the style to the inserted range; arrow keys, clicks, blur, undo/redo, copy/cut clear it; Enter (block split) preserves it via `rebindAnchor`. No changes to `DocStore`, the Yorkie schema, or `model/document.ts`.

**Tech Stack:** TypeScript, Vitest, `@wafflebase/docs`.

Design doc: `docs/design/docs/docs-pending-inline-style.md`.

---

## File Structure

**Create:**
- `packages/docs/src/view/pending-style.ts` — controller (~50 LOC)
- `packages/docs/test/view/pending-style.test.ts` — controller unit tests
- `packages/docs/test/view/pending-style-integration.test.ts` — Doc + text-editor scenarios (canvas-free)

**Modify:**
- `packages/docs/src/view/editor.ts` — construct controller, branch `applyStyleImpl`, merge in `getSelectionStyle`, clear on blur/undo/redo, pass controller into `createTextEditor`
- `packages/docs/src/view/text-editor.ts` — accept controller via options, consume after every `doc.insertText`, rewind around IME delete cycles, rebind after `splitBlock`, clear on arrow keys / mousedown / copy / cut

**No changes to:**
- `packages/docs/src/model/*`, `packages/docs/src/store/*`, Yorkie schema, `DocStore` interface, the document data model.

---

## Task 1: PendingStyle controller (TDD)

**Files:**
- Create: `packages/docs/src/view/pending-style.ts`
- Test: `packages/docs/test/view/pending-style.test.ts`

- [x] **Step 1.1: Write the failing controller tests**

Create `packages/docs/test/view/pending-style.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPendingStyle } from '../../src/view/pending-style.js';
import type { Doc } from '../../src/model/document.js';

function mockDoc() {
  return {
    applyInlineStyle: vi.fn(),
  } as unknown as Doc;
}

describe('PendingStyle', () => {
  it('is empty by default', () => {
    const p = createPendingStyle(mockDoc());
    expect(p.has()).toBe(false);
    expect(p.get()).toBeNull();
  });

  it('set stores style and anchor; get returns the style', () => {
    const p = createPendingStyle(mockDoc());
    p.set({ bold: true }, { blockId: 'b1', offset: 3 });
    expect(p.has()).toBe(true);
    expect(p.get()).toEqual({ bold: true });
  });

  it('clear removes state', () => {
    const p = createPendingStyle(mockDoc());
    p.set({ bold: true }, { blockId: 'b1', offset: 0 });
    p.clear();
    expect(p.has()).toBe(false);
    expect(p.get()).toBeNull();
  });

  it('consumeForInsert with matching anchor applies style and advances anchor', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 5 });
    p.consumeForInsert('b1', 5, 6);
    expect(doc.applyInlineStyle).toHaveBeenCalledWith(
      { anchor: { blockId: 'b1', offset: 5 }, focus: { blockId: 'b1', offset: 6 } },
      { bold: true },
    );
    // anchor advanced — a second matching consume should still apply
    p.consumeForInsert('b1', 6, 7);
    expect(doc.applyInlineStyle).toHaveBeenCalledTimes(2);
    expect(p.has()).toBe(true);
  });

  it('consumeForInsert with mismatched blockId is a no-op and clears state', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 5 });
    p.consumeForInsert('b2', 5, 6);
    expect(doc.applyInlineStyle).not.toHaveBeenCalled();
    expect(p.has()).toBe(false);
  });

  it('consumeForInsert with mismatched offset is a no-op and clears state', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 5 });
    p.consumeForInsert('b1', 6, 7);
    expect(doc.applyInlineStyle).not.toHaveBeenCalled();
    expect(p.has()).toBe(false);
  });

  it('rewindAnchor subtracts the given length, clamping at zero', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ bold: true }, { blockId: 'b1', offset: 3 });
    p.rewindAnchor('b1', 2);
    p.consumeForInsert('b1', 1, 2);
    expect(doc.applyInlineStyle).toHaveBeenCalled();
    p.set({ bold: true }, { blockId: 'b1', offset: 1 });
    p.rewindAnchor('b1', 5);
    p.consumeForInsert('b1', 0, 1);
    expect(doc.applyInlineStyle).toHaveBeenCalledTimes(2);
  });

  it('rewindAnchor on a non-matching block is a no-op', () => {
    const p = createPendingStyle(mockDoc());
    p.set({ bold: true }, { blockId: 'b1', offset: 3 });
    p.rewindAnchor('b2', 1);
    // Anchor unchanged: consuming at offset 3 should still match
    p.consumeForInsert('b1', 3, 4);
    expect(p.has()).toBe(true);
  });

  it('rebindAnchor moves anchor to a new block at offset 0 while keeping style', () => {
    const doc = mockDoc();
    const p = createPendingStyle(doc);
    p.set({ italic: true }, { blockId: 'b1', offset: 7 });
    p.rebindAnchor('b2');
    p.consumeForInsert('b2', 0, 1);
    expect(doc.applyInlineStyle).toHaveBeenCalledWith(
      { anchor: { blockId: 'b2', offset: 0 }, focus: { blockId: 'b2', offset: 1 } },
      { italic: true },
    );
  });

  it('rebindAnchor when nothing is pending is a no-op', () => {
    const p = createPendingStyle(mockDoc());
    p.rebindAnchor('b2');
    expect(p.has()).toBe(false);
  });
});
```

- [x] **Step 1.2: Run the tests and confirm they fail**

Run: `pnpm --filter @wafflebase/docs test pending-style`
Expected: FAIL with `Cannot find module '../../src/view/pending-style.js'` (or similar resolution error).

- [x] **Step 1.3: Implement the controller**

Create `packages/docs/src/view/pending-style.ts`:

```ts
import type { Doc } from '../model/document.js';
import type { InlineStyle } from '../model/types.js';

type Anchor = { blockId: string; offset: number };

export interface PendingStyle {
  get(): Partial<InlineStyle> | null;
  has(): boolean;
  set(style: Partial<InlineStyle>, anchor: Anchor): void;
  clear(): void;
  consumeForInsert(blockId: string, fromOffset: number, toOffset: number): void;
  rewindAnchor(blockId: string, n: number): void;
  rebindAnchor(blockId: string): void;
}

export function createPendingStyle(doc: Doc): PendingStyle {
  let state: { style: Partial<InlineStyle>; anchor: Anchor } | null = null;

  return {
    get: () => (state ? state.style : null),
    has: () => state !== null,
    set: (style, anchor) => {
      state = { style: { ...style }, anchor: { ...anchor } };
    },
    clear: () => {
      state = null;
    },
    consumeForInsert: (blockId, fromOffset, toOffset) => {
      if (!state) return;
      if (state.anchor.blockId !== blockId || state.anchor.offset !== fromOffset) {
        state = null;
        return;
      }
      doc.applyInlineStyle(
        {
          anchor: { blockId, offset: fromOffset },
          focus: { blockId, offset: toOffset },
        },
        state.style,
      );
      state.anchor = { blockId, offset: toOffset };
    },
    rewindAnchor: (blockId, n) => {
      if (!state || state.anchor.blockId !== blockId) return;
      state.anchor.offset = Math.max(0, state.anchor.offset - n);
    },
    rebindAnchor: (blockId) => {
      if (!state) return;
      state.anchor = { blockId, offset: 0 };
    },
  };
}
```

- [x] **Step 1.4: Run the tests and confirm they pass**

Run: `pnpm --filter @wafflebase/docs test pending-style`
Expected: PASS — 10 tests green.

- [x] **Step 1.5: Commit**

```bash
git add packages/docs/src/view/pending-style.ts packages/docs/test/view/pending-style.test.ts
git commit -m "$(cat <<'EOF'
Add PendingStyle controller for collapsed-caret inline styles

The docs editor currently drops inline-style toolbar actions when no
text is selected. Introduce a small view-local controller that holds
a pending style anchored to a caret position. Subsequent edits in
the editor / text-editor will consume this state to apply the style
to typed characters and clear it on non-typing caret moves.
EOF
)"
```

---

## Task 2: Wire controller into `editor.ts`

**Files:**
- Modify: `packages/docs/src/view/editor.ts` (around `applyStyleImpl` / `getSelectionStyle` / `clearInlineFormatting` / `handleBlur` / `undoFn` / `redoFn`)

This task adds wiring only; behaviour changes are exercised in Task 4.

- [x] **Step 2.1: Construct the controller**

Near the top of `createDocEditor`, after `doc` is in scope and before
`createTextEditor(...)` is called, add the controller:

```ts
import { createPendingStyle } from './pending-style.js';
// ...
const pending = createPendingStyle(doc);
```

- [x] **Step 2.2: Branch `applyStyleImpl` for collapsed selections**

Locate `applyStyleImpl` (current head at `editor.ts:1661`). Replace its
body's leading guard so collapsed selections record pending instead of
no-oping:

```ts
const applyStyleImpl = (style: Partial<InlineStyle>): void => {
  if (!selection.hasSelection() || !selection.range) {
    // Collapsed caret — remember the style for the next typed run.
    const current = getSelectionStyleImpl();
    pending.set({ ...current, ...style }, cursor.position);
    render();
    return;
  }
  docStore.snapshot();
  const range = selection.range;
  // ...existing cell-range + range-style logic unchanged
};
```

Extract the existing `getSelectionStyle` body into a private
`getSelectionStyleImpl()` (no behavior change) so it can be reused
above without re-entering pending merging.

- [x] **Step 2.3: Merge pending into `getSelectionStyle`**

```ts
return {
  // ...
  getSelectionStyle: (): Partial<InlineStyle> => {
    const base = getSelectionStyleImpl();
    if (pending.has() && !selection.hasSelection()) {
      return { ...base, ...pending.get()! };
    }
    return base;
  },
  // ...
};
```

- [x] **Step 2.4: Route `clearInlineFormatting` through pending when collapsed**

```ts
clearInlineFormatting: () => {
  if (!selection.hasSelection()) {
    pending.set(CLEAR_INLINE_STYLE, cursor.position);
    render();
    return;
  }
  applyStyleImpl(CLEAR_INLINE_STYLE);
},
```

- [x] **Step 2.5: Clear pending on blur, undo, redo, and image insert**

In `handleBlur` (around `editor.ts:1646`):

```ts
const handleBlur = () => {
  focused = false;
  pending.clear();
  cursor.stopBlink();
  render();
};
```

In `undoFn` (around `editor.ts:1135`) and `redoFn` (around `editor.ts:1159`),
add `pending.clear()` immediately before the existing `docStore.undo()` /
`docStore.redo()` calls.

In the inline-image insert handler (the function backing
`insertImageInline` on the returned API), add `pending.clear()` at the top.

- [x] **Step 2.6: Pass the controller into `createTextEditor`**

`createTextEditor(...)` is invoked from `editor.ts`. Add `pending` to its
options object:

```ts
const textEditor = createTextEditor({
  // ...existing options
  pending,
});
```

(`createTextEditor` will read this in Task 3.)

- [x] **Step 2.7: Type-check**

Run: `pnpm --filter @wafflebase/docs typecheck` (or `pnpm verify:fast`)
Expected: no new TypeScript errors. The `pending` option will be marked
unused inside `createTextEditor` until Task 3 — that is fine; if the
docs package treats unused params as errors, mark the param optional
and prefixed with `_` in Task 2 and remove the prefix in Task 3.

- [x] **Step 2.8: Commit**

```bash
git add packages/docs/src/view/editor.ts
git commit -m "$(cat <<'EOF'
Record pending inline style on collapsed applyStyle in docs editor

When applyStyle / clearInlineFormatting fire with no selection, store
the request in the new PendingStyle controller and merge it into
getSelectionStyle so toolbar buttons reflect the toggle. Blur, undo,
redo, and inline-image insert clear the pending state. The pending
controller is threaded into createTextEditor for consume wiring in a
follow-up commit.
EOF
)"
```

---

## Task 3: Wire controller into `text-editor.ts`

**Files:**
- Modify: `packages/docs/src/view/text-editor.ts`

- [x] **Step 3.1: Accept the controller via options**

In the `TextEditor` class options interface and constructor (top of the
file), accept and store the controller:

```ts
import type { PendingStyle } from './pending-style.js';

interface TextEditorOptions {
  // ...existing fields
  pending: PendingStyle;
}

export class TextEditor {
  private pending: PendingStyle;

  constructor(opts: TextEditorOptions) {
    // ...existing assignments
    this.pending = opts.pending;
  }
}
```

- [x] **Step 3.2: Consume after every `doc.insertText`**

For each `this.doc.insertText(pos, data)` call, immediately follow it with
a consume. Concrete call sites (line numbers as of the snapshot in the
design doc; verify with `grep -n "this.doc.insertText" text-editor.ts`):

```ts
// Pattern to apply at each site:
const before = pos.offset;
this.doc.insertText(pos, data);
this.pending.consumeForInsert(pos.blockId, before, before + data.length);
```

Sites to update:
1. `handleCompositionEnd` (around line 324) — `finalText` commit.
2. `handleInput` IME replace path (around line 373) — `newText` insert.
3. `handleInput` regular input (around line 406) — `data` insert.
4. `handlePaste` line insert loop (around line 3042) — paste's per-line
   `insertText`.
5. Hangul assembler (lines 4365, 4372, 4390) — `result.commit` and
   `result.composing` inserts.
6. Hyperlink auto-detect insert (around `editor.ts:1863` and the `#` path
   at `editor.ts:2332`) — these run from editor.ts directly on `doc`; they
   are not driven by `text-editor`. They should still trigger
   `pending.clear()` (anchor mismatch behaviour) without an explicit
   consume call. Leave as-is — the natural mismatch path handles them.

- [x] **Step 3.3: Rewind before IME delete cycles**

For each `this.doc.deleteText(pos, n)` call that is part of an IME or
Hangul composing cycle (the delete-then-reinsert pattern), add a
`rewindAnchor` immediately before. Sites:

- `handleCompositionEnd` (line 321 — `deleteText(startPosition, currentLength)`)
- `handleInput` IME replace path (line 370)
- Hangul flush / replace inside `applyHangulResult` (search the file for
  `this.doc.deleteText` adjacent to the hangul state and add the rewind
  call where the next operation is an `insertText` at the same position).

```ts
this.pending.rewindAnchor(pos.blockId, n);
this.doc.deleteText(pos, n);
```

Delete sites that are NOT followed by a same-position insert (backspace,
selection delete, word delete) should instead call `this.pending.clear()`
before the delete. Identify these by inspection of the surrounding code:
backspace handlers, `deleteSelection`, word-boundary deletes (the
non-IME `this.doc.deleteText` calls in the 1525 / 1577 / 1599 / 1621 /
1644 / 2383 / 2388 / 2675 / 2693 region).

- [x] **Step 3.4: Rebind after `splitBlock`**

For each `this.doc.splitBlock(...)` call (search `text-editor.ts` —
~four sites including Enter, list-prefix-trigger, and the `/` handler),
follow it with a rebind:

```ts
const newBlockId = this.doc.splitBlock(pos.blockId, pos.offset);
this.pending.rebindAnchor(newBlockId);
```

- [x] **Step 3.5: Clear pending on non-typing caret moves**

Add `this.pending.clear()` at the start of:

- `handleMouseDown` (around line 975)
- Arrow-key handlers inside `handleKeyDown` (left/right/up/down,
  home/end, page up/down — every branch that calls `cursor.setPosition`
  for navigation rather than text edit)
- `handlePaste` (top of method, around line 795) — paste shouldn't pick
  up pending across the paste boundary

Copy and cut clipboard handlers should also call `this.pending.clear()`
at the top.

- [x] **Step 3.6: Type-check and run all existing tests**

Run: `pnpm --filter @wafflebase/docs test`
Expected: existing tests still green. No new tests added in this step.

- [x] **Step 3.7: Commit**

```bash
git add packages/docs/src/view/text-editor.ts
git commit -m "$(cat <<'EOF'
Consume pending inline style in docs text-editor input paths

Apply the recorded pending style to each inserted run via the new
PendingStyle controller — including IME composing/commit cycles
(via rewindAnchor around delete-then-insert) and Enter block splits
(via rebindAnchor). Caret-moving handlers (mouse, arrow keys, paste,
copy, cut) clear the state so it never leaks past a navigation.
EOF
)"
```

---

## Task 4: Integration test — editor scenarios

**Files:**
- Create: `packages/docs/test/view/pending-style-integration.test.ts`

These tests drive `Doc` + `PendingStyle` directly (no canvas) plus a
minimal wrapper that mimics the text-editor's insertText flow. The goal
is to assert end-to-end style application without booting the full
Canvas editor.

- [x] **Step 4.1: Write integration tests**

Create `packages/docs/test/view/pending-style-integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MemDocStore } from '../../src/store/memory.js';
import { Doc } from '../../src/model/document.js';
import { createPendingStyle } from '../../src/view/pending-style.js';

function makeDoc(text = '') {
  const store = new MemDocStore();
  const doc = new Doc(store);
  const firstBlockId = doc.document.blocks[0].id;
  if (text) doc.insertText({ blockId: firstBlockId, offset: 0 }, text);
  return { doc, blockId: firstBlockId };
}

function typeAt(
  doc: Doc,
  pending: ReturnType<typeof createPendingStyle>,
  pos: { blockId: string; offset: number },
  text: string,
) {
  const before = pos.offset;
  doc.insertText(pos, text);
  pending.consumeForInsert(pos.blockId, before, before + text.length);
  return { blockId: pos.blockId, offset: before + text.length };
}

function styleAt(doc: Doc, blockId: string, charIndex: number) {
  const block = doc.getBlock(blockId)!;
  let cursor = 0;
  for (const inline of block.inlines) {
    if (charIndex < cursor + inline.text.length) return inline.style;
    cursor += inline.text.length;
  }
  return block.inlines[block.inlines.length - 1]?.style ?? {};
}

describe('pending inline style — editor-level scenarios', () => {
  it('typing after a collapsed bold toggle styles the inserted run', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 0 });
    typeAt(doc, pending, { blockId, offset: 0 }, 'abc');
    expect(styleAt(doc, blockId, 0).bold).toBe(true);
    expect(styleAt(doc, blockId, 2).bold).toBe(true);
  });

  it('caret move via clear discards the pending style', () => {
    const { doc, blockId } = makeDoc('xy');
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 2 });
    pending.clear(); // simulating arrow-key handler
    typeAt(doc, pending, { blockId, offset: 2 }, 'a');
    expect(styleAt(doc, blockId, 2).bold).toBeFalsy();
  });

  it('rebindAnchor preserves pending across Enter block split', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ italic: true }, { blockId, offset: 0 });
    const newBlockId = doc.splitBlock(blockId, 0);
    pending.rebindAnchor(newBlockId);
    typeAt(doc, pending, { blockId: newBlockId, offset: 0 }, 'x');
    expect(styleAt(doc, newBlockId, 0).italic).toBe(true);
  });

  it('IME composing cycle applies style through rewindAnchor', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ color: '#ff0000' }, { blockId, offset: 0 });
    // Composing "ㅇ" at offset 0
    typeAt(doc, pending, { blockId, offset: 0 }, 'ㅇ');
    // Replace with "안" — text-editor pattern: rewind, delete, insert
    pending.rewindAnchor(blockId, 1);
    doc.deleteText({ blockId, offset: 0 }, 1);
    typeAt(doc, pending, { blockId, offset: 0 }, '안');
    // Commit "안녕" by appending "녕"
    typeAt(doc, pending, { blockId, offset: 1 }, '녕');
    expect(styleAt(doc, blockId, 0).color).toBe('#ff0000');
    expect(styleAt(doc, blockId, 1).color).toBe('#ff0000');
  });

  it('layered toggles accumulate after a committed character', () => {
    const { doc, blockId } = makeDoc();
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 0 });
    typeAt(doc, pending, { blockId, offset: 0 }, 'a');
    // Second toggle at the new caret merges italic on top of bold
    pending.set({ bold: true, italic: true }, { blockId, offset: 1 });
    typeAt(doc, pending, { blockId, offset: 1 }, 'b');
    expect(styleAt(doc, blockId, 0).bold).toBe(true);
    expect(styleAt(doc, blockId, 1).bold).toBe(true);
    expect(styleAt(doc, blockId, 1).italic).toBe(true);
  });

  it('anchor mismatch from an unrelated insert clears pending', () => {
    const { doc, blockId } = makeDoc('ab');
    const pending = createPendingStyle(doc);
    pending.set({ bold: true }, { blockId, offset: 2 });
    // An unrelated insert (e.g. markdown auto-convert) fires at offset 0
    typeAt(doc, pending, { blockId, offset: 0 }, 'X');
    expect(pending.has()).toBe(false);
    expect(styleAt(doc, blockId, 0).bold).toBeFalsy();
  });
});
```

- [x] **Step 4.2: Run integration tests**

Run: `pnpm --filter @wafflebase/docs test pending-style-integration`
Expected: PASS — 6 tests green.

- [x] **Step 4.3: Run the full docs package suite**

Run: `pnpm --filter @wafflebase/docs test`
Expected: all previously green tests remain green.

- [x] **Step 4.4: Commit**

```bash
git add packages/docs/test/view/pending-style-integration.test.ts
git commit -m "$(cat <<'EOF'
Integration tests for docs pending inline style scenarios

Cover collapsed toggle + typing, clear-on-caret-move, Enter rebind,
IME composing cycles, layered toggles, and anchor-mismatch clearing.
EOF
)"
```

---

## Task 5: Verify, manual smoke, archive

- [x] **Step 5.1: Repo-level verification**

Run: `pnpm verify:fast`
Expected: lint clean + all unit tests green across the monorepo.

- [ ] **Step 5.2: Manual smoke (browser)**

Start: `pnpm dev`

First pass surfaced two bugs (Cmd+B did nothing on collapsed caret,
never toggled off). Both fixed in 876e40f0 — see lessons file under
"Browser smoke caught a parallel keyboard code path." Re-verify the
six scenarios below before merge.

Confirm in `localhost:5173`:
1. Empty document, click into the first paragraph, press Cmd+B, type
   `Hello`. → `Hello` renders bold.
2. Empty paragraph, press Cmd+B, click into a different line, type. →
   typed text is plain (caret move cleared pending).
3. Empty paragraph, press Cmd+B, press Enter, type. → the new line's
   typed text is bold (Enter preserves pending).
4. Empty paragraph, press Cmd+B, press the right-arrow key, type. →
   typed text is plain (arrow-key cleared pending).
5. Empty paragraph, press Cmd+I, type `안녕`. → both syllables render
   italic, including during composing.
6. Empty paragraph, change the text color from the toolbar, then type.
   → typed text picks up the chosen color.

Capture findings (pass/fail per item) in
`docs/tasks/active/20260530-docs-pending-inline-style-lessons.md`.

- [x] **Step 5.3: Self code-review**

Dispatch `superpowers:requesting-code-review` (or `/code-review`) over
the full branch diff. Apply blocking findings as additional commits.

- [ ] **Step 5.4: Archive task files**

Once everything is green and reviewed:

```bash
pnpm tasks:archive && pnpm tasks:index
```

- [ ] **Step 5.5: Final push and PR**

Push the branch and open a PR titled "Docs: pending inline style at
collapsed caret" with body = Summary (one paragraph) + Test plan
(items from Step 5.2).

---

## Self-review notes

Run before handoff:

- Spec coverage: every Goals item maps to Task 1–4 (toolbar surface →
  Task 2, typed run styling → Task 3 + 4, IME → Task 3 + 4, Enter →
  Task 3 + 4, clear triggers → Task 3, no regressions → Task 4 + 5).
- Placeholder scan: none — all steps include code or exact commands.
- Type consistency: `PendingStyle` interface fields (`get`, `has`,
  `set`, `clear`, `consumeForInsert`, `rewindAnchor`, `rebindAnchor`)
  are used identically in Tasks 1–4. `Doc.applyInlineStyle(range, style)`
  matches `model/document.ts:316`.
