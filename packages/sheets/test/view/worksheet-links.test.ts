import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import { RenderedLink } from '../../src/view/gridcanvas';
import { parseRef } from '../../src/model/core/coordinates';

/**
 * The hyperlink hover state machine and the click that opens a link.
 *
 * Both are driven against a hand-built `this`, the way `worksheet-mouse.test.ts`
 * and `gridcanvas-links.test.ts` already drive their handlers: the sheets view
 * suite runs in Vitest's node environment, and constructing a `Worksheet` wants
 * a DOM. What is exercised here is the arithmetic and the ordering, which is
 * where every one of these behaviors lives.
 */
type Proto = Record<string, (...args: never[]) => unknown>;
const proto = Worksheet.prototype as unknown as Proto;

type HoverCtx = {
  zoom: number;
  gridCanvas: {
    linkAt: (x: number, y: number) => RenderedLink | null;
    linksInCell: (sref: string) => Array<RenderedLink>;
  };
  toRefFromMouse: (x: number, y: number) => { r: number; c: number };
  hoveredLinkSref: string | null;
  hoveredLinkUrls: Array<string>;
  linkHoverTimer: ReturnType<typeof setTimeout> | null;
  pointerOverLink: boolean;
  onLinkHoverCallback: ReturnType<typeof vi.fn>;
  updateLinkHover(x: number, y: number): void;
  resetLinkHover(): void;
};

function link(sref: string, url: string, left = 100): RenderedLink {
  return { sref, left, top: 100, width: 50, height: 16, url };
}

/**
 * Builds the worksheet state `updateLinkHover` reads, over a fixed painted
 * layout: `hits` answers the point-hit lookup, `cells` the per-cell listing.
 */
function hoverCtx(
  hits: Array<RenderedLink>,
  cells: Record<string, Array<RenderedLink>>,
  at: { r: number; c: number } = { r: 5, c: 3 },
): HoverCtx {
  return {
    zoom: 1,
    gridCanvas: {
      linkAt: (x: number, y: number) =>
        hits.find(
          (each) =>
            x >= each.left &&
            x <= each.left + each.width &&
            y >= each.top &&
            y <= each.top + each.height,
        ) ?? null,
      linksInCell: (sref: string) => cells[sref] ?? [],
    },
    toRefFromMouse: () => at,
    hoveredLinkSref: null,
    hoveredLinkUrls: [],
    linkHoverTimer: null,
    pointerOverLink: false,
    onLinkHoverCallback: vi.fn(),
    linkAtMouse: proto.linkAtMouse,
    isInsideGrid: proto.isInsideGrid,
    clearLinkHoverTimer: proto.clearLinkHoverTimer,
    updateLinkHover: proto.updateLinkHover,
    resetLinkHover: proto.resetLinkHover,
  } as unknown as HoverCtx;
}

