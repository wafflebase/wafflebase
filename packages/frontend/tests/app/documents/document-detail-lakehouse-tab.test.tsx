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
  } | null,
  fetchMe: vi.fn(),
  fetchDocument: vi.fn(),
  fetchWorkspaces: vi.fn(),
  fetchLakehouseSources: vi.fn(),
}));

vi.mock('@yorkie-js/react', () => ({
  DocumentProvider: ({ children }: { children: ReactNode }) => children,
  useDocument: () => ({
    doc: mocks.doc,
    root: mocks.doc?.getRoot(),
    loading: false,
    error: undefined,
  }),
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
  SiteHeader: ({ title, children }: { title: string; children: ReactNode }) => (
    <header>
      <span>{title}</span>
      {children}
    </header>
  ),
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

describe('DocumentDetail lakehouse tab creation', () => {
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
      await screen.findByRole('button', { name: 'Add tab' }),
      {
        button: 0,
        pointerType: 'mouse',
      },
    );
    fireEvent.click(
      await screen.findByRole('menuitem', { name: /New Lakehouse/ }),
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
      screen
        .getByRole('button', { name: 'Orders' })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect((await screen.findByTestId('lakehouse-view')).textContent).toBe(
      newTabId,
    );
  });
});
