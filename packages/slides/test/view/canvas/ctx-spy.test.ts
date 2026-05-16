import { describe, it, expect } from 'vitest';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';

describe('createCtxSpy', () => {
  it('starts with canvas defaults', () => {
    const ctx = createCtxSpy();
    expect(ctx.fillStyle).toBe('#000000');
    expect(ctx.lineWidth).toBe(1);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('returns isolated spies — calls in one do not leak to another', () => {
    const a = createCtxSpy();
    const b = createCtxSpy();
    a.fillRect(0, 0, 10, 10);
    expect(a.fillRect).toHaveBeenCalledTimes(1);
    expect(b.fillRect).not.toHaveBeenCalled();
  });

  it('asCtx returns the same object (only the type changes)', () => {
    const spy = createCtxSpy();
    const ctx = asCtx(spy);
    ctx.fillRect(1, 2, 3, 4);
    expect(spy.fillRect).toHaveBeenCalledWith(1, 2, 3, 4);
  });
});
