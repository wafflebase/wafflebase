import { useCallback, useEffect, useRef, useState } from 'react';

import type { PdfTextAnchor } from '@/types/comments.ts';
import { readPdfTextSelection } from './text-selection.ts';

/**
 * Track the reader's text selection inside the PDF, so selecting a phrase can
 * offer to comment on it.
 *
 * Reads on `pointerup` and `keyup` rather than on `selectionchange`: the
 * latter fires continuously while the pointer drags, which would make the
 * affordance chase the cursor across the page. This settles once, when the
 * selection is finished — mouse or keyboard.
 *
 * `enabled` is false for a read-only viewer and while the region tool is
 * armed; in both cases any live selection is dropped rather than left on
 * screen offering an action that is not available.
 */
export function usePdfTextSelection(enabled: boolean): {
  /** The finished selection, or null when there is nothing to comment on. */
  selection: PdfTextAnchor | null;
  /** Forget the selection and clear it from the document. */
  clear: () => void;
  /**
   * Attach to any element whose pointer-downs must not dismiss the selection
   * — the affordance itself, which is only reachable while one exists.
   */
  keepAliveRef: React.RefObject<HTMLElement | null>;
} {
  const [selection, setSelection] = useState<PdfTextAnchor | null>(null);
  const keepAliveRef = useRef<HTMLElement | null>(null);

  const clear = useCallback(() => {
    setSelection(null);
    // Drop the browser selection too. Leaving the text highlighted after the
    // comment is anchored reads as if it were still pending.
    const sel = typeof window !== 'undefined' ? window.getSelection() : null;
    sel?.removeAllRanges();
  }, []);

  useEffect(() => {
    if (!enabled) {
      setSelection(null);
      return;
    }

    const insideKeepAlive = (target: EventTarget | null): boolean =>
      target instanceof Node && keepAliveRef.current?.contains(target) === true;

    const settle = (e: Event) => {
      // Never re-read on the affordance's own pointer-up. A browser collapses
      // the selection when the pointer goes down on something unselectable,
      // so re-reading here would find nothing, unmount the affordance, and
      // the click that was about to fire would land on nothing.
      if (insideKeepAlive(e.target)) return;
      setSelection(readPdfTextSelection(window.getSelection()));
    };

    const onPointerDown = (e: PointerEvent) => {
      // A pointer-down on the affordance is the user taking the action, not
      // starting a new selection — dismissing here would eat the click.
      if (insideKeepAlive(e.target)) return;
      setSelection(null);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', settle);
    document.addEventListener('keyup', settle);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', settle);
      document.removeEventListener('keyup', settle);
    };
  }, [enabled]);

  return { selection, clear, keepAliveRef };
}
