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
 * Upper bound on the wait in {@link yieldToPaintedFrame}. One frame is 16 ms
 * at 60 Hz; this is long enough to cover a slow or heavily loaded compositor
 * and short enough to be imperceptible when it does fire.
 */
const PAINTED_FRAME_TIMEOUT_MS = 100;

/**
 * Resolve after the browser has actually painted a frame.
 *
 * `yieldToPaint()` only guarantees the task queue is drained — it gives the
 * browser an *opportunity* to render, which is enough between the repeated
 * units of an export loop, where a missed frame just lands on the next one.
 * It is not enough before a single long block: if that one macrotask lands
 * before the next rendering opportunity, whatever the caller put on screen
 * first never appears at all. Measured in Chromium, `yieldToPaint()` renders
 * zero frames ahead of a long synchronous block; this renders one.
 *
 * `requestAnimationFrame` fires immediately *before* a paint, so a macrotask
 * scheduled from inside it runs after that paint has been committed.
 *
 * The timeout is not belt-and-braces: browsers **pause** rAF entirely in a
 * backgrounded tab, and backgrounding is exactly what a user does when they
 * expect a wait. Without it the caller's work would never run at all. A
 * `setTimeout` is throttled but not paused there, so the work still lands —
 * unpainted, which is correct, since there is nothing to paint to. Also
 * covers environments with no rAF (Node, jsdom without `pretendToBeVisual`).
 */
export function yieldToPaintedFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') return yieldToPaint();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, PAINTED_FRAME_TIMEOUT_MS);
    requestAnimationFrame(() => {
      void yieldToPaint().then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  });
}
