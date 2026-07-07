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

  it('a plain click drops a default-sized marker centered on the click', () => {
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
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400 }) as DOMRect;
    // Down and up at the same point == a click, not a drag.
    fireEvent.pointerDown(surface, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(surface, { clientX: 100, clientY: 200 });
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [pageIndex, rect] = onCreate.mock.calls[0];
    expect(pageIndex).toBe(0);
    // Default 24px marker: 24/200 wide, 24/400 tall, centered on (100,200).
    expect(rect.w).toBeCloseTo(0.12);
    expect(rect.h).toBeCloseTo(0.06);
    expect(rect.x).toBeCloseTo(0.44);
    expect(rect.y).toBeCloseTo(0.47);
  });

  it('shows a live ghost while dragging and clears it on release', () => {
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
    surface.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 400 }) as DOMRect;

    // No ghost before dragging.
    expect(screen.queryByTestId('pdf-region-ghost')).toBeNull();

    fireEvent.pointerDown(surface, { clientX: 20, clientY: 40 });
    fireEvent.pointerMove(surface, { clientX: 60, clientY: 80 });

    // Ghost tracks the drawn rect: (20,40)->(60,80) on 200x400 == 10/10/20/10%.
    const ghost = screen.getByTestId('pdf-region-ghost');
    expect(ghost.style.left).toBe('10%');
    expect(ghost.style.top).toBe('10%');
    expect(ghost.style.width).toBe('20%');
    expect(ghost.style.height).toBe('10%');

    fireEvent.pointerUp(surface, { clientX: 60, clientY: 80 });

    // Ghost cleared on release; the region is committed.
    expect(screen.queryByTestId('pdf-region-ghost')).toBeNull();
    expect(onCreate).toHaveBeenCalledWith(0, { x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
  });
});
