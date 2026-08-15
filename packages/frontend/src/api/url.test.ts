import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./auth", () => ({ fetchWithAuth: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { fetchWithAuth } from "./auth";
import { seg } from "./url";
import {
  createShareLink,
  getShareLinks,
  deleteShareLink,
  resolveShareLink,
} from "./share-links";
import {
  fetchFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
} from "./folders";
import {
  fetchWorkspace,
  updateWorkspace,
  deleteWorkspace,
  removeMember,
  createInvite,
  fetchInvites,
  revokeInvite,
  acceptInvite,
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  fetchWorkspaceDocuments,
  getWorkspaceAnalytics,
  createWorkspaceDocument,
  fetchWorkspaceDataSources,
  createWorkspaceDataSource,
  testWorkspaceDataSourceConfig,
} from "./workspaces";
import {
  fetchDataSource,
  updateDataSource,
  deleteDataSource,
  testDataSourceConnection,
  executeDataSourceQuery,
} from "./datasources";
import { fileUrl } from "./files";
import { getDocumentAnalytics } from "./analytics";
import { openMiroImportStream } from "./miro";

const mockFetch = vi.mocked(fetchWithAuth);

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers(),
  } as Response;
}

/**
 * An id that, sent raw, walks the request off the route it was named for and
 * onto `/auth/logout` — with the caller's session attached. React-router
 * percent-decodes route params, so this is what a crafted link delivers.
 */
const TRAVERSAL = "../../auth/logout";

/**
 * Every browser API module that interpolates a route-param id must pin it to
 * one segment. The guard living in `documents.ts` alone would read as covered
 * while every other module stayed walkable, so this pins the whole client.
 */
describe("route-param ids are pinned to one path segment", () => {
  let globalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okJson({}));
    globalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => okJson({})) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = globalFetch;
  });

  const calls: Array<[string, () => unknown]> = [
    ["share-links: create", () => createShareLink(TRAVERSAL, "viewer", null)],
    ["share-links: list", () => getShareLinks(TRAVERSAL)],
    ["share-links: delete", () => deleteShareLink(TRAVERSAL)],
    ["folders: list", () => fetchFolders(TRAVERSAL)],
    ["folders: create", () => createFolder(TRAVERSAL, { name: "f" })],
    ["folders: rename", () => renameFolder(TRAVERSAL, "f")],
    ["folders: move", () => moveFolder(TRAVERSAL, null)],
    ["folders: delete", () => deleteFolder(TRAVERSAL)],
    ["workspaces: get", () => fetchWorkspace(TRAVERSAL)],
    ["workspaces: update", () => updateWorkspace(TRAVERSAL, { name: "w" })],
    ["workspaces: delete", () => deleteWorkspace(TRAVERSAL)],
    ["workspaces: remove member", () => removeMember(TRAVERSAL, 7)],
    ["workspaces: create invite", () => createInvite(TRAVERSAL)],
    ["workspaces: list invites", () => fetchInvites(TRAVERSAL)],
    ["workspaces: revoke invite", () => revokeInvite(TRAVERSAL, TRAVERSAL)],
    ["workspaces: accept invite", () => acceptInvite(TRAVERSAL)],
    ["workspaces: list api keys", () => fetchApiKeys(TRAVERSAL)],
    ["workspaces: create api key", () => createApiKey(TRAVERSAL, { name: "k" })],
    ["workspaces: revoke api key", () => revokeApiKey(TRAVERSAL, TRAVERSAL)],
    ["workspaces: documents", () => fetchWorkspaceDocuments(TRAVERSAL)],
    ["workspaces: analytics", () => getWorkspaceAnalytics(TRAVERSAL)],
    [
      "workspaces: create document",
      () => createWorkspaceDocument(TRAVERSAL, { title: "t" }),
    ],
    ["workspaces: datasources", () => fetchWorkspaceDataSources(TRAVERSAL)],
    [
      "workspaces: create datasource",
      () => createWorkspaceDataSource(TRAVERSAL, {}),
    ],
    [
      "workspaces: test datasource",
      () =>
        testWorkspaceDataSourceConfig(TRAVERSAL, {
          host: "h",
          port: 1,
          database: "d",
          username: "u",
          password: "p",
          sslEnabled: false,
        }),
    ],
    ["datasources: get", () => fetchDataSource(TRAVERSAL)],
    ["datasources: update", () => updateDataSource(TRAVERSAL, {})],
    ["datasources: delete", () => deleteDataSource(TRAVERSAL)],
    ["datasources: test", () => testDataSourceConnection(TRAVERSAL)],
    ["datasources: query", () => executeDataSourceQuery(TRAVERSAL, "select 1")],
    ["analytics: document", () => getDocumentAnalytics(TRAVERSAL)],
    [
      "miro: import",
      () => openMiroImportStream(TRAVERSAL, { token: "t", boardUrl: "b" }),
    ],
  ];

  for (const [name, run] of calls) {
    it(`${name} keeps the id inside its own segment`, async () => {
      await run();
      const urls = [
        ...mockFetch.mock.calls.map((c) => String(c[0])),
        ...vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0])),
      ];
      expect(urls.length).toBeGreaterThan(0);
      for (const raw of urls) {
        // WHATWG resolves `..` — if the id were raw, the normalized path
        // would end at /auth/logout instead of the route that was named.
        const { pathname } = new URL(raw, "https://api.example.test");
        expect(pathname).not.toContain("/auth/logout");
        expect(pathname).toContain(encodeURIComponent(TRAVERSAL));
      }
    });
  }

  it("share-links: resolve keeps a pasted token inside its own segment", async () => {
    await resolveShareLink(TRAVERSAL);
    const raw = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    const { pathname } = new URL(raw, "https://api.example.test");
    expect(pathname).not.toContain("/auth/logout");
    expect(pathname).toContain(encodeURIComponent(TRAVERSAL));
  });

  it("files: fileUrl keeps the document id inside its own segment", () => {
    const { pathname } = new URL(
      fileUrl(TRAVERSAL),
      "https://api.example.test"
    );
    expect(pathname).not.toContain("/auth/logout");
    expect(pathname).toContain(encodeURIComponent(TRAVERSAL));
  });

  it("refuses a bare dot segment rather than encoding it", () => {
    // `encodeURIComponent("..") === ".."`, so encoding alone is not enough.
    expect(() => seg("..")).toThrow("Invalid path segment");
    expect(() => seg(".")).toThrow("Invalid path segment");
  });
});
