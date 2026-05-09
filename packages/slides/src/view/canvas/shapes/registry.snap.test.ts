import { describe, it, expect } from 'vitest';
import '../test-canvas-env';
import { PATH_BUILDERS } from './index';

/**
 * Registry-wide regression guard. Every registered path builder is
 * invoked at a fixed 100×100 frame and the resulting Path2D's recorded
 * operations (rect / ellipse / subpath polylines / arcs flattened to
 * segments) are pinned to a snapshot.
 *
 * If a builder's geometry shifts — even by a pixel — the snapshot
 * diff makes the change explicit. Updates require running with `-u`.
 *
 * The shim's `TestPath2D` (installed by `test-canvas-env`) exposes
 * `.ops` and a `finalize()` that flushes any pending sub-path. We
 * reach through `unknown` because the production `Path2D` typings do
 * not advertise either field.
 */
type TestPath2DLike = {
  ops: ReadonlyArray<unknown>;
  finalize: () => void;
};

/**
 * Round all numeric leaves in an object/array tree to 6 decimal
 * places. The shim's polyline approximation of arcs / beziers walks
 * trig functions (`Math.sin` / `Math.cos`) whose final-ULP results
 * vary across CPU microarchitectures (Apple Silicon vs Linux x86_64
 * GitHub runners), and that variance leaks into snapshot string
 * representations like `6.005165928857689` vs `6.005165928857686`.
 * Six-decimal rounding pins the snapshot to micrometer-level
 * precision — geometric regressions stay visible, ULP noise does not.
 */
function quantize(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : value;
  }
  if (Array.isArray(value)) return value.map(quantize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = quantize(v);
    return out;
  }
  return value;
}

describe('shape registry snapshot', () => {
  it('every registered builder produces stable Path2D ops at 100x100', () => {
    const sortedKinds = [...PATH_BUILDERS.keys()].sort();
    const log: Record<string, unknown> = {};
    for (const kind of sortedKinds) {
      const builder = PATH_BUILDERS.get(kind)!;
      const path = builder({ w: 100, h: 100 }, undefined) as unknown as TestPath2DLike;
      // Builders may leave a sub-path open; finalize() flushes it so
      // the recorded ops list is what `isPointInPath` would actually
      // walk. Without this the snapshot would omit any trailing
      // subpath that was never explicitly closed.
      path.finalize();
      log[kind] = quantize(path.ops);
    }
    expect(log).toMatchSnapshot();
  });
});
