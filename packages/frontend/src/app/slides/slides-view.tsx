import {
  initializeEditor,
  mountThumbnailPanel,
  mountNotesPanel,
  type InsertKind,
  type SlidesEditor,
  type ThumbnailPanelHandle,
} from "@wafflebase/slides";
import { useEffect, useRef, useState } from "react";
import { useDocument } from "@yorkie-js/react";
import { Loader } from "@/components/loader";
import type { YorkieSlidesRoot } from "@/types/slides-document";
import type { SlidesPresence } from "@/types/users";
import { YorkieSlidesStore, ensureSlidesRoot } from "./yorkie-slides-store";

export type { SlidesEditor } from "@wafflebase/slides";

interface SlidesViewProps {
  /**
   * Document id passed from the route. Currently unused inside the
   * component — Yorkie attach is handled by the surrounding
   * `DocumentProvider` keyed by id — but kept on the prop surface so
   * the parent route can pass it explicitly (matches DocsView).
   */
  documentId?: string;
  /**
   * Reserved for Phase 4b: when true the editor will mount in a
   * non-interactive presenter view. Phase 4a accepts the flag for
   * API parity with `DocsView` but does not act on it yet.
   */
  readOnly?: boolean;
  onEditorReady?: (editor: SlidesEditor | null) => void;
}

const HOST_W = 960;
const HOST_H = 540;

/**
 * SlidesView mounts the vanilla `@wafflebase/slides` editor inside a
 * Yorkie DocumentProvider context. It builds the canvas + overlay +
 * thumbnail + notes DOM hosts into a React-managed container, wires a
 * YorkieSlidesStore to the editor, and broadcasts presence updates on
 * selection / current-slide changes.
 *
 * Mirrors the structure of `docs-view.tsx`: `useDocument` for the
 * Yorkie doc handle, a `didMount` gate to dodge React strict-mode's
 * double mount, and a single mount-time `useEffect` whose cleanup
 * cancels the RAF tick, disposes the thumbnail panel, detaches the
 * editor, unsubscribes presence callbacks, and removes the injected
 * style tag.
 *
 * CJK fonts: the slides text renderer routes inline `fontFamily`
 * values through the docs font registry (see
 * `packages/slides/src/view/canvas/fonts.ts`), which appends
 * `'Noto Sans KR'` to Korean font name fallback chains. No font is
 * fetched here — Canvas relies on the browser's installed fonts plus
 * its own last-resort glyph fallback, matching how the docs editor
 * paints CJK in its live editor today. PDF export (Phase 5b) will
 * preload Noto KR via `document.fonts.load` the same way docs'
 * PDF exporter does.
 */
