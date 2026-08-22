/**
 * Resolve on the next macrotask so the browser can paint between heavy
 * synchronous export units (per-page PDF paint). A `MessageChannel`
 * macrotask avoids `setTimeout`'s ~4 ms clamp; falls back to `setTimeout(0)`
 * where `MessageChannel` is unavailable (older Node).
 */
export function yieldToPaint(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
}

/**
 * Resolve after the browser has actually painted a frame.
 *
 * `yieldToPaint()` only guarantees the task queue is drained — it gives the
 * browser an *opportunity* to render, which is enough between the repeated
 * units of an export loop, where a missed frame just lands on the next one.
 * It is not enough before a single long block: if that one macrotask lands
 * before the next rendering opportunity, whatever the caller put on screen
 * first never appears at all.
 *
 * `requestAnimationFrame` fires immediately *before* a paint, so a macrotask
 * scheduled from inside it runs after that paint has been committed. Falls
 * back to a plain macrotask where rAF is unavailable (Node, jsdom without
 * `pretendToBeVisual`).
 */
export function yieldToPaintedFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') return yieldToPaint();
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      void yieldToPaint().then(resolve);
    });
  });
}
