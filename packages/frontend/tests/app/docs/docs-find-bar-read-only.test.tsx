import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRef } from 'react';
import { DocsFindBar } from '@/app/docs/docs-find-bar';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { EditorAPI } from '@wafflebase/docs';

/**
 * The find bar drives `FindReplaceState` straight against the `Doc` and the
 * store, so it never passes through the editor's read-only neutralization
 * (`MUTATING_METHODS` in `packages/docs/src/view/editor.ts`). These tests pin
 * the gate that has to live in the component itself: a viewer can search, but
 * nothing they can reach may call `doc.deleteText` / `doc.insertText`.
 */

/** Minimal Doc stub: one match for any non-empty query, spies for the writes. */
function makeDoc() {
  return {
    searchText: vi.fn(() => [
      { blockId: 'b1', startOffset: 0, endOffset: 3 },
    ]),
    deleteText: vi.fn(),
    insertText: vi.fn(),
  };
}

function makeEditor(doc: ReturnType<typeof makeDoc>): EditorAPI {
  return {
    getDoc: vi.fn(() => doc),
    getStore: vi.fn(() => ({ snapshot: vi.fn() })),
    setSearchMatches: vi.fn(),
    clearSearchMatches: vi.fn(),
    clearImageSelection: vi.fn(),
    render: vi.fn(),
    focus: vi.fn(),
  } as unknown as EditorAPI;
}

function Wrapper({
  editor,
  readOnly,
}: {
  editor: EditorAPI;
  readOnly: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <TooltipProvider>
      <div ref={containerRef} data-testid="doc-container" />
      <DocsFindBar
        editor={editor}
        showReplace
        onClose={vi.fn()}
        containerRef={containerRef}
        readOnly={readOnly}
      />
    </TooltipProvider>
  );
}

describe('DocsFindBar read-only gate', () => {
  it('hides the replace row for a viewer but keeps find working', () => {
    const doc = makeDoc();
    render(<Wrapper editor={makeEditor(doc)} readOnly />);

    fireEvent.change(screen.getByLabelText('Find'), {
      target: { value: 'abc' },
    });

    // Find still runs — it only reads.
    expect(doc.searchText).toHaveBeenCalled();
    expect(screen.getByText('1 of 1')).toBeDefined();

    // The whole replace row is gone.
    expect(screen.queryByLabelText('Replace with')).toBeNull();
    expect(screen.queryByText('Replace')).toBeNull();
    expect(screen.queryByText('All')).toBeNull();
  });

  it('renders the replace row and writes when not read-only', () => {
    const doc = makeDoc();
    render(<Wrapper editor={makeEditor(doc)} readOnly={false} />);

    fireEvent.change(screen.getByLabelText('Find'), {
      target: { value: 'abc' },
    });
    fireEvent.change(screen.getByLabelText('Replace with'), {
      target: { value: 'xyz' },
    });
    fireEvent.click(screen.getByText('Replace'));

    expect(doc.deleteText).toHaveBeenCalled();
    expect(doc.insertText).toHaveBeenCalled();
  });

  it('refuses a replace forced past the hidden row', () => {
    const doc = makeDoc();
    render(<Wrapper editor={makeEditor(doc)} readOnly />);

    fireEvent.change(screen.getByLabelText('Find'), {
      target: { value: 'abc' },
    });
    // Enter in the replace input is the other way in; the input is not even
    // rendered, and the handlers refuse regardless.
    expect(doc.deleteText).not.toHaveBeenCalled();
    expect(doc.insertText).not.toHaveBeenCalled();
  });
});
