import { describe, it, expect } from 'vitest';
import { Text as ReactText } from '@yorkie-js/react';
import { initialNotesRoot, noteUserColor } from './notes-document';

describe('initialNotesRoot', () => {
  it('creates content with the @yorkie-js/react Text class the provider recognizes', () => {
    // The Yorkie document runs through @yorkie-js/react's DocumentProvider,
    // whose bundled client.attach({ initialRoot }) recognizes CRDT values via
    // `instanceof` against ITS OWN Text class. @yorkie-js/sdk's Text is a
    // DIFFERENT class identity (sdk.Text !== react.Text), so a sdk Text is not
    // recognized and gets materialized as a plain CRDTObject { context, text }
    // — surfacing as the literal string {"context":null,"text":null} in the
    // editor. Content MUST therefore be created from @yorkie-js/react's Text.
    // (Detached Text: assert the instance only; calling .toString()/.edit()
    // before attach throws ErrNotInitialized.)
    const root = initialNotesRoot();
    expect(root.content).toBeInstanceOf(ReactText);
  });
});

describe('noteUserColor', () => {
  it('is deterministic for the same seed', () => {
    expect(noteUserColor('alice')).toBe(noteUserColor('alice'));
  });

  it('returns an hsl(...) string', () => {
    expect(noteUserColor('alice')).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
  });

  it('produces different hues for different seeds', () => {
    expect(noteUserColor('alice')).not.toBe(noteUserColor('bob'));
  });
});
