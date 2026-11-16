import { describe, it, expect } from 'vitest';
import { noteCodeLanguage } from './code-languages.js';
import { packs } from './code-language-packs.js';

describe('noteCodeLanguage', () => {
  it('matches the first word of the info string exactly', () => {
    expect(noteCodeLanguage('ts')?.name).toBe('typescript');
    expect(noteCodeLanguage('Py')?.name).toBe('python');
    expect(noteCodeLanguage('  bash  ')?.name).toBe('shell');
    expect(noteCodeLanguage('ts title="a.ts"')?.name).toBe('typescript');
  });

  it('does not claim a language by substring', () => {
    // The default fuzzy lookup found `sql` inside `graphql`.
    expect(noteCodeLanguage('graphql')).toBeNull();
    expect(noteCodeLanguage('typescript-old')).toBeNull();
    expect(noteCodeLanguage('')).toBeNull();
  });

  it('loads a working grammar for every pack', async () => {
    for (const name of Object.keys(packs)) {
      const desc = noteCodeLanguage(name);
      expect(desc?.name, name).toBe(name);
      const support = await desc!.load();
      expect(support.language, name).toBeTruthy();
    }
  });
});
