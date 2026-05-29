import { describe, it, expect } from 'vitest';
import { MemSlidesStore } from '../../src/store/memory';

describe('MemSlidesStore.setUnit', () => {
  it('defaults Meta.unit to undefined (read as inches)', () => {
    const store = new MemSlidesStore();
    expect(store.read().meta.unit).toBeUndefined();
  });

  it('setUnit("cm") writes the field', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.setUnit('cm'));
    expect(store.read().meta.unit).toBe('cm');
  });

  it('setUnit("in") writes the field', () => {
    const store = new MemSlidesStore();
    store.batch(() => store.setUnit('in'));
    expect(store.read().meta.unit).toBe('in');
  });

  it('setUnit throws on invalid value', () => {
    const store = new MemSlidesStore();
    expect(() =>
      store.batch(() => store.setUnit('px' as 'in')),
    ).toThrow(/invalid unit/i);
  });
});
