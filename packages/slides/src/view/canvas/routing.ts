export type Point = { x: number; y: number };
export type SegmentPath = { points: Point[] };

export function routeStraight(a: Point, b: Point): SegmentPath {
  return { points: [{ ...a }, { ...b }] };
}
