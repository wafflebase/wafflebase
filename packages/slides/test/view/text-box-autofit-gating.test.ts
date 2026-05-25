// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AutofitMode, Frame } from '../../src/model/element';

// Capture the options the wrapper passes to docs `initializeTextBox` so we
// can assert which autofit hooks get wired per mode. `vi.hoisted` makes the
// spy available to the hoisted `vi.mock` factory below.
const { initSpy } = vi.hoisted(() => ({ initSpy: vi.fn() }));

vi.mock('@wafflebase/docs', async (importActual) => {
  const actual = await importActual<typeof import('@wafflebase/docs')>();
  return {
    ...actual,
    // Record opts, return a no-op API (the wrapper only stores it and
    // delegates lazily; nothing is invoked during mount).
    initializeTextBox: (opts: unknown) => {
      initSpy(opts);
      return new Proxy({}, { get: () => () => undefined });
    },
  };
});

// Import AFTER the mock so the wrapper binds the mocked initializeTextBox.
import { mountSlidesTextBox } from '../../src/view/editor/text-box-editor';

type InitOpts = {
  transformLayoutBlocks?: unknown;
  onContentHeightChange?: unknown;
};

function mountWith(autofit: AutofitMode | undefined): InitOpts {
  initSpy.mockClear();
  const overlay = document.createElement('div');
  document.body.appendChild(overlay);
  const frame: Frame = { x: 0, y: 0, w: 200, h: 100, rotation: 0 };
  mountSlidesTextBox({
    overlay,
    frame,
    scale: 1,
    blocks: [],
    onCommit: () => {},
    onCancel: () => {},
    autofit,
  });
  return initSpy.mock.calls[0][0] as InitOpts;
}

describe('mountSlidesTextBox autofit hook gating', () => {
  beforeEach(() => initSpy.mockClear());

  it("'shrink' wires transformLayoutBlocks and NOT onContentHeightChange", () => {
    const opts = mountWith('shrink');
    expect(typeof opts.transformLayoutBlocks).toBe('function');
    expect(opts.onContentHeightChange).toBeUndefined();
  });

  it("'grow' wires onContentHeightChange and NOT transformLayoutBlocks", () => {
    const opts = mountWith('grow');
    expect(typeof opts.onContentHeightChange).toBe('function');
    expect(opts.transformLayoutBlocks).toBeUndefined();
  });

  it("absent autofit behaves like grow (auto-grow, no font scale)", () => {
    const opts = mountWith(undefined);
    expect(typeof opts.onContentHeightChange).toBe('function');
    expect(opts.transformLayoutBlocks).toBeUndefined();
  });

  it("'none' wires neither hook (fixed box)", () => {
    const opts = mountWith('none');
    expect(opts.onContentHeightChange).toBeUndefined();
    expect(opts.transformLayoutBlocks).toBeUndefined();
  });
});
