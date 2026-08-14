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
import { FormattingToolbar } from "@/components/formatting-toolbar";

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

// --- seeded faults: the hunter's positive control -----------------------------
//
// WHY A DELIBERATE DEFECT LIVES IN THE HARNESS.
//
// Every other guard in this pipeline is a negative control: it proves the hunter
// does not report things that are fine. Nothing proved the opposite — that a real
// defect actually survives explore → replay → verify → gate → report. The obvious
// control was issue #343, and it turned out to be already fixed, so there is no open
// UI bug with a known ground-A shape to aim at. A SEEDED defect is better anyway,
// because it is repeatable: run against `?fault=…` and the funnel must report it;
// run against the clean route and it must stay quiet.
//
// This is a deliberate reversal of PR 1's rule that faults come only from the
// driver, and the reason PR 1 could hold that line is the reason it cannot hold
// here: Playwright can inject a `pageerror` from outside, but it cannot inject a
// SEMANTIC defect into the editor's own code path. Only the app can do that.
//
// It cannot ship. `/harness/hunt` is already DEV-only — App.tsx gates the whole lazy
// import behind `import.meta.env.DEV`, which Vite replaces statically, so this file
// is not in a production bundle at all. No second gate is needed and adding one
// would imply the first is not trusted.
//
// The registry is CLOSED and the id is matched exactly, so `?fault=` can turn on one
// of these and nothing else. The active fault is also published as
// `data-hunt-harness-fault` on the root, so a seeded run can never be mistaken for a
// real one — a positive control that looks identical to a hunt is how a fabricated
// finding ends up in a report.

type FaultId = "drop-second-char";

const KNOWN_FAULTS: readonly FaultId[] = ["drop-second-char"] as const;

function useFaultFromSearchParams(): FaultId | null {
  try {
    const fault = new URLSearchParams(window.location.search).get("fault");
    return KNOWN_FAULTS.includes(fault as FaultId) ? (fault as FaultId) : null;
  } catch {
    return null;
  }
}

/**
 * Install a seeded fault, returning its uninstaller.
 *
 * `drop-second-char` swallows every second printable keystroke. Chosen because it is
 * the cleanest possible GROUND A defect: the agent types a literal, the literal is
 * therefore an `@input:` reference in its own journal, and what comes back is not
 * what it typed. No documentation, no convention and no opinion is involved — the
 * app contradicts the agent's own action.
 *
 * Capture phase on the container, so it intercepts before the editor sees the key
 * and works identically on both surfaces without either engine knowing about it.
 * Modified keys are left alone: swallowing Ctrl+Z would make undo behave oddly and
 * the control has to inject ONE defect, not a fog.
 *
 * The counter is per-install and starts at 0, so replaying the same action sequence
 * drops the same characters — a non-deterministic fault would fail replay and the
 * control would prove nothing.
 */
function installFault(fault: FaultId, container: HTMLElement): () => void {
  if (fault === "drop-second-char") {
    let seen = 0;
    const onKeyDown = (event: KeyboardEvent) => {
      const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
      if (!printable) return;
      seen += 1;
      if (seen % 2 === 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    container.addEventListener("keydown", onKeyDown, true);
    return () => container.removeEventListener("keydown", onKeyDown, true);
  }
  return () => {};
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
  const fault = useFaultFromSearchParams();
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<HarnessStatus>("loading");
  // The toolbar is a React child of this page, so the editor has to reach it through
  // state rather than a ref — a ref assignment would not re-render and the toolbar
  // would stay permanently disabled.
  const [editor, setEditor] = useState<EditorAPI | null>(null);
  const [sheet, setSheet] = useState<Spreadsheet | null>(null);

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

    // Installed on THIS mount's container and torn down with it, so a stale mount
    // cannot leave a listener intercepting the live one's keystrokes — the same
    // isolation argument as the container itself, and the failure would look
    // identical to a real defect, which is the worst possible bug for a positive
    // control to have.
    const uninstallFault = fault ? installFault(fault, container) : null;

    const disposeMounted = () => {
      uninstallFault?.();
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
          setSheet(spreadsheet);
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
      setSheet(null);
      controller.dispose();
      // Removes only THIS mount's container; a later mount's container is a sibling
      // this closure never sees, so teardown cannot reach across into it.
      disposeMounted();
    };
  }, [surface, fault]);

  return (
    <main
      className="flex h-screen flex-col overflow-clip bg-muted/20"
      data-testid="hunt-harness-root"
      data-hunt-harness-ready={status === "ready" ? "true" : "false"}
      data-hunt-harness-status={status}
      data-hunt-harness-surface={surface}
      data-hunt-harness-fault={fault ?? "none"}
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

      {/*
        The sheet surface ran without chrome until now, and it showed: every defect this
        hunter has filed came from a TOOLBAR control, and the sheet persona -- asked to
        run the same round-trip shape with no controls to run it through -- produced one
        false finding and one empty run across two live sessions.

        Only `spreadsheet` is required. The optional handlers are deliberately NOT
        supplied: they open panels this harness does not mount, and stubbing them would
        invent behaviour the product does not have. Those buttons therefore render and
        do nothing, which `sheet-author.md` names explicitly -- the same treatment
        `MemStore`'s no-op undo already gets, for the same reason. A trap the brief
        names is a trap; one it does not is a false finding.
      */}
      {surface === "sheet" && (
        <div className="border-b bg-background" data-testid="hunt-harness-toolbar">
          <FormattingToolbar spreadsheet={sheet ?? undefined} />
        </div>
      )}

      <section className="min-h-0 flex-1 overflow-hidden bg-white">
        <div className="h-full w-full" data-testid="hunt-harness-host" ref={hostRef} />
      </section>
    </main>
  );
}
