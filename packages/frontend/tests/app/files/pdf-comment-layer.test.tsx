import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdfCommentLayer } from '@/app/files/pdf-comment-layer';
import type { Thread, PdfRegionAnchor } from '@/types/comments';

const thread = (id: string, pageIndex: number): Thread<PdfRegionAnchor> => ({
  id,
  anchor: { kind: 'pdf-region', pageIndex, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 } },
  comments: [{ id: 'c', author: { userId: '1', username: 'a' }, body: 'hi', createdAt: 1 }],
  resolved: false,
  createdAt: 1,
});

describe('PdfCommentLayer', () => {
  it('renders one pin per thread on this page only', () => {
    render(
      <PdfCommentLayer
        pageIndex={0}
        threads={[thread('a', 0), thread('b', 1), thread('c', 0)]}
        creating={false}
        onCreateRegion={vi.fn()}
        onSelectThread={vi.fn()}
        activeThreadId={null}
      />,
    );
    expect(screen.getAllByRole('button', { name: /comment/i })).toHaveLength(2);
  });

  it('selecting a pin calls onSelectThread', () => {
    const onSelect = vi.fn();
    render(
      <PdfCommentLayer
        pageIndex={0}
        threads={[thread('a', 0)]}
        creating={false}
        onCreateRegion={vi.fn()}
        onSelectThread={onSelect}
        activeThreadId={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /comment/i }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('does not render a pin for a resolved thread', () => {
    const resolved = { ...thread('a', 0), resolved: true };
    render(
      <PdfCommentLayer
        pageIndex={0}
        threads={[resolved]}
        creating={false}
        onCreateRegion={vi.fn()}
        onSelectThread={vi.fn()}
        activeThreadId={null}
      />,
    );
    expect(screen.queryAllByRole('button', { name: /comment/i })).toHaveLength(0);
  });

  it('a drag on the capture surface emits a normalized region', () => {
    const onCreate = vi.fn();
    render(
      <PdfCommentLayer
        pageIndex={0}
        threads={[]}
        creating
        onCreateRegion={onCreate}
        onSelectThread={vi.fn()}
        activeThreadId={null}
      />,
    );
    const surface = screen.getByTestId('pdf-region-capture');
    // jsdom gives 0-size rects; stub getBoundingClientRect for deterministic math.
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400 }) as DOMRect;
    fireEvent.pointerDown(surface, { clientX: 20, clientY: 40 });
    fireEvent.pointerUp(surface, { clientX: 60, clientY: 80 });
    expect(onCreate).toHaveBeenCalledWith(0, { x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });
});
