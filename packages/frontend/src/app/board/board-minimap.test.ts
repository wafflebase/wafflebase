/* eslint-disable @typescript-eslint/no-explicit-any -- fakeStore is a
   minimal SlidesStore stub and the jsdom canvas 2D-context stub is a
   narrow mock; typing either precisely would just re-declare their
   real interfaces for no test-clarity gain. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBoardMinimap } from './board-minimap';

function fakeStore() {
  return {
    read: () => ({
      meta: { title: 't', themeId: 'x', masterId: 'y' },
      themes: [], masters: [], layouts: [],
      slides: [{ id: 'board', layoutId: 'blank', background: {}, elements: [], notes: [] }],
      guides: [],
    }),
  } as any;
}

describe('createBoardMinimap', () => {
  beforeEach(() => {
    // jsdom canvas getContext returns null; stub a minimal 2D context.
    (HTMLCanvasElement.prototype as any).getContext = vi.fn(() => ({
      setTransform: vi.fn(), clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(),
      strokeRect: vi.fn(), drawImage: vi.fn(), fillRect: vi.fn(),
      scale: vi.fn(), translate: vi.fn(), beginPath: vi.fn(), rect: vi.fn(),
      stroke: vi.fn(), fill: vi.fn(),
    }));
  });

  it('creates a root element and toggles visibility', () => {
    const mm = createBoardMinimap({
      store: fakeStore(),
      getHostSize: () => ({ w: 800, h: 600 }),
      onNavigate: vi.fn(),
      dpr: 1,
    });
    expect(mm.element).toBeInstanceOf(HTMLElement);
    const toggle = mm.element.querySelector('button');
    expect(toggle).not.toBeNull();
    // The panel (canvas host) is the div sibling of the toggle.
    const panel = mm.element.querySelector('div');
    expect(panel).not.toBeNull();

    // Visible by default; clicking the toggle hides the panel, clicking
    // again shows it — the assertion the title actually promises.
    expect((panel as HTMLElement).style.display).toBe('block');
    (toggle as HTMLButtonElement).click();
    expect((panel as HTMLElement).style.display).toBe('none');
    (toggle as HTMLButtonElement).click();
    expect((panel as HTMLElement).style.display).toBe('block');

    mm.dispose();
  });

  it('repaintScene / repaintViewport do not throw with an empty scene', () => {
    const mm = createBoardMinimap({
      store: fakeStore(),
      getHostSize: () => ({ w: 800, h: 600 }),
      onNavigate: vi.fn(),
      dpr: 1,
    });
    expect(() => {
      mm.repaintScene();
      mm.repaintViewport({ panX: 0, panY: 0, zoom: 1 });
    }).not.toThrow();
    mm.dispose();
  });
});