export function SlidesView({ onEditorReady }: SlidesViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SlidesEditor | null>(null);
  const [didMount, setDidMount] = useState(false);
  const { doc, loading, error } = useDocument<YorkieSlidesRoot, SlidesPresence>();

  // Prevent double-initialization in React strict mode / dev HMR.
  useEffect(() => {
    setDidMount(true);
  }, []);

  useEffect(() => {
    if (!didMount || !doc) return;
    const container = containerRef.current;
    if (!container) return;

    ensureSlidesRoot(doc);

    // Build the canvas + overlay DOM into the container. The slides
    // editor is vanilla DOM, so we hand-build the scaffolding here
    // instead of expressing it as JSX — a future refactor could move
    // this into a `useEditorMount` hook.
    container.innerHTML = "";
    const dpr = window.devicePixelRatio || 1;

    const layout = document.createElement("div");
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = "220px 1fr";
    layout.style.gap = "12px";
    layout.style.padding = "12px";
    layout.style.boxSizing = "border-box";
    layout.style.height = "100%";

    const left = document.createElement("div");
    left.style.overflowY = "auto";
    const thumbsHost = document.createElement("div");
    left.appendChild(thumbsHost);
    layout.appendChild(left);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.flexDirection = "column";
    right.style.gap = "12px";

    // Toolbar — vanilla DOM buttons that drive editor.setInsertMode.
    // Each button toggles its own insert mode; clicking the active
    // button again exits insert mode (matches the demo behaviour).
    const toolbar = document.createElement("div");
    toolbar.style.display = "flex";
    toolbar.style.gap = "8px";
    toolbar.style.flexWrap = "wrap";
    const insertKinds: InsertKind[] = ["rect", "ellipse", "line", "arrow", "text"];
    const labels: Record<InsertKind, string> = {
      rect: "+ Rect",
      ellipse: "+ Ellipse",
      line: "+ Line",
      arrow: "+ Arrow",
      text: "+ Text",
    };
    const buttons: Partial<Record<InsertKind, HTMLButtonElement>> = {};
    for (const kind of insertKinds) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.insert = kind;
      btn.textContent = labels[kind];
      btn.style.background = "#2a2a2a";
      btn.style.color = "#ddd";
      btn.style.border = "1px solid #444";
      btn.style.padding = "6px 12px";
      btn.style.borderRadius = "4px";
      btn.style.cursor = "pointer";
      btn.style.fontSize = "13px";
      buttons[kind] = btn;
      toolbar.appendChild(btn);
    }
    right.appendChild(toolbar);

    const canvasWrap = document.createElement("div");
    canvasWrap.style.position = "relative";
    canvasWrap.style.alignSelf = "flex-start";

    const canvas = document.createElement("canvas");
    canvas.width = HOST_W * dpr;
    canvas.height = HOST_H * dpr;
    canvas.style.width = `${HOST_W}px`;
    canvas.style.height = `${HOST_H}px`;
    canvas.style.background = "#fff";
    canvasWrap.appendChild(canvas);

    const overlay = document.createElement("div");
    overlay.style.position = "absolute";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = `${HOST_W}px`;
    overlay.style.height = `${HOST_H}px`;
    overlay.style.pointerEvents = "none";
    canvasWrap.appendChild(overlay);

    right.appendChild(canvasWrap);

    const notesHost = document.createElement("div");
    right.appendChild(notesHost);

    layout.appendChild(right);
    container.appendChild(layout);

    // Inject pointer-events for handles (overlay-level CSS). The
    // overlay itself uses pointer-events: none so empty-area clicks
    // pass through to the canvas; handle children opt back in.
    const style = document.createElement("style");
    style.textContent = "[data-handle] { pointer-events: auto !important; }";
    document.head.appendChild(style);

    const store = new YorkieSlidesStore(doc);
    const editor = initializeEditor({
      canvas,
      overlay,
      store,
      hostWidth: HOST_W,
      hostHeight: HOST_H,
      dpr,
    });
    editorRef.current = editor;
    onEditorReady?.(editor);

    const thumbHandle: ThumbnailPanelHandle = mountThumbnailPanel(
      thumbsHost,
      store,
      editor,
    );
    mountNotesPanel(notesHost, store, editor);

    // Wire toolbar clicks. Insert mode auto-exits to null after a
    // successful place (per the editor's `startInsert` flow), so we
    // also reset the active button there via the onSelectionChange
    // broadcast that fires when the new element gets selected.
    const setActiveButton = (kind: InsertKind | null) => {
      for (const k of insertKinds) {
        buttons[k]?.classList.toggle("active", k === kind);
        const isActive = k === kind;
        const btn = buttons[k];
        if (!btn) continue;
        btn.style.background = isActive ? "#3a7" : "#2a2a2a";
        btn.style.borderColor = isActive ? "#3a7" : "#444";
        btn.style.color = isActive ? "#fff" : "#ddd";
      }
    };
    const onToolbarClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const insert = target.dataset.insert as InsertKind | undefined;
      if (!insert) return;
      const wasActive = target.classList.contains("active");
      if (wasActive) {
        editor.setInsertMode(null);
        setActiveButton(null);
      } else {
        editor.setInsertMode(insert);
        setActiveButton(insert);
      }
    };
    toolbar.addEventListener("click", onToolbarClick);

    // Re-render on ANY store change — local batch commits OR remote
    // changes pushed in by another peer.
    //
    // markDirty before render is required because the renderer's
    // dirty flag is reset after each successful paint, so a remote
    // change wouldn't otherwise trigger a repaint (the editor doesn't
    // know the underlying data shifted under it). markDirty is also
    // safe to call after local edits — the next render is a no-op if
    // the renderer already painted the same frame.
    //
    // thumbHandle.refresh() is the only way A's own thumbnail picks
    // up a drag/resize commit on the current slide, since the
    // thumbnail panel only listens to selection / current-slide
    // changes, neither of which fires for an in-place frame update.
    const offChange = store.onChange(() => {
      editor.markDirty();
      editor.render();
      thumbHandle.refresh();
    });

    // Local presence: broadcast active slide + selection. The
    // username/email/photo fields are filled in by the SlidesDetail
    // wrapper via `initialPresence`; we only patch the slides-specific
    // fields here so we don't clobber the identity payload.
    const broadcast = () => {
      store.updatePresence({
        username: "",
        email: "",
        photo: "",
        activeSlideId: editor.getCurrentSlideId(),
        selectedElementIds: editor.getSelection().slice(),
      });
    };
    const offSelection = editor.onSelectionChange(broadcast);
    const offSlide = editor.onCurrentSlideChange(broadcast);

    // RAF loop so async asset loads (image cache) repaint, and
    // thumbnail count stays in sync with store mutations the panel
    // doesn't observe directly.
    let lastSlideCount = store.read().slides.length;
    let raf = 0;
    const tick = () => {
      editor.render();
      const n = store.read().slides.length;
      if (n !== lastSlideCount) {
        lastSlideCount = n;
        thumbHandle.refresh();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      offSelection();
      offSlide();
      offChange();
      toolbar.removeEventListener("click", onToolbarClick);
      thumbHandle.dispose();
      editor.detach();
      editorRef.current = null;
      onEditorReady?.(null);
      style.remove();
    };
    // onEditorReady is intentionally excluded — re-mounting on every
    // identity change of the parent's setter would tear down the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didMount, doc]);

  if (loading) {
    return <Loader />;
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="text-red-500">{error.message}</div>
      </div>
    );
  }

  return <div ref={containerRef} className="relative flex-1 w-full min-h-0" />;
}

export default SlidesView;
