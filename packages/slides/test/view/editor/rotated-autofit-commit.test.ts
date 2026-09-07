// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Block } from '@wafflebase/docs';
import type { Frame } from '../../../src/model/element';
import { MemSlidesStore } from '../../../src/store/memory';
import {
  initialize,
  maskEditingElement,
  type SlidesEditor,
} from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

/**
 * Mock mount that hands the editor's own options back to the test so it
 * can drive the autofit-grow commit path: report a content height, then
 * commit.
 */
function makeMount(captured: { opts?: MountSlidesTextBoxOptions }) {
  return function mount(opts: MountSlidesTextBoxOptions): SlidesTextBoxEditor {
    captured.opts = opts;
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
      stepSelectionFontSize: () => {},
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

/** World position of the unrotated box's top-left corner. */
function nwWorld(f: Frame): { x: number; y: number } {
  const cx = f.x + f.w / 2;
  const cy = f.y + f.h / 2;
  const cos = Math.cos(f.rotation);
  const sin = Math.sin(f.rotation);
  const dx = -f.w / 2;
  const dy = -f.h / 2;
  return { x: cx + cos * dx - sin * dy, y: cy + sin * dx + cos * dy };
}

function setup(rotation: number) {
  document.body.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  document.body.appendChild(canvas);
  document.body.appendChild(overlay);
  const store = new MemSlidesStore();
  let sid = '';
  let textId = '';
  store.batch(() => {
    sid = store.addSlide('blank');
    textId = store.addElement(sid, {
      type: 'text',
      frame: { x: 400, y: 300, w: 200, h: 100, rotation },
      data: { blocks: [block('grow me')] },
    });
  });
  const before = { x: 400, y: 300, w: 200, h: 100, rotation };
  return { canvas, overlay, store, sid, textId, before };
}

function frameOf(store: MemSlidesStore, sid: string, id: string): Frame {
  const slide = store.read().slides.find((s) => s.id === sid)!;
  return slide.elements.find((e) => e.id === id)!.frame;
}

describe('autofit-grow commit on a rotated text box (#1039)', () => {
  let editor: SlidesEditor | null = null;
  afterEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it('keeps the unrotated top-left anchored instead of patching h alone', () => {
    const rotation = Math.PI / 3;
    const { canvas, overlay, store, sid, textId, before } = setup(rotation);
    const captured: { opts?: MountSlidesTextBoxOptions } = {};
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMount(captured),
    });

    editor.enterTextEditing(textId);
    captured.opts!.onContentHeightChange!(180);
    captured.opts!.onCommit(captured.opts!.blocks);

    const after = frameOf(store, sid, textId);
    expect(after.h).toBe(180);
    expect(after.rotation).toBeCloseTo(rotation, 10);
    // The size-only patch this replaces would have left x/y at 400/300
    // and so moved every painted point of the box.
    expect(after.x).not.toBeCloseTo(400, 3);
    const nwBefore = nwWorld(before);
    const nwAfter = nwWorld(after);
    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 6);
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 6);
  });

  it('grows the live underlay onto the frame the commit will write', () => {
    // The in-edit box decoration is painted from `maskEditingElement`'s
    // live-height clone. If that clone grew `h` with x/y pinned it would
    // sit somewhere the anchored commit never lands, so a rotated box's
    // fill/border would jump the moment the edit committed (#1039).
    const rotation = Math.PI / 3;
    const before: Frame = { x: 400, y: 300, w: 200, h: 100, rotation };
    const el = {
      id: 't1', type: 'text' as const,
      frame: before,
      data: { blocks: [block('grow me')] },
    };
    const [masked] = maskEditingElement([el as never], 't1', null, 180);
    const live = masked.frame;
    expect(live.h).toBe(180);
    expect(live.x).not.toBeCloseTo(400, 3);
    const nwBefore = nwWorld(before);
    const nwLive = nwWorld(live);
    expect(nwLive.x).toBeCloseTo(nwBefore.x, 6);
    expect(nwLive.y).toBeCloseTo(nwBefore.y, 6);

    // …and it is exactly the committed frame.
    const { canvas, overlay, store, sid, textId } = setup(rotation);
    const captured: { opts?: MountSlidesTextBoxOptions } = {};
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMount(captured),
    });
    editor.enterTextEditing(textId);
    captured.opts!.onContentHeightChange!(180);
    captured.opts!.onCommit(captured.opts!.blocks);
    const after = frameOf(store, sid, textId);
    expect(after.x).toBeCloseTo(live.x, 6);
    expect(after.y).toBeCloseTo(live.y, 6);
  });

  it('leaves x/y untouched at rotation 0', () => {
    const { canvas, overlay, store, sid, textId } = setup(0);
    const captured: { opts?: MountSlidesTextBoxOptions } = {};
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeMount(captured),
    });

    editor.enterTextEditing(textId);
    captured.opts!.onContentHeightChange!(180);
    captured.opts!.onCommit(captured.opts!.blocks);

    const after = frameOf(store, sid, textId);
    expect(after.h).toBe(180);
    expect(after.x).toBe(400);
    expect(after.y).toBe(300);
  });
});
