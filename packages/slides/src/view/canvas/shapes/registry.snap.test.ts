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

describe('shape registry snapshot', () => {
  it('every registered builder produces stable Path2D ops at 100x100', () => {
    const sortedKinds = [...PATH_BUILDERS.keys()].sort();
    const log: Record<string, ReadonlyArray<unknown>> = {};
    for (const kind of sortedKinds) {
      const builder = PATH_BUILDERS.get(kind)!;
      const path = builder({ w: 100, h: 100 }, undefined) as unknown as TestPath2DLike;
      // Builders may leave a sub-path open; finalize() flushes it so
      // the recorded ops list is what `isPointInPath` would actually
      // walk. Without this the snapshot would omit any trailing
      // subpath that was never explicitly closed.
      path.finalize();
      log[kind] = path.ops;
    }
    expect(log).toMatchSnapshot();
  });
});
