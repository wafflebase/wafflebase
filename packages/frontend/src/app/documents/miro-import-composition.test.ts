import { describe, it, expect } from "vitest";
import { MemSlidesStore } from "@wafflebase/slides";
import type { Element, SlidesStore } from "@wafflebase/slides";
import {
  mapMiroItems,
  boardToSlidesDocument,
  SYNTHETIC_SLIDE_ID,
} from "@wafflebase/board";

import { resolveImageUrl } from "@/app/spreadsheet/image-upload";
import { applyBoardElements } from "./apply-imported-content";

/**
 * The one test that crosses all three Miro-import layers.
 *
 * Every other suite in this feature is layer-local, and that is exactly how
 * two cross-layer defects shipped: the backend test asserted the URL string it
 * emits, the mapper test fed that same string in as a literal and asserted it
 * came back out, and the applier test stubbed `addElement` with a CONSTANT id
 * so remapping could never be observed to be missing. Each layer was green and
 * the composition was broken — connectors pointed at ids no element had, and
 * image `src` stayed root-relative against an API on a different origin.
 *
 * So this test runs a realistic BACKEND-SHAPED payload through
 * `mapMiroItems` -> `applyBoardElements` -> a REAL store, and asserts on the
 * document that actually lands. It must never be reduced to stubs.
 */

/** A payload shaped exactly like `MiroService.importBoard` returns. */
function backendPayload() {
  return {
    items: [
      {
        id: "3458764500000000001",
        type: "image",
        position: { x: 100, y: 100 },
        geometry: { width: 320, height: 240 },
        // Post-re-host: `MiroService.rehostImages` rewrites `imageUrl` to this
        // ROOT-RELATIVE form. It is the backend's own URL shape, verbatim.
        data: { imageUrl: "/api/v1/workspaces/ws-1/images/img-9" },
      },
      {
        id: "3458764500000000002",
        type: "shape",
        position: { x: 600, y: 100 },
        geometry: { width: 200, height: 120 },
        data: { shape: "rectangle", content: "<p>Start</p>" },
        style: { fillColor: "#ffffff", borderColor: "#1a1a1a", borderWidth: 2 },
      },
      {
        id: "3458764500000000003",
        type: "shape",
        position: { x: 1000, y: 100 },
        geometry: { width: 200, height: 120 },
        data: { shape: "circle", content: "<p>End</p>" },
        style: { fillColor: "#ff9d48" },
      },
      // A frame far from the origin, and one sticky INSIDE it. Miro reports
      // the sticky against the frame's top-left, so this pair is what tells
      // absolute-position handling apart from frame-local.
      {
        id: "3458764500000000004",
        type: "frame",
        position: { x: 20000, y: -9000, relativeTo: "canvas_center" },
        geometry: { width: 1000, height: 800 },
        data: { title: "Sprint 12" },
      },
      {
        id: "3458764500000000005",
        type: "sticky_note",
        position: { x: 250, y: 400, relativeTo: "parent_top_left" },
        geometry: { width: 200, height: 200 },
        parent: { id: "3458764500000000004" },
        data: { content: "<p>Inside the frame</p>" },
        style: { fillColor: "yellow" },
      },
    ],
    connectors: [
      {
        id: "3458764500000000009",
        shape: "elbowed",
        startItem: { id: "3458764500000000002" },
        endItem: { id: "3458764500000000003" },
        style: { endStrokeCap: "arrow", strokeColor: "#1a1a1a", strokeWidth: 2 },
      },
    ],
  };
}

/** An empty board, presented as the single synthetic slide the store writes to. */
function emptyBoardStore(): SlidesStore {
  return new MemSlidesStore(
    boardToSlidesDocument({ meta: { title: "Imported Miro board" }, elements: [] }),
  );
}

function writtenElements(store: SlidesStore): Element[] {
  const slide = store.read().slides.find((s) => s.id === SYNTHETIC_SLIDE_ID);
  if (!slide) throw new Error("synthetic board slide missing");
  return slide.elements;
}

