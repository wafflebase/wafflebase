// @vitest-environment jsdom
/**
 * Integration tests for multi-select resize covering non-trivial selections
 * that pure unit tests cannot cover: group + shape, connector with attached
 * endpoint, single batched undo, drilled-in scope, and W-handle snap
 * re-derivation sign regression.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../../src/view/canvas/test-canvas-env';
import { MemSlidesStore } from '../../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../../src/view/editor/editor';
import type { Selection } from '../../../../src/view/editor/selection';

// ---------------------------------------------------------------------------
// Shared fixture helpers (inlined — no new shared helpers per plan)
// ---------------------------------------------------------------------------

function makeFixture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  store.batch(() => store.addSlide('blank'));
  return { canvas, overlay, store };
}

/**
 * Drag a resize handle by firing pointerdown → pointermove → pointerup.
 * `handle` is a data-handle attribute value (e.g. 'se', 'w').
 * Asserts that the handle element exists via `expect(handleEl).not.toBeNull()`;
 * the test fails loudly if the handle is missing rather than silently
 * skipping the gesture.
 */
function dragHandle(
  canvas: HTMLCanvasElement,
  overlay: HTMLElement,
  handle: string,
  dx: number,
  dy: number,
): void {
  const handleEl = overlay.querySelector<HTMLDivElement>(`[data-handle="${handle}"]`);
  expect(handleEl).not.toBeNull();
  const left = parseFloat(handleEl!.style.left);
  const top = parseFloat(handleEl!.style.top);
  // Handle element is positioned so its top-left is (cx - 4, cy - 4) for an
  // 8px handle; the centre is at (left + 4, top + 4).
  const startX = left + 4;
  const startY = top + 4;
  canvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: startX, clientY: startY, bubbles: true,
  }));
  document.dispatchEvent(new PointerEvent('pointermove', {
    clientX: startX + dx, clientY: startY + dy, bubbles: true,
  }));
  document.dispatchEvent(new PointerEvent('pointerup', {
    clientX: startX + dx, clientY: startY + dy, bubbles: true,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Multi-resize integration — non-trivial selections', () => {
  let editor: SlidesEditor | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    if (editor) {
      editor.detach();
      editor = null;
    }
  });

  // -------------------------------------------------------------------------
  // Test A: Group + shape multi-resize — group's refSize is unchanged
  // -------------------------------------------------------------------------
  it("group child scales as a frame; its refSize is unchanged after multi-resize", () => {
    const { canvas, overlay, store } = makeFixture();
    let sid!: string;
    let aId!: string;
    let groupId!: string;

    store.batch(() => {
      sid = store.read().slides[0].id;

      // Plain rect 'a' at (0, 0, 100, 50)
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });

      // Two shapes that will be grouped to create group 'g' at roughly
      // (200, 100, 100, 100). Use two shapes that produce that AABB.
      const g1 = store.addElement(sid, {
        type: 'shape',
        frame: { x: 200, y: 100, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0f0' } },
      });
      const g2 = store.addElement(sid, {
        type: 'shape',
        frame: { x: 200, y: 150, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#00f' } },
      });
      ({ groupId } = store.group(sid, [g1, g2]));
    });

    // The group's frame and refSize are now set. Capture refSize before.
    const groupBefore = store.read().slides[0].elements.find((e) => e.id === groupId)!;
    expect(groupBefore.type).toBe('group');
    if (groupBefore.type !== 'group') throw new Error('unreachable');
    const refSizeBefore = { ...groupBefore.data.refSize! };
    expect(refSizeBefore.w).toBeGreaterThan(0);
    expect(refSizeBefore.h).toBeGreaterThan(0);

    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, groupId]);
    editor.render();

    // Drag the SE handle to grow the multi-selection bounding box.
    dragHandle(canvas, overlay, 'se', 40, 30);

    const groupAfter = store.read().slides[0].elements.find((e) => e.id === groupId)!;
    expect(groupAfter.type).toBe('group');
    if (groupAfter.type !== 'group') throw new Error('unreachable');

    // The group's frame width should have grown (SE drag).
    expect(groupAfter.frame.w).toBeGreaterThan(groupBefore.frame.w);

    // The refSize must NOT change — it is the stable anchor for child scaling.
    expect(groupAfter.data.refSize).toBeDefined();
    expect(groupAfter.data.refSize!.w).toBeCloseTo(refSizeBefore.w, 3);
    expect(groupAfter.data.refSize!.h).toBeCloseTo(refSizeBefore.h, 3);
  });

  // -------------------------------------------------------------------------
  // Test B: Connector with attached endpoint preserves attachment
  // -------------------------------------------------------------------------
  it('connector with one attached endpoint: attached endpoint persists; free endpoint scales', () => {
    const { canvas, overlay, store } = makeFixture();
    let sid!: string;
    let targetId!: string;
    let connectorId!: string;

    store.batch(() => {
      sid = store.read().slides[0].id;

      // Target rect at (200, 100, 80, 60).
      targetId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 200, y: 100, w: 80, h: 60, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });

      // Connector: free start at (0, 0), attached end at target siteIndex 0.
      // Cached frame spans from (0, 0) to the target's connection site.
      connectorId = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 0, y: 0 },
        end: { kind: 'attached', elementId: targetId, siteIndex: 0 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 240, h: 130, rotation: 0 },
      });
    });

    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([targetId, connectorId]);
    editor.render();

    // Drag the SE handle to grow the bounding box.
    dragHandle(canvas, overlay, 'se', 40, 30);

    const elements = store.read().slides[0].elements;
    const connectorAfter = elements.find((e) => e.id === connectorId)!;
    expect(connectorAfter.type).toBe('connector');
    if (connectorAfter.type !== 'connector') throw new Error('unreachable');

    // The 'end' endpoint was attached — it must remain attached, with the
    // same elementId and siteIndex, even after multi-resize.
    expect(connectorAfter.end.kind).toBe('attached');
    if (connectorAfter.end.kind !== 'attached') throw new Error('unreachable');
    expect(connectorAfter.end.elementId).toBe(targetId);
    expect(connectorAfter.end.siteIndex).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Test C: Single batched undo reverts the whole gesture
  // -------------------------------------------------------------------------
  it('one batched undo reverts the whole multi-resize gesture', () => {
    const { canvas, overlay, store } = makeFixture();
    let sid!: string;
    let aId!: string;
    let bId!: string;

    store.batch(() => {
      sid = store.read().slides[0].id;
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 200, y: 100, w: 80, h: 60, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
    });

    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);
    editor.render();

    // Snapshot before the gesture.
    const aFrameBefore = { ...store.read().slides[0].elements.find((e) => e.id === aId)!.frame };
    const bFrameBefore = { ...store.read().slides[0].elements.find((e) => e.id === bId)!.frame };

    // Drag SE handle by (40, 30).
    dragHandle(canvas, overlay, 'se', 40, 30);

    const aFrameAfter = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const bFrameAfter = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;

    // Verify the drag actually changed the frames (test would be vacuous otherwise).
    expect(aFrameAfter.w).not.toBeCloseTo(aFrameBefore.w, 1);
    expect(bFrameAfter.x).not.toBeCloseTo(bFrameBefore.x, 1);

    // Single undo should revert both elements atomically.
    expect(store.canUndo()).toBe(true);
    store.undo();

    const aFrameRestored = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const bFrameRestored = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;

    expect(aFrameRestored.x).toBeCloseTo(aFrameBefore.x, 3);
    expect(aFrameRestored.y).toBeCloseTo(aFrameBefore.y, 3);
    expect(aFrameRestored.w).toBeCloseTo(aFrameBefore.w, 3);
    expect(aFrameRestored.h).toBeCloseTo(aFrameBefore.h, 3);

    expect(bFrameRestored.x).toBeCloseTo(bFrameBefore.x, 3);
    expect(bFrameRestored.y).toBeCloseTo(bFrameBefore.y, 3);
    expect(bFrameRestored.w).toBeCloseTo(bFrameBefore.w, 3);
    expect(bFrameRestored.h).toBeCloseTo(bFrameBefore.h, 3);
  });

  // -------------------------------------------------------------------------
  // Test D: W handle with matchSize snap re-derives the correct delta
  // Regression for the sign bug fixed in commit 910c1b5a: for a W or N handle,
  // the re-derived matchedDx was computed from matched.w - startBbox.w
  // (positive, wrong sign for a W-handle drag) instead of
  // matched.x - startBbox.x (negative, correct).
  // -------------------------------------------------------------------------
  it('W handle with snap-target peer redistributes per-child correctly (sign regression)', () => {
    const { canvas, overlay, store } = makeFixture();
    let sid!: string;
    let aId!: string;
    let bId!: string;

    store.batch(() => {
      sid = store.read().slides[0].id;

      // 'a' at (100, 0, 100, 50) — selected
      aId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 0, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });

      // 'b' at (100, 100, 100, 50) — selected (multi-select with 'a')
      bId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 100, y: 100, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });

      // 'c' at (0, 300, 150, 50) — NOT selected; w=150 is the snap target
      store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 300, w: 150, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#f00' } },
      });
    });

    // Combined bbox of [a, b] = { x: 100, y: 0, w: 100, h: 150 }.
    // Drag the W handle by dx = -55: raw bbox becomes { x: 45, w: 155 }.
    // matchSize: peer 'c' has w=150, diff=5 <= 8 → snaps to w=150.
    // After fix: matchedDx = matched.x - startBbox.x = 50 - 100 = -50
    //   → resizeMultiFrames with dx=-50 → a.w = 150, a.x = 50 (moved left).
    // Pre-fix bug: matchedDx = matched.w - startBbox.w = 150 - 100 = 50
    //   → resizeMultiFrames with dx=+50 → a.w = 50, a.x = 150 (moved right!).

    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    editor.setSelection([aId, bId]);
    editor.render();

    // Drag W handle by (-55, 0) to land within matchSize threshold of peer c's w=150.
    dragHandle(canvas, overlay, 'w', -55, 0);

    const aFrame = store.read().slides[0].elements.find((e) => e.id === aId)!.frame;
    const bFrame = store.read().slides[0].elements.find((e) => e.id === bId)!.frame;

    // After the correct snap:
    //   - Both elements have w = 150 (matched peer width).
    //   - Both elements have x = 50 (bbox x moved left, not right).
    // Pre-fix: w ≈ 50 and x ≈ 150 (wrong direction).
    expect(aFrame.w).toBeCloseTo(150, 0);
    expect(aFrame.x).toBeCloseTo(50, 0);
    expect(bFrame.w).toBeCloseTo(150, 0);
    expect(bFrame.x).toBeCloseTo(50, 0);
  });

  // -------------------------------------------------------------------------
  // Test E: Drilled-in scope multi-resize
  // -------------------------------------------------------------------------
  it('drilled-in scope: multi-resize 2 children inside a group', () => {
    const { canvas, overlay, store } = makeFixture();
    let sid!: string;
    let groupId!: string;
    let gaId!: string;
    let gbId!: string;

    store.batch(() => {
      sid = store.read().slides[0].id;

      // Two shapes inside a group. After store.group() they will have
      // group-local frames. group bbox = (0, 0, 250, 50) in world space.
      gaId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 0, y: 0, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
      });
      gbId = store.addElement(sid, {
        type: 'shape',
        frame: { x: 150, y: 0, w: 100, h: 50, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#0a0' } },
      });
      ({ groupId } = store.group(sid, [gaId, gbId]));
    });

    // Capture the children's world-space widths before the drag.
    const groupEl = store.read().slides[0].elements.find((e) => e.id === groupId)!;
    expect(groupEl.type).toBe('group');
    if (groupEl.type !== 'group') throw new Error('unreachable');
    const gaLocal0 = groupEl.data.children.find((c) => c.id === gaId)!.frame;
    const gbLocal0 = groupEl.data.children.find((c) => c.id === gbId)!.frame;

    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });

    // Drill into the group scope and select both children.
    const impl = editor as unknown as { selection: Selection };
    impl.selection.setScope([groupId]);
    impl.selection.set([gaId, gbId]);
    editor.render();

    // Drag the SE handle to grow both children.
    dragHandle(canvas, overlay, 'se', 40, 30);

    const groupElAfter = store.read().slides[0].elements.find((e) => e.id === groupId)!;
    expect(groupElAfter.type).toBe('group');
    if (groupElAfter.type !== 'group') throw new Error('unreachable');

    const gaLocalAfter = groupElAfter.data.children.find((c) => c.id === gaId)!.frame;
    const gbLocalAfter = groupElAfter.data.children.find((c) => c.id === gbId)!.frame;

    // Both children's width (in group-local coords) should have grown.
    expect(gaLocalAfter.w).toBeGreaterThan(gaLocal0.w);
    expect(gbLocalAfter.w).toBeGreaterThan(gbLocal0.w);
  });
});
