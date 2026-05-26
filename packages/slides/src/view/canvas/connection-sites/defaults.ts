import type { ConnectionSite } from '../../../model/connection-site';
import { DIR_E, DIR_N, DIR_S, DIR_W } from '../../../model/connection-site';

/** N / E / S / W mid-edge connection points, in fixed order. */
export const FOUR_CARDINAL: readonly ConnectionSite[] = Object.freeze([
  Object.freeze({ x: 0.5, y: 0,   angle: DIR_N }),  // 0: N
  Object.freeze({ x: 1,   y: 0.5, angle: DIR_E }),  // 1: E
  Object.freeze({ x: 0.5, y: 1,   angle: DIR_S }),  // 2: S
  Object.freeze({ x: 0,   y: 0.5, angle: DIR_W }),  // 3: W
]) as readonly ConnectionSite[];

export function fourCardinal(): readonly ConnectionSite[] {
  return FOUR_CARDINAL;
}
