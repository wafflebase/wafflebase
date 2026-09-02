import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevisionPreview, RevisionPreviewOverlay } from '../revision-preview';
import { firstWorksheetTabId } from '../first-worksheet-tab';

const getRevision = vi.fn();
const listRevisions = vi.fn().mockResolvedValue([]);
const createRevision = vi.fn().mockResolvedValue({ id: 'safety' });
const restoreRevision = vi.fn().mockResolvedValue(undefined);
vi.mock('@yorkie-js/react', () => ({
  useRevisions: () => ({
    getRevision,
    listRevisions,
    createRevision,
    restoreRevision,
  }),
}));

// A real `SpreadsheetDocument` (`{tabs, tabOrder, sheets}` — the brief's own
// `{"worksheets":{}}` sketch was a different, nonexistent shape, so that
// version of this fixture never reached `SheetPreview`'s mount effect at
// all: `doc.tabOrder` was `undefined`, so the `if (!container || !worksheet)
// return` guard fired before `MemStore.load`/`initializeSheet` ever ran).
// Cells are keyed by `rowId|colId` axis-ID pairs, not by A1 notation — that
// is how every worksheet (Mem- and Yorkie-backed alike) actually stores
// cells (`createWorksheetCellKey`, `packages/sheets/src/model/workbook/
// worksheet-record.ts`), and `MemStore.load`'s `getWorksheetEntries` call
// resolves exactly that format via `rowOrder`/`colOrder`.
const worksheet = {
  cells: { 'r1|c1': { v: '1' }, 'r1|c2': { v: '2' } },
  rowOrder: ['r1'],
  colOrder: ['c1', 'c2'],
  nextRowId: 2,
  nextColId: 3,
  rowHeights: {},
  colWidths: {},
  colStyles: {},
  rowStyles: {},
  conditionalFormats: [],
  dataValidations: [],
  merges: {},
  charts: {},
  images: {},
  comments: {},
  frozenRows: 0,
  frozenCols: 0,
};

const SHEET_SNAPSHOT = JSON.stringify({
  tabs: { 'tab-1': { id: 'tab-1', name: 'Sheet1', type: 'sheet' } },
  tabOrder: ['tab-1'],
  sheets: { 'tab-1': worksheet },
});

/**
 * Every tab is external, so no tab has a `sheets` entry to render.
 *
 * Doubles as the snapshot for every test below that is about the preview
 * *shell* (keyboard containment, restore reporting) rather than its content:
 * it exercises the whole load-and-parse path but stops short of mounting a
 * Canvas engine, which jsdom cannot paint — `HTMLCanvasElement.getContext`
 * returns null, and the sheets renderer's next animation frame then rejects
 * after the test that started it has already finished.
 */
const EXTERNAL_ONLY_SNAPSHOT = JSON.stringify({
  tabs: {
    'tab-1': { id: 'tab-1', name: 'Postgres', type: 'datasource' },
    'tab-2': { id: 'tab-2', name: 'Iceberg', type: 'lakehouse' },
  },
  tabOrder: ['tab-1', 'tab-2'],
  sheets: {},
});

/**
 * A three-slide deck. Only `slides[].id` is read by the banner's prev/next
 * control; the Canvas engine that would consume the rest never mounts here
 * (jsdom's `HTMLCanvasElement.getContext` returns null, and
 * `SlidesEditorImpl`'s constructor throws on that — caught by
 * `SlidesPreview`'s own try/catch, which is why this still renders).
 */
const THREE_SLIDE_SNAPSHOT = JSON.stringify({
  meta: { title: 'Deck', themeId: 't', masterId: 'm' },
  themes: [],
  masters: [],
  layouts: [],
  slides: [
    { id: 's1', layoutId: 'l', elements: [] },
    { id: 's2', layoutId: 'l', elements: [] },
    { id: 's3', layoutId: 'l', elements: [] },
  ],
});

