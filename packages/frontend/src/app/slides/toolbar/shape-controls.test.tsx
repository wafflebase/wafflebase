import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Element, SlidesEditor, SlidesStore } from '@wafflebase/slides';
import { ShapeControls } from './shape-controls';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * `BorderPicker` only ever sees a `Stroke | undefined`, so it cannot
 * distinguish "this shape has no border" from "this connector is drawn
 * with the renderer's default". That resolution happens here, in the one
 * place that knows the element's type — which is why these cases live in
 * `shape-controls`' tests rather than the picker's.
 */
function renderControls(element: Element) {
  const store = {
    read: () => ({
      slides: [{ id: 's1', elements: [element] }],
      meta: { recentColors: [] },
    }),
  } as unknown as SlidesStore;
  const editor = { getCurrentSlideId: () => 's1' } as unknown as SlidesEditor;

  render(
    <TooltipProvider>
      <ShapeControls editor={editor} store={store} ids={[element.id]} />
    </TooltipProvider>,
  );
}

async function openWeight() {
  await userEvent.click(screen.getByRole('button', { name: /border weight/i }));
}

function checked(name: string) {
  return screen
    .getByRole('menuitemcheckbox', { name })
    .getAttribute('aria-checked');
}

describe('ShapeControls border state', () => {
  it('reports a strokeless connector as the 2px line it is drawn as', async () => {
    // `parseCxnSp` omits `stroke` whenever the `<a:ln>` carries no
    // `<a:solidFill>` — the normal shape of a PowerPoint connector whose
    // color comes from `<p:style><a:lnRef>`. The canvas still paints it
    // via `DEFAULT_CONNECTOR_STROKE`, so "No border" would be a lie
    // about a line the user can see.
    renderControls({
      id: 'c1',
      type: 'connector',
      frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
      routing: 'straight',
      start: { kind: 'free', x: 0, y: 0 },
      end: { kind: 'free', x: 10, y: 10 },
      arrowheads: {},
    } as unknown as Element);

    await openWeight();
    expect(checked('2px')).toBe('true');
    expect(checked('No border')).toBe('false');
  });

  it('reports a strokeless shape as having no border', async () => {
    // The default for every `filled` insert kind — and here the absence
    // is real, because nothing paints an edge.
    renderControls({
      id: 'r1',
      type: 'shape',
      frame: { x: 0, y: 0, w: 10, h: 10, rotation: 0 },
      data: { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } },
    } as unknown as Element);

    await openWeight();
    expect(checked('No border')).toBe('true');
    expect(checked('2px')).toBe('false');
  });
});
