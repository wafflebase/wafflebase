import type { SlideAnimation } from '../../model/presentation';

/**
 * Map each elementId to its 1-based playback position(s) in the slide's
 * animation sequence. An element that appears multiple times (multiple
 * animations) receives an array of all its positions in sequence order.
 *
 * @example
 * // animations = [{elementId:'a',...},{elementId:'b',...},{elementId:'a',...}]
 * // → Map { 'a' => [1, 3], 'b' => [2] }
 */
export function computeAnimationOrder(
  animations: readonly SlideAnimation[] | undefined,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  if (!animations) return result;
  for (let i = 0; i < animations.length; i++) {
    const { elementId } = animations[i];
    const positions = result.get(elementId);
    if (positions) {
      positions.push(i + 1);
    } else {
      result.set(elementId, [i + 1]);
    }
  }
  return result;
}
