// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showAdjustmentTooltip, hideAdjustmentTooltip } from '../../../src/view/editor/adjustment-tooltip';

describe('adjustment tooltip', () => {
  let overlay: HTMLDivElement;
  beforeEach(() => {
    overlay = document.createElement('div');
    document.body.appendChild(overlay);
  });

  afterEach(() => {
    hideAdjustmentTooltip();
    overlay.remove();
  });

  it('reattaches the tooltip after the overlay is wiped', () => {
    showAdjustmentTooltip(overlay, 100, 100, 1, '10%');
    expect(overlay.querySelector('.wfb-slides-adjust-tooltip')).not.toBeNull();

    // Simulate renderOverlay clearing the overlay (the bug trigger).
    overlay.innerHTML = '';
    expect(overlay.querySelector('.wfb-slides-adjust-tooltip')).toBeNull();

    // Next show call should re-append.
    showAdjustmentTooltip(overlay, 110, 110, 1, '12%');
    expect(overlay.querySelector('.wfb-slides-adjust-tooltip')).not.toBeNull();
    expect(overlay.querySelector('.wfb-slides-adjust-tooltip')?.textContent).toBe('12%');
  });

  it('hideAdjustmentTooltip removes the element from DOM', () => {
    showAdjustmentTooltip(overlay, 100, 100, 1, '10%');
    hideAdjustmentTooltip();
    expect(overlay.querySelector('.wfb-slides-adjust-tooltip')).toBeNull();
  });
});