describe('updateLinkHover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits out the delay before opening the card', () => {
    const a = link('C5', 'https://example.com');
    const ctx = hoverCtx([a], { C5: [a] });

    ctx.updateLinkHover(120, 105);
    expect(ctx.pointerOverLink).toBe(true);
    // Sweeping across a column of links must not strobe a popover, so nothing
    // is emitted until the pointer has come to rest.
    expect(ctx.onLinkHoverCallback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(ctx.onLinkHoverCallback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(ctx.onLinkHoverCallback).toHaveBeenCalledWith({
      sref: 'C5',
      urls: ['https://example.com'],
    });
  });

  it('keeps the card open across the plain text between two links', () => {
    const a = link('C5', 'https://a.example', 100);
    const b = link('C5', 'https://b.example', 200);
    const ctx = hoverCtx([a, b], { C5: [a, b] });

    ctx.updateLinkHover(120, 105);
    vi.advanceTimersByTime(300);
    ctx.onLinkHoverCallback.mockClear();

    // The gap between the two spans hits no span at all, so without the
    // cell fallback the card would close and reopen while crossing it.
    ctx.updateLinkHover(180, 105);
    expect(ctx.pointerOverLink).toBe(false);
    vi.advanceTimersByTime(300);
    expect(ctx.onLinkHoverCallback).not.toHaveBeenCalled();
    expect(ctx.hoveredLinkSref).toBe('C5');
  });

  it('closes the old card before opening the next cell', () => {
    const a = link('C5', 'https://a.example', 100);
    const b = link('D5', 'https://b.example', 300);
    const ctx = hoverCtx([a, b], { C5: [a], D5: [b] });

    ctx.updateLinkHover(120, 105);
    vi.advanceTimersByTime(300);
    ctx.onLinkHoverCallback.mockClear();

    ctx.updateLinkHover(320, 105);
    // Emitted synchronously: otherwise the previous cell's URLs sit at the
    // previous cell's position until the new timer fires.
    expect(ctx.onLinkHoverCallback).toHaveBeenCalledExactlyOnceWith(null);

    vi.advanceTimersByTime(300);
    expect(ctx.onLinkHoverCallback).toHaveBeenLastCalledWith({
      sref: 'D5',
      urls: ['https://b.example'],
    });
  });

  it('refreshes a card whose cell was edited under the pointer', () => {
    const before = link('C5', 'https://a.example');
    const after = link('C5', 'https://b.example');
    const cells: Record<string, Array<RenderedLink>> = { C5: [before] };
    const ctx = hoverCtx([before], cells);

    ctx.updateLinkHover(120, 105);
    vi.advanceTimersByTime(300);
    ctx.onLinkHoverCallback.mockClear();

    // A collaborator replaces the destination. Same cell, same span geometry —
    // comparing by reference alone would leave the card listing a link that is
    // gone.
    cells.C5 = [after];
    ctx.updateLinkHover(120, 105);
    expect(ctx.onLinkHoverCallback).toHaveBeenCalledExactlyOnceWith(null);
    vi.advanceTimersByTime(300);
    expect(ctx.onLinkHoverCallback).toHaveBeenLastCalledWith({
      sref: 'C5',
      urls: ['https://b.example'],
    });
  });

  it('emits nothing while the pointer stays on the same links', () => {
    const a = link('C5', 'https://example.com');
    const ctx = hoverCtx([a], { C5: [a] });

    ctx.updateLinkHover(120, 105);
    vi.advanceTimersByTime(300);
    ctx.onLinkHoverCallback.mockClear();

    ctx.updateLinkHover(130, 106);
    ctx.updateLinkHover(140, 107);
    vi.advanceTimersByTime(300);
    expect(ctx.onLinkHoverCallback).not.toHaveBeenCalled();
  });

  it('ignores a cell over the headers', () => {
    const a = link('C5', 'https://example.com');
    // The pointer hits no span and sits over the row header, so the cell
    // fallback must not run — `toRefFromMouse` there is not a grid cell.
    const ctx = hoverCtx([a], { C5: [a] });
    ctx.updateLinkHover(10, 105);
    vi.advanceTimersByTime(300);
    expect(ctx.onLinkHoverCallback).not.toHaveBeenCalled();
    expect(ctx.hoveredLinkSref).toBeNull();
  });

  describe('resetLinkHover', () => {
    it('closes an open card and cancels a pending one', () => {
      const a = link('C5', 'https://example.com');
      const ctx = hoverCtx([a], { C5: [a] });

      ctx.updateLinkHover(120, 105);
      ctx.resetLinkHover();
      expect(ctx.onLinkHoverCallback).toHaveBeenCalledExactlyOnceWith(null);
      expect(ctx.linkHoverTimer).toBeNull();
      expect(ctx.pointerOverLink).toBe(false);

      // The cancelled timer must not fire afterwards.
      vi.advanceTimersByTime(300);
      expect(ctx.onLinkHoverCallback).toHaveBeenCalledTimes(1);
    });

    it('says nothing when no card was open', () => {
      const ctx = hoverCtx([], {});
      ctx.resetLinkHover();
      expect(ctx.onLinkHoverCallback).not.toHaveBeenCalled();
    });

    it('re-opens after a reset, rather than comparing equal to the old card', () => {
      const a = link('C5', 'https://example.com');
      const ctx = hoverCtx([a], { C5: [a] });

      ctx.updateLinkHover(120, 105);
      vi.advanceTimersByTime(300);
      ctx.resetLinkHover();
      ctx.onLinkHoverCallback.mockClear();

      ctx.updateLinkHover(120, 105);
      vi.advanceTimersByTime(300);
      expect(ctx.onLinkHoverCallback).toHaveBeenCalledExactlyOnceWith({
        sref: 'C5',
        urls: ['https://example.com'],
      });
    });
  });
});

