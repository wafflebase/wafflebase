// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { ConnectorElement } from '../../../src/model/connector';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import { makeDefaultLabelBlock } from '../../../src/view/editor/connector-label-edit';

describe('connector label edit entry', () => {
  let editor: SlidesEditor | null = null;

  afterEach(() => {
    editor?.detach();
    editor = null;
    document.body.innerHTML = '';
  });

  function setup(withLabel = false) {
    const canvas = document.createElement('canvas');
    const overlay = document.createElement('div');
    document.body.append(canvas, overlay);
    const store = new MemSlidesStore();
    store.batch(() => store.addSlide('blank'));
    const sid = store.read().slides[0].id;
    let id = '';
    const block = makeDefaultLabelBlock();
    store.batch(() => {
      id = store.addElement(sid, {
        type: 'connector',
        routing: 'straight',
        start: { kind: 'free', x: 100, y: 200 },
        end: { kind: 'free', x: 500, y: 200 },
        arrowheads: {},
        frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
        ...(withLabel
          ? { label: { blocks: [{ ...block, inlines: [{ ...block.inlines[0], text: 'yes' }] }] } }
          : {}),
      });
    });
    editor = initialize({ canvas, overlay, store, hostWidth: 1920, hostHeight: 1080, dpr: 1 });
    const read = () =>
      store.read().slides[0].elements.find((e) => e.id === id) as ConnectorElement;
    return { canvas, id, read };
  }

  it('double-clicking a connector edits its label instead of deselecting', () => {
    const { canvas, id } = setup();
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 200, bubbles: true }));
    expect(editor!.getEditingElementId()).toBe(id);
    expect(editor!.getSelection()).toEqual([id]);
  });

  it('Enter on a selected connector edits its label', () => {
    const { id } = setup();
    editor!.setSelection([id]);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(editor!.getEditingElementId()).toBe(id);
  });

  it('leaving an untouched new label stores no label', () => {
    const { canvas, read } = setup();
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 200, bubbles: true }));
    editor!.exitTextEditing();
    expect(editor!.getEditingElementId()).toBeNull();
    expect(read().label).toBeUndefined();
  });

  it('leaving an existing label unchanged keeps it', () => {
    const { canvas, read } = setup(true);
    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 300, clientY: 200, bubbles: true }));
    editor!.exitTextEditing();
    expect(read().label?.blocks[0].inlines[0].text).toBe('yes');
  });
});
