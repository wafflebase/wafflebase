// packages/docs/src/spell/session.ts
import type { SpellRouter } from './router.js';
import { tokenizeWords } from './tokenize.js';

export interface SpellError {
  blockId: string;
  start: number;
  end: number;
  word: string;
}

/** Minimal Doc surface SpellSession needs for replacement. */
export interface DocLike {
  deleteText(pos: { blockId: string; offset: number }, length: number): void;
  insertText(pos: { blockId: string; offset: number }, text: string): void;
}

interface RecheckOpts {
  composing?: boolean;
}

/** View-local spell state. Never serialized to the CRDT. */
export class SpellSession {
  errors: SpellError[] = [];
  private cache = new Map<string, boolean>(); // word → correct?
  private generation = 0;

  constructor(
    readonly router: SpellRouter,
    private opts: { snapshot?: () => void } = {},
  ) {}

  async recheckBlocks(
    blocks: Array<{ id: string; text: string }>,
    opts: RecheckOpts = {},
  ): Promise<void> {
    const gen = ++this.generation;
    if (opts.composing) {
      if (gen === this.generation) this.errors = [];
      return;
    }
    const next: SpellError[] = [];
    for (const block of blocks) {
      for (const tok of tokenizeWords(block.text)) {
        const correct = await this.isCorrect(tok.word);
        if (!correct) {
          next.push({ blockId: block.id, start: tok.start, end: tok.end, word: tok.word });
        }
      }
    }
    if (gen === this.generation) {
      this.errors = next;
    }
  }

  private async isCorrect(word: string): Promise<boolean> {
    const cached = this.cache.get(word);
    if (cached !== undefined) return cached;
    const correct = await this.router.check(word);
    this.cache.set(word, correct);
    return correct;
  }

  /**
   * Returns the error whose range contains `offset`.
   * The end bound is inclusive — an offset one past the last character of a
   * word still matches.
   */
  errorAt(blockId: string, offset: number): SpellError | undefined {
    return this.errors.find(
      (e) => e.blockId === blockId && offset >= e.start && offset <= e.end,
    );
  }

  replace(doc: DocLike, error: SpellError, correction: string): void {
    this.opts.snapshot?.();
    doc.deleteText({ blockId: error.blockId, offset: error.start }, error.end - error.start);
    doc.insertText({ blockId: error.blockId, offset: error.start }, correction);
  }
}