type DownCtx = {
  readOnly: boolean;
  openLinksOnClick: boolean;
  zoom: number;
  gridCanvas: { linkAt: (x: number, y: number) => RenderedLink | null };
  detectFreezeHandle: () => null;
  detectHiddenIndicator: () => null;
  detectResizeEdge: () => null;
  detectFilterButton: () => null;
  resetLinkHover: ReturnType<typeof vi.fn>;
};

const handleMouseDown = proto.handleMouseDown as unknown as (
  this: DownCtx,
  e: MouseEvent,
) => Promise<void>;

/** The one span painted in these tests, at (100..150, 100..116). */
const HIT = link('C5', 'https://example.com');

function downCtx(overrides: Partial<DownCtx> = {}): DownCtx {
  return {
    readOnly: false,
    openLinksOnClick: false,
    zoom: 1,
    gridCanvas: {
      linkAt: (x: number, y: number) =>
        x >= HIT.left &&
        x <= HIT.left + HIT.width &&
        y >= HIT.top &&
        y <= HIT.top + HIT.height
          ? HIT
          : null,
    },
    detectFreezeHandle: () => null,
    detectHiddenIndicator: () => null,
    detectResizeEdge: () => null,
    detectFilterButton: () => null,
    resetLinkHover: vi.fn(),
    linkAtMouse: proto.linkAtMouse,
    isInsideGrid: proto.isInsideGrid,
    ...overrides,
  } as unknown as DownCtx;
}

function mouseDown(over: Partial<MouseEvent> = {}): MouseEvent {
  return {
    button: 0,
    detail: 1,
    ctrlKey: false,
    metaKey: false,
    offsetX: 120,
    offsetY: 105,
    preventDefault: vi.fn(),
    ...over,
  } as unknown as MouseEvent;
}

/**
 * Runs the handler far enough to settle the link branch.
 *
 * When it does not open a link the handler carries on into the selection
 * paths, which need a whole grid — so a rejection *is* the assertion that the
 * branch was declined, and only `window.open` is asserted on.
 */
async function press(ctx: DownCtx, e: MouseEvent): Promise<void> {
  await handleMouseDown.call(ctx, e).catch(() => {});
}

