import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RevisionPreview } from '../revision-preview';

const getRevision = vi.fn();
vi.mock('@yorkie-js/react', () => ({ useRevisions: () => ({ getRevision }) }));

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
const SHEET_SNAPSHOT = JSON.stringify({
  tabs: { 'tab-1': { id: 'tab-1', name: 'Sheet1', type: 'sheet' } },
  tabOrder: ['tab-1'],
  sheets: {
    'tab-1': {
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
    },
  },
});

describe('RevisionPreview', () => {
  it('announces that this is a past version, with its time', async () => {
    getRevision.mockResolvedValue({
      id: 'r1', label: 'v1', description: '', createdAt: new Date('2026-09-02T10:00:00Z'),
      snapshot: SHEET_SNAPSHOT,
    });
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
});
