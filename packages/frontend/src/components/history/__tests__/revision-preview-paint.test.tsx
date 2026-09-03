import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RevisionPreview } from '../revision-preview';

/**
 * Both engines mounted here paint into a Canvas, and jsdom has no Canvas 2D
 * context (`HTMLCanvasElement.getContext` returns `null`), so no test in this
 * repo can assert that a pixel was written. What *is* assertable is one step
 * short of that: that the mount path **asks** for a first paint, and that the
 * resize path asks again even when the box it measured did not change.
 *
 * Both were found by driving the real components in headless Chromium against
 * captured revision snapshots, where the paint itself is observable:
 *
 * - slides came up with a correctly-sized but entirely transparent canvas and
 *   only appeared once the window was physically resized;
 * - sheets came up with **no canvas in the document at all**, and no resize
 *   brought one back.
 *
 * The two causes are unrelated, so they get one test each.
 */

// ---------------------------------------------------------------------------
// Slides: the editor handle is a spy, so "did the mount request a paint?" is
// observable. Everything else in the package stays real — `MemSlidesStore`
// and `deckSlideHeight` are what `SlidesPreview` drives the sizing off.
// ---------------------------------------------------------------------------

const slidesEditor = vi.hoisted(() => ({
  render: vi.fn(),
  markDirty: vi.fn(),
  setHostSize: vi.fn(),
  setViewport: vi.fn(),
  setCurrentSlide: vi.fn(),
  detach: vi.fn(),
}));

const initializeEditor = vi.hoisted(() => vi.fn(() => slidesEditor));

vi.mock('@wafflebase/slides', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wafflebase/slides')>()),
  initializeEditor,
}));

// ---------------------------------------------------------------------------
// Sheets: the stand-in reproduces the one behaviour of the real engine that
// causes the bug — `Worksheet.cleanup()` ends with
// `this.container.innerHTML = ''` (`packages/sheets/src/view/worksheet.ts`) —
// and resolves only when the test says so, which is what lets the test place
// a still-in-flight mount's teardown *after* the next mount has been built.
// ---------------------------------------------------------------------------

const sheetMounts = vi.hoisted(
  () =>
    [] as Array<{
      host: HTMLElement;
      marker: HTMLElement;
      settle: () => void;
    }>,
);

const initializeSheet = vi.hoisted(() =>
  vi.fn((host: HTMLElement) => {
    const marker = document.createElement('div');
    marker.dataset.sheetMount = String(sheetMounts.length);
    host.appendChild(marker);

    let settle = () => {};
    const promise = new Promise((resolve) => {
      settle = () =>
        resolve({
          cleanup: () => {
            host.innerHTML = '';
          },
        });
    });
    sheetMounts.push({ host, marker, settle });
    return promise;
  }),
);

vi.mock('@wafflebase/sheets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wafflebase/sheets')>()),
  initialize: initializeSheet,
}));

const getRevision = vi.fn();
vi.mock('@yorkie-js/react', () => ({
  useRevisions: () => ({
    getRevision,
    listRevisions: vi.fn().mockResolvedValue([]),
    createRevision: vi.fn().mockResolvedValue({ id: 'safety' }),
    restoreRevision: vi.fn().mockResolvedValue(undefined),
  }),
}));

const ONE_SLIDE_SNAPSHOT = JSON.stringify({
  meta: { title: 'Deck', themeId: 't', masterId: 'm' },
  themes: [],
  masters: [],
  layouts: [],
  slides: [{ id: 's1', layoutId: 'l', elements: [] }],
});

const SHEET_SNAPSHOT = JSON.stringify({
  tabs: { 'tab-1': { id: 'tab-1', name: 'Sheet1', type: 'sheet' } },
  tabOrder: ['tab-1'],
  sheets: {
    'tab-1': {
      cells: { 'r1|c1': { v: '1' } },
      rowOrder: ['r1'],
      colOrder: ['c1'],
      nextRowId: 2,
      nextColId: 2,
      rowHeights: {},
      colWidths: {},
      colStyles: {},
      rowStyles: {},
      conditionalFormats: [],
      dataValidations: [],
      merges: {},
      charts: {},
      images: {},
      comments: {},
      frozenRows: 0,
      frozenCols: 0,
    },
  },
});

