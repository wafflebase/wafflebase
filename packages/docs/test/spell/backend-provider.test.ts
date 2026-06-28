import { describe, it, expect, vi } from 'vitest';
import { BackendSpellProvider } from '../../src/spell/backend-provider.js';

function mockFetch(body: unknown) {
  return vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;
}

describe('BackendSpellProvider', () => {
  it('supports configured langs only', () => {
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: mockFetch({}) });
    expect(p.supports('ko')).toBe(true);
    expect(p.supports('en')).toBe(false);
  });
  it('checks a word via the endpoint', async () => {
    const f = mockFetch({ correct: false });
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: f });
    expect(await p.check('안뇽', 'ko')).toBe(false);
    expect(f).toHaveBeenCalledWith('/api/v1/spell/check', expect.objectContaining({ method: 'POST' }));
  });
  it('returns suggestions via the endpoint', async () => {
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: mockFetch({ suggestions: ['안녕'] }) });
    expect(await p.suggest('안뇽', 'ko')).toEqual(['안녕']);
  });
  it('fails open (treats as correct) on network error', async () => {
    const f = vi.fn(async () => { throw new Error('net'); }) as unknown as typeof fetch;
    const p = new BackendSpellProvider({ endpoint: '/api/v1/spell', fetchImpl: f });
    expect(await p.check('안뇽', 'ko')).toBe(true);
    expect(await p.suggest('안뇽', 'ko')).toEqual([]);
  });
});
