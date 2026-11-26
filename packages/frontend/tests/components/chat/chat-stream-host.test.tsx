import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PrivateRoute } from "@/PrivateRoute";

vi.mock("@/api/auth", () => ({
  fetchMe: async () => ({ id: 1, username: "me", email: "me@x", photo: null }),
  fetchYorkieToken: async () => "token",
  isBackendUnreachableError: () => false,
}));
vi.mock("@yorkie-js/react", () => ({
  YorkieProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/api/chat", () => ({
  CHAT_PAGE_SIZE: 50,
  chatStreamUrl: () => "http://api.test/chat/stream",
  fetchChannels: () => Promise.resolve([]),
  fetchMessages: () => Promise.resolve([]),
  fetchMessage: () => Promise.resolve(null),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  readyState = 1;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}

const items = { main: [], secondary: [] };

/** Two different shells, as the list Layout and an editor page are. */
function ListShell() {
  const navigate = useNavigate();
  return (
    <SidebarProvider>
      <AppSidebar items={items} />
      <button onClick={() => navigate("/editor")}>open editor</button>
    </SidebarProvider>
  );
}

function EditorShell() {
  const navigate = useNavigate();
  return (
    <SidebarProvider>
      <AppSidebar items={items} />
      <button onClick={() => navigate("/list")}>back to list</button>
    </SidebarProvider>
  );
}

describe("ChatStreamHost", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
        }) as unknown as MediaQueryList,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps one stream across shells that each render the sidebar", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/list"]}>
          <Routes>
            <Route element={<PrivateRoute />}>
              <Route path="/list" element={<ListShell />} />
              <Route path="/editor" element={<EditorShell />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    (await screen.findByText("open editor")).click();
    await screen.findByText("back to list");
    act(() => screen.getByText("back to list").click());
    await screen.findByText("open editor");
    act(() => screen.getByText("open editor").click());
    await screen.findByText("back to list");

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].closed).toBe(false);
  });
});
