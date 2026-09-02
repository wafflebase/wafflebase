import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RevisionPreview } from '../revision-preview';

const getRevision = vi.fn();
vi.mock('@yorkie-js/react', () => ({ useRevisions: () => ({ getRevision }) }));

describe('RevisionPreview', () => {
  it('announces that this is a past version, with its time', async () => {
    getRevision.mockResolvedValue({
      id: 'r1', label: 'v1', description: '', createdAt: new Date('2026-09-02T10:00:00Z'),
      snapshot: '{"worksheets":{}}',
    });
    render(
      <RevisionPreview revisionId="r1" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /restore/i })).toBeInTheDocument();
  });

  // A snapshot this build cannot parse must say so. Rendering an empty
  // document would read as "this version was blank".
  it('reports an unreadable snapshot instead of rendering an empty document', async () => {
    getRevision.mockResolvedValue({
      id: 'r2', label: 'v2', description: '', createdAt: new Date(),
      snapshot: '{"content":Tree({"type":"doc","children":[{"type":"block","children":[{"type":"inline","children":[{"type":"text","value":"a"}]}]}]})}',
    });
    render(
      <RevisionPreview revisionId="r2" type="sheet" onRestore={vi.fn()} onBack={vi.fn()} />,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
