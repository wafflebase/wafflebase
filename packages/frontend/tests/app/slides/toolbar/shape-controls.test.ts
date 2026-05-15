/**
 * Logic tests for ShapeControls handler logic.
 *
 * The React JSX component cannot be rendered by the Node --experimental-strip-types
 * test runner. We extract and verify the handler predicates in isolation:
 *   - onStrokeChange writes via updateElementData (shapes) and updateConnectorStroke (connectors)
 *   - Multi-select writes to all applicable elements
 *   - No-ops when store or slideId is absent
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { Stroke } from '@wafflebase/slides';

// ---------------------------------------------------------------------------
// Extracted handler logic (mirrors shape-controls.tsx)
// ---------------------------------------------------------------------------

type MockElement =
  | { id: string; type: 'shape'; data: { stroke?: Stroke } }
  | { id: string; type: 'connector'; stroke?: Stroke }
  | { id: string; type: 'image' };

function makeOnStrokeChange(
  store: {
    batch: (fn: () => void) => void;
    updateElementData: (slideId: string, id: string, patch: object) => void;
    updateConnectorStroke: (slideId: string, id: string, stroke: Stroke | undefined) => void;
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
        if (!el) continue;
        if (el.type === 'shape') {
          store.updateElementData(slideId, id, { stroke });
        } else if (el.type === 'connector') {
          store.updateConnectorStroke(slideId, id, stroke);
        }
      }
    });
  };
}

// ---------------------------------------------------------------------------

describe('ShapeControls onStrokeChange logic', () => {
  const slideId = 'slide-1';
  const stroke: Stroke = { color: '#ff0000', width: 2, dash: 'solid' };

  function makeStore() {
    const batchMock = mock.fn((fn: () => void) => fn());
    const updateElementDataMock = mock.fn();
    const updateConnectorStrokeMock = mock.fn();
    return {
      batch: batchMock,
      updateElementData: updateElementDataMock,
      updateConnectorStroke: updateConnectorStrokeMock,
    };
  }

  it('calls updateElementData for a single shape', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'shape', data: {} }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1']);
    handler(stroke);

    assert.equal(store.batch.mock.calls.length, 1);
    assert.equal(store.updateElementData.mock.calls.length, 1);
    assert.equal(store.updateElementData.mock.calls[0].arguments[0], slideId);
    assert.equal(store.updateElementData.mock.calls[0].arguments[1], 'el-1');
    assert.deepEqual(store.updateElementData.mock.calls[0].arguments[2], { stroke });
    assert.equal(store.updateConnectorStroke.mock.calls.length, 0);
  });

  it('calls updateConnectorStroke for a single connector', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'con-1', type: 'connector' }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['con-1']);
    handler(stroke);

    assert.equal(store.updateConnectorStroke.mock.calls.length, 1);
    assert.equal(store.updateConnectorStroke.mock.calls[0].arguments[0], slideId);
    assert.equal(store.updateConnectorStroke.mock.calls[0].arguments[1], 'con-1');
    assert.deepEqual(store.updateConnectorStroke.mock.calls[0].arguments[2], stroke);
    assert.equal(store.updateElementData.mock.calls.length, 0);
  });

  it('writes to both shapes and connectors in a multi-select', () => {
    const store = makeStore();
    const elements: MockElement[] = [
      { id: 'el-1', type: 'shape', data: {} },
      { id: 'con-1', type: 'connector' },
      { id: 'el-2', type: 'shape', data: {} },
    ];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1', 'con-1', 'el-2']);
    handler(stroke);

    assert.equal(store.updateElementData.mock.calls.length, 2);
    assert.equal(store.updateConnectorStroke.mock.calls.length, 1);
  });

  it('skips image elements entirely', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'img-1', type: 'image' }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['img-1']);
    handler(stroke);

    // batch is still called but no updates issued
    assert.equal(store.batch.mock.calls.length, 1);
    assert.equal(store.updateElementData.mock.calls.length, 0);
    assert.equal(store.updateConnectorStroke.mock.calls.length, 0);
  });

  it('passes undefined stroke (no border) through correctly', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'shape', data: {} }];
    const handler = makeOnStrokeChange(store, slideId, elements, ['el-1']);
    handler(undefined);

    assert.deepEqual(store.updateElementData.mock.calls[0].arguments[2], { stroke: undefined });
  });

  it('no-ops when store is null', () => {
    const elements: MockElement[] = [{ id: 'el-1', type: 'shape', data: {} }];
    const handler = makeOnStrokeChange(null, slideId, elements, ['el-1']);
    // Should not throw
    handler(stroke);
  });

  it('no-ops when slideId is undefined', () => {
    const store = makeStore();
    const elements: MockElement[] = [{ id: 'el-1', type: 'shape', data: {} }];
    const handler = makeOnStrokeChange(store, undefined, elements, ['el-1']);
    handler(stroke);

    assert.equal(store.batch.mock.calls.length, 0);
    assert.equal(store.updateElementData.mock.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Border weight: 0 means "clear stroke"
// ---------------------------------------------------------------------------

describe('BorderPicker onWeightChange logic', () => {
  /** Mirrors the logic in border-picker.tsx */
  function onWeightChange(
    value: Stroke | undefined,
    width: number,
    onChange: (s: Stroke | undefined) => void,
  ) {
    const DEFAULT_STROKE: Stroke = { color: '#000000', width: 1, dash: 'solid' };
    if (width === 0) {
      onChange(undefined);
    } else {
      onChange({ ...(value ?? DEFAULT_STROKE), width });
    }
  }

  it('emits undefined when weight is 0', () => {
    const onChange = mock.fn<(s: Stroke | undefined) => void>();
    onWeightChange({ color: '#ff0000', width: 2 }, 0, onChange);
    assert.equal(onChange.mock.calls[0].arguments[0], undefined);
  });

  it('emits updated stroke with new width', () => {
    const onChange = mock.fn<(s: Stroke | undefined) => void>();
    const existing: Stroke = { color: '#ff0000', width: 2, dash: 'solid' };
    onWeightChange(existing, 4, onChange);
    assert.deepEqual(onChange.mock.calls[0].arguments[0], {
      color: '#ff0000',
      width: 4,
      dash: 'solid',
    });
  });

  it('uses DEFAULT_STROKE as base when value is undefined', () => {
    const onChange = mock.fn<(s: Stroke | undefined) => void>();
    onWeightChange(undefined, 2, onChange);
    assert.deepEqual(onChange.mock.calls[0].arguments[0], {
      color: '#000000',
      width: 2,
      dash: 'solid',
    });
  });
});

// ---------------------------------------------------------------------------
// Border color: re-enables stroke when weight was 0
// ---------------------------------------------------------------------------

describe('BorderPicker onColorChange logic', () => {
  function onColorChange(
    value: Stroke | undefined,
    color: { kind: 'srgb'; value: string },
    onChange: (s: Stroke | undefined) => void,
  ) {
    const DEFAULT_STROKE: Stroke = { color: '#000000', width: 1, dash: 'solid' };
    const next: Stroke = { ...(value ?? DEFAULT_STROKE), color };
    if (next.width === 0) next.width = 1;
    onChange(next);
  }

  it('re-enables stroke width from 0 when a color is chosen', () => {
    const onChange = mock.fn<(s: Stroke | undefined) => void>();
    const existing: Stroke = { color: '#000000', width: 0 };
    onColorChange(existing, { kind: 'srgb', value: '#ff0000' }, onChange);
    const result = onChange.mock.calls[0].arguments[0] as Stroke;
    assert.equal(result.width, 1);
    assert.deepEqual(result.color, { kind: 'srgb', value: '#ff0000' });
  });
});
