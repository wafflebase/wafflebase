import { useEffect, useState } from "react";
import type {
  ContextMenuItem,
  Element,
  Frame,
  Point,
  Slide,
  SlidesEditor,
  SlidesEditorOptions,
  SlidesStore,
} from "@wafflebase/slides";
import {
  DEFAULT_SECTION_SIZE,
  SYNTHETIC_SLIDE_ID,
  buildSectionInit,
  companionMoveIds,
  filterSectionLasso,
  frameAround,
  sectionColorData,
  sectionInsertIndex,
  sectionMemberIds,
  sectionOf,
  sectionsAt,
  unselectableIds,
  type SectionColor,
  type SectionMeta,
  type Viewport,
} from "@wafflebase/board";
import { paintSections, titleLabel, titleRect, TITLE_FONT_PX } from "./board-section-paint";
import type { YorkieBoardStore } from "./yorkie-board-store";

/**
 * Board sections, wired into the reused Slides editor (design:
 * docs/design/board/board-sections.md). The rules live in
 * `@wafflebase/board`'s `model/section.ts`; this file turns them into
 * editor host options, store writes, the section tool and the rename
 * input, so `board-view.tsx` only spreads and attaches.
 */

/** The top-level elements of the board's one synthetic slide. */
export function readElements(store: SlidesStore): Element[] {
  return store.read().slides[0]?.elements ?? [];
}

/**
 * Add a section filling `frame`, placed in the z-order behind ordinary
 * elements and smaller sections (`sectionInsertIndex`), and select it.
 * One batch, so one undo step. Returns the new id.
 */
export function createSection(
  store: SlidesStore,
  frame: Omit<Frame, "rotation">,
  opts: { title?: string; color?: SectionColor } = {},
): string {
  const index = sectionInsertIndex(readElements(store), frame);
  const init = buildSectionInit(frame, opts);
  const atIndex = (store as Partial<Pick<YorkieBoardStore, "addElementAt">>).addElementAt;
  let id = "";
  store.batch(() => {
    if (atIndex) {
      // One array insert: see `YorkieBoardStore.addElementAt` for why an
      // add followed by a reorder is not the same undo step.
      id = atIndex.call(store, init, index);
    } else {
      id = store.addElement(SYNTHETIC_SLIDE_ID, init);
      store.reorderElement(SYNTHETIC_SLIDE_ID, id, index);
    }
  });
  return id;
}

/** A default-size section centred on `at`. */
export function defaultSectionFrame(at: Point): Omit<Frame, "rotation"> {
  return {
    x: at.x - DEFAULT_SECTION_SIZE.w / 2,
    y: at.y - DEFAULT_SECTION_SIZE.h / 2,
    w: DEFAULT_SECTION_SIZE.w,
    h: DEFAULT_SECTION_SIZE.h,
  };
}

/**
 * Wrap the given top-level elements in a new section, with padding.
 * `null` when none of them is on the board.
 */
export function wrapInSection(store: SlidesStore, ids: readonly string[]): string | null {
  const wanted = new Set(ids);
  const frames = readElements(store)
    .filter((el) => wanted.has(el.id))
    .map((el) => el.frame);
  const frame = frameAround(frames);
  if (!frame) return null;
  return createSection(store, frame);
}

/** Merge `patch` into a section's marker. A no-op on anything else. */
export function updateSectionMeta(
  store: SlidesStore,
  id: string,
  patch: Partial<SectionMeta>,
): void {
  const meta = sectionOf(readElements(store).find((el) => el.id === id));
  if (!meta) return;
  const next: SectionMeta = { ...meta, ...patch };
  // Absent rather than `false`, so a section that was never hidden and one
  // that was revealed again store the same thing.
  if (!next.hidden) delete next.hidden;
  if (!next.locked) delete next.locked;
  store.batch(() => {
    store.updateElementData(SYNTHETIC_SLIDE_ID, id, { section: next });
  });
}

/** Recolour sections. */
export function setSectionColor(
  store: SlidesStore,
  ids: readonly string[],
  color: SectionColor,
): void {
  store.batch(() => {
    for (const id of ids) {
      store.updateElementData(SYNTHETIC_SLIDE_ID, id, sectionColorData(color));
    }
  });
}

