import { useEffect, useMemo, useRef, useState } from 'react';
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
import { boardPreviewViewport } from './board-preview-viewport';
import { firstWorksheetTabId } from './first-worksheet-tab';
import { readRevisionMeta } from './revision-meta';
import { useRevisionHistory } from './use-revision-history';

export type RevisionPreviewType = 'sheet' | 'slides' | 'board' | 'note';

type Props = {
  revisionId: string;
  type: RevisionPreviewType;
  onRestore: () => void;
  onBack: () => void;
  /** Rendered in the banner when a restore started from here failed. */
  restoreError?: string | null;
  /** Disables the Restore button while one is already in flight. */
  isRestoring?: boolean;
};

/**
 * The parsed content, tagged by which adapter produced it. `slides` and
 * `board` end up in the same shape — the board adapter builds one via
 * `boardToSlidesDocument`, from a wire format that is *not* a
 * `SlidesDocument` (see `snapshot-adapters.ts`) — but are kept as distinct
 * tags so the mount effect below can pass `suppressSlideChrome`/a full-plane
 * `viewport` for board without the sheet/note branches needing to know that
 * distinction exists.
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

/**
 * The one way a preview is allowed to show nothing.
 *
 * Every canvas mount below used to swallow its failure into `console.error`
 * and leave an empty container behind, which is how the YSON-wrapper bug
 * reached a user as a silent black rectangle rather than as an error. A blank
 * render is a lie about the user's data — the same rule the
 * unreadable-snapshot branch already follows — so a mount that throws says so,
 * in the same `role="alert"` treatment, with the engine's own message attached.
 *
 * It renders as an opaque overlay *above* the still-mounted container rather
 * than in place of it. Replacing the container would tear out the `ref` the
 * mount effect targets, and the effect only re-runs when its deps change — so
 * paging to another revision after one failure would find no container to
 * mount into and stay stuck on the error for a document that reads fine.
 */
