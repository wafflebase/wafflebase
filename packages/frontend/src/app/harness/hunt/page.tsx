// The UI hunter's target surface — real engines, real toolbar, fake storage.
//
// WHY A SEPARATE ROUTE FROM /harness/visual AND /harness/interaction. Those two are
// built for what they measure: `visual` mounts scenes READ-ONLY for screenshot
// diffing, and `interaction` mounts a bare `Spreadsheet` with no chrome. Neither can
// exercise a toolbar, and a toolbar is where a large share of the product's real
// defects live — every UI bug the design doc cites (#343, #494, #333) is reached
// through one.
//
// So this route mounts the REAL engines over IN-MEMORY stores and hangs the REAL
// `DocsFormattingToolbar` off the editor. `MemStore`/`MemDocStore` mean there is no
// backend, no login, no docker, and nothing a probe does can touch real data —
// safety is a property of what is mounted rather than a rule the driver must respect.
//
// SURFACE SELECTION IS A QUERY PARAM, not bridge state. `?surface=doc` remounts from
// a fixed seed, mirroring `/harness/visual?section=…`. Navigation is therefore the
// reset primitive: every run starts from a byte-identical document, which is what
// makes a 3x replay comparable at all.

import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  MemDocStore,
  generateBlockId,
  initialize as initializeDocs,
  type Block,
  type Document as DocsDocument,
  type EditorAPI,
} from "@wafflebase/docs";
import {
  MemStore,
  initialize as initializeSheet,
  type Grid,
  type Spreadsheet,
} from "@wafflebase/sheets";
import { useEffect, useRef, useState } from "react";

import { DocsFormattingToolbar } from "@/app/docs/docs-formatting-toolbar";

import { installHuntBridge, type HuntSurface } from "./bridge";

type HarnessStatus = "loading" | "ready" | "error";

function useSurfaceFromSearchParams(): HuntSurface {
  try {
    const surface = new URLSearchParams(window.location.search).get("surface");
    return surface === "doc" ? "doc" : "sheet";
  } catch {
    return "sheet";
  }
}

/**
 * The doc seed.
 *
 * Block 0 deliberately carries THREE different font sizes on one line. That is the
 * exact shape issue #343 needs — "increasing font size on a mixed-size selection
 * resets to the minimum" is unobservable on uniformly-sized text — and it is the
 * same shape `harness/visual/docs-scenarios.tsx` uses for its baseline. Duplicated
 * rather than imported: coupling two harnesses means a change made for a screenshot
 * silently changes what the hunter explores.
 */
