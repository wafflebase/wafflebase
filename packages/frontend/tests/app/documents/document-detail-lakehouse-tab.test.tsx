import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DocumentDetail from '@/app/documents/document-detail';
import {
  initialSpreadsheetDocument,
  type SpreadsheetDocument,
} from '@/types/worksheet';

const mocks = vi.hoisted(() => ({
  doc: null as {
    getRoot: () => SpreadsheetDocument;
    update: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    getOthersPresences: ReturnType<typeof vi.fn>;
    getChangeID: () => { getActorID: () => string };
  } | null,
  fetchMe: vi.fn(),
  fetchDocument: vi.fn(),
  fetchWorkspaces: vi.fn(),
  fetchLakehouseSources: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sonner')>();
  return {
    ...actual,
    toast: Object.assign(actual.toast, { error: mocks.toastError }),
  };
});

vi.mock('@yorkie-js/react', () => ({
  DocumentProvider: ({ children }: { children: ReactNode }) => children,
  useDocument: () => ({
    doc: mocks.doc,
    root: mocks.doc?.getRoot(),
    loading: false,
    error: undefined,
  }),
  createDocumentSelector:
    () =>
    <T,>(selector: (s: { doc: unknown }) => T) =>
      selector({ doc: mocks.doc }),
}));

vi.mock('@/api/auth', () => ({
  fetchMe: mocks.fetchMe,
  isAuthExpiredError: () => false,
}));

vi.mock('@/api/documents', () => ({
  fetchDocument: mocks.fetchDocument,
  renameDocument: vi.fn(),
}));

vi.mock('@/api/workspaces', () => ({
  fetchWorkspaces: mocks.fetchWorkspaces,
  // The sidebar nav gates its Analytics entry on this.
  fetchAnalyticsEnabled: vi.fn(async () => false),
}));

vi.mock('@/api/lakehouse', () => ({
  fetchWorkspaceLakehouseSources: mocks.fetchLakehouseSources,
}));

vi.mock('@/hooks/use-presence-updater', () => ({
  usePresenceUpdater: () => undefined,
}));

vi.mock('@/components/app-sidebar', () => ({
  AppSidebar: () => null,
}));

vi.mock('@/components/site-header', () => ({
  SiteHeader: ({
    title,
    actions,
  }: {
    title: string;
    actions?: Record<string, ReactNode>;
  }) => (
    <header>
      <span>{title}</span>
      {Object.values(actions ?? {})}
    </header>
  ),
  HeaderPanelToggle: () => null,
}));

vi.mock('@/components/share-dialog', () => ({
  ShareDialog: () => null,
}));

vi.mock('@/components/user-presence', () => ({
  UserPresence: () => null,
}));

vi.mock('@/components/comments/components/CommentSidePanel', () => ({
  CommentSidePanel: () => null,
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarProvider: ({ children }: { children: ReactNode }) => children,
  SidebarInset: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/app/spreadsheet/sheet-view', () => ({
  default: ({ tabId }: { tabId: string }) => (
    <div data-testid="sheet-view">{tabId}</div>
  ),
}));

vi.mock('@/app/spreadsheet/lakehouse-view', () => ({
  LakehouseView: ({ tabId }: { tabId: string }) => (
    <div data-testid="lakehouse-view">{tabId}</div>
  ),
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

describe('DocumentDetail tab bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const root = structuredClone(initialSpreadsheetDocument());
    mocks.doc = {
      getRoot: () => root,
      update: vi.fn((update: (nextRoot: SpreadsheetDocument) => void) =>
        update(root),
      ),
      subscribe: vi.fn(() => () => undefined),
      getOthersPresences: vi.fn(() => []),
      getChangeID: () => ({ getActorID: () => 'me' }),
    };

    mocks.fetchMe.mockResolvedValue({
      id: 1,
      username: 'alice',
      email: 'alice@example.com',
      photo: '',
    });
    mocks.fetchDocument.mockResolvedValue({
      id: 'document-1',
      title: 'Lakehouse workbook',
      workspaceId: 'workspace-1',
    });
    mocks.fetchWorkspaces.mockResolvedValue([
      {
        id: 'workspace-1',
        name: 'Workspace',
        slug: 'workspace',
        createdAt: '2026-07-28T00:00:00.000Z',
      },
    ]);
    mocks.fetchLakehouseSources.mockResolvedValue([source]);
  });

  it('creates and activates a source-only Yorkie tab through the real tab bar and selector', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/documents/document-1']}>
          <Routes>
            <Route path="/documents/:id" element={<DocumentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.pointerDown(
      await screen.findByRole('button', { name: 'More tab types' }),
      {
        button: 0,
        pointerType: 'mouse',
      },
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /Connect lakehouse table/ }),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Orders/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));

    await waitFor(() => {
      expect(mocks.doc?.getRoot().tabOrder).toHaveLength(2);
    });

    const root = mocks.doc!.getRoot();
    const newTabId = root.tabOrder[1];
    expect(mocks.doc?.update).toHaveBeenCalledTimes(1);
    expect(root.tabs[newTabId]).toEqual({
      id: newTabId,
      name: 'Orders',
      type: 'lakehouse',
      lakehouseSourceId: 'source-1',
      lakehouseRef: {
        metadataUri: 's3://fixtures/orders/metadata/v3.metadata.json',
      },
    });
    expect(root.tabs[newTabId]).not.toHaveProperty('endpoint');
    expect(root.tabs[newTabId]).not.toHaveProperty('credentials');
    expect(
      screen.getByRole('tab', { name: 'Orders' }).getAttribute('aria-selected'),
    ).toBe('true');
    expect((await screen.findByTestId('lakehouse-view')).textContent).toBe(
      newTabId,
    );
  });
  it('duplicates a sheet tab next to itself and activates the copy', async () => {
    const root = mocks.doc!.getRoot();
    root.sheets['tab-1'].cells['1:1'] = { v: '42' } as never;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/documents/document-1']}>
          <Routes>
            <Route path="/documents/:id" element={<DocumentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'Sheet1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => {
      expect(root.tabOrder).toHaveLength(2);
    });
    const copyId = root.tabOrder[1];
    expect(root.tabs[copyId].name).toBe('Sheet1 (copy)');
    expect(root.sheets[copyId].cells['1:1']).toEqual({ v: '42' });
    // A copy, not an alias of the source's worksheet.
    expect(root.sheets[copyId]).not.toBe(root.sheets['tab-1']);
    expect(
      (await screen.findByRole('tab', { name: 'Sheet1 (copy)' })).getAttribute(
        'aria-selected',
      ),
    ).toBe('true');
  });

  function renderDetail() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/documents/document-1']}>
          <Routes>
            <Route path="/documents/:id" element={<DocumentDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('detaches a live worksheet through toJS before copying it', async () => {
    const root = mocks.doc!.getRoot();
    const source = root.sheets['tab-1'];
    // A live Yorkie proxy carries a toJS method. The detached snapshot holds a
    // value the source does not, so the copy proves toJS fed it rather than
    // the structuredClone fallback.
    const detached = {
      ...structuredClone(source),
      cells: { '1:1': { v: 'from-toJS' } },
    };
    const toJS = vi.fn(() => detached);
    Object.defineProperty(source, 'toJS', { value: toJS, enumerable: false });

    renderDetail();
    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'Sheet1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => {
      expect(root.tabOrder).toHaveLength(2);
    });
    expect(toJS).toHaveBeenCalledTimes(1);
    expect(root.sheets[root.tabOrder[1]].cells['1:1']).toEqual({
      v: 'from-toJS',
    });
  });

  it('reports a worksheet that cannot be detached and writes nothing', async () => {
    const root = mocks.doc!.getRoot();
    Object.defineProperty(root.sheets['tab-1'], 'toJS', {
      value: () => {
        throw new Error('detached proxy');
      },
      enumerable: false,
    });

    renderDetail();
    fireEvent.contextMenu(await screen.findByRole('tab', { name: 'Sheet1' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }));

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Could not duplicate this sheet.',
      );
    });
    expect(root.tabOrder).toHaveLength(1);
    expect(mocks.doc!.update).not.toHaveBeenCalledWith(expect.anything());
  });
});