const ONE_SLIDE_SNAPSHOT = JSON.stringify({
  meta: { title: 'Deck', themeId: 't', masterId: 'm' },
  themes: [],
  masters: [],
  layouts: [],
  slides: [{ id: 's1', layoutId: 'l', elements: [] }],
});

function resolveWith(snapshot: string) {
  getRevision.mockResolvedValue({
    id: 'r1',
    label: 'v1',
    description: '',
    createdAt: new Date('2026-09-02T10:00:00Z'),
    snapshot,
  });
}

afterEach(() => {
  vi.clearAllMocks();
  listRevisions.mockResolvedValue([]);
  createRevision.mockResolvedValue({ id: 'safety' });
  restoreRevision.mockResolvedValue(undefined);
});

describe('RevisionPreview', () => {
  it('announces that this is a past version, with its time', async () => {
    resolveWith(SHEET_SNAPSHOT);
    render(
      <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  // A snapshot this build cannot parse must say so. Rendering an empty
  // document would read as "this version was blank".
  it('reports an unreadable snapshot instead of rendering an empty document', async () => {
    getRevision.mockResolvedValue({
      id: 'r2', label: 'v2', description: '', createdAt: new Date(),
      snapshot: '{"content":Tree({"type":"doc","children":[{"type":"block","children":[{"type":"inline","children":[{"type":"text","value":"a"}]}]}]})}',
    });
    render(
      <RevisionPreview revisionId="r2" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  // Same rule, one step further in: the snapshot parsed fine, but nothing in
  // it can be rendered. Silence would still read as "this version was blank".
  it('says so when no tab in the version has a worksheet to render', async () => {
    resolveWith(EXTERNAL_ONLY_SNAPSHOT);
    render(
      <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/no sheet to show/i),
    );
  });
});

// The preview mounts ONE canvas and the thumbnail rail lives in
// `SlidesView`, which the overlay hides; `readOnly: true` skips
// `attachInteractions()` and the keyboard suppressor blocks the arrow keys
// anyway. Without a control in the banner a 30-slide deck previewed as
// slide 1 and the other 29 were unreachable.
describe('RevisionPreview slide navigation', () => {
  it('offers prev/next with a position indicator for a multi-slide deck', async () => {
    resolveWith(THREE_SLIDE_SNAPSHOT);
    render(
      <RevisionPreview revisionId="r1" type="slides" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    expect(screen.getByLabelText('Slide position')).toHaveTextContent('1 / 3');
    expect(screen.getByRole('button', { name: 'Previous slide' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByLabelText('Slide position')).toHaveTextContent('2 / 3');

    await userEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByLabelText('Slide position')).toHaveTextContent('3 / 3');
    expect(screen.getByRole('button', { name: 'Next slide' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Previous slide' }));
    expect(screen.getByLabelText('Slide position')).toHaveTextContent('2 / 3');
  });

  it('shows no navigation for a single-slide deck', async () => {
    resolveWith(ONE_SLIDE_SNAPSHOT);
    render(
      <RevisionPreview revisionId="r1" type="slides" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument();
  });

  // Board renders as one synthetic slide, so a rail would be noise.
  it('shows no navigation for a board', async () => {
    resolveWith('{"meta":{"title":"Board"},"elements":[]}');
    render(
      <RevisionPreview revisionId="r1" type="board" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Next slide' })).not.toBeInTheDocument();
  });

  // Switching to a shorter revision must not leave the index past its end.
  it('returns to the first slide when the revision changes', async () => {
    resolveWith(THREE_SLIDE_SNAPSHOT);
    const { rerender } = render(
      <RevisionPreview revisionId="r1" type="slides" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(screen.getByLabelText('Slide position')).toHaveTextContent('2 / 3');

    resolveWith(THREE_SLIDE_SNAPSHOT);
    rerender(
      <RevisionPreview revisionId="r2" type="slides" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Slide position')).toHaveTextContent('1 / 3'),
    );
  });
});

// The overlay is a *sibling* of the live editor, which stays mounted and
// keeps its `document`-level keydown listener (worksheet.ts:2649,
// editor.ts:2803). Without suppression, Cmd+Z with a preview open undoes a
// real change in the live document and Delete deletes the live selection.
describe('RevisionPreview keyboard containment', () => {
  it('keeps keystrokes away from document-level listeners in both phases', async () => {
    const bubble = vi.fn();
    // Registered *before* the preview mounts, exactly as the live editor's
    // is — a listener we cannot outrun by registration order. `window` in
    // the capture phase is upstream of `document` in either phase, which is
    // what makes both of these unreachable.
    const capture = vi.fn();
    document.addEventListener('keydown', bubble);
    document.addEventListener('keydown', capture, true);

    try {
      resolveWith(EXTERNAL_ONLY_SNAPSHOT);
      render(
        <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
      );
      await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

      // Nothing focused inside the overlay...
      fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
      // ...and a focused control inside it (the sheets engine's
      // `isExternalInput` guard lets a focused <button> through).
      fireEvent.keyDown(screen.getByRole('button', { name: /back/i }), {
        key: 'Delete',
      });

      expect(bubble).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', bubble);
      document.removeEventListener('keydown', capture, true);
    }
  });

  it('moves focus into the overlay so the next keystroke lands there', async () => {
    resolveWith(EXTERNAL_ONLY_SNAPSHOT);
    const { container } = render(
      <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(document.activeElement).toBe(container.firstChild);
  });

  // Escape is the one deliberate exception: non-destructive in both engines,
  // and it is how the panel beside this overlay dismisses its dialogs.
  it('still lets Escape through', async () => {
    const bubble = vi.fn();
    document.addEventListener('keydown', bubble);
    try {
      resolveWith(EXTERNAL_ONLY_SNAPSHOT);
      render(
        <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
      );
      await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(bubble).toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', bubble);
    }
  });

  it('stops suppressing once the preview closes', async () => {
    const bubble = vi.fn();
    document.addEventListener('keydown', bubble);
    try {
      resolveWith(EXTERNAL_ONLY_SNAPSHOT);
      const { unmount } = render(
        <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
      );
      await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
      unmount();
      fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
      expect(bubble).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', bubble);
    }
  });
});

describe('RevisionPreviewOverlay', () => {
  it('reports a failed restore instead of closing on it', async () => {
    resolveWith(EXTERNAL_ONLY_SNAPSHOT);
    restoreRevision.mockRejectedValue(new Error('permission denied'));
    const onClose = vi.fn();
    render(
      <RevisionPreviewOverlay
        revisionId="r1"
        type="sheet"
        userId={42}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());

    await userEvent.click(
      screen.getByRole('button', { name: /restore this version/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(/couldn't restore this version: permission denied/i),
      ).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once the restore succeeds', async () => {
    resolveWith(EXTERNAL_ONLY_SNAPSHOT);
    const onClose = vi.fn();
    render(
      <RevisionPreviewOverlay
        revisionId="r1"
        type="sheet"
        userId={42}
        onClose={onClose}
      />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    await userEvent.click(
      screen.getByRole('button', { name: /restore this version/i }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(restoreRevision).toHaveBeenCalled();
  });
});

describe('firstWorksheetTabId', () => {
  // Datasource and lakehouse tabs occupy a `tabOrder` slot without a
  // `sheets` entry, so `tabOrder[0]` is not necessarily renderable.
  it('skips leading tabs that have no worksheet', () => {
    expect(
      firstWorksheetTabId({
        tabs: {
          ds: { id: 'ds', name: 'Postgres', type: 'datasource' },
          s1: { id: 's1', name: 'Sheet1', type: 'sheet' },
        },
        tabOrder: ['ds', 's1'],
        sheets: { s1: worksheet },
      } as never),
    ).toBe('s1');
  });

  it('returns undefined when no tab has one', () => {
    expect(
      firstWorksheetTabId({
        tabs: { ds: { id: 'ds', name: 'Postgres', type: 'datasource' } },
        tabOrder: ['ds'],
        sheets: {},
      } as never),
    ).toBeUndefined();
  });
});
