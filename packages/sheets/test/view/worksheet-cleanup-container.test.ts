// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

/**
 * A host re-mounts the engine into the *same* container on a tab switch or a
 * theme toggle, and a mount torn down while its `initialize` was still awaited
 * runs its `cleanup()` after the successor has already appended itself (the
 * `cancelled` branch in `sheet-view.tsx`). So teardown must remove this
 * worksheet's own nodes and nothing else — clearing the container wholesale
 * blanked the grid that had just mounted.
 */
describe('Worksheet cleanup', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
  });

  const cleanupOf = (worksheet: Worksheet) =>
    (worksheet as unknown as { cleanup: () => void }).cleanup();

  it('removes its own nodes from the host container', () => {
    const worksheet = new Worksheet(container, 'light', false);
    expect(container.children.length).toBeGreaterThan(0);

    cleanupOf(worksheet);

    expect(container.children.length).toBe(0);
  });

  it('leaves a successor mount sharing the container intact', () => {
    const superseded = new Worksheet(container, 'light', false);
    const supersededNodes = Array.from(container.children);

    const successor = new Worksheet(container, 'light', false);
    const successorNodes = Array.from(container.children).filter(
      (node) => !supersededNodes.includes(node),
    );
    expect(successorNodes.length).toBe(supersededNodes.length);

    cleanupOf(superseded);

    for (const node of supersededNodes) {
      expect(container.contains(node)).toBe(false);
    }
    for (const node of successorNodes) {
      expect(container.contains(node)).toBe(true);
    }

    cleanupOf(successor);
  });
});
