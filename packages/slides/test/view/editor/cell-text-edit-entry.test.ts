// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { TableElement } from '../../../src/model/element';
import { SLIDE_WIDTH, SLIDE_HEIGHT } from '../../../src/model/presentation';
import { MemSlidesStore } from '../../../src/store/memory';
import { initialize, type SlidesEditor } from '../../../src/view/editor/editor';
import type {
  MountSlidesTextBoxOptions,
  SlidesTextBoxEditor,
} from '../../../src/view/editor/text-box-editor';

/**
 * Capturing mock mount: records the options the editor passes to
 * `mountTextBox` so the test can assert how the cell editor is sized.
 */
function makeCapturingMount(captured: {
  opts?: MountSlidesTextBoxOptions;
}) {
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

/** 2×2 table, 100×100 cells, all empty bodies. */
function tableData(): TableElement['data'] {
  const emptyCell = () => ({ body: { blocks: [] }, style: {} });
  return {
    columnWidths: [100, 100],
    rows: [
      { height: 100, cells: [emptyCell(), emptyCell()] },
      { height: 100, cells: [emptyCell(), emptyCell()] },
    ],
  };
}

describe('table cell text-edit entry — box sizing', () => {
  let editor: SlidesEditor | null = null;
  afterEach(() => {
    if (editor) { editor.detach(); editor = null; }
  });

  it('keeps the editing box at the cell height (growMode never)', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      store.addElement(sid, {
        type: 'table',
        frame: { x: 200, y: 200, w: 200, h: 200, rotation: 0 },
        data: tableData(),
      });
    });

    const captured: { opts?: MountSlidesTextBoxOptions } = {};
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeCapturingMount(captured),
    });

    // Double-click inside cell (0,0): table at (200,200), cell spans
    // local x[0,100] y[0,100] → world (250,250).
    canvas.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 250, clientY: 250, bubbles: true }),
    );

    expect(captured.opts).toBeDefined();
    // The editor canvas must stay at the cell's inner-frame height — the
    // cell text-edit box must not shrink to the (empty) content height.
    expect(captured.opts!.growMode).toBe('never');
    // editFrame height ≈ cell height (100) minus top/bottom padding;
    // a shrunk box would be far smaller than this.
    expect(captured.opts!.frame.h).toBeGreaterThan(50);
  });

  it('extends the paint surface to the slide bounds so overflow shows', () => {
    const { canvas, overlay, store } = setup();
    let sid = '';
    store.batch(() => {
      sid = store.addSlide('blank');
      store.addElement(sid, {
        type: 'table',
        frame: { x: 200, y: 200, w: 200, h: 200, rotation: 0 },
        data: tableData(),
      });
    });

    const captured: { opts?: MountSlidesTextBoxOptions } = {};
    editor = initialize({
      canvas, overlay, store,
      hostWidth: 1920, hostHeight: 1080, dpr: 1,
      mountTextBox: makeCapturingMount(captured),
    });

    canvas.dispatchEvent(
      new MouseEvent('dblclick', { clientX: 250, clientY: 250, bubbles: true }),
    );

    const opts = captured.opts!;
    expect(opts.overflowBounds).toBeDefined();
    // Editing text that overflows the cell must paint up to the slide
    // edge — exactly where the committed renderer clips it.
    expect(opts.overflowBounds!.width).toBe(SLIDE_WIDTH - opts.frame.x);
    expect(opts.overflowBounds!.height).toBe(SLIDE_HEIGHT - opts.frame.y);
    // And the surface is strictly larger than the cell box.
    expect(opts.overflowBounds!.width).toBeGreaterThan(opts.frame.w);
  });
});
