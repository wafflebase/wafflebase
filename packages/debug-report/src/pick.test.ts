import { beforeEach, describe, expect, it } from 'vitest';
import type { Rect } from '@wafflebase/core/geometry';
import {
  describeElement,
  isPlausibleTarget,
  describeSelector,
  domInventory,
  domTarget,
  FALLBACK_REGION,
  isMeaningful,
  nearestTestId,
  onCanvas,
  promote,
  regionAround,
  textExcerpt,
} from './pick';

/**
 * jsdom reports every `getBoundingClientRect` as zeroes, so boxes are injected.
 * Keyed by `data-box="x,y,w,h"` on the element itself, which keeps the fixture
 * and its geometry in one place.
 */
const boxOf = (el: Element): Rect => {
  const raw = el.getAttribute('data-box');
  if (!raw) return { x: 0, y: 0, w: 0, h: 0 };
  const [x, y, w, h] = raw.split(',').map(Number);
  return { x, y, w, h };
};

const mount = (html: string) => {
  document.body.innerHTML = html;
  return document.body;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('promote', () => {
  it('returns the control when the pointer landed on a glyph inside it', () => {
    // Measured: aiming at the theme toggle resolved to `svg.lucide-sun`.
    mount('<button class="inline-flex"><svg class="lucide lucide-sun"><path/></svg></button>');
    const glyph = document.querySelector('path')!;
    expect(promote(glyph).tagName).toBe('BUTTON');
  });

  it('returns a labelled element even when it is not interactive', () => {
    mount('<div aria-label="Toolbar"><span><b id="deep">x</b></span></div>');
    expect(promote(document.querySelector('#deep')!).getAttribute('aria-label')).toBe('Toolbar');
  });

  it('returns the element itself when nothing meaningful is within reach', () => {
    // The canvas case: promotion finds nothing, and the caller must NOT fall
    // back to the container — that is what produced a photograph of the whole
    // sheet instead of a cell.
    mount('<div><div><div><span id="leaf">x</span></div></div></div>');
    const leaf = document.querySelector('#leaf')!;
    expect(promote(leaf)).toBe(leaf);
    expect(isMeaningful(promote(leaf))).toBe(false);
  });

  it('stops climbing at the depth limit', () => {
    mount('<button><i><i><i><i><i><i><i><span id="far">x</span></i></i></i></i></i></i></i></button>');
    expect(promote(document.querySelector('#far')!).tagName).not.toBe('BUTTON');
  });
});

describe('describeSelector', () => {
  it('short-circuits on an id', () => {
    mount('<div class="a"><span id="target">x</span></div>');
    expect(describeSelector(document.querySelector('#target')!)).toBe('#target');
  });

  it('short-circuits on a data-testid, which is a real seam in this repo', () => {
    mount('<div><span data-testid="cell-editor">x</span></div>');
    expect(describeSelector(document.querySelector('span')!)).toBe('[data-testid="cell-editor"]');
  });

  it('drops state and arbitrary-value utility classes', () => {
    mount('<button class="hover:bg-red-500 w-[42px] inline-flex items-center">x</button>');
    expect(describeSelector(document.querySelector('button')!)).toBe(
      'button.inline-flex.items-center',
    );
  });

  it('names ancestors up to the depth limit', () => {
    mount('<main><section><div><button>x</button></div></section></main>');
    expect(describeSelector(document.querySelector('button')!).split(' > ')).toHaveLength(4);
  });
});

describe('textExcerpt', () => {
  it('collapses whitespace', () => {
    mount('<button>  Bold \n  text </button>');
    expect(textExcerpt(document.querySelector('button')!)).toBe('Bold text');
  });

  it('truncates with an ellipsis', () => {
    mount(`<button>${'a'.repeat(200)}</button>`);
    const text = textExcerpt(document.querySelector('button')!)!;
    expect(text).toHaveLength(121);
    expect(text.endsWith('…')).toBe(true);
  });

  it('is undefined for an element with no text', () => {
    mount('<button><svg/></button>');
    expect(textExcerpt(document.querySelector('button')!)).toBeUndefined();
  });
});

describe('nearestTestId', () => {
  it('finds one on an ancestor', () => {
    mount('<div data-testid="toolbar"><button><span id="t">x</span></button></div>');
    expect(nearestTestId(document.querySelector('#t')!)).toBe('toolbar');
  });

  it('is undefined when there is none', () => {
    mount('<div><button>x</button></div>');
    expect(nearestTestId(document.querySelector('button')!)).toBeUndefined();
  });
});

describe('domTarget', () => {
  it('carries the selector, tag, test id, text and box', () => {
    mount('<div data-testid="toolbar"><button data-box="10,20,32,32">Bold</button></div>');
    const target = domTarget(document.querySelector('button')!, boxOf);
    expect(target).toEqual({
      kind: 'dom',
      // The ancestor's `data-testid` short-circuits the path, which is the
      // point of preferring it over class soup.
      selector: '[data-testid="toolbar"] > button',
      tag: 'button',
      testId: 'toolbar',
      text: 'Bold',
      rect: { x: 10, y: 20, w: 32, h: 32 },
    });
  });

  it('omits the optional fields rather than carrying empty ones', () => {
    mount('<button data-box="0,0,10,10"><svg/></button>');
    const target = domTarget(document.querySelector('button')!, boxOf);
    expect('text' in target).toBe(false);
    expect('testId' in target).toBe(false);
  });
});

describe('onCanvas', () => {
  const canvases = [{ box: { x: 0, y: 100, w: 200, h: 100 } }];

  it('is true inside, including on the boundary', () => {
    expect(onCanvas({ x: 50, y: 150 }, canvases)).toBe(true);
    expect(onCanvas({ x: 0, y: 100 }, canvases)).toBe(true);
    expect(onCanvas({ x: 200, y: 200 }, canvases)).toBe(true);
  });

  it('is false outside, and false with no canvases at all', () => {
    expect(onCanvas({ x: 50, y: 50 }, canvases)).toBe(false);
    expect(onCanvas({ x: 50, y: 150 }, [])).toBe(false);
  });

  it('ignores a zero-sized canvas', () => {
    expect(onCanvas({ x: 0, y: 0 }, [{ box: { x: 0, y: 0, w: 0, h: 0 } }])).toBe(false);
  });
});

describe('domInventory', () => {
  it('lists the elements a region overlaps, smallest first', () => {
    // The `/login` case: a region over pure DOM must come back with something
    // an agent can grep for, not just coordinates.
    mount(`
      <div data-box="0,0,1000,800">
        <button data-box="10,10,80,30">Sign in</button>
        <a data-box="10,50,200,20" href="#">Forgot password?</a>
        <input data-box="10,90,300,40" aria-label="Email" />
      </div>
    `);
    const items = domInventory({ x: 0, y: 0, w: 400, h: 200 }, { boxOf });
    // The wrapping `div` is absent on purpose: it matches nothing in
    // `MEANINGFUL_SELECTOR`, and a page shell is not a thing anyone aimed at.
    expect(items.map((i) => i.tag)).toEqual(['button', 'a', 'input']);
    expect(items[0]).toMatchObject({ tag: 'button', text: 'Sign in' });
  });

  it('skips elements the region misses', () => {
    mount(`
      <button data-box="0,0,50,50">near</button>
      <button data-box="900,900,50,50">far</button>
    `);
    const items = domInventory({ x: 0, y: 0, w: 100, h: 100 }, { boxOf });
    expect(items.map((i) => i.text)).toEqual(['near']);
  });

  it('caps the list', () => {
    const many = Array.from(
      { length: 30 },
      (_, i) => `<button data-box="0,${i},10,10">b${i}</button>`,
    ).join('');
    mount(many);
    expect(domInventory({ x: 0, y: 0, w: 100, h: 100 }, { boxOf, limit: 5 })).toHaveLength(5);
  });

  it('ignores zero-sized elements, which are the ones jsdom would flood it with', () => {
    mount('<button>no box</button>');
    expect(domInventory({ x: 0, y: 0, w: 100, h: 100 }, { boxOf })).toEqual([]);
  });
});

describe('describeElement', () => {
  it('describes one element the same way the inventory does', () => {
    mount('<button data-box="1,2,3,4">Save</button>');
    expect(describeElement(document.querySelector('button')!, boxOf)).toEqual({
      selector: 'button',
      tag: 'button',
      text: 'Save',
      rect: { x: 1, y: 2, w: 3, h: 4 },
    });
  });
});

describe('regionAround', () => {
  const viewport = { w: 1280, h: 800 };

  it('centres the region on the point', () => {
    expect(regionAround({ x: 640, y: 400 }, FALLBACK_REGION, viewport)).toEqual({
      x: 640 - FALLBACK_REGION.w / 2,
      y: 400 - FALLBACK_REGION.h / 2,
      w: FALLBACK_REGION.w,
      h: FALLBACK_REGION.h,
    });
  });

  it('clamps at the edges so the capture is not mostly nothing', () => {
    expect(regionAround({ x: 2, y: 2 }, FALLBACK_REGION, viewport)).toMatchObject({ x: 0, y: 0 });
    const corner = regionAround({ x: 1279, y: 799 }, FALLBACK_REGION, viewport);
    expect(corner.x + corner.w).toBe(viewport.w);
    expect(corner.y + corner.h).toBe(viewport.h);
  });

  it('shrinks to fit a viewport smaller than the region', () => {
    expect(regionAround({ x: 50, y: 50 }, FALLBACK_REGION, { w: 100, h: 60 })).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 60,
    });
  });
});

