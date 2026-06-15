/**
 * Logic tests for TextElementControls handler logic.
 *
 * These are logic tests rather than component-render tests; we extract and
 * verify the handler predicates in isolation:
 *   - onBackgroundFill writes fill via updateElementData for all selected text elements
 *   - onStrokeChange writes stroke via updateElementData for all selected text elements
 *   - Multi-select: changes applied to all selected text elements
 *   - No-ops when store or slideId is absent
 *
 * Font family / size are NOT box-level controls — they live in the
 * text-editing toolbar (see TextEditSection), matching the shape toolbar
 * which also shows only fill + border at object level.
 */

import { describe, it, expect, vi } from 'vitest';

import type { Block } from '@wafflebase/docs';
import type { Stroke, ThemeColor } from '@wafflebase/slides';

// ---------------------------------------------------------------------------
// Shared types mirroring element.ts
// ---------------------------------------------------------------------------

type MockTextElement = {
  id: string;
  type: 'text';
  data: { blocks: Block[]; fill?: ThemeColor; stroke?: Stroke };
};

type MockElement = MockTextElement | { id: string; type: 'image' };

// ---------------------------------------------------------------------------
// Extracted handler: onBackgroundFill
// ---------------------------------------------------------------------------

function makeOnBackgroundFill(
  store: {
    batch: (fn: () => void) => void;
    updateElementData: (slideId: string, id: string, patch: object) => void;
  } | null,
  slideId: string | undefined,
  elements: MockElement[],
  ids: readonly string[],
) {
  return (color: ThemeColor) => {
    if (!store || !slideId) return;
    store.batch(() => {
      for (const id of ids) {
        const el = elements.find((e) => e.id === id);
        if (el?.type === 'text') {
          store.updateElementData(slideId, id, { fill: color });
        }
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Extracted handler: onStrokeChange
// ---------------------------------------------------------------------------

function makeOnStrokeChange(
  store: {
    batch: (fn: () => void) => void;
    updateElementData: (slideId: string, id: string, patch: object) => void;
  } | null,
  slideId: string | undefined,
  elements: MockElement[],
  ids: readonly string[],
) {
  return (stroke: Stroke | undefined) => {
    if (!store || !slideId) return;
    store.batch(() => {
      for (const id of ids) {
        const el = elements.find((e) => e.id === id);
        if (el?.type === 'text') {
          store.updateElementData(slideId, id, { stroke });
        }
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Tests: onBackgroundFill
// ---------------------------------------------------------------------------

describe('TextElementControls onBackgroundFill logic', () => {
  const slideId = 'slide-1';
  const color: ThemeColor = { kind: 'srgb', value: '#ff0000' };

  function makeStore() {
    return {
      batch: vi.fn((fn: () => void) => fn()),
      updateElementData: vi.fn(),
    };
  }

  it('writes fill via updateElementData for a single text element', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnBackgroundFill(store, slideId, elements, ['el-1']);
    handler(color);

    expect(store.batch.mock.calls.length).toBe(1);
    expect(store.updateElementData.mock.calls.length).toBe(1);
    expect(store.updateElementData.mock.calls[0][0]).toBe(slideId);
    expect(store.updateElementData.mock.calls[0][1]).toBe('el-1');
    expect(store.updateElementData.mock.calls[0][2]).toEqual({ fill: color });
  });

  it('writes fill to all selected text elements in multi-select', () => {
    const store = makeStore();
    const elements: MockElement[] = [
      { id: 'el-1', type: 'text', data: { blocks: [] } },
      { id: 'el-2', type: 'text', data: { blocks: [] } },
    ];
    const handler = makeOnBackgroundFill(store, slideId, elements, ['el-1', 'el-2']);
    handler(color);

    expect(store.updateElementData.mock.calls.length).toBe(2);
    expect(store.updateElementData.mock.calls[0][1]).toBe('el-1');
    expect(store.updateElementData.mock.calls[1][1]).toBe('el-2');
  });

  it('skips non-text elements', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'img-1', type: 'image' }];
    const handler = makeOnBackgroundFill(store, slideId, elements, ['img-1']);
    handler(color);

    expect(store.batch.mock.calls.length).toBe(1);
    expect(store.updateElementData.mock.calls.length).toBe(0);
  });

  it('no-ops when store is null', () => {
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnBackgroundFill(null, slideId, elements, ['el-1']);
    // Should not throw
    handler(color);
  });

  it('no-ops when slideId is undefined', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnBackgroundFill(store, undefined, elements, ['el-1']);
    handler(color);

    expect(store.batch.mock.calls.length).toBe(0);
    expect(store.updateElementData.mock.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: onStrokeChange
// ---------------------------------------------------------------------------

describe('TextElementControls onStrokeChange logic', () => {
  const slideId = 'slide-1';
  const stroke: Stroke = { color: '#000000', width: 2, dash: 'solid' };

  function makeStore() {
    return {
      batch: vi.fn((fn: () => void) => fn()),
      updateElementData: vi.fn(),
    };
  }

  it('writes stroke via updateElementData for a single text element', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1']);
    handler(stroke);

    expect(store.updateElementData.mock.calls.length).toBe(1);
    expect(store.updateElementData.mock.calls[0][2]).toEqual({ stroke });
  });

  it('writes stroke to all selected text elements in multi-select', () => {
    const store = makeStore();
    const elements: MockElement[] = [
      { id: 'el-1', type: 'text', data: { blocks: [] } },
      { id: 'el-2', type: 'text', data: { blocks: [] } },
    ];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1', 'el-2']);
    handler(stroke);

    expect(store.updateElementData.mock.calls.length).toBe(2);
  });

  it('passes undefined stroke (clear border) through correctly', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1']);
    handler(undefined);

    expect(store.updateElementData.mock.calls[0][2]).toEqual({ stroke: undefined });
  });
});
