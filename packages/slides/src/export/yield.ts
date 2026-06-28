/**
 * Resolve on the next macrotask so the browser can paint between heavy
 * synchronous export units (per-slide canvas raster, per-slide XML). A
 * `MessageChannel` macrotask avoids `setTimeout`'s ~4 ms clamp; falls back
 * to `setTimeout(0)` where `MessageChannel` is unavailable (older Node).
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
