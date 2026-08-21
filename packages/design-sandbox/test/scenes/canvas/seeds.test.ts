import { describe, expect, it } from 'vitest';
import { Document, Text, Tree } from '@yorkie-js/sdk';
import { seedSheetsFixture } from '../../../src/scenes/canvas/seed-sheets.ts';
import { seedDocsFixture } from '../../../src/scenes/canvas/seed-docs.ts';
import { seedNotesFixture } from '../../../src/scenes/canvas/seed-notes.ts';

/**
 * The canvas seeds, against a real DETACHED document.
 *
 * WHY NOT THROUGH THE BROWSER. A sheet and a docs page paint their content on `<canvas>`,
 * so `verify:scenes` can see that the scene mounts and shows its title but cannot see a
 * single seeded cell. Reading the CRDT the seed actually wrote is both precise and free.
 *
 * The document here is constructed exactly as the shim constructs one — `new Document(key)`,
 * never attached — which is also the claim this whole feature rests on. Re-verified against
 * `@yorkie-js/sdk@0.7.17` (the prototype's probe was against 0.7.13): a detached document's
 * `update()` works, `Text`/`Tree` construct, local `subscribe()` fires and `history.canUndo()`
 * answers. Only the `Client` touches the network.
 *
 * ONE REALM. `Text`/`Tree` come from `@yorkie-js/sdk` here, the same package the shim's
 * `Document` comes from. Mixing in `@yorkie-js/react`'s bundled copy silently flattens a CRDT
 * value into a plain object — `buildCRDTElement`'s fallthrough is `CRDTObject.create`, not a
 * throw — which the engines' own `ensureTree`/`ensureText` then overwrite with an empty
 * document. That is what the shim's shadowing re-export prevents, and it is why these tests
 * import from the sdk rather than from react.
 */

/** What `initialSpreadsheetDocument()` produces, minimally: one tab with an empty cell map. */
const sheetDoc = () => {
  const doc = new Document<never, never>('sheet-fixture');
  doc.update((root) => {
    (root as unknown as Record<string, unknown>).sheets = { 'tab-1': { cells: {} } };
  });
  return doc;
};

describe('a detached document is functional at 0.7.17', () => {
  it('accepts an update, a Text and a Tree, and reports its own history', () => {
    // The foundation. If this ever fails, every canvas scene is unmountable and the shim's
    // premise is gone — so it is asserted here rather than assumed from a comment.
    const doc = new Document<never, never>('probe');
    expect(doc.getStatus()).toBe('detached');
    let fired = 0;
    doc.subscribe(() => fired++);
    doc.update((root) => {
      const r = root as unknown as Record<string, unknown>;
      r.text = new Text();
      (r.text as Text).edit(0, 0, 'hello');
      r.tree = new Tree({ type: 'doc', children: [{ type: 'p', children: [] }] });
    });
    const root = doc.getRoot() as unknown as Record<string, { toString?: () => string }>;
    expect(root.text?.toString?.()).toBe('hello');
    expect(root.tree).toBeInstanceOf(Tree);
    expect(fired).toBeGreaterThan(0);
    expect(typeof doc.history.canUndo()).toBe('boolean');
  });
});

describe('seedSheetsFixture', () => {
  it('writes cells into the document’s only tab', () => {
    const doc = sheetDoc();
    seedSheetsFixture(doc);
    const cells = (
      doc.getRoot() as unknown as { sheets: Record<string, { cells: Record<string, unknown> }> }
    ).sheets['tab-1'].cells;
    expect(Object.keys(cells).length).toBeGreaterThan(5);
    // A1 exists because `toSref` is 1-BASED on both axes — row/column 0 yields a bare sref
    // that the engine's `parseRef` rejects, which is the trap the seed's header records.
    expect(cells.A1).toBeTruthy();
  });

  it('stores a formula as `{ v, f }`, never `{ f }` alone', () => {
    // The engine reads `v` for display and `f` for editing; a cell with only `f` renders
    // blank until something recalculates it, which in a static fixture is never.
    const doc = sheetDoc();
    seedSheetsFixture(doc);
    const cells = (
      doc.getRoot() as unknown as { sheets: Record<string, { cells: Record<string, Record<string, unknown>> }> }
    ).sheets['tab-1'].cells;
    /*
     * `Object.keys(...).includes('f')`, NOT `'f' in c`.
     *
     * A Yorkie CRDT object is a Proxy with no `has` trap, so `in` answers FALSE for a member
     * that is genuinely there — measured: `Object.keys(d3)` is `['v','f']` and
     * `JSON.stringify(d3)` is `{"v":"48200","f":"=B3-C3"}` while `'f' in d3` is `false`. Any
     * code that detects a CRDT field with `in` is wrong and fails silently.
     */
    const withFormula = Object.values(cells).filter((c) => Object.keys(c).includes('f'));
    expect(withFormula.length).toBeGreaterThan(0);
    for (const c of withFormula) expect(c.v).toBeDefined();
    // And every cell has a value, formula or not — a cell with only `f` renders blank until
    // something recalculates it, which in a static fixture is never.
    for (const c of Object.values(cells)) expect(c.v).toBeDefined();
  });

  it('does nothing when the document has no sheets map', () => {
    // The seed runs before the engine's own initializer in no case today, but a guard that
    // throws here would take the whole frame down instead of rendering an empty sheet.
    const doc = new Document<never, never>('empty');
    expect(() => seedSheetsFixture(doc)).not.toThrow();
  });
});

describe('seedNotesFixture', () => {
  it('edits the markdown into `root.content`, keeping it a Text', () => {
    // Notes stores the whole note in ONE `Text` at `root.content`, byte-compatible with
    // CodePair. Assigning a string instead of editing the Text would replace the CRDT with a
    // primitive, and `ensureText` would then overwrite it with an empty document.
    const doc = new Document<never, never>('note-fixture');
    doc.update((root) => {
      (root as unknown as Record<string, unknown>).content = new Text();
    });
    seedNotesFixture(doc);
    const content = (doc.getRoot() as unknown as { content: Text }).content;
    expect(content).toBeInstanceOf(Text);
    expect(content.toString().length).toBeGreaterThan(20);
    expect(content.toString()).toMatch(/#/);
  });
});

describe('seedDocsFixture', () => {
  it('leaves `root.content` a Tree the engine will accept', () => {
    // `ensureTree` treats a non-CRDT `root.content` as "needs initializing" and REPLACES it,
    // so a realm slip here does not fail — it silently wipes the fixture.
    const doc = new Document<never, never>('doc-fixture');
    doc.update((root) => {
      (root as unknown as Record<string, unknown>).content = new Tree({
        type: 'doc',
        children: [{ type: 'paragraph', children: [] }],
      });
    });
    seedDocsFixture(doc);
    const content = (doc.getRoot() as unknown as { content: Tree }).content;
    expect(content).toBeInstanceOf(Tree);
    expect(JSON.stringify(content.toJSON())).toMatch(/paragraph|text/);
  });
});
