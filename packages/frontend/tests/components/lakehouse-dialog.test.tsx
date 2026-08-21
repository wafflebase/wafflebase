import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LakehouseDialog } from '@/components/lakehouse-dialog';
import type { LakehouseSource } from '@/types/lakehouse';

const api = vi.hoisted(() => ({
  create: vi.fn(),
  testExisting: vi.fn(),
  testWorkspace: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@/api/lakehouse', () => ({
  createWorkspaceLakehouseSource: api.create,
  testLakehouseSource: api.testExisting,
  testWorkspaceLakehouseSource: api.testWorkspace,
  updateLakehouseSource: api.update,
}));

vi.mock('@/api/auth', () => ({
  isAuthExpiredError: () => false,
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

const savedSource: LakehouseSource = {
  id: 'source-1',
  name: 'Events',
  format: 'iceberg',
  storage: 's3-compatible',
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'fixtures',
  basePath: 'events/metadata/v3.metadata.json',
  credentials: '********',
  workspaceId: 'workspace-1',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function fillDefaultSource() {
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Events' },
  });
  fireEvent.change(screen.getByLabelText('Bucket'), {
    target: { value: 'fixtures' },
  });
  fireEvent.change(
    screen.getByLabelText('Iceberg metadata file (.metadata.json)'),
    {
      target: { value: 'events/metadata/v3.metadata.json' },
    },
  );
  fireEvent.change(screen.getByLabelText('Access key'), {
    target: { value: 'minioadmin' },
  });
  fireEvent.change(screen.getByLabelText('Secret key'), {
    target: { value: 'minioadmin' },
  });
}

describe('LakehouseDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.create.mockResolvedValue(savedSource);
    api.testExisting.mockResolvedValue({ success: true });
    api.testWorkspace.mockResolvedValue({ success: true });
    api.update.mockResolvedValue(savedSource);
  });

  it('defaults to the local MinIO-compatible backend contract', async () => {
    const onCreated = vi.fn();
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        onOpenChange={() => undefined}
        onCreated={onCreated}
      />,
    );

    expect(screen.getByDisplayValue('http://localhost:9000')).toBeTruthy();
    fillDefaultSource();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith('workspace-1', {
      name: 'Events',
      format: 'iceberg',
      storage: 's3-compatible',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'fixtures',
      basePath: 'events/metadata/v3.metadata.json',
      credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
      },
    });
    expect(onCreated).toHaveBeenCalledWith(savedSource);
  });

  it('tests a new source without creating or selecting it', async () => {
    const onCreated = vi.fn();
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        onOpenChange={() => undefined}
        onCreated={onCreated}
      />,
    );
    fillDefaultSource();

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => expect(api.testWorkspace).toHaveBeenCalledTimes(1));
    expect(api.testWorkspace).toHaveBeenCalledWith('workspace-1', {
      name: 'Events',
      format: 'iceberg',
      storage: 's3-compatible',
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'fixtures',
      basePath: 'events/metadata/v3.metadata.json',
      credentials: {
        accessKeyId: 'minioadmin',
        secretAccessKey: 'minioadmin',
      },
    });
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('tests edits as an overlay without updating the stored source', async () => {
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        source={savedSource}
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Renamed Events' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => expect(api.testExisting).toHaveBeenCalledTimes(1));
    expect(api.testExisting).toHaveBeenCalledWith(
      'source-1',
      expect.objectContaining({
        name: 'Renamed Events',
        format: 'iceberg',
        storage: 's3-compatible',
        basePath: 'events/metadata/v3.metadata.json',
      }),
    );
    expect(api.testExisting.mock.calls[0][1]).not.toHaveProperty('credentials');
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('requires fresh credentials when an edit changes the object target', async () => {
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        source={savedSource}
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.change(
      screen.getByLabelText('Iceberg metadata file (.metadata.json)'),
      {
        target: { value: 'events/metadata/v4.metadata.json' },
      },
    );
    expect(
      screen.getByRole('button', { name: 'Test Connection' }),
    ).toHaveProperty('disabled', true);

    fireEvent.change(screen.getByLabelText('Access key'), {
      target: { value: 'rotated-id' },
    });
    fireEvent.change(screen.getByLabelText('Secret key'), {
      target: { value: 'rotated-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => expect(api.testExisting).toHaveBeenCalledTimes(1));
    expect(api.testExisting).toHaveBeenCalledWith(
      'source-1',
      expect.objectContaining({
        basePath: 'events/metadata/v4.metadata.json',
        credentials: {
          accessKeyId: 'rotated-id',
          secretAccessKey: 'rotated-secret',
        },
      }),
    );
  });

  it('flags an invalid bucket name and blocks submission until it is fixed', () => {
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
    );
    fillDefaultSource();
    fireEvent.change(screen.getByLabelText('Bucket'), {
      target: { value: 'warehouse/prod' },
    });

    const bucket = screen.getByLabelText('Bucket');
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('lakehouse-bucket-error');
    expect(bucket.getAttribute('aria-invalid')).toBe('true');
    expect(bucket.getAttribute('aria-describedby')).toBe(alert.id);
    expect(
      screen.getByRole('button', { name: 'Test Connection' }),
    ).toHaveProperty('disabled', true);

    fireEvent.change(bucket, { target: { value: 'warehouse' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Test Connection' }),
    ).toHaveProperty('disabled', false);
  });

  it('links the credentials error message to every credential input', () => {
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        source={savedSource}
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.change(
      screen.getByLabelText('Iceberg metadata file (.metadata.json)'),
      {
        target: { value: 'events/metadata/v4.metadata.json' },
      },
    );
    const alert = screen.getByRole('alert');
    expect(alert.id).toBe('lakehouse-credentials-error');
    for (const label of ['Access key', 'Secret key']) {
      const input = screen.getByLabelText(label);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    }

    fireEvent.change(screen.getByLabelText('Access key'), {
      target: { value: 'rotated-id' },
    });
    fireEvent.change(screen.getByLabelText('Secret key'), {
      target: { value: 'rotated-secret' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByLabelText('Access key').getAttribute('aria-describedby'),
    ).toBeNull();
  });

  it('requires fresh credentials when an extra trailing slash retargets a table', () => {
    const deltaSource: LakehouseSource = {
      ...savedSource,
      format: 'delta',
      basePath: 'delta-events/',
    };
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        source={deltaSource}
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Delta table root'), {
      target: { value: 'delta-events//' },
    });

    expect(
      screen.getByRole('button', { name: 'Test Connection' }),
    ).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Save Changes' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('requires a fresh Azure secret when an edit supplies an account name', () => {
    const azureSource: LakehouseSource = {
      ...savedSource,
      format: 'delta',
      storage: 'azure',
      endpoint: null,
      bucket: 'fixtures',
      basePath: 'delta-events',
    };
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        source={azureSource}
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText('Account name'), {
      target: { value: 'newaccount' },
    });
    expect(
      screen.getByText(
        'Changing an Azure account name requires a fresh account key or SAS token.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save Changes' })).toHaveProperty(
      'disabled',
      true,
    );

    fireEvent.change(screen.getByLabelText('Account key'), {
      target: { value: 'fresh-key' },
    });
    expect(screen.getByRole('button', { name: 'Save Changes' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('sends nulls when cleared optional fields are updated', async () => {
    const localSource: LakehouseSource = {
      ...savedSource,
      storage: 'local',
      endpoint: 'http://stale.example',
      region: 'us-east-1',
      bucket: 'stale-bucket',
      basePath: '/srv/lakehouse/events/metadata/v3.metadata.json',
    };
    render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        source={localSource}
        onOpenChange={() => undefined}
        onCreated={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(
      'source-1',
      expect.objectContaining({
        endpoint: null,
        region: null,
        bucket: null,
      }),
    );
  });

  it('does not select a source after the dialog closes mid-request', async () => {
    const pendingCreate = deferred<LakehouseSource>();
    api.create.mockReturnValueOnce(pendingCreate.promise);
    const onCreated = vi.fn();
    const view = render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        onOpenChange={() => undefined}
        onCreated={onCreated}
      />,
    );
    fillDefaultSource();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));

    view.rerender(
      <LakehouseDialog
        workspaceId="workspace-1"
        open={false}
        onOpenChange={() => undefined}
        onCreated={onCreated}
      />,
    );
    await act(async () => {
      pendingCreate.resolve(savedSource);
      await pendingCreate.promise;
    });

    expect(onCreated).not.toHaveBeenCalled();
  });

  it('does not select a source after the dialog unmounts mid-request', async () => {
    const pendingCreate = deferred<LakehouseSource>();
    api.create.mockReturnValueOnce(pendingCreate.promise);
    const onCreated = vi.fn();
    const view = render(
      <LakehouseDialog
        workspaceId="workspace-1"
        open
        onOpenChange={() => undefined}
        onCreated={onCreated}
      />,
    );
    fillDefaultSource();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));

    view.unmount();
    await act(async () => {
      pendingCreate.resolve(savedSource);
      await pendingCreate.promise;
    });

    expect(onCreated).not.toHaveBeenCalled();
  });
});