function MountErrorOverlay({ what, error }: { what: string; error: unknown }) {
  const detail = error instanceof Error ? error.message : String(error);
  return (
    <div
      role="alert"
      className="absolute inset-0 z-10 flex items-center justify-center bg-background p-6 text-center text-sm text-destructive"
    >
      Couldn't show this version's {what}: {detail}
    </div>
  );
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
export function RevisionPreview({
  revisionId,
  type,
  onRestore,
  onBack,
  restoreError,
  isRestoring = false,
}: Props) {
  const { getRevision } = useRevisions();
  const [meta, setMeta] = useState<{ createdAt: Date; title: string } | null>(null);
  const [content, setContent] = useState<ParsedContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which slide of a previewed deck is shown. Lives here rather than in
  // `SlidesPreview` because the control that moves it is in the banner, and
  // the banner is this component. Reset whenever the content changes, so
  // switching to a shorter revision cannot leave the index past its end.
  const [slideIndex, setSlideIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const slideCount = content?.kind === 'slides' ? content.doc.slides.length : 0;

  // The overlay is a sibling of the live editor, which stays mounted and
  // fully wired, and both engines bind their primary keyboard handler on
  // `document` — `worksheet.ts`'s `addEventListener(document, 'keydown', …)`
  // (whose `isExternalInput` guard passes `document.body` and a focused
  // `<button>` straight through) and `editor.ts`'s `on(document, 'keydown',
  // …)` (whose undo/redo rules have no editable-target guard at all). With a
  // preview open and nothing suppressing them, `Cmd+Z` undoes a real change
  // in the live document and syncs it to peers, and `Delete` deletes the
  // still-selected live element.
  //
  // The listener therefore sits on `window` in the **capture** phase, which
  // is the one position that runs before every `document` listener no matter
  // what order they were registered in (the live view mounts first, so
  // registration order is not ours to win). Stopping propagation there never
  // reaches the engines — and does not suppress default actions, so the
  // overlay's own buttons still activate on Enter/Space and Tab still moves
  // focus.
  //
  // `Escape` is the deliberate exception: it is non-destructive in both
  // engines (it cancels an in-cell edit / clears a selection) and it is how
  // the panel beside this overlay dismisses its own dialogs.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });

    const suppress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return;
      e.stopPropagation();
    };
    window.addEventListener('keydown', suppress, true);
    window.addEventListener('keyup', suppress, true);
    return () => {
      window.removeEventListener('keydown', suppress, true);
      window.removeEventListener('keyup', suppress, true);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setMeta(null);
    setContent(null);
    setError(null);
    setSlideIndex(0);

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
    <div
      ref={rootRef}
      // Focused on mount so the first keystroke after opening a preview
      // lands here rather than on whatever the live editor left focused.
      tabIndex={-1}
      aria-label="Version preview"
      className="absolute inset-0 z-20 flex flex-col bg-background outline-none"
    >
      {meta && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-4 py-2 text-sm"
        >
          <span>
            Viewing {meta.title} from {formatRevisionTime(meta.createdAt)}
          </span>
          <div className="flex items-center gap-2">
            {slideCount > 1 && (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Previous slide"
                  disabled={slideIndex === 0}
                  onClick={() => setSlideIndex((i) => Math.max(0, i - 1))}
                >
                  ‹
                </Button>
                <span
                  className="min-w-14 text-center tabular-nums text-muted-foreground"
                  aria-label="Slide position"
                >
                  {slideIndex + 1} / {slideCount}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Next slide"
                  disabled={slideIndex >= slideCount - 1}
                  onClick={() =>
                    setSlideIndex((i) => Math.min(slideCount - 1, i + 1))
                  }
                >
                  ›
                </Button>
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onBack}>
              Back to current version
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onRestore}
              disabled={isRestoring}
            >
              {isRestoring ? 'Restoring…' : 'Restore this version'}
            </Button>
          </div>
        </div>
      )}
      {restoreError && (
        <p
          role="alert"
          className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          Couldn't restore this version: {restoreError}
        </p>
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
        {!error && content?.kind === 'slides' && (
          <SlidesPreview doc={content.doc} slideIndex={slideIndex} />
        )}
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
 *
 * The preview closes only once the restore has actually succeeded. Closing
 * first and firing the restore into the void (what this did originally) left
 * a failed restore with nowhere to report itself — on a feature whose whole
 * job is getting data back, that is the one failure that must not be silent.
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
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const handleRestore = async () => {
    if (isRestoring) return;
    setIsRestoring(true);
    setRestoreError(null);
    try {
      await restore(revisionId);
      onClose();
    } catch (err) {
      setRestoreError(
        err instanceof Error ? err.message : 'The restore did not complete.',
      );
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <RevisionPreview
      revisionId={revisionId}
      type={type}
      onBack={onClose}
      onRestore={() => {
        void handleRestore();
      }}
      restoreError={restoreError}
      isRestoring={isRestoring}
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
  const tabId = useMemo(() => firstWorksheetTabId(doc), [doc]);
  const [mountError, setMountError] = useState<unknown>(null);

  useEffect(() => {
    const container = containerRef.current;
    const worksheet = tabId ? doc.sheets?.[tabId] : undefined;
    if (!container || !worksheet) return;

    let cancelled = false;
    let sheet: Awaited<ReturnType<typeof initializeSheet>> | undefined;
    setMountError(null);

    const fail = (err: unknown) => {
      console.error('Failed to mount the sheet preview', err);
      if (!cancelled) setMountError(err);
    };

    // The engine gets a host element belonging to *this* effect run, never
    // `container` itself. `Worksheet.cleanup()` ends with
    // `this.container.innerHTML = ''`
    // (`packages/sheets/src/view/worksheet.ts`), and `initializeSheet` is
    // async — so a cleanup that runs while the first mount is still in
    // flight cannot cancel it, only tear it down later, and pointed at a
    // shared container that teardown empties the *next* mount's DOM too.
    //
    // React StrictMode performs exactly that sequence on every dev mount
    // (effect → cleanup → effect), which is what left the sheet preview
    // permanently blank: the surviving `Spreadsheet` went on painting into
    // a canvas no longer in the document, and its own `ResizeObserver`
    // watched a detached element, so no amount of resizing brought it back.
    // Outside StrictMode the same race is reachable whenever a dep changes
    // — paging to another revision, or toggling the theme — while a mount
    // is still resolving.
    //
    // Mirrors what `SlidesPreview` below already does with `slideWrap`.
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';
    container.appendChild(host);

    try {
      const store = new MemStore();
      store.load(worksheet);
      initializeSheet(host, {
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
        .catch(fail);
    } catch (err) {
      fail(err);
    }

    return () => {
      cancelled = true;
      sheet?.cleanup();
      host.remove();
    };
  }, [doc, tabId, resolvedTheme]);

  if (!tabId) {
    // Same rule as the unreadable-snapshot branch above: say what happened
    // rather than render nothing, which a user would read as a blank version.
    return (
      <p
        role="alert"
        className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground"
      >
        This version has no sheet to show — its tabs are all external
        (datasource or lakehouse) tabs, whose rows are not stored in the
        document.
      </p>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {mountError !== null && (
        <MountErrorOverlay what="grid" error={mountError} />
      )}
    </div>
  );
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
 * needs no interaction wiring — only sizing. That is also why navigation
 * has to be supplied from outside: a deck is driven by `slideIndex` from
 * the banner (`setCurrentSlide` below), and a board opens framed on its own
 * content (`boardPreviewViewport`) because a read-only mount has no
 * wheel-pan, drag-pan or minimap to hunt with. `board` otherwise reuses the
 * same editor with a full-plane `viewport` and `suppressSlideChrome`,
 * matching how `board-view.tsx` mounts it.
 */
function SlidesPreview({
  doc,
  board = false,
  slideIndex = 0,
}: {
  doc: SlidesDocument;
  board?: boolean;
  /**
   * Which slide the banner's prev/next control is on. Ignored for `board`,
   * which is one synthetic slide by construction.
   */
  slideIndex?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);
  const [mountError, setMountError] = useState<unknown>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setMountError(null);

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

      const mountOrResize = () => {
        const rect = container.getBoundingClientRect();
        const availW = Math.max(1, Math.round(rect.width));
        const availH = Math.max(1, Math.round(rect.height));

        if (board) {
          sizeTo(availW, availH);
          // Re-framed on every resize, not just at mount: a `readOnly`
          // board preview has no pan of its own to preserve, so there is
          // nothing a refit could yank out from under the user — which is
          // why this needs no equivalent of `board-view.tsx`'s one-shot
          // `FitLatch`.
          const viewport: Viewport = boardPreviewViewport(doc, {
            w: availW,
            h: availH,
          });
          if (!editor) {
            editor = initializeEditor({
              canvas,
              overlay,
              store,
              hostWidth: availW,
              hostHeight: availH,
              dpr,
              viewport,
              cull: true,
              suppressSlideChrome: true,
              readOnly: true,
            });
          } else {
            editor.setHostSize(availW, availH);
            editor.setViewport(viewport);
          }
        } else {
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
        }

        // Unconditional, on both the mount and the resize path, because
        // every path above has just run `sizeTo` — and assigning
        // `canvas.width`/`canvas.height` resets the bitmap even when the
        // value is identical. `setHostSize` early-returns on an unchanged
        // size (`editor.ts`), so a resize that measures the same box would
        // otherwise clear the canvas and repaint nothing.
        //
        // That is exactly what the `ResizeObserver` below delivers on its
        // *initial* observation, one frame after the mount: the preview
        // came up blank and only appeared once the user physically resized
        // the window. `SlidesView` never hit this because its scroll host
        // drives a refit with a genuinely different size right after mount.
        //
        // `markDirty()` before `render()` is what the editor documents for
        // a repaint driven from outside its own interaction handlers —
        // without it `render()` no-ops, the renderer's dirty flag having
        // been reset after the last successful paint.
        editor.markDirty();
        editor.render();
      };

      mountOrResize();
      editorRef.current = editor ?? null;
      // A resize that throws is as blank a failure as a mount that does, and
      // the observer fires outside this `try` — so it reports through the
      // same channel rather than into an unhandled rejection.
      resizeObserver = new ResizeObserver(() => {
        try {
          mountOrResize();
        } catch (err) {
          console.error('Failed to mount the slides preview', err);
          setMountError(err);
        }
      });
      resizeObserver.observe(container);
    } catch (err) {
      console.error('Failed to mount the slides preview', err);
      setMountError(err);
    }

    return () => {
      editorRef.current = null;
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

  // Drive the mounted editor from the banner's prev/next control. The
  // editor renders exactly one slide and `readOnly: true` skips
  // `attachInteractions()`, so without this a 30-slide deck previewed as
  // slide 1 and nothing — not the arrow keys, not a thumbnail rail (which
  // lives in `SlidesView`, hidden behind the overlay) — could reach the
  // other 29.
  useEffect(() => {
    if (board) return;
    const id = doc.slides[slideIndex]?.id;
    if (id) editorRef.current?.setCurrentSlide(id);
  }, [doc, board, slideIndex]);

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="flex h-full w-full items-center justify-center overflow-hidden bg-muted/20"
      />
      {mountError !== null && (
        <MountErrorOverlay
          what={board ? 'canvas' : 'slide'}
          error={mountError}
        />
      )}
    </div>
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
  const [mountError, setMountError] = useState<unknown>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setMountError(null);

    let api: ReturnType<typeof initializeNote> | undefined;
    try {
      const store = new MemNoteStore(text);
      api = initializeNote(container, store, resolvedTheme, true, 'view');
    } catch (err) {
      console.error('Failed to mount the note preview', err);
      setMountError(err);
    }

    return () => {
      api?.dispose();
    };
  }, [text, resolvedTheme]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full overflow-auto" />
      {mountError !== null && (
        <MountErrorOverlay what="text" error={mountError} />
      )}
    </div>
  );
}
