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
  onInsertComment = vi.fn(),
}: {
  editor: EditorAPI;
  readOnly?: boolean;
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
        onInsertComment={onInsertComment}
      />
    </>
  );
}

describe('DocsContextMenu', () => {
  it('(a) no-selection + not-readonly: shows Paste/Add link/Insert comment, hides Cut/Copy', () => {
    const editor = makeEditor();
    render(<Wrapper editor={editor} readOnly={false} />);

    const container = screen.getByTestId('doc-container');
    fireEvent.contextMenu(container, { clientX: 10, clientY: 10 });

    // Insert / paste group visible
    expect(screen.getByText('Paste')).toBeDefined();
    expect(screen.getByText('Add link')).toBeDefined();
    expect(screen.getByText('Insert comment')).toBeDefined();

    // Clipboard-selection-gated items absent (no selection)
    expect(screen.queryByText('Cut')).toBeNull();
    expect(screen.queryByText('Copy')).toBeNull();
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
});
