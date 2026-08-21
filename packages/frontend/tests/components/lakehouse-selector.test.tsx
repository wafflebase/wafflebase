import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LakehouseSelector } from '@/components/lakehouse-selector';

const api = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock('@/api/lakehouse', () => ({
  fetchWorkspaceLakehouseSources: api.list,
}));

vi.mock('@/api/auth', () => ({
  isAuthExpiredError: () => false,
}));

vi.mock('@/components/lakehouse-dialog', () => ({
  LakehouseDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onOpenChange(false)}>
        Close create mock
      </button>
    ) : null,
}));

const source = {
  id: 'source-1',
  name: 'Orders',
  format: 'iceberg',
  storage: 's3-compatible',
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'fixtures',
  basePath: 'orders/metadata/v3.metadata.json',
  credentials: '********',
  workspaceId: 'workspace-1',
} as const;

describe('LakehouseSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([source]);
  });

  it('uses native pressed buttons instead of incomplete listbox semantics', async () => {
    const onOpenChange = vi.fn();
    const onSelect = vi.fn();
    render(
      <LakehouseSelector
        workspaceId="workspace-1"
        open
        onOpenChange={onOpenChange}
        onSelect={onSelect}
      />,
    );

    const group = await screen.findByRole('group', {
      name: 'Connections',
    });
    expect(group).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('option')).toBeNull();

    const sourceButton = screen.getByRole('button', { name: /Orders/ });
    expect(sourceButton.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(sourceButton);
    expect(sourceButton.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(source));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ignores a stale manual refresh after the workspace changes', async () => {
    let resolveOldRefresh!: (sources: (typeof source)[]) => void;
    const oldRefresh = new Promise<(typeof source)[]>((resolve) => {
      resolveOldRefresh = resolve;
    });
    const otherSource = {
      ...source,
      id: 'source-2',
      name: 'Customers',
      workspaceId: 'workspace-2',
    };
    api.list
      .mockResolvedValueOnce([source])
      .mockReturnValueOnce(oldRefresh)
      .mockResolvedValueOnce([otherSource]);

    const view = render(
      <LakehouseSelector
        workspaceId="workspace-1"
        open
        onOpenChange={() => undefined}
        onSelect={() => undefined}
      />,
    );
    await screen.findByRole('button', { name: /Orders/ });
    fireEvent.click(screen.getByRole('button', { name: 'New Connection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close create mock' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));

    view.rerender(
      <LakehouseSelector
        workspaceId="workspace-2"
        open
        onOpenChange={() => undefined}
        onSelect={() => undefined}
      />,
    );
    await screen.findByRole('button', { name: /Customers/ });

    resolveOldRefresh([source]);
    await oldRefresh;
    expect(screen.queryByRole('button', { name: /Orders/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Customers/ })).toBeTruthy();
  });
});
