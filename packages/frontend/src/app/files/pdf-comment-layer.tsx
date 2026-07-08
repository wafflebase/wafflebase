import { Fragment, useRef, useState } from 'react';
import { IconMessage } from '@tabler/icons-react';

import type { PdfRect, PdfRegionAnchor, Thread } from '@/types/comments.ts';
import { normalizeDragRect, rectToStyle } from './comments/rect.ts';

// A single click (no drag) drops a default marker of this pixel size at the
// click point, so commenting a spot doesn't require dragging a box.
const DEFAULT_MARK_PX = 24;

type Props = {
  pageIndex: number;
  threads: ReadonlyArray<Thread<PdfRegionAnchor>>;
  creating: boolean;
  onCreateRegion: (pageIndex: number, rect: PdfRect) => void;
  onSelectThread: (threadId: string) => void;
  activeThreadId: string | null;
};

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Overlay for one PDF page (parent must be `position: relative`). For each
 * unresolved thread anchored to this page it draws a faint region highlight
 * plus a compact pin at the region's top-left corner. While `creating`, a
 * transparent surface turns a drag into a normalized region — or a plain
 * click into a small default-sized marker at the click point.
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
  // Live rectangle drawn while dragging, so the region gets slides-style
  // ghost feedback before it's committed on pointer-up.
  const [ghost, setGhost] = useState<PdfRect | null>(null);
  const pageThreads = threads.filter(
    (t) => t.anchor.pageIndex === pageIndex && !t.resolved,
  );

  const localPoint = (e: React.PointerEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  return (
    <div className="pointer-events-none absolute inset-0">
      {pageThreads.map((t) => {
        const active = t.id === activeThreadId;
        return (
          <Fragment key={t.id}>
            {/* Faint highlight of the commented region. */}
            <div
              className={`absolute rounded-sm border bg-yellow-200/20 ${
                active ? 'border-yellow-500' : 'border-yellow-400/60'
              }`}
              style={rectToStyle(t.anchor.rect)}
            />
            {/* Compact clickable pin at the region's top-left corner. */}
            <button
              type="button"
              aria-label={`Comment by ${
                t.comments[0]?.author.username ?? 'unknown'
              }`}
              onClick={() => onSelectThread(t.id)}
              className={`pointer-events-auto absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-yellow-300 shadow-sm hover:bg-yellow-400 ${
                active
                  ? 'border-yellow-600 ring-1 ring-yellow-500'
                  : 'border-yellow-500'
              }`}
              style={{
                left: `${t.anchor.rect.x * 100}%`,
                top: `${t.anchor.rect.y * 100}%`,
              }}
            >
              <IconMessage size={12} className="text-yellow-800" />
            </button>
          </Fragment>
        );
      })}

      {creating && (
        <div
          data-testid="pdf-region-capture"
          className="pointer-events-auto absolute inset-0 cursor-crosshair"
          onPointerDown={(e) => {
            const p = localPoint(e, e.currentTarget);
            dragStart.current = { x: p.x, y: p.y };
            setGhost(null);
            // Some environments (jsdom) don't implement pointer capture.
            e.currentTarget.setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const start = dragStart.current;
            if (!start) return;
            const p = localPoint(e, e.currentTarget);
            setGhost(normalizeDragRect(start, { x: p.x, y: p.y }, p.w, p.h));
          }}
          onPointerCancel={() => {
            dragStart.current = null;
            setGhost(null);
          }}
          onPointerUp={(e) => {
            const start = dragStart.current;
            dragStart.current = null;
            setGhost(null);
            if (!start) return;
            const p = localPoint(e, e.currentTarget);
            const rect = normalizeDragRect(start, { x: p.x, y: p.y }, p.w, p.h);
            // A plain click (no meaningful drag area) drops a default-sized
            // marker at the click point instead of being ignored.
            if (rect.w < 0.01 || rect.h < 0.01) {
              const w = Math.min(DEFAULT_MARK_PX / p.w, 1);
              const h = Math.min(DEFAULT_MARK_PX / p.h, 1);
              onCreateRegion(pageIndex, {
                x: clamp01(start.x / p.w - w / 2),
                y: clamp01(start.y / p.h - h / 2),
                w,
                h,
              });
              return;
            }
            onCreateRegion(pageIndex, rect);
          }}
        >
          {/* Live ghost of the region being dragged (slides-style). */}
          {ghost && (ghost.w > 0 || ghost.h > 0) && (
            <div
              data-testid="pdf-region-ghost"
              className="pointer-events-none absolute rounded-sm border-2 border-dashed border-yellow-500 bg-yellow-200/30"
              style={rectToStyle(ghost)}
            />
          )}
        </div>
      )}
    </div>
  );
}
