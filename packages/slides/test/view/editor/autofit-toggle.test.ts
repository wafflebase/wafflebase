// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderOverlay } from '../../../src/view/editor/overlay';
import type { ShapeElement, TextElement } from '../../../src/model/element';

function textEl(autofit?: 'none' | 'shrink' | 'grow'): TextElement {
  return {
    id: 't1',
    type: 'text',
    frame: { x: 100, y: 200, w: 300, h: 80, rotation: 0 },
    data: {
      blocks: [],
      ...(autofit ? { autofit } : {}),
    },
  };
}

function shapeEl(): ShapeElement {
  return {
    id: 's1',
    type: 'shape',
    frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
    data: { kind: 'rect' },
  };
}

function makeOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  document.body.appendChild(overlay);
  return overlay;
}

const baseOpts = { scale: 1, slideWidth: 1920, slideHeight: 1080 };

describe('autofit toggle', () => {
  it('renders a toggle button at the frame bottom-left for a single text element', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [textEl('grow')], {
      ...baseOpts,
      onAutofitToggle: vi.fn(),
    });
    const btn = overlay.querySelector('.wfb-slides-autofit-toggle') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    // Bottom-left of frame (100, 200+80=280) + a small offset below.
    expect(btn!.style.left).toBe('100px');
    expect(parseInt(btn!.style.top, 10)).toBeGreaterThanOrEqual(280);
  });

  it('clicking the toggle on a none element advances to shrink', () => {
    const overlay = makeOverlay();
    const onToggle = vi.fn();
    renderOverlay(overlay, [textEl('none')], { ...baseOpts, onAutofitToggle: onToggle });
    const btn = overlay.querySelector('.wfb-slides-autofit-toggle') as HTMLButtonElement;
    btn.click();
    expect(onToggle).toHaveBeenCalledWith('t1', 'shrink');
  });

  it('clicking the toggle on a shrink element advances to grow', () => {
    const overlay = makeOverlay();
    const onToggle = vi.fn();
    renderOverlay(overlay, [textEl('shrink')], { ...baseOpts, onAutofitToggle: onToggle });
    const btn = overlay.querySelector('.wfb-slides-autofit-toggle') as HTMLButtonElement;
    btn.click();
    expect(onToggle).toHaveBeenCalledWith('t1', 'grow');
  });

  it('clicking the toggle on a grow element wraps to none', () => {
    const overlay = makeOverlay();
    const onToggle = vi.fn();
    renderOverlay(overlay, [textEl('grow')], { ...baseOpts, onAutofitToggle: onToggle });
    const btn = overlay.querySelector('.wfb-slides-autofit-toggle') as HTMLButtonElement;
    btn.click();
    expect(onToggle).toHaveBeenCalledWith('t1', 'none');
  });

  it('treats absent autofit as grow (next click wraps to none)', () => {
    const overlay = makeOverlay();
    const onToggle = vi.fn();
    renderOverlay(overlay, [textEl(/* absent */)], { ...baseOpts, onAutofitToggle: onToggle });
    const btn = overlay.querySelector('.wfb-slides-autofit-toggle') as HTMLButtonElement;
    btn.click();
    expect(onToggle).toHaveBeenCalledWith('t1', 'none');
  });

  it('does not render the toggle for non-text elements', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [shapeEl()], { ...baseOpts, onAutofitToggle: vi.fn() });
    expect(overlay.querySelector('.wfb-slides-autofit-toggle')).toBeNull();
  });

  it('does not render the toggle when no onAutofitToggle callback is provided', () => {
    const overlay = makeOverlay();
    renderOverlay(overlay, [textEl('grow')], baseOpts);
    expect(overlay.querySelector('.wfb-slides-autofit-toggle')).toBeNull();
  });

  it('stops pointerdown / mousedown / click propagation so the editor does not clear selection', () => {
    // Regression: the editor attaches a pointerdown listener on the overlay
    // itself that runs hit-test → select-or-clear. The toggle sits BELOW the
    // frame, so without propagation guards the click is treated as a click on
    // empty space and clears the selection of the very element we're toggling.
    const overlay = makeOverlay();
    renderOverlay(overlay, [textEl('grow')], { ...baseOpts, onAutofitToggle: vi.fn() });
    const btn = overlay.querySelector('.wfb-slides-autofit-toggle') as HTMLButtonElement;

    const overlaySpy = vi.fn();
    overlay.addEventListener('pointerdown', overlaySpy);
    overlay.addEventListener('mousedown', overlaySpy);
    overlay.addEventListener('click', overlaySpy);

    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btn.click();

    expect(overlaySpy).not.toHaveBeenCalled();
  });

  it('does not render the toggle when multiple elements are selected', () => {
    const overlay = makeOverlay();
    const t2: TextElement = { ...textEl('shrink'), id: 't2' };
    renderOverlay(overlay, [textEl('grow'), t2], {
      ...baseOpts,
      onAutofitToggle: vi.fn(),
    });
    expect(overlay.querySelector('.wfb-slides-autofit-toggle')).toBeNull();
  });
});
