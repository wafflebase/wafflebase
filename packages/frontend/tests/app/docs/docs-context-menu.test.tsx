import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { DocsContextMenu } from '@/app/docs/docs-context-menu';
import type { EditorAPI } from '@wafflebase/docs';

/** Minimal EditorAPI stub — only the methods DocsContextMenu calls. */
function makeEditor(overrides: Partial<EditorAPI> = {}): EditorAPI {
  return {
    isInTable: vi.fn(() => false),
    getActiveSelection: vi.fn(() => null),
    getSpellErrorAt: vi.fn(() => undefined),
    getSpellSuggestions: vi.fn(() => Promise.resolve([])),
    applySpellSuggestion: vi.fn(),
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(() => Promise.resolve()),
    requestLink: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  } as unknown as EditorAPI;
}

/** Wrapper that owns the container ref that DocsContextMenu attaches to. */
function Wrapper({
  editor,
  readOnly = false,
  canComment = true,
  onInsertComment = vi.fn(),
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
      <DocsContextMenu
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

describe('DocsContextMenu', () => {
  it('(a) no-selection + not-readonly: shows Paste/Add link, hides Cut/Copy/Insert comment', () => {
    const editor = makeEditor();
    render(<Wrapper editor={editor} readOnly={false} />);

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });

    // Insert / paste group visible
    expect(screen.getByText('Paste')).toBeDefined();
    expect(screen.getByText('Add link')).toBeDefined();

    // Clipboard-selection-gated items absent (no selection)
    expect(screen.queryByText('Cut')).toBeNull();
    expect(screen.queryByText('Copy')).toBeNull();
    // A comment anchors to a text range, so `beginCompose` refuses a bare
    // caret. The row must not be offered at all — see (f).
    expect(screen.queryByText('Insert comment')).toBeNull();
  });

  it('(b) readOnly + no selection + no spell error: menu does not open', () => {
    const editor = makeEditor();
    render(<Wrapper editor={editor} readOnly={true} />);

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });

    // All groups are hidden in readOnly with no selection/spell error:
    // the empty-overlay guard should have bailed before opening.
    expect(screen.queryByText('Paste')).toBeNull();
    expect(screen.queryByText('Add link')).toBeNull();
    expect(screen.queryByText('Insert comment')).toBeNull();
  });

  it('(c) isInTable() true: handler bails, no menu opens', () => {
    const editor = makeEditor({ isInTable: vi.fn(() => true) });
    render(<Wrapper editor={editor} readOnly={false} />);

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });

    expect(screen.queryByText('Paste')).toBeNull();
    expect(screen.queryByText('Add link')).toBeNull();
  });

  // A read-only editor still constructs its TextEditor and hidden textarea,
  // so `editor.copy()` works there — the menu used to hide Copy anyway.
  it('(d) readOnly + selection: offers Copy but not Cut or Paste', () => {
    const editor = makeEditor({
      getActiveSelection: vi.fn(() => ({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 3 },
      })) as unknown as EditorAPI['getActiveSelection'],
    });
    render(<Wrapper editor={editor} readOnly={true} />);

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });

    expect(screen.getByText('Copy')).toBeDefined();
    expect(screen.queryByText('Cut')).toBeNull();
    expect(screen.queryByText('Paste')).toBeNull();
    expect(screen.queryByText('Add link')).toBeNull();
  });

  it('(e) Copy in readOnly calls editor.copy()', () => {
    const copy = vi.fn();
    const editor = makeEditor({
      copy,
      getActiveSelection: vi.fn(() => ({
        anchor: { blockId: 'b1', offset: 0 },
        focus: { blockId: 'b1', offset: 3 },
      })) as unknown as EditorAPI['getActiveSelection'],
    });
    render(<Wrapper editor={editor} readOnly={true} />);

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByText('Copy'));

    expect(copy).toHaveBeenCalledTimes(1);
  });

  // `beginCompose` returns early unless `getActiveSelection()` is non-null, so
  // an Insert comment row shown at a bare caret is an enabled item that does
  // nothing. Gate it on the same selection the table menu gates it on. The
  // negative half of that claim is case (a).
  it('(f) Insert comment is offered with a selection, and composes when clicked', () => {
    const onInsertComment = vi.fn();
    const editor = makeEditor(withSelection());
    render(
      <Wrapper
        editor={editor}
        readOnly={false}
        canComment={true}
        onInsertComment={onInsertComment}
      />,
    );

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });

    const row = screen.getByText('Insert comment');
    fireEvent.click(row);
    expect(onInsertComment).toHaveBeenCalledTimes(1);
  });

  // The other half of `beginCompose`'s guard: it also refuses without a
  // signed-in author. `SharedDocsLayout` sets `readOnly = role === "viewer"`,
  // so an *editor*-role share link opened by an anonymous visitor mounts
  // DocsView with `readOnly === false` while `fetchMeOptional()` resolves to
  // null — an editable session with no user. Selection alone would render the
  // row, and clicking it would reach `beginCompose` and return false silently.
  it('(g) anonymous editor-role share link: Insert comment stays hidden despite a selection', () => {
    const onInsertComment = vi.fn();
    const editor = makeEditor(withSelection());
    render(
      <Wrapper
        editor={editor}
        readOnly={false}
        canComment={false}
        onInsertComment={onInsertComment}
      />,
    );

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });

    // The rest of the editable menu is intact — only the comment row is gone,
    // so this is a gate on commenting rather than the menu failing to open.
    expect(screen.getByText('Add link')).toBeDefined();
    expect(screen.getByText('Cut')).toBeDefined();
    expect(screen.queryByText('Insert comment')).toBeNull();
    expect(onInsertComment).not.toHaveBeenCalled();
  });
});

