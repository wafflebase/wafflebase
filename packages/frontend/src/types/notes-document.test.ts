import { describe, it, expect } from 'vitest';
import { Text } from '@yorkie-js/sdk';
import { initialNotesRoot } from './notes-document';

describe('initialNotesRoot', () => {
  it('creates a Text content field for client.attach to seed', () => {
    const root = initialNotesRoot();
    // NOTE: a detached yorkie.Text throws ErrNotInitialized if you call its
    // methods (edit/toString) before client.attach seeds it inside a doc.
    // So assert the instance, do NOT call .toString() here (verified in the
    // Task 2 spike). The real content round-trip is covered by the
    // YorkieNoteStore test (Task 9), which drives an attached Document.
    expect(root.content).toBeInstanceOf(Text);
  });
});