describe("Miro import composition (backend payload -> mapper -> store)", () => {
  it("writes connectors whose endpoints reference elements that actually exist", () => {
    const { items, connectors } = backendPayload();
    const { inits } = mapMiroItems({ items, connectors, resolveImageUrl });

    const store = emptyBoardStore();
    applyBoardElements(store, inits);

    const elements = writtenElements(store);
    const ids = new Set(elements.map((e) => e.id));
    const written = elements.filter((e) => e.type === "connector");

    // The connector must survive — both of its ends map.
    expect(written).toHaveLength(1);

    for (const connector of written) {
      for (const endpoint of [connector.start, connector.end]) {
        expect(endpoint.kind).toBe("attached");
        if (endpoint.kind !== "attached") continue;
        // The id the mapper minted is NOT the id the store minted. Storing the
        // mapper's id makes the endpoint unresolvable, `resolveEndpoint` falls
        // back to (0, 0), and the arrow collapses to a ~1x1 frame at the world
        // origin — invisible, and nowhere near the imported content.
        expect(ids).toContain(endpoint.elementId);
      }
    }
  });

  it("never anchors a connector to an id no element carries, even under reordering", () => {
    // Connectors arrive from a separate feed, so nothing guarantees a
    // connector's targets were written before it. Reversing the init order
    // (connector first) must not change the outcome.
    const { items, connectors } = backendPayload();
    const { inits } = mapMiroItems({ items, connectors, resolveImageUrl });

    const store = emptyBoardStore();
    applyBoardElements(store, [...inits].reverse());

    const elements = writtenElements(store);
    const ids = new Set(elements.map((e) => e.id));
    const dangling = elements
      .filter((e) => e.type === "connector")
      .flatMap((c) => [c.start, c.end])
      .filter((ep) => ep.kind === "attached" && !ids.has(ep.elementId));

    expect(dangling).toEqual([]);
  });

  it("stores an imported image src in the same absolute shape a native upload does", () => {
    const { items, connectors } = backendPayload();
    const { inits } = mapMiroItems({ items, connectors, resolveImageUrl });

    const store = emptyBoardStore();
    applyBoardElements(store, inits);

    const image = writtenElements(store).find((e) => e.type === "image");
    expect(image).toBeDefined();
    const src = (image as Extract<Element, { type: "image" }>).data.src;

    // `uploadImageFile` returns `resolveImageUrl(url)` for exactly this reason:
    // the raw backend value is root-relative and the API lives on another
    // origin, so a persisted relative src 404s forever.
    expect(src).toMatch(/^https?:\/\//i);
    expect(src).toBe(resolveImageUrl("/api/v1/workspaces/ws-1/images/img-9"));
  });

  it("lands a framed item inside its frame, not beside the world origin", () => {
    // Miro measures a framed item from its frame's TOP-LEFT. Persisting that
    // offset as a world coordinate is how a real import put 96% of its
    // elements into one box next to the origin while the frames stayed spread
    // across x up to 46,000 — the board read as "everything shoved left".
    const { items, connectors } = backendPayload();
    const { inits, approximated } = mapMiroItems({
      items,
      connectors,
      resolveImageUrl,
    });

    const store = emptyBoardStore();
    applyBoardElements(store, inits);

    const elements = writtenElements(store);
    const frame = elements.find((e) => e.frame.w === 1000 && e.frame.h === 800);
    const sticky = elements.find((e) => e.frame.w === 200 && e.frame.h === 200);
    expect(frame).toBeDefined();
    expect(sticky).toBeDefined();

    // Frame top-left: (20000 - 500, -9000 - 400) = (19500, -9400).
    expect(frame!.frame).toMatchObject({ x: 19500, y: -9400 });
    // Sticky centre: frame top-left + (250, 400) → top-left (19650, -9100).
    expect(sticky!.frame).toMatchObject({ x: 19650, y: -9100 });

    // It resolved exactly, so nothing is reported as approximated.
    expect(approximated["parent-position"]).toBeUndefined();

    // And it really is inside the frame's box, which is the property that
    // matters however the arithmetic is expressed.
    expect(sticky!.frame.x).toBeGreaterThanOrEqual(frame!.frame.x);
    expect(sticky!.frame.x + sticky!.frame.w).toBeLessThanOrEqual(
      frame!.frame.x + frame!.frame.w,
    );
  });

  it("reports connectors it had to drop rather than writing a dangling one", () => {
    const { items } = backendPayload();
    const { inits } = mapMiroItems({
      items,
      connectors: [],
      resolveImageUrl,
    });

    // Forge the shape the mapper promises never to produce: a connector whose
    // endpoint names an element that is not in this batch. The applier must
    // refuse to write it AND say so — a silent drop is the failure mode this
    // whole feature is written to avoid.
    const orphan = {
      __id: "mapper-orphan",
      type: "connector",
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing: "straight",
      start: { kind: "attached", elementId: "not-in-this-batch", siteIndex: 0 },
      end: { kind: "attached", elementId: "also-missing", siteIndex: 0 },
      arrowheads: {},
    } as unknown as (typeof inits)[number];

    const store = emptyBoardStore();
    const { droppedConnectors } = applyBoardElements(store, [...inits, orphan]);

    expect(droppedConnectors).toBe(1);
    expect(writtenElements(store).filter((e) => e.type === "connector")).toHaveLength(0);
  });
});
