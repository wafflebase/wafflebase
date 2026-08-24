/*
 * Pan and zoom, observed inside the frame and forwarded to the host.
 *
 * WHY IT LIVES HERE AND NOT ON AN OVERLAY. The host cannot see a wheel or a drag that
 * lands on an iframe. Covering the frame catches them and takes the component's own
 * interactions with it — no hover, no click, on the one thing the pane exists to show.
 * Listening inside and posting out keeps both.
 *
 * PAN IS MODAL OVER THE COMPONENT AND PLAIN OVER THE GROUND.
 *
 * A drag that starts ON the component belongs to it — a slider, a text selection — so
 * there it takes middle-button or space-held, which is what every canvas tool means by
 * panning. A drag that starts on the empty grid around it has nothing else it could
 * mean, and requiring a modifier there was the whole reason panning read as missing:
 * a canvas you drag is the first thing anyone tries, and this one answered only to a
 * middle button nobody reached for.
 *
 * The two are told apart by `data-wb-cell`, which `ComponentFrame` puts on the box
 * holding the component. Nothing else in the frame carries it, so "not in a cell" is
 * exactly "the ground".
 *
 * A plain wheel scrolls; only Ctrl/⌘ zooms, matching the browser's own gesture and
 * leaving a tall grid of variants scrollable.
 */
import type { ViewGesture } from './frame-protocol.ts';

export function installViewGestures(send: (m: ViewGesture) => void, signal?: AbortSignal): void {
  let space = false;
  let panning: { x: number; y: number } | null = null;

  addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'Space' && !space) {
        space = true;
        document.body.style.cursor = 'grab';
      }
    },
    { signal },
  );
  addEventListener(
    'keyup',
    (e) => {
      if (e.code === 'Space') {
        space = false;
        document.body.style.cursor = '';
      }
    },
    { signal },
  );

  /** Did this gesture start on the empty ground rather than on the component? */
  const onGround = (e: PointerEvent) =>
    !(e.target instanceof Element) || !e.target.closest('[data-wb-cell]');

  addEventListener(
    'pointerdown',
    (e) => {
      const modal = e.button === 1 || (space && e.button === 0);
      // A plain left-drag pans only from the ground; over the component it is the
      // component's own gesture and must pass through untouched.
      if (!modal && !(e.button === 0 && onGround(e))) return;
      e.preventDefault();
      panning = { x: e.clientX, y: e.clientY };
      document.body.style.cursor = 'grabbing';
    },
    { capture: true, signal },
  );

  addEventListener(
    'pointermove',
    (e) => {
      if (!panning) return;
      send({ type: 'wb:view', kind: 'pan', dx: e.clientX - panning.x, dy: e.clientY - panning.y, x: e.clientX, y: e.clientY });
      panning = { x: e.clientX, y: e.clientY };
    },
    { signal },
  );

  const stop = () => {
    panning = null;
    document.body.style.cursor = space ? 'grab' : '';
  };
  addEventListener('pointerup', stop, { signal });
  addEventListener('pointercancel', stop, { signal });

  addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      // Also stops the BROWSER zooming the whole editor, which is what a ctrl-wheel
      // does by default and is never what someone zooming a preview meant.
      e.preventDefault();
      send({ type: 'wb:view', kind: 'zoom', dx: 0, dy: e.deltaY, x: e.clientX, y: e.clientY });
    },
    { passive: false, signal },
  );
}
