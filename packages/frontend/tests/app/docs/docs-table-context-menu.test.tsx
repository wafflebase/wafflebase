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
function Wrapper({
  editor,
  readOnly = false,
  canComment = true,
  onInsertComment,
}: {
  editor: EditorAPI;
  readOnly?: boolean;
  canComment?: boolean;
  onInsertComment?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={containerRef} data-testid="doc-container" />
      <DocsTableContextMenu
        editor={editor}
        containerRef={containerRef}
        readOnly={readOnly}
        canComment={canComment}
        onInsertComment={onInsertComment}
      />
    </>
  );
}

/** A selection stub — `getActiveSelection()` returning a non-empty range. */
const withSelection = () =>
  ({
    getActiveSelection: vi.fn(() => ({
      anchor: { blockId: 'b1', offset: 0 },
      focus: { blockId: 'b1', offset: 3 },
    })),
  }) as unknown as Partial<EditorAPI>;

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

describe('DocsTableContextMenu cell background reset (issue #728)', () => {
  it('clears the key instead of writing an empty string', () => {
    const applyTableCellStyle = vi.fn();
    const editor = makeEditor({ applyTableCellStyle } as Partial<EditorAPI>);
    render(<Wrapper editor={editor} />);

    fireEvent.contextMenu(screen.getByTestId('doc-container'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText('Cell background'));
    fireEvent.click(screen.getByText('Reset'));

    expect(applyTableCellStyle).toHaveBeenCalledTimes(1);
    const style = applyTableCellStyle.mock.calls[0][0] as Record<string, unknown>;
    // `toHaveBeenCalledWith({ backgroundColor: undefined })` would pass against
    // `{}` too — vitest treats an explicitly-undefined property as absent. The
    // property has to be *present* and undefined: that is what
    // `removedCellStyleAttrs` keys off to emit a CRDT attribute removal.
    expect(Object.keys(style)).toEqual(['backgroundColor']);
    expect(style.backgroundColor).toBeUndefined();
  });

  it('control: picking a swatch still passes the color through', () => {
    const applyTableCellStyle = vi.fn();
    const editor = makeEditor({ applyTableCellStyle } as Partial<EditorAPI>);
    render(<Wrapper editor={editor} />);

    fireEvent.contextMenu(screen.getByTestId('doc-container'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText('Cell background'));
    const swatch = document.querySelector('[aria-label^="Background "]')!;
    fireEvent.click(swatch);

    const style = applyTableCellStyle.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof style.backgroundColor).toBe('string');
  });
});

describe('DocsTableContextMenu Insert comment gating', () => {
  it('control: a selection in a session that can comment offers the row', () => {
    const onInsertComment = vi.fn();
    const editor = makeEditor(withSelection());
    render(
      <Wrapper editor={editor} canComment={true} onInsertComment={onInsertComment} />,
    );

    fireEvent.contextMenu(screen.getByTestId('doc-container'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText('Insert comment'));

    expect(onInsertComment).toHaveBeenCalledTimes(1);
  });

  // `beginCompose` refuses without a signed-in author as well as without a
  // selection. `SharedDocsLayout` sets `readOnly = role === "viewer"`, so an
  // *editor*-role share link opened by an anonymous visitor mounts DocsView
  // with `readOnly === false` while `fetchMeOptional()` resolves to null — an
  // editable session with no user. Selection alone would render the row, and
  // clicking it would reach `beginCompose` and return false silently.
  it('anonymous editor-role share link: the row stays hidden despite a selection', () => {
    const onInsertComment = vi.fn();
    const editor = makeEditor(withSelection());
    render(
      <Wrapper editor={editor} canComment={false} onInsertComment={onInsertComment} />,
    );

    fireEvent.contextMenu(screen.getByTestId('doc-container'), { clientX: 10, clientY: 10 });

    // The table-edit menu itself is intact — only the comment row is gone.
    expect(screen.getByText('Delete row')).toBeDefined();
    expect(screen.queryByText('Insert comment')).toBeNull();
    expect(onInsertComment).not.toHaveBeenCalled();
  });

  it('no selection: the row stays hidden even when the session can comment', () => {
    const onInsertComment = vi.fn();
    const editor = makeEditor();
    render(
      <Wrapper editor={editor} canComment={true} onInsertComment={onInsertComment} />,
    );

    fireEvent.contextMenu(screen.getByTestId('doc-container'), { clientX: 10, clientY: 10 });

    expect(screen.getByText('Delete row')).toBeDefined();
    expect(screen.queryByText('Insert comment')).toBeNull();
  });
});

describe('DocsTableContextMenu keyboard model', () => {
  const open = (editor: EditorAPI) => {
    render(<Wrapper editor={editor} />);
    fireEvent.contextMenu(screen.getByTestId('doc-container'), {
      clientX: 10,
      clientY: 10,
    });
  };
  const press = (key: string) =>
    fireEvent.keyDown(document.activeElement as Element, { key });
  const focusedText = () => document.activeElement?.textContent?.trim();

  it('opens focused and walks rows, skipping labels and the disabled merge row', () => {
    open(makeEditor());
    const [menu] = screen.getAllByRole('menu');
    expect(document.activeElement).toBe(menu);
    press('ArrowDown');
    expect(focusedText()).toBe('Insert above');
    press('ArrowDown');
    press('ArrowDown');
    expect(focusedText()).toBe('Delete row');
    press('ArrowDown');
    expect(focusedText()).toBe('Insert left');
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    // "Merge cells" is disabled with nothing to merge — skipped.
    expect(focusedText()).toBe('Cell background');
    press('End');
    expect(focusedText()).toBe('Delete table');
  });

  it('ArrowRight opens the colour submenu with focus inside; ArrowLeft returns', () => {
    const editor = makeEditor({ applyTableCellStyle: vi.fn() } as Partial<EditorAPI>);
    open(editor);
    const trigger = screen.getByText('Cell background').closest('button')!;
    trigger.focus();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    press('ArrowRight');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(focusedText()).toBe('Reset');
    press('ArrowDown');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Background /);
    press('ArrowLeft');
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByText('Reset')).toBeNull();

    // Enter opens it too, and a swatch activates from the keyboard.
    press('Enter');
    expect(focusedText()).toBe('Reset');
    press('ArrowDown');
    press('Enter');
    expect(editor.applyTableCellStyle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape in the submenu closes only the submenu; Escape again closes the menu', () => {
    const editor = makeEditor();
    open(editor);
    const trigger = screen.getByText('Cell background').closest('button')!;
    trigger.focus();
    press('ArrowRight');
    press('Escape');
    expect(document.activeElement).toBe(trigger);
    expect(screen.getAllByRole('menu')).toHaveLength(1);
    press('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });
});