/**
 * Delete a section together with everything inside it — the explicit
 * alternative to plain Delete, which removes the section alone and keeps
 * its contents. One batch.
 */
export function deleteSectionAndContents(store: SlidesStore, id: string): void {
  const elements = readElements(store);
  const section = elements.find((el) => el.id === id);
  if (!section) return;
  const ids = [id, ...sectionMemberIds(elements, section)];
  store.batch(() => {
    store.removeElements(SYNTHETIC_SLIDE_ID, ids);
  });
}

/** A one-flag tool toggle, like the hand tool. */
export interface SectionTool {
  get(): boolean;
  set(on: boolean): void;
  subscribe(cb: () => void): () => void;
}

export function createSectionTool(): SectionTool {
  let on = false;
  const listeners = new Set<() => void>();
  return {
    get: () => on,
    set: (next) => {
      if (next === on) return;
      on = next;
      for (const cb of listeners) cb();
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

/** Whether the section tool is armed, as React state. */
export function useSectionToolArmed(sections: BoardSections | null): boolean {
  const [armed, setArmed] = useState(() => sections?.tool.get() ?? false);
  useEffect(() => {
    if (!sections) {
      setArmed(false);
      return;
    }
    setArmed(sections.tool.get());
    return sections.tool.subscribe(() => setArmed(sections.tool.get()));
  }, [sections]);
  return armed;
}

/** The section tool's cursor, on the canvas and overlay while it is armed. */
export const SECTION_TOOL_CURSOR_CSS = `
[data-board-section-tool], [data-board-section-tool] * { cursor: crosshair !important; }
`;

/** Below this drag distance (screen px) a section-tool press is a click. */
export const SECTION_CLICK_SLOP_PX = 4;

/**
 * The world frame a section-tool gesture asks for: the dragged rect, or a
 * default-size section centred on the press when it was a click.
 */
export function sectionFrameFromGesture(
  start: Point,
  end: Point,
  zoom: number,
): Omit<Frame, "rotation"> {
  const dx = Math.abs(end.x - start.x) * zoom;
  const dy = Math.abs(end.y - start.y) * zoom;
  if (dx < SECTION_CLICK_SLOP_PX && dy < SECTION_CLICK_SLOP_PX) {
    return defaultSectionFrame(start);
  }
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export interface BoardSectionsDeps {
  store: SlidesStore;
  /** The host the canvas fills; the tool preview and rename input go here. */
  container: HTMLElement;
  getEditor: () => SlidesEditor | null;
  getViewport: () => Viewport;
  readOnly: boolean;
  /** Frame one element in the viewport (the sections list's "go to"). */
  fitElement: (id: string) => void;
  /** Whether a press landed on the scene (canvas or overlay), not chrome. */
  isSceneTarget: (target: EventTarget | null) => boolean;
}

export interface BoardSections {
  tool: SectionTool;
  /** Spread into `initializeEditor`. */
  editorOptions: Pick<
    SlidesEditorOptions,
    | "getCompanionMoveIds"
    | "getUnselectableIds"
    | "filterLassoSelection"
    | "interceptTextEdit"
    | "hostElementMenuItems"
    | "paintAfterElements"
  >;
  /** Empty-canvas menu entries at world point `at` ("Unlock section"). */
  canvasMenuItems(at: Point): ContextMenuItem[];
  /** The canvas menu's insert entry. */
  insertMenuItems(at: Point): ContextMenuItem[];
  /** Open the title input over a section. */
  rename(id: string, initialText?: string): void;
  /** Frame a section and select it (unless it is locked). */
  goTo(id: string): void;
  /** Create a section around the current selection. */
  wrapSelection(): void;
  /**
   * Install the section-tool gesture on the container. Call it after the
   * board's pan claim, so a Space / middle-button pan still wins.
   */
  attach(): () => void;
}

export function createBoardSections(deps: BoardSectionsDeps): BoardSections {
  const { store, container, readOnly } = deps;
  const tool = createSectionTool();

  // `getUnselectableIds` runs on every hover sample. The board store
  // hands out the same slide object until the document changes, so the
  // answer is cached per slide.
  const unselectableCache = new WeakMap<Slide, ReadonlySet<string>>();
  const unselectable = (slide: Slide): ReadonlySet<string> => {
    let hit = unselectableCache.get(slide);
    if (!hit) {
      hit = unselectableIds(slide.elements);
      unselectableCache.set(slide, hit);
    }
    return hit;
  };

  let renameInput: HTMLInputElement | null = null;

  const rename = (id: string, initialText?: string) => {
    if (readOnly) return;
    const el = readElements(store).find((e) => e.id === id);
    const meta = sectionOf(el);
    if (!el || !meta) return;
    renameInput?.remove();
    const vp = deps.getViewport();
    const zoom = vp.zoom > 0 ? vp.zoom : 1;
    // The input sits over the pill, at least wide enough to type into.
    const rect =
      titleRect(el.frame, zoom, Math.max(160, titleLabel(meta).length * TITLE_FONT_PX * 0.6)) ??
      { x: el.frame.x, y: el.frame.y, w: 160 / zoom, h: 22 / zoom };
    const input = document.createElement("input");
    input.type = "text";
    input.value = initialText ?? meta.title;
    input.setAttribute("aria-label", "Section title");
    input.dataset.boardSectionTitle = id;
    Object.assign(input.style, {
      position: "absolute",
      left: `${rect.x * zoom + vp.panX}px`,
      top: `${rect.y * zoom + vp.panY}px`,
      width: `${Math.max(160, rect.w * zoom)}px`,
      height: `${Math.max(22, rect.h * zoom)}px`,
      font: `600 ${TITLE_FONT_PX}px Inter, system-ui, sans-serif`,
      padding: "0 8px",
      border: "2px solid #1D4ED8",
      borderRadius: "4px",
      background: "#FFFFFF",
      color: "#18181B",
      zIndex: "20",
      boxSizing: "border-box",
    } satisfies Partial<CSSStyleDeclaration>);
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      input.remove();
      if (renameInput === input) renameInput = null;
      if (commit && value && value !== meta.title) {
        updateSectionMeta(store, id, { title: value });
      }
    };
    input.addEventListener("keydown", (e) => {
      // The board's tool keys and the editor's key rules are document
      // listeners; a title being typed is none of their business.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    container.appendChild(input);
    renameInput = input;
    input.focus();
    if (initialText === undefined) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  };

  const goTo = (id: string) => {
    const el = readElements(store).find((e) => e.id === id);
    if (!el) return;
    deps.fitElement(id);
    if (!sectionOf(el)?.locked) deps.getEditor()?.setSelection([id]);
  };

  const wrapSelection = () => {
    const editor = deps.getEditor();
    if (!editor) return;
    const id = wrapInSection(store, editor.getSelection());
    if (!id) return;
    editor.setSelection([id]);
    rename(id);
  };

  const sectionMenuItems = (section: Element, meta: SectionMeta): ContextMenuItem[] => [
    { label: "Rename section", run: () => rename(section.id) },
    {
      label: meta.hidden ? "Reveal contents" : "Hide contents",
      run: () => updateSectionMeta(store, section.id, { hidden: !meta.hidden }),
    },
    {
      label: "Lock section",
      run: () => {
        updateSectionMeta(store, section.id, { locked: true });
        deps.getEditor()?.setSelection([]);
      },
    },
    {
      label: "Delete section and contents",
      run: () => {
        deleteSectionAndContents(store, section.id);
        deps.getEditor()?.setSelection([]);
      },
    },
  ];

  const editorOptions: BoardSections["editorOptions"] = {
    getCompanionMoveIds: (movedIds, slide) => companionMoveIds(movedIds, slide.elements),
    getUnselectableIds: unselectable,
    filterLassoSelection: (ids, slide, rect) => filterSectionLasso(ids, slide.elements, rect),
    interceptTextEdit: (el, initialText) => {
      if (!sectionOf(el)) return false;
      rename(el.id, initialText);
      return true;
    },
    hostElementMenuItems: ({ selectedIds }) => {
      if (readOnly || selectedIds.length === 0) return [];
      const elements = readElements(store);
      if (selectedIds.length === 1) {
        const el = elements.find((e) => e.id === selectedIds[0]);
        const meta = sectionOf(el);
        if (el && meta) {
          return [{ label: "---", run: () => undefined }, ...sectionMenuItems(el, meta)];
        }
      }
      // Top-level only: a drilled-in group child cannot be wrapped alone.
      if (!selectedIds.every((id) => elements.some((e) => e.id === id))) return [];
      return [
        { label: "---", run: () => undefined },
        { label: "Create section around selection", run: wrapSelection },
      ];
    },
    paintAfterElements: (ctx, slide) =>
      paintSections(ctx, slide.elements, deps.getViewport().zoom),
  };

  const canvasMenuItems = (at: Point): ContextMenuItem[] => {
    if (readOnly) return [];
    // A locked section ignores clicks, so a right-click on it lands here,
    // on the empty-canvas menu — the one place left to unlock it from.
    const locked = sectionsAt(readElements(store), at).filter((el) => sectionOf(el)?.locked);
    if (locked.length === 0) return [];
    return [
      { label: "---", run: () => undefined },
      ...locked.map((el) => ({
        label: `Unlock “${sectionOf(el)!.title.trim() || "Untitled section"}”`,
        run: () => updateSectionMeta(store, el.id, { locked: false }),
      })),
    ];
  };

  const insertMenuItems = (at: Point): ContextMenuItem[] =>
    readOnly
      ? []
      : [
          {
            label: "Insert section",
            run: () => {
              const id = createSection(store, defaultSectionFrame(at));
              deps.getEditor()?.setSelection([id]);
              rename(id);
            },
          },
        ];

  const attach = () => {
    let preview: HTMLDivElement | null = null;
    let start: Point | null = null;
    let startClient = { x: 0, y: 0 };
    let pointerId: number | null = null;

    const toWorld = (e: PointerEvent): Point => {
      const r = container.getBoundingClientRect();
      const vp = deps.getViewport();
      return {
        x: (e.clientX - r.left - vp.panX) / vp.zoom,
        y: (e.clientY - r.top - vp.panY) / vp.zoom,
      };
    };

    const onDown = (e: PointerEvent) => {
      if (!tool.get() || readOnly || e.defaultPrevented) return;
      if (e.button !== 0) return;
      // Scene only: the minimap and any other host chrome keep their drag.
      if (!deps.isSceneTarget(e.target)) return;
      e.preventDefault();
      // Same node and phase as the editor-bound listeners' ancestor claim:
      // nothing else may see this press, the touch pan included.
      e.stopImmediatePropagation();
      start = toWorld(e);
      startClient = { x: e.clientX, y: e.clientY };
      pointerId = e.pointerId;
      const r = container.getBoundingClientRect();
      preview = document.createElement("div");
      Object.assign(preview.style, {
        position: "absolute",
        left: `${e.clientX - r.left}px`,
        top: `${e.clientY - r.top}px`,
        width: "0px",
        height: "0px",
        border: "2px dashed #71717A",
        background: "rgba(244, 244, 245, 0.6)",
        pointerEvents: "none",
        zIndex: "10",
      } satisfies Partial<CSSStyleDeclaration>);
      container.appendChild(preview);
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !preview) return;
      const r = container.getBoundingClientRect();
      const x0 = Math.min(startClient.x, e.clientX) - r.left;
      const y0 = Math.min(startClient.y, e.clientY) - r.top;
      preview.style.left = `${x0}px`;
      preview.style.top = `${y0}px`;
      preview.style.width = `${Math.abs(e.clientX - startClient.x)}px`;
      preview.style.height = `${Math.abs(e.clientY - startClient.y)}px`;
    };

    const teardown = () => {
      preview?.remove();
      preview = null;
      pointerId = null;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };

    const onCancel = () => {
      teardown();
      start = null;
    };

    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId || !start) return;
      const from = start;
      start = null;
      teardown();
      const frame = sectionFrameFromGesture(from, toWorld(e), deps.getViewport().zoom);
      const id = createSection(store, frame);
      tool.set(false);
      deps.getEditor()?.setSelection([id]);
      rename(id);
    };

    container.addEventListener("pointerdown", onDown, { capture: true });
    return () => {
      container.removeEventListener("pointerdown", onDown, { capture: true });
      teardown();
      renameInput?.remove();
      renameInput = null;
    };
  };

  return {
    tool,
    editorOptions,
    canvasMenuItems,
    insertMenuItems,
    rename,
    goTo,
    wrapSelection,
    attach,
  };
}