describe('DocsContextMenu keyboard model', () => {
  const open = (editor: EditorAPI) => {
    render(<Wrapper editor={editor} />);
    fireEvent.contextMenu(screen.getByTestId('doc-container'), {
      clientX: 10,
      clientY: 10,
    });
    return screen.getByRole('menu');
  };
  const press = (key: string) =>
    fireEvent.keyDown(document.activeElement as Element, { key });

  it('opens as a focused role=menu whose rows are menuitems', () => {
    const menu = open(makeEditor(withSelection()));
    expect(document.activeElement).toBe(menu);
    const labels = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(labels[0]).toMatch(/^Cut/);
    // No row sits in the Tab order; focus moves by arrow key.
    for (const el of screen.getAllByRole('menuitem')) {
      expect(el.tabIndex).toBe(-1);
    }
  });

  it('ArrowDown / ArrowUp / Home / End move focus between rows, wrapping', () => {
    open(makeEditor(withSelection()));
    press('ArrowDown');
    expect(document.activeElement?.textContent).toMatch(/^Cut/);
    press('ArrowDown');
    expect(document.activeElement?.textContent).toMatch(/^Copy/);
    press('End');
    expect(document.activeElement?.textContent).toMatch(/^Insert comment/);
    press('ArrowDown');
    expect(document.activeElement?.textContent).toMatch(/^Cut/);
    press('ArrowUp');
    expect(document.activeElement?.textContent).toMatch(/^Insert comment/);
    press('Home');
    expect(document.activeElement?.textContent).toMatch(/^Cut/);
  });

  it('Enter activates the focused row and returns focus to the editor', () => {
    const editor = makeEditor(withSelection());
    open(editor);
    press('ArrowDown');
    press('ArrowDown'); // Copy
    press('Enter');
    expect(editor.copy).toHaveBeenCalledTimes(1);
    expect(editor.focus).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('typing a letter jumps to the next row starting with it', () => {
    open(makeEditor(withSelection()));
    press('p');
    expect(document.activeElement?.textContent).toMatch(/^Paste/);
    press('c');
    expect(document.activeElement?.textContent).toMatch(/^Cut/);
    press('c');
    expect(document.activeElement?.textContent).toMatch(/^Copy/);
  });

  it('Escape closes the menu and hands focus back to the editor', () => {
    const editor = makeEditor();
    open(editor);
    press('ArrowDown');
    press('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(editor.focus).toHaveBeenCalledTimes(1);
  });

  it('skips status rows that are not actions', async () => {
    const editor = makeEditor({
      getSpellErrorAt: vi.fn(() => ({ word: 'teh' })) as unknown as EditorAPI['getSpellErrorAt'],
      // Never resolves: the "Checking…" row stays up.
      getSpellSuggestions: vi.fn(() => new Promise<string[]>(() => {})),
    });
    open(editor);
    const checking = screen.getByText('Checking…');
    expect(checking.getAttribute('aria-disabled')).toBe('true');
    press('ArrowDown');
    expect(document.activeElement?.textContent).toMatch(/^Paste/);
  });

  it('hovering a row focuses it, so one highlight serves pointer and keys', () => {
    open(makeEditor(withSelection()));
    const copy = screen.getByText('Copy').closest('button')!;
    fireEvent.pointerMove(copy);
    expect(document.activeElement).toBe(copy);
    press('ArrowDown');
    expect(document.activeElement?.textContent).toMatch(/^Paste/);
  });
});