function seedDocument(): DocsDocument {
  const mixed: Block = {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [
      { text: "Small ", style: { fontSize: 11 } },
      { text: "Medium ", style: { fontSize: 18 } },
      { text: "LARGE", style: { fontSize: 32, bold: true } },
    ],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  const plain: Block = {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [{ text: "The quick brown fox jumps over the lazy dog.", style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  const styled: Block = {
    id: generateBlockId(),
    type: "paragraph",
    inlines: [
      { text: "Bold start ", style: { bold: true } },
      { text: "then italic ", style: { italic: true } },
      { text: "then plain.", style: {} },
    ],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  return { blocks: [mixed, plain, styled], pageSetup: DEFAULT_PAGE_SETUP };
}

/** The sheet seed — values, a formula to recalculate, and rows to scroll through. */
function seedGrid(): Grid {
  const grid: Grid = new Map([
    ["A1", { v: "10" }],
    ["A2", { v: "20" }],
    ["A3", { v: "30" }],
    ["B1", { v: "Label" }],
    ["C1", { f: "=A1+A2", v: "30" }],
  ]);
  for (let row = 2; row <= 60; row++) {
    grid.set(`D${row}`, { v: `Row ${row}` });
  }
  return grid;
}

export default function HuntHarnessPage() {
  const surface = useSurfaceFromSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<HarnessStatus>("loading");
  // The toolbar is a React child of this page, so the editor has to reach it through
  // state rather than a ref — a ref assignment would not re-render and the toolbar
  // would stay permanently disabled.
  const [editor, setEditor] = useState<EditorAPI | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    // One effect owns install + mount + teardown. Split across two effects this is
    // correct but fiddly to reason about under StrictMode's mount/unmount/remount;
    // keeping it in one makes the ordering obvious and the cleanup total.
    const controller = installHuntBridge();
    controller.setSurface(surface);

    let disposed = false;
    let spreadsheet: Spreadsheet | undefined;
    let docEditor: EditorAPI | undefined;

    /**
     * This mount's OWN container, not the shared host.
     *
     * Two facts collide here, and the isolation is what keeps them apart.
     *
     * First, the sheet branch awaits before it can assign `spreadsheet`, so an
     * unmount landing mid-await leaves the teardown's `spreadsheet?.cleanup()` with
     * nothing to clean; the promise then resolves into a live engine — RAF loop and
     * listeners — that nothing ever disposes. StrictMode's mount/unmount/remount
     * makes that the normal dev path.
     *
     * Second, and this is what makes the obvious fix wrong: disposing that abandoned
     * engine tears down whatever DOM it was given, and by then the NEXT mount has
     * already painted into the same host. Cleaning up the stale engine therefore
     * deletes the live canvas. Measured, not theorised — the first attempt at this
     * fix left the sheet surface with no canvas at all, which the bridge readers
     * cannot see because they read the engine rather than the DOM.
     *
     * Giving every mount its own child means a stale cleanup operates on a node that
     * was already detached, and the live mount is untouched.
     */
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";

    const disposeMounted = () => {
      docEditor?.dispose();
      docEditor = undefined;
      spreadsheet?.cleanup();
      spreadsheet = undefined;
      container.remove();
    };

    async function mount() {
      setStatus("loading");
      host!.replaceChildren(container);
      try {
        if (surface === "doc") {
          const store = new MemDocStore();
          store.setDocument(seedDocument());
          docEditor = initializeDocs(container, store, "light", /* readOnly */ false);
          if (disposed) return disposeMounted();
          controller.setDoc({ editor: docEditor, host: container });
          setEditor(docEditor);
        } else {
          const store = new MemStore(seedGrid());
          await store.setDimensionSize("column", 1, 110);
          await store.setDimensionSize("column", 2, 160);
          await store.setDimensionSize("column", 3, 180);
          await store.setDimensionSize("column", 4, 260);
          spreadsheet = await initializeSheet(container, { theme: "light", store });
          if (disposed) return disposeMounted();
          await spreadsheet.focusCell({ r: 1, c: 1 });
          controller.setSheet({ spreadsheet, store, host: container });
        }
        if (disposed) return disposeMounted();
        // Ready is set LAST, after the surface is mounted and registered. The driver
        // gates on it, so flipping it earlier would let a probe act on a half-built
        // page and record the resulting mess as a defect.
        controller.setReady(true);
        setStatus("ready");
      } catch (error) {
        console.error("[hunt-harness] failed to initialize", error);
        if (!disposed) setStatus("error");
      }
    }

    void mount();

    return () => {
      disposed = true;
      setEditor(null);
      controller.dispose();
      // Removes only THIS mount's container; a later mount's container is a sibling
      // this closure never sees, so teardown cannot reach across into it.
      disposeMounted();
    };
  }, [surface]);

  return (
    <main
      className="flex h-screen flex-col overflow-clip bg-muted/20"
      data-testid="hunt-harness-root"
      data-hunt-harness-ready={status === "ready" ? "true" : "false"}
      data-hunt-harness-status={status}
      data-hunt-harness-surface={surface}
    >
      <header className="border-b bg-card px-4 py-2">
        <span className="text-xs text-muted-foreground">
          Wafflebase Hunt Harness — surface:{" "}
          <span data-testid="hunt-harness-surface">{surface}</span>, status:{" "}
          <span data-testid="hunt-harness-status">{status}</span>
        </span>
      </header>

      {surface === "doc" && (
        <div className="border-b bg-background" data-testid="hunt-harness-toolbar">
          <DocsFormattingToolbar editor={editor} />
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-hidden bg-white">
        <div className="h-full w-full" data-testid="hunt-harness-host" ref={hostRef} />
      </section>
    </main>
  );
}
