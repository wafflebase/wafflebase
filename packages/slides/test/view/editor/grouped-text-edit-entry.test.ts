// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import type { Frame } from '../../../src/model/element';
import { MemSlidesStore } from '../../../src/store/memory';
import { buildElementWorldLookup } from '../../../src/model/group';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

/**
 * Capturing mock mount: records the frame the editor passed in so the
 * test can assert it's in world coords (group transform composed),
 * not the raw group-local frame.
 */
function makeCapturingMount(captured: { frame?: Frame }) {
  return function mount(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
    captured.frame = opts.frame;
    const container = document.createElement('div');
    container.className = 'wfb-slides-text-box-editor';
    container.style.position = 'absolute';
    opts.overlay.appendChild(container);
    let mounted = true;
    return {
      isEditing: () => mounted,
      focus: () => undefined,
      commit: () => opts.onCommit(opts.blocks),
      detach: () => { mounted = false; container.remove(); },
      container,
      getSelectionStyle: () => ({}),
      getRangeStyleSummary: () => ({}),
      applyStyle: () => {},
      clearInlineFormatting: () => {},
      applyBlockStyle: () => {},
      getBlockType: () => ({ type: 'paragraph' as const }),
      getBlockStyle: () => ({}),
      setBlockType: () => {},
      toggleList: () => {},
      indent: () => {},
      outdent: () => {},
      insertLink: () => {},
      removeLink: () => {},
      getLinkAtCursor: () => undefined,
      requestLink: () => {},
      undo: () => {},
      redo: () => {},
      onCursorMove: () => () => {},
    };
  };
}

function block(text: string): Block {
  return {
    id: 'b1', type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

function setup() {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  return { canvas, overlay, store };
}

describe('enterTextEditing for grouped elements', () => {
  let editor: SlidesEditor | null = null;
  afterEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it('enters edit mode on a text element nested inside a group', () => {
    // Slide-22 regression: `Array.prototype.find` only walked the
    // top-level `slide.elements`, so any text/shape inside a group
    // silently failed to enter text-edit mode.
    const { canvas, overlay, store } = setup();
    let sid = '';
    let textId = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      textId = store.addElement(sid, {
        type: 'text',
        frame: { x: 100, y: 200, w: 300, h: 80, rotation: 0 },
        data: { blocks: [block('Inside a group')] },
      });
      const labelId = store.addElement(sid, {
        type: 'text',
        frame: { x: 0, y: 200, w: 80, h: 80, rotation: 0 },
        data: { blocks: [block('label')] },
      });
      // group() requires at least 2 elements at the same level.
      store.group(sid, [labelId, textId]);
    });

    const captured: { frame?: Frame } = {};
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeCapturingMount(captured),
    });

    editor.enterTextEditing(textId);

    expect(editor.getEditingElementId()).toBe(textId);
    expect(captured.frame).toBeDefined();
  });

  it('passes world (not group-local) frame to the text-box mount', () => {
    // The overlay text-box mounts in world coords (`frame.x * scale`);
    // for a grouped element the stored `frame` is group-local. The
    // mount path must compose the ancestor group transforms before
    // handing the frame to `mountTextBox`, or the editor lines up
    // outside the visible element on the slide canvas.
    //
    // Place the elements far enough apart that `store.group()`'s AABB
    // wrap produces a group origin that is clearly NOT (0, 0), so the
    // world frame is meaningfully different from any nested local
    // coords.
    const { canvas, overlay, store } = setup();
    let sid = '';
    let textId = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      textId = store.addElement(sid, {
        type: 'text',
        frame: { x: 600, y: 400, w: 200, h: 60, rotation: 0 },
        data: { blocks: [block('Body')] },
      });
      const otherId = store.addElement(sid, {
        type: 'text',
        frame: { x: 500, y: 300, w: 40, h: 40, rotation: 0 },
        data: { blocks: [block('x')] },
      });
      store.group(sid, [otherId, textId]);
    });

    const slide = store.read().slides.find((s) => s.id === sid)!;
    // Canonical world frame for the grouped element. Whatever the
    // editor passes to mount must equal this — the mount path uses
    // this same helper internally.
    const expected = buildElementWorldLookup(slide.elements).get(textId)!.frame;

    const captured: { frame?: Frame } = {};
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeCapturingMount(captured),
    });

    editor.enterTextEditing(textId);

    expect(captured.frame?.x).toBeCloseTo(expected.x, 5);
    expect(captured.frame?.y).toBeCloseTo(expected.y, 5);
    expect(captured.frame?.w).toBeCloseTo(expected.w, 5);
    expect(captured.frame?.h).toBeCloseTo(expected.h, 5);
    // The original world coords we wrote — sanity check that the
    // expected frame matches the visible position on the slide
    // (group AABB wrap doesn't change the child's world position).
    expect(expected.x).toBeCloseTo(600, 5);
    expect(expected.y).toBeCloseTo(400, 5);
  });
});
