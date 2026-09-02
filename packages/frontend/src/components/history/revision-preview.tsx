import { useEffect, useRef, useState } from 'react';
import { useRevisions, type RevisionSummary } from '@yorkie-js/react';
import {
  initialize as initializeSheet,
  MemStore,
  type SpreadsheetDocument,
} from '@wafflebase/sheets';
import {
  deckSlideHeight,
  initializeEditor,
  MemSlidesStore,
  SLIDE_WIDTH,
  type SlidesDocument,
  type SlidesEditor,
  type Viewport,
} from '@wafflebase/slides';
import {
  initialize as initializeNote,
  MemNoteStore,
} from '@wafflebase/notes';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';

import {
  parseBoardSnapshot,
  parseNoteSnapshot,
  parseSheetSnapshot,
  parseSlidesSnapshot,
} from './snapshot-adapters';
import { readRevisionMeta } from './revision-meta';
import { useRevisionHistory } from './use-revision-history';

export type RevisionPreviewType = 'sheet' | 'slides' | 'board' | 'note';

type Props = {
  revisionId: string;
  type: RevisionPreviewType;
  onRestore: () => void;
  onBack: () => void;
};

/**
 * The parsed content, tagged by which adapter produced it. `slides` and
 * `board` share a shape (a board is one synthetic slide — see
 * `snapshot-adapters.ts`) but are kept as distinct tags so the mount effect
 * below can pass `suppressSlideChrome`/a full-plane `viewport` for board
 * without the sheet/note branches needing to know that distinction exists.
 */
type ParsedContent =
  | { kind: 'sheet'; doc: SpreadsheetDocument }
  | { kind: 'slides'; doc: SlidesDocument }
  | { kind: 'board'; doc: SlidesDocument }
  | { kind: 'note'; text: string };

function parseByType(type: RevisionPreviewType, snapshot: string): ParsedContent {
  switch (type) {
    case 'sheet':
      return { kind: 'sheet', doc: parseSheetSnapshot(snapshot) };
    case 'slides':
      return { kind: 'slides', doc: parseSlidesSnapshot(snapshot) };
    case 'board':
      return { kind: 'board', doc: parseBoardSnapshot(snapshot) };
    case 'note':
      return { kind: 'note', text: parseNoteSnapshot(snapshot) };
  }
}

