import { useRef } from 'react';
import { IconMessage } from '@tabler/icons-react';

import type { PdfRect, PdfRegionAnchor, Thread } from '@/types/comments.ts';
import { normalizeDragRect, rectToStyle } from './comments/rect.ts';

type Props = {
  pageIndex: number;
  threads: ReadonlyArray<Thread<PdfRegionAnchor>>;
  creating: boolean;
  onCreateRegion: (pageIndex: number, rect: PdfRect) => void;
  onSelectThread: (threadId: string) => void;
  activeThreadId: string | null;
};

/**
 * Overlay for one PDF page (parent must be `position: relative`). Draws a
 * pin per unresolved thread anchored to this page, and — while `creating` —
 * a transparent surface that converts a drag into a normalized region.
 */
export function PdfCommentLayer({
  pageIndex,
  threads,
  creating,
  onCreateRegion,
  onSelectThread,
  activeThreadId,
}: Props) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pageThreads = threads.filter(
    (t) => t.anchor.pageIndex === pageIndex && !t.resolved,
  );

  const localPoint = (e: React.PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {pageThreads.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={`Comment by ${t.comments[0]?.author.username ?? 'unknown'}`}
          onClick={() => onSelectThread(t.id)}
          className={`pointer-events-auto absolute flex items-center justify-center rounded border-2 bg-yellow-200/30 ${
            t.id === activeThreadId ? 'border-yellow-500' : 'border-yellow-400'
          }`}
          style={rectToStyle(t.anchor.rect)}
        >
          <IconMessage size={14} className="text-yellow-700" />
        </button>
      ))}

      {creating && (
        <div
          data-testid="pdf-region-capture"
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
          onPointerDown={(e) => {
            const p = localPoint(e, e.currentTarget);
            dragStart.current = { x: p.x, y: p.y };
            // Some environments (jsdom) don't implement pointer capture.
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerUp={(e) => {
            const start = dragStart.current;
            dragStart.current = null;
            if (!start) return;
            const p = localPoint(e, e.currentTarget);
            const rect = normalizeDragRect(start, { x: p.x, y: p.y }, p.w, p.h);
            // Ignore an accidental click with no drag area.
            if (rect.w < 0.01 || rect.h < 0.01) return;
            onCreateRegion(pageIndex, rect);
          }}
        />
      )}
    </div>
  );
}