function resolveWith(snapshot: string) {
  getRevision.mockResolvedValue({
    id: 'r1',
    label: 'v1',
    description: '',
    createdAt: new Date('2026-09-02T10:00:00Z'),
    snapshot,
  });
}

/** Captures the observer callbacks so a resize can be fired on demand. */
let resizeCallbacks: Array<() => void> = [];
const RealResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  resizeCallbacks = [];
  globalThis.ResizeObserver = class {
    constructor(cb: () => void) {
      resizeCallbacks.push(cb);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = RealResizeObserver;
  vi.clearAllMocks();
  sheetMounts.length = 0;
});

describe('SlidesPreview first paint', () => {
  // `initializeEditor` leaves the renderer's dirty flag reset once it has
  // painted, so nothing repaints until something marks it dirty again — and
  // the `ResizeObserver`'s *initial* observation runs `sizeTo()`, which
  // reassigns `canvas.width`/`canvas.height` and therefore clears the bitmap
  // that was just painted. This is the deck coming up blank in a real browser.
  it('asks the editor to repaint as part of mounting it', async () => {
    resolveWith(ONE_SLIDE_SNAPSHOT);
    render(
      <RevisionPreview
        revisionId="r1"
        type="slides"
        onRestore={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() => expect(initializeEditor).toHaveBeenCalledTimes(1));
    expect(slidesEditor.markDirty).toHaveBeenCalled();
    expect(slidesEditor.render).toHaveBeenCalled();
  });

  // `setHostSize` early-returns when the size is unchanged (`editor.ts`), which
  // is exactly what the initial observation delivers — so relying on it to
  // repaint after `sizeTo()` cleared the canvas leaves the surface blank until
  // the user physically changes the window size.
  it('repaints on a resize that measures the same box', async () => {
    resolveWith(ONE_SLIDE_SNAPSHOT);
    render(
      <RevisionPreview
        revisionId="r1"
        type="slides"
        onRestore={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    await waitFor(() => expect(initializeEditor).toHaveBeenCalledTimes(1));
    expect(resizeCallbacks.length).toBeGreaterThan(0);

    slidesEditor.markDirty.mockClear();
    slidesEditor.render.mockClear();

    // Every jsdom `getBoundingClientRect()` is the same all-zero box, so this
    // is the unchanged-size case by construction.
    for (const cb of resizeCallbacks) cb();

    const { hostWidth, hostHeight } = initializeEditor.mock
      .calls[0][0] as unknown as { hostWidth: number; hostHeight: number };
    expect(slidesEditor.setHostSize).toHaveBeenCalledWith(hostWidth, hostHeight);
    expect(slidesEditor.markDirty).toHaveBeenCalled();
    expect(slidesEditor.render).toHaveBeenCalled();
  });
});

describe('SheetPreview mount isolation', () => {
  // `initializeSheet` is async and its teardown is synchronous, so a cleanup
  // that fires while a mount is still in flight cannot cancel it — it can only
  // run later. Pointed at a container shared with the next mount, that late
  // teardown's `container.innerHTML = ''` takes the *next* mount's DOM with
  // it. React StrictMode drives that sequence on every dev mount
  // (effect → cleanup → effect), which is why the sheet preview came up with
  // no canvas in the document and no resize brought one back: the surviving
  // Spreadsheet painted into a detached canvas, and its own ResizeObserver
  // watched a detached element.
  it('survives a stale mount tearing down after the next one is built', async () => {
    resolveWith(SHEET_SNAPSHOT);
    render(
      <RevisionPreview
        revisionId="r1"
        type="sheet"
        onRestore={vi.fn()}
        onBack={vi.fn()}
      />,
      { wrapper: StrictMode },
    );

    // StrictMode runs the mount effect, tears it down, and runs it again.
    await waitFor(() => expect(sheetMounts.length).toBe(2));
    const [stale, live] = sheetMounts;
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(live.marker.isConnected).toBe(true);

    // The first mount finally resolves — after the second one already exists.
    stale.settle();
    await waitFor(() => expect(stale.marker.isConnected).toBe(false));

    expect(
      live.marker.isConnected,
      "the live mount's DOM was torn out by the stale mount's cleanup",
    ).toBe(true);
  });
});
