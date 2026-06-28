// packages/docs/test/spell/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { SpellSession } from '../../src/spell/session.js';
import { SpellRouter } from '../../src/spell/router.js';
import type { Lang, SpellChecker } from '../../src/spell/spell-checker.js';

class FakeEn implements SpellChecker {
  supports(l: Lang) { return l === 'en'; }
  async check(w: string) { return w !== 'helllo' && w !== 'wrld'; }
  async suggest(w: string) { return w === 'helllo' ? ['hello'] : ['world']; }
}
const router = () => new SpellRouter([new FakeEn()]);

describe('SpellSession', () => {
  it('collects misspelled ranges across blocks', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([
      { id: 'b1', text: 'helllo there' },
      { id: 'b2', text: 'the wrld' },
    ]);
    expect(s.errors).toEqual([
      { blockId: 'b1', start: 0, end: 6, word: 'helllo' },
      { blockId: 'b2', start: 4, end: 8, word: 'wrld' },
    ]);
  });

  it('skips the word currently under the caret', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([{ id: 'b1', text: 'helllo there' }], {
      caret: { blockId: 'b1', offset: 3 }, // inside "helllo"
    });
    expect(s.errors).toEqual([]);
  });

  it('skips all blocks while composing', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([{ id: 'b1', text: 'helllo' }], { composing: true });
    expect(s.errors).toEqual([]);
  });

  it('hit-tests an offset to its error', async () => {
    const s = new SpellSession(router());
    await s.recheckBlocks([{ id: 'b1', text: 'helllo there' }]);
    expect(s.errorAt('b1', 2)?.word).toBe('helllo');
    expect(s.errorAt('b1', 8)).toBeUndefined();
  });

  it('replace() snapshots then deletes+inserts', () => {
    const snapshot = vi.fn();
    const s = new SpellSession(router(), { snapshot });
    const doc = { deleteText: vi.fn(), insertText: vi.fn() };
    s.replace(doc, { blockId: 'b1', start: 0, end: 6, word: 'helllo' }, 'hello');
    expect(snapshot).toHaveBeenCalledOnce();
    expect(doc.deleteText).toHaveBeenCalledWith({ blockId: 'b1', offset: 0 }, 6);
    expect(doc.insertText).toHaveBeenCalledWith({ blockId: 'b1', offset: 0 }, 'hello');
  });

  it('generation guard: second overlapping recheck wins', async () => {
    // A router that pauses on each check until manually flushed.
    const resolvers: Array<() => void> = [];
    const controlled = {
      check(word: string): Promise<boolean> {
        return new Promise<boolean>(resolve => {
          resolvers.push(() => resolve(word !== 'helllo'));
        });
      },
    };

    const s = new SpellSession(controlled as any);

    // First call: block containing a misspelling ("helllo").
    const p1 = s.recheckBlocks([{ id: 'b1', text: 'helllo' }]);
    // p1 is now suspended at the first router.check() await.

    // Second call supersedes the first before p1 resolves.
    const p2 = s.recheckBlocks([{ id: 'b1', text: 'good' }]);
    // p2 is suspended at its own router.check() await.

    // Flush all pending checks in order (p1's first, then p2's).
    const pending = resolvers.splice(0);
    pending.forEach(r => r());

    await Promise.all([p1, p2]);

    // Only the second call's result should be visible; p1 must not clobber it.
    expect(s.errors).toEqual([]);
  });

  it('caret exactly at word start or end suppresses that word', async () => {
    const s = new SpellSession(router());
    // "helllo" tokenizes to { start: 0, end: 6 }

    await s.recheckBlocks([{ id: 'b1', text: 'helllo' }], {
      caret: { blockId: 'b1', offset: 0 }, // at the very start of the word
    });
    expect(s.errors).toEqual([]);

    await s.recheckBlocks([{ id: 'b1', text: 'helllo' }], {
      caret: { blockId: 'b1', offset: 6 }, // one past the last char (inclusive end)
    });
    expect(s.errors).toEqual([]);
  });
});
