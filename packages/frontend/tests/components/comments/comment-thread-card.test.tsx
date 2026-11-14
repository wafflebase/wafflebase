import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentThreadCard } from '@/components/comments/components/CommentThreadCard';
import { createThread } from '@/components/comments/thread';
import type { CommentAnchor } from '@/types/comments';

const anchor: CommentAnchor = {
  kind: 'sheet-cell',
  tabId: 'tab1',
  rowId: 'r1',
  colId: 'c1',
};

function renderCard() {
  let n = 0;
  const id = () => `id-${++n}`;
  const thread = createThread(
    anchor,
    'hello',
    { userId: 'u1', username: 'alice' },
    id,
    id,
    () => 1_000,
  );
  return render(
    <CommentThreadCard
      thread={thread}
      currentUserId="u1"
      onReply={vi.fn()}
      onResolveToggle={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

describe('CommentThreadCard — Edit/Delete menu trigger', () => {
  it('stays in the Tab order instead of being visibility-hidden', () => {
    renderCard();
    const trigger = screen.getByRole('button', { name: 'More actions' });
    // `visibility: hidden` (the old `invisible`) removes an element from
    // the Tab order; a dimmed trigger keeps it reachable.
    for (let el: HTMLElement | null = trigger; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/(^|\s)invisible(\s|$)/);
    }
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });

  it('is shown at full strength and touch size on a coarse pointer', () => {
    renderCard();
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger.className).toContain('pointer-coarse:h-11');
    expect(trigger.parentElement!.className).toContain('pointer-coarse:opacity-100');
    expect(trigger.parentElement!.className).toContain('group-focus-within:opacity-100');
  });
});