describe('isPlausibleTarget', () => {
  const viewport = { w: 1280, h: 800 };

  it('accepts a control-sized box', () => {
    expect(isPlausibleTarget({ w: 32, h: 32 }, viewport)).toBe(true);
    expect(isPlausibleTarget({ w: 420, h: 96 }, viewport)).toBe(true);
  });

  it('rejects a page-sized box', () => {
    // Measured: `main[data-testid="hunt-harness-root"]` at 1280×800 matched the
    // promotion selector and produced a 61 KB photograph of the whole page.
    expect(isPlausibleTarget({ w: 1280, h: 800 }, viewport)).toBe(false);
  });

  it('accepts an unmeasured box, because this guard is only about size', () => {
    // Turning "not measured" into "not reportable" would silently downgrade
    // every DOM pick to a region wherever layout had not settled.
    expect(isPlausibleTarget({ w: 0, h: 40 }, viewport)).toBe(true);
  });

  it('accepts anything when the viewport is unmeasurable', () => {
    // jsdom, and any environment mid-layout: refusing everything there would
    // turn "no measurement" into "no report".
    expect(isPlausibleTarget({ w: 100, h: 100 }, { w: 0, h: 0 })).toBe(true);
  });

  it('honours an explicit fraction', () => {
    expect(isPlausibleTarget({ w: 640, h: 400 }, viewport, 0.2)).toBe(false);
    expect(isPlausibleTarget({ w: 640, h: 400 }, viewport, 0.3)).toBe(true);
  });
});

describe('domInventory · excluding the reporting tool', () => {
  it('never describes the overlay’s own chrome', () => {
    // The overlay is `inset: 0` and carries a test id, so it matched the
    // promotion selector and intersected every possible region — every DOM
    // report came back partly describing the reporter's own instrument.
    mount(`
      <div data-wb-debug="" data-testid="debug-overlay" data-box="0,0,1280,800">
        <button data-box="16,760,120,24">debug badge</button>
      </div>
      <button data-box="10,10,80,30">Sign in</button>
    `);
    const items = domInventory({ x: 0, y: 0, w: 400, h: 800 }, { boxOf });
    expect(items.map((i) => i.text)).toEqual(['Sign in']);
  });

  it('still describes an element that merely mentions debug in its text', () => {
    mount('<button data-box="10,10,80,30">Open debug menu</button>');
    expect(domInventory({ x: 0, y: 0, w: 200, h: 200 }, { boxOf })).toHaveLength(1);
  });
});
