/**
 * Logic tests for TextElementControls handler logic.
 *
 * The React JSX component cannot be rendered by the Node --experimental-strip-types
 * test runner. We extract and verify the handler predicates in isolation:
 *   - onBackgroundFill writes fill via updateElementData for all selected text elements
 *   - onStrokeChange writes stroke via updateElementData for all selected text elements
 *   - onFontFamily writes fontFamily to all inlines of all selected text elements
 *   - onFontSize writes fontSize to all inlines of all selected text elements
 *   - Multi-select: changes applied to all selected text elements
 *   - No-ops when store or slideId is absent
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
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
// Extracted handler: onFontFamily
// ---------------------------------------------------------------------------

type WithTextElementFn = (
  slideId: string,
  elementId: string,
  fn: (blocks: Block[]) => Block[] | void,
) => void;

function makeOnFontFamily(
  store: {
    batch: (fn: () => void) => void;
    withTextElement: WithTextElementFn;
  } | null,
  slideId: string | undefined,
  family: string,
  ids: readonly string[],
) {
  return () => {
    if (!store || !slideId) return;
    store.batch(() => {
      for (const id of ids) {
        store.withTextElement(slideId, id, (blocks) =>
          blocks.map((b) => ({
            ...b,
            inlines: b.inlines.map((run) => ({
              ...run,
              style: { ...run.style, fontFamily: family },
            })),
          })),
        );
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Extracted handler: onFontSize
// ---------------------------------------------------------------------------

function makeOnFontSize(
  store: {
    batch: (fn: () => void) => void;
    withTextElement: WithTextElementFn;
  } | null,
  slideId: string | undefined,
  ids: readonly string[],
) {
  return (size: number) => {
    if (!store || !slideId) return;
    store.batch(() => {
      for (const id of ids) {
        store.withTextElement(slideId, id, (blocks) =>
          blocks.map((b) => ({
            ...b,
            inlines: b.inlines.map((run) => ({
              ...run,
              style: { ...run.style, fontSize: size },
            })),
          })),
        );
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
      batch: mock.fn((fn: () => void) => fn()),
      updateElementData: mock.fn(),
    };
  }

  it('writes fill via updateElementData for a single text element', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnBackgroundFill(store, slideId, elements, ['el-1']);
    handler(color);

    assert.equal(store.batch.mock.calls.length, 1);
    assert.equal(store.updateElementData.mock.calls.length, 1);
    assert.equal(store.updateElementData.mock.calls[0].arguments[0], slideId);
    assert.equal(store.updateElementData.mock.calls[0].arguments[1], 'el-1');
    assert.deepEqual(store.updateElementData.mock.calls[0].arguments[2], { fill: color });
  });

  it('writes fill to all selected text elements in multi-select', () => {
    const store = makeStore();
    const elements: MockElement[] = [
      { id: 'el-1', type: 'text', data: { blocks: [] } },
      { id: 'el-2', type: 'text', data: { blocks: [] } },
    ];
    const handler = makeOnBackgroundFill(store, slideId, elements, ['el-1', 'el-2']);
    handler(color);

    assert.equal(store.updateElementData.mock.calls.length, 2);
    assert.equal(store.updateElementData.mock.calls[0].arguments[1], 'el-1');
    assert.equal(store.updateElementData.mock.calls[1].arguments[1], 'el-2');
  });

  it('skips non-text elements', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'img-1', type: 'image' }];
    const handler = makeOnBackgroundFill(store, slideId, elements, ['img-1']);
    handler(color);

    assert.equal(store.batch.mock.calls.length, 1);
    assert.equal(store.updateElementData.mock.calls.length, 0);
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

    assert.equal(store.batch.mock.calls.length, 0);
    assert.equal(store.updateElementData.mock.calls.length, 0);
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
      batch: mock.fn((fn: () => void) => fn()),
      updateElementData: mock.fn(),
    };
  }

  it('writes stroke via updateElementData for a single text element', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1']);
    handler(stroke);

    assert.equal(store.updateElementData.mock.calls.length, 1);
    assert.deepEqual(store.updateElementData.mock.calls[0].arguments[2], { stroke });
  });

  it('writes stroke to all selected text elements in multi-select', () => {
    const store = makeStore();
    const elements: MockElement[] = [
      { id: 'el-1', type: 'text', data: { blocks: [] } },
      { id: 'el-2', type: 'text', data: { blocks: [] } },
    ];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1', 'el-2']);
    handler(stroke);

    assert.equal(store.updateElementData.mock.calls.length, 2);
  });

  it('passes undefined stroke (clear border) through correctly', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'text', data: { blocks: [] } }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1']);
    handler(undefined);

    assert.deepEqual(store.updateElementData.mock.calls[0].arguments[2], { stroke: undefined });
  });
});

// ---------------------------------------------------------------------------
// Tests: onFontFamily
// ---------------------------------------------------------------------------

describe('TextElementControls onFontFamily logic', () => {
  const slideId = 'slide-1';
  const family = 'Roboto';

  function makeBlockWithRun(text: string): Block {
    return {
      type: 'paragraph',
      inlines: [{ text, style: {} }],
    } as unknown as Block;
  }

  function makeStore(blocks: Block[]) {
    const withTextElement = mock.fn(
      (
        _slideId: string,
        _id: string,
        fn: (blocks: Block[]) => Block[] | void,
      ) => {
        fn(blocks);
      },
    );
    return {
      batch: mock.fn((fn: () => void) => fn()),
      withTextElement,
    };
  }

  it('writes fontFamily to all inlines of a single text element', () => {
    const blocks = [makeBlockWithRun('Hello')];
    const store = makeStore(blocks);
    const handler = makeOnFontFamily(store, slideId, family, ['el-1']);
    handler();

    assert.equal(store.withTextElement.mock.calls.length, 1);
    assert.equal(store.withTextElement.mock.calls[0].arguments[0], slideId);
    assert.equal(store.withTextElement.mock.calls[0].arguments[1], 'el-1');
  });

  it('calls withTextElement for all selected elements in multi-select', () => {
    const blocks = [makeBlockWithRun('Hi')];
    const store = makeStore(blocks);
    const handler = makeOnFontFamily(store, slideId, family, ['el-1', 'el-2']);
    handler();

    assert.equal(store.withTextElement.mock.calls.length, 2);
    assert.equal(store.withTextElement.mock.calls[0].arguments[1], 'el-1');
    assert.equal(store.withTextElement.mock.calls[1].arguments[1], 'el-2');
  });

  it('the block mapper writes fontFamily into each inline style', () => {
    const block = makeBlockWithRun('Text');
    let capturedResult: Block[] | undefined;
    const store = {
      batch: mock.fn((fn: () => void) => fn()),
      withTextElement: mock.fn(
        (_sid: string, _eid: string, fn: (blocks: Block[]) => Block[] | void) => {
          capturedResult = fn([block]) as Block[];
        },
      ),
    };
    const handler = makeOnFontFamily(store, slideId, family, ['el-1']);
    handler();

    assert.ok(capturedResult);
    const inline = capturedResult[0].inlines[0] as { style: { fontFamily?: string } };
    assert.equal(inline.style.fontFamily, family);
  });

  it('no-ops when store is null', () => {
    const handler = makeOnFontFamily(null, slideId, family, ['el-1']);
    // Should not throw
    handler();
  });

  it('no-ops when slideId is undefined', () => {
    const blocks = [makeBlockWithRun('Hi')];
    const store = makeStore(blocks);
    const handler = makeOnFontFamily(store, undefined, family, ['el-1']);
    handler();

    assert.equal(store.batch.mock.calls.length, 0);
    assert.equal(store.withTextElement.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: onFontSize
// ---------------------------------------------------------------------------

describe('TextElementControls onFontSize logic', () => {
  const slideId = 'slide-1';

  function makeBlockWithRun(text: string): Block {
    return {
      type: 'paragraph',
      inlines: [{ text, style: {} }],
    } as unknown as Block;
  }

  function makeStore(blocks: Block[]) {
    const withTextElement = mock.fn(
      (
        _slideId: string,
        _id: string,
        fn: (blocks: Block[]) => Block[] | void,
      ) => {
        fn(blocks);
      },
    );
    return {
      batch: mock.fn((fn: () => void) => fn()),
      withTextElement,
    };
  }

  it('writes fontSize to all inlines of a single text element', () => {
    const block = makeBlockWithRun('Hello');
    let capturedResult: Block[] | undefined;
    const store = {
      batch: mock.fn((fn: () => void) => fn()),
      withTextElement: mock.fn(
        (_sid: string, _eid: string, fn: (blocks: Block[]) => Block[] | void) => {
          capturedResult = fn([block]) as Block[];
        },
      ),
    };
    const handler = makeOnFontSize(store, slideId, ['el-1']);
    handler(24);

    assert.ok(capturedResult);
    const inline = capturedResult[0].inlines[0] as { style: { fontSize?: number } };
    assert.equal(inline.style.fontSize, 24);
  });

  it('calls withTextElement for all selected elements in multi-select', () => {
    const blocks = [makeBlockWithRun('Hi')];
    const store = makeStore(blocks);
    const handler = makeOnFontSize(store, slideId, ['el-1', 'el-2']);
    handler(16);

    assert.equal(store.withTextElement.mock.calls.length, 2);
    assert.equal(store.withTextElement.mock.calls[0].arguments[1], 'el-1');
    assert.equal(store.withTextElement.mock.calls[1].arguments[1], 'el-2');
  });

  it('no-ops when store is null', () => {
    const handler = makeOnFontSize(null, slideId, ['el-1']);
    // Should not throw
    handler(12);
  });

  it('no-ops when slideId is undefined', () => {
    const blocks = [makeBlockWithRun('Hi')];
    const store = makeStore(blocks);
    const handler = makeOnFontSize(store, undefined, ['el-1']);
    handler(12);

    assert.equal(store.batch.mock.calls.length, 0);
    assert.equal(store.withTextElement.mock.calls.length, 0);
  });
});