describe('handleMouseDown link opening', () => {
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    open = vi.fn();
    (globalThis as { window?: unknown }).window = { open };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('opens on a plain click for a read-only host that asked for it', async () => {
    const ctx = downCtx({ readOnly: true, openLinksOnClick: true });
    const e = mouseDown();
    await press(ctx, e);

    expect(open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
    expect(e.preventDefault).toHaveBeenCalled();
    // The card must go with the click, or it floats over the tab that opened.
    expect(ctx.resetLinkHover).toHaveBeenCalled();
  });

  it('leaves a plain click to selection on a read-only result grid', async () => {
    // datasource-view / lakehouse-view / revision-preview mount the engine
    // read-only without opting in: their click selects a cell to copy.
    await press(downCtx({ readOnly: true }), mouseDown());
    expect(open).not.toHaveBeenCalled();
  });

  it('leaves a plain click to selection for an editor', async () => {
    await press(downCtx(), mouseDown());
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
  ])('opens on %s+click for an editor', async (_label, mods) => {
    await press(downCtx(), mouseDown(mods));
    expect(open).toHaveBeenCalledWith(
      'https://example.com',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('opens once for a double-click, not twice', async () => {
    const ctx = downCtx({ readOnly: true, openLinksOnClick: true });
    await press(ctx, mouseDown({ detail: 1 }));
    // The second press of the double-click runs this handler again.
    await press(ctx, mouseDown({ detail: 2 }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('ignores a right click', async () => {
    await press(downCtx({ readOnly: true, openLinksOnClick: true }), mouseDown({ button: 2 }));
    expect(open).not.toHaveBeenCalled();
  });

  it('opens nothing where no span was painted', async () => {
    await press(
      downCtx({ readOnly: true, openLinksOnClick: true }),
      mouseDown({ offsetX: 400 }),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('ignores a click on the headers', async () => {
    // Guarded by `isInsideGrid`: even with a span reported everywhere, a press
    // on the row-header strip must not navigate.
    await press(
      downCtx({
        readOnly: true,
        openLinksOnClick: true,
        gridCanvas: { linkAt: () => HIT },
      }),
      mouseDown({ offsetX: 20, offsetY: 105 }),
    );
    expect(open).not.toHaveBeenCalled();
  });
});

/**
 * The keyboard route to a link. A viewer can reach the hover card only with a
 * pointer, so without this there is no keyboard access at all — and the grid
 * keymap is where it has to live, because the Alt+Enter that inserts a line
 * break belongs to the cell-input keymap.
 */
describe('activeCellLinks', () => {
  const activeCellLinks = (
    Worksheet.prototype as unknown as {
      activeCellLinks(): Array<string>;
    }
  ).activeCellLinks;

  function ctx(sref: string, links: Array<{ url: string }>) {
    return {
      sheet: { getActiveCell: () => parseRef(sref) },
      gridCanvas: {
        linksInCell: (asked: string) => (asked === sref ? links : []),
      },
    };
  }

  it('returns the destinations painted in the active cell', () => {
    expect(
      activeCellLinks.call(
        ctx('C5', [{ url: 'https://a.example.com' }, { url: 'https://b.example.com' }]),
      ),
    ).toEqual(['https://a.example.com', 'https://b.example.com']);
  });

  it('returns nothing for a cell with no links', () => {
    expect(activeCellLinks.call(ctx('C5', []))).toEqual([]);
  });

  it('returns nothing before a sheet is attached', () => {
    expect(activeCellLinks.call({ sheet: undefined })).toEqual([]);
  });
});

/**
 * A repaint can replace the hovered cell's destinations — a collaborator
 * editing the cell the pointer rests on — and no mouse move follows it, so
 * `updateLinkHover` never runs and the card would keep the old list.
 */
describe('refreshLinkHoverAfterRender', () => {
  const refresh = (
    Worksheet.prototype as unknown as {
      refreshLinkHoverAfterRender(): void;
    }
  ).refreshLinkHoverAfterRender;

  function ctx(opts: {
    sref: string | null;
    shown: Array<string>;
    painted: Array<string>;
    timer?: unknown;
  }) {
    const notified: Array<unknown> = [];
    return {
      notified,
      hoveredLinkSref: opts.sref,
      hoveredLinkUrls: opts.shown,
      linkHoverTimer: opts.timer ?? null,
      gridCanvas: { linksInCell: () => opts.painted.map((url) => ({ url })) },
      clearLinkHoverTimer() {
        this.linkHoverTimer = null;
      },
      onLinkHoverCallback: (info: unknown) => notified.push(info),
    };
  }

  it('re-sends the card when the destinations changed', () => {
    const c = ctx({ sref: 'C5', shown: ['https://old.example.com'], painted: ['https://new.example.com'] });
    refresh.call(c);
    expect(c.notified).toEqual([
      { sref: 'C5', urls: ['https://new.example.com'] },
    ]);
    expect(c.hoveredLinkUrls).toEqual(['https://new.example.com']);
  });

  it('says nothing when they are unchanged', () => {
    const c = ctx({ sref: 'C5', shown: ['https://x.example.com'], painted: ['https://x.example.com'] });
    refresh.call(c);
    expect(c.notified).toEqual([]);
  });

  it('closes the card when the cell lost its links', () => {
    const c = ctx({ sref: 'C5', shown: ['https://x.example.com'], painted: [] });
    refresh.call(c);
    expect(c.notified).toEqual([null]);
    expect(c.hoveredLinkSref).toBeNull();
  });

  it('leaves a pending card to its own timer, with the new list stored', () => {
    const c = ctx({
      sref: 'C5',
      shown: ['https://old.example.com'],
      painted: ['https://new.example.com'],
      timer: 1,
    });
    refresh.call(c);
    expect(c.notified).toEqual([]);
    expect(c.hoveredLinkUrls).toEqual(['https://new.example.com']);
  });

  it('does nothing when no cell is hovered', () => {
    const c = ctx({ sref: null, shown: [], painted: ['https://x.example.com'] });
    refresh.call(c);
    expect(c.notified).toEqual([]);
  });
});