function formatRevisionTime(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Read-only preview of one past revision, rendered as a banner over the
 * document's own viewer rather than a modal: four of the five engines are
 * Canvas-based, and a Canvas mounted inside a dialog loses the scroll, zoom
 * and pan the live viewer already implements. Docs is not a supported
 * `type` here — see `snapshot-adapters.ts` for why (`YSON.parse` cannot
 * read a docs snapshot's nested `Tree`).
 */
export function RevisionPreview({ revisionId, type, onRestore, onBack }: Props) {
  const { getRevision } = useRevisions();
  const [meta, setMeta] = useState<{ createdAt: Date; title: string } | null>(null);
  const [content, setContent] = useState<ParsedContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setContent(null);
    setError(null);

    getRevision(revisionId)
      .then((revision: RevisionSummary) => {
        if (cancelled) return;
        const revMeta = readRevisionMeta(revision);
        setMeta({
          createdAt: revision.createdAt,
          title: revMeta.kind === 'automatic' ? 'Automatic version' : revision.label,
        });
        try {
          setContent(parseByType(type, revision.snapshot));
        } catch (err) {
          // A snapshot this build cannot parse must say so — rendering an
          // empty document would read as "this version was blank," which
          // is a lie about the user's data.
          setError(
            err instanceof Error ? err.message : 'This version could not be read.',
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'This version could not be loaded.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [getRevision, revisionId, type]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background">
      {meta && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2 text-sm"
        >
          <span>
            Viewing {meta.title} from {formatRevisionTime(meta.createdAt)}
          </span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              Back to current version
            </Button>
            <Button type="button" size="sm" onClick={onRestore}>
              Restore this version
            </Button>
          </div>
        </div>
      )}
      {content?.kind === 'sheet' && (
        <p className="border-b bg-muted/50 px-4 py-1 text-xs text-muted-foreground">
          Charts and images are not shown in preview.
        </p>
      )}
      <div className="relative min-h-0 flex-1">
        {error && (
          <div
            role="alert"
            className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive"
          >
            Couldn't read this version: {error}
          </div>
        )}
        {!error && content?.kind === 'sheet' && <SheetPreview doc={content.doc} />}
        {!error && content?.kind === 'slides' && <SlidesPreview doc={content.doc} />}
        {!error && content?.kind === 'board' && <SlidesPreview doc={content.doc} board />}
        {!error && content?.kind === 'note' && <NotePreview text={content.text} />}
      </div>
    </div>
  );
}

/**
 * Wires `RevisionPreview`'s "Restore this version" button to an actual
 * restore, without every call site duplicating that plumbing. Only
 * instantiated while a preview is open (the five editors render this
 * conditionally on `previewRevisionId`), so `useRevisions()` — and the
 * network calls it can trigger — is never reached by a mount that never
 * opens version history at all.
 *
 * `useRevisionHistory({ enabled: false })` skips its own `listRevisions`
 * fetch (the `HistoryPanel` already open elsewhere owns that list); this
 * instance exists only for `restore`. Mirrors Google Docs: the preview
 * *is* the confirmation, so restoring from it performs the restore
 * directly rather than opening a second confirm dialog like the panel's
 * list-row Restore does.
 */
export function RevisionPreviewOverlay({
  revisionId,
  type,
  userId,
  onClose,
  onRestored,
}: {
  revisionId: string;
  type: RevisionPreviewType;
  userId: number;
  onClose: () => void;
  /** Forwarded to `useRevisionHistory` — see `HistoryPanel`'s own prop of the same name. */
  onRestored?: () => void;
}) {
  const { restore } = useRevisionHistory({ enabled: false, userId, onRestored });

  return (
    <RevisionPreview
      revisionId={revisionId}
      type={type}
      onBack={onClose}
      onRestore={() => {
        onClose();
        void restore(revisionId);
      }}
    />
  );
}

/**
 * Mounts `@wafflebase/sheets`'s own Canvas engine directly (not the
 * frontend's `SheetView`, which is hard-wired to a live Yorkie doc via
 * `YorkieStore`) over a `MemStore` hydrated from the revision's first tab —
 * `MemStore.load` (Task 10) replaces a store's whole worksheet in one call.
 *
 * A revision preview shows only the first tab. `RevisionPreview` has no
 * tab-selection prop (the panel that opens it is document-level, not
 * tab-scoped), so a multi-tab workbook's other tabs aren't previewable yet.
 *
 * Untestable past the mount attempt itself in this repo's test environment:
 * jsdom has no working Canvas 2D context (`HTMLCanvasElement.getContext`
 * returns `null`), so `Worksheet`'s render pipeline throws once it actually
 * paints — no test anywhere in `@wafflebase/sheets`/`@wafflebase/slides`/
 * `@wafflebase/notes` mounts its own canvas engine for the same reason. This
 * mount was verified by source reading against `sheet-view.tsx`'s
 * established `initialize()` usage instead.
 */
function SheetPreview({ doc }: { doc: SpreadsheetDocument }) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const tabId = doc.tabOrder?.[0];
    const worksheet = tabId ? doc.sheets?.[tabId] : undefined;
    if (!container || !worksheet) return;

    let cancelled = false;
    let sheet: Awaited<ReturnType<typeof initializeSheet>> | undefined;

    try {
      const store = new MemStore();
      store.load(worksheet);
      initializeSheet(container, {
        theme: resolvedTheme,
        store,
        readOnly: true,
      })
        .then((s) => {
          if (cancelled) {
            s.cleanup();
            return;
          }
          sheet = s;
        })
        .catch((err) => {
          console.error('Failed to mount the sheet preview', err);
        });
    } catch (err) {
      console.error('Failed to mount the sheet preview', err);
    }

    return () => {
      cancelled = true;
      sheet?.cleanup();
    };
  }, [doc, resolvedTheme]);

  return <div ref={containerRef} className="h-full w-full" />;
}

/**
 * Mounts `@wafflebase/slides`'s own Canvas editor (`initializeEditor`, the
 * same engine `SlidesView`/`BoardView` embed) read-only over a
 * `MemSlidesStore` hydrated from the parsed snapshot — the store's
 * constructor takes the whole document directly, so no separate `.load()`
 * step is needed (unlike the sheet's `MemStore`).
 *
 * `readOnly: true` disables every pointer/keyboard binding on the editor
 * (see `SlidesEditorOptions.readOnly`'s own doc comment), so this mount
 * needs no interaction wiring — only sizing. `board` reuses the same
 * editor with a full-plane `viewport` and `suppressSlideChrome`, matching
 * how `board-view.tsx` mounts it; the viewport starts at the origin rather
 * than fit to content, so board content placed far from (0, 0) may render
 * off-screen in the preview until a fit-to-content pass is added.
 */
function SlidesPreview({ doc, board = false }: { doc: SlidesDocument; board?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let editor: SlidesEditor | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const slideWrap = document.createElement('div');
    slideWrap.style.position = 'relative';

    try {
      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.display = 'block';

      const overlay = document.createElement('div');
      overlay.style.position = 'absolute';
      overlay.style.left = '0';
      overlay.style.top = '0';
      overlay.style.pointerEvents = 'none';

      slideWrap.appendChild(canvas);
      slideWrap.appendChild(overlay);
      container.appendChild(slideWrap);

      const store = new MemSlidesStore(doc);

      const sizeTo = (w: number, h: number) => {
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        overlay.style.width = `${w}px`;
        overlay.style.height = `${h}px`;
        slideWrap.style.width = `${w}px`;
        slideWrap.style.height = `${h}px`;
      };

      const fitInside = (availW: number, availH: number, aspect: number) => {
        let w = availW;
        let h = w / aspect;
        if (h > availH) {
          h = availH;
          w = h * aspect;
        }
        return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
      };

      const boardViewport: Viewport = { panX: 0, panY: 0, zoom: 1 };

      const mountOrResize = () => {
        const rect = container.getBoundingClientRect();
        const availW = Math.max(1, Math.round(rect.width));
        const availH = Math.max(1, Math.round(rect.height));

        if (board) {
          sizeTo(availW, availH);
          if (!editor) {
            editor = initializeEditor({
              canvas,
              overlay,
              store,
              hostWidth: availW,
              hostHeight: availH,
              dpr,
              viewport: boardViewport,
              cull: true,
              suppressSlideChrome: true,
              readOnly: true,
            });
          } else {
            editor.setHostSize(availW, availH);
          }
          return;
        }

        const aspect = SLIDE_WIDTH / deckSlideHeight(store.readMeta());
        const fit = fitInside(availW, availH, aspect);
        sizeTo(fit.w, fit.h);
        if (!editor) {
          editor = initializeEditor({
            canvas,
            overlay,
            store,
            hostWidth: fit.w,
            hostHeight: fit.h,
            dpr,
            readOnly: true,
          });
        } else {
          editor.setHostSize(fit.w, fit.h);
        }
      };

      mountOrResize();
      resizeObserver = new ResizeObserver(() => mountOrResize());
      resizeObserver.observe(container);
    } catch (err) {
      console.error('Failed to mount the slides preview', err);
    }

    return () => {
      resizeObserver?.disconnect();
      // `SlidesEditorImpl`'s constructor unconditionally attaches a global
      // `document.fonts` `loadingdone` listener (even for a readOnly
      // mount), removed only inside `detach()`. Without this call, every
      // slides/board preview opened in a session leaks that listener plus
      // the editor, canvas and store it closes over — and the listener
      // keeps firing `render()` against a canvas already removed from the
      // DOM by `slideWrap.remove()` below.
      editor?.detach();
      slideWrap.remove();
    };
  }, [doc, board]);

  return (
    <div
      ref={containerRef}
      className="flex h-full w-full items-center justify-center overflow-hidden bg-muted/20"
    />
  );
}

/**
 * Mounts `@wafflebase/notes`'s own editor in preview-only, read-only mode
 * (`viewMode: 'view'` renders the markdown preview pane alone — no source
 * editor pane, matching a read-only surface) over a `MemNoteStore` seeded
 * with the parsed text directly.
 */
function NotePreview({ text }: { text: string }) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let api: ReturnType<typeof initializeNote> | undefined;
    try {
      const store = new MemNoteStore(text);
      api = initializeNote(container, store, resolvedTheme, true, 'view');
    } catch (err) {
      console.error('Failed to mount the note preview', err);
    }

    return () => {
      api?.dispose();
    };
  }, [text, resolvedTheme]);

  return <div ref={containerRef} className="h-full w-full overflow-auto" />;
}
