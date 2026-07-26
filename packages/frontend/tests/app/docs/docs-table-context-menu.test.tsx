import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { DocsTableContextMenu } from '@/app/docs/docs-table-context-menu';
import type { EditorAPI } from '@wafflebase/docs';

/** Minimal EditorAPI stub — only the methods DocsTableContextMenu touches. */
function makeEditor(overrides: Partial<EditorAPI> = {}): EditorAPI {
  return {
    isInTable: vi.fn(() => true),
    getTableMergeContext: vi.fn(() => ({ state: 'none' })),
    getActiveSelection: vi.fn(() => null),
    insertTableRow: vi.fn(),
    deleteTableRow: vi.fn(),
    insertTableColumn: vi.fn(),
    deleteTableColumn: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  } as unknown as EditorAPI;
}

/** Wrapper that owns the container ref the menu attaches its listener to. */
function Wrapper({ editor, readOnly = false }: { editor: EditorAPI; readOnly?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={containerRef} data-testid="doc-container" />
      <DocsTableContextMenu editor={editor} containerRef={containerRef} readOnly={readOnly} />
    </>
  );
}

describe('DocsTableContextMenu read-only bail (issue #482)', () => {
  it('control: right-click inside a table opens the edit menu when not read-only', () => {
    const editor = makeEditor();
    render(<Wrapper editor={editor} readOnly={false} />);

    fireEvent.contextMenu(screen.getByTestId('doc-container'), { clientX: 10, clientY: 10 });

    // The table-edit menu opened.
    expect(screen.getByText('Delete row')).toBeDefined();
    expect(editor.isInTable).toHaveBeenCalled();
  });

  it('read-only: right-click inside a table does NOT open the edit menu', () => {
    const editor = makeEditor();
    render(<Wrapper editor={editor} readOnly={true} />);

    fireEvent.contextMenu(screen.getByTestId('doc-container'), { clientX: 10, clientY: 10 });

    // Bailed before opening — no table-edit affordances rendered.
    expect(screen.queryByText('Delete row')).toBeNull();
    expect(screen.queryByText('Insert above')).toBeNull();
    // Bail happens before it even asks whether the caret is in a table.
    expect(editor.isInTable).not.toHaveBeenCalled();
  });
});
