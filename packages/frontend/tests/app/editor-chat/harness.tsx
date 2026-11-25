/**
 * Shared harness for the editor chat-panel tests (`docs/design/chat.md`
 * § Chat panel — in every editor). Each `*.test.tsx` beside this file mounts
 * one real detail page with its engine view mocked out, and runs
 * {@link describeEditorChatPanel} against it.
 *
 * What stays real is exactly the wiring under test: the page itself,
 * `useRightPanels`, `ChatPanelProvider`, `ChatPanelToggle`, `EditingChrome`
 * and `PreviewSurface`. What is replaced is chrome with no bearing on it —
 * `SiteHeader` becomes a row of named slots, so a test can ask which slot a
 * control was put in; `LazyChatPanel` becomes a marker that reports what the
 * provider above it says; the history panel and the revision preview become
 * buttons that open and close a preview.
 *
 * Imported from `vi.mock` factories, so this module must not import any
 * module those factories replace.
 */
/* A test harness, never hot-reloaded: it shares mocks and the suite beside
   its components on purpose. */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import {
  useChatPanel,
  useChatPanelState,
} from "@/components/chat/chat-panel-context";

export const WORKSPACE_ID = "ws-1";

export const me = {
  id: 7,
  username: "alice",
  email: "alice@example.com",
  photo: "",
};

/** `@/api/auth`, signed in. */
export const authMock = {
  fetchMe: vi.fn(async () => me),
  fetchMeOptional: vi.fn(async () => me),
  isAuthExpiredError: () => false,
};

/** `@/api/workspaces`, with the one workspace every document lives in. */
export const workspacesMock = {
  fetchWorkspaces: vi.fn(async () => [
    { id: WORKSPACE_ID, name: "Team", slug: "team", createdAt: "" },
  ]),
  fetchAnalyticsEnabled: vi.fn(async () => false),
};

/** `@/api/documents`, answering for document `id` of `type`. */
export function documentsMock(type: string) {
  return {
    fetchDocument: vi.fn(async (id: string) => ({
      id,
      title: "Quarterly plan",
      type,
      workspaceId: WORKSPACE_ID,
      folderId: null,
    })),
    renameDocument: vi.fn(async () => undefined),
  };
}

/**
 * A Yorkie document double: `getRoot` answers `root`, every other member is
 * a tolerated no-op (`subscribe` hands back an unsubscribe).
 */
export function fakeDoc(root: unknown = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    getRoot: () => root,
    getOthersPresences: () => [],
    getMyPresence: () => ({}),
    getChangeID: () => ({ getActorID: () => "me" }),
    subscribe: () => () => undefined,
    update: (fn: (r: unknown, p: unknown) => void) =>
      fn(root, { set: () => undefined }),
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop !== "string" || prop === "then") {
        return Reflect.get(target, prop);
      }
      if (!(prop in target)) target[prop] = () => undefined;
      return target[prop];
    },
  });
}

/** `@yorkie-js/react` over `doc`. */
export function yorkieMock(doc: () => unknown) {
  return {
    DocumentProvider: ({ children }: { children: ReactNode }) => children,
    useDocument: () => ({
      doc: doc(),
      root: (doc() as { getRoot: () => unknown }).getRoot(),
      presences: [],
      loading: false,
      error: undefined,
    }),
    createDocumentSelector:
      () =>
      <T,>(selector: (s: { doc: unknown; root: unknown }) => T) =>
        selector({
          doc: doc(),
          root: (doc() as { getRoot: () => unknown }).getRoot(),
        }),
    Tree: class {},
    Text: class {},
  };
}

export const SLOTS = [
  "primary",
  "comments",
  "history",
  "chat",
  "export",
  "share",
  "presence",
] as const;

/** `SiteHeader`: the title, then each filled slot in a box named for it. */
export function MockSiteHeader({
  title,
  leading,
  actions,
  children,
}: {
  title: string;
  leading?: ReactNode;
  actions?: Partial<Record<(typeof SLOTS)[number], ReactNode>>;
  children?: ReactNode;
}) {
  return (
    <header>
      {leading}
      <span>{title}</span>
      {SLOTS.map((slot) =>
        actions?.[slot] ? (
          <div key={slot} data-testid={`slot-${slot}`}>
            {actions[slot]}
          </div>
        ) : null,
      )}
      {children ? <div data-testid="slot-children">{children}</div> : null}
    </header>
  );
}

/** `HeaderPanelToggle`, as a plain pressed button named like the real one. */
export function MockHeaderPanelToggle({
  label,
  pressed,
  onPressedChange,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  return (
    <button aria-pressed={pressed} onClick={() => onPressedChange(!pressed)}>
      {`${pressed ? "Hide" : "Show"} ${label}`}
    </button>
  );
}

export const siteHeaderMock = {
  SiteHeader: MockSiteHeader,
  HeaderPanelToggle: MockHeaderPanelToggle,
};

/**
 * `LazyChatPanel`: reports its props and what the provider above it says, so
 * a test sees the panel the user would — or that there is none.
 */
export function ChatPanelMarker(props: {
  workspaceId: string;
  documentId: string;
}) {
  const api = useChatPanel();
  const state = useChatPanelState();
  return (
    <div
      data-testid="chat-panel"
      data-open={String(api.isOpen)}
      data-available={String(state?.available)}
      data-channel={state?.channelId ?? ""}
      data-workspace={props.workspaceId}
      data-document={props.documentId}
    />
  );
}

/** `LazyHistoryPanel`: one button that opens a preview. */
export function MockHistoryPanel({
  onPreview,
}: {
  onPreview: (revisionId: string) => void;
}) {
  return (
    <div data-testid="history-panel">
      <button onClick={() => onPreview("rev-1")}>Preview revision</button>
    </div>
  );
}

/** `RevisionPreviewOverlay`: the banner's close button. */
export function MockRevisionOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div data-testid="revision-preview">
      <button onClick={onClose}>Close preview</button>
    </div>
  );
}

type PanelPair = [boolean, Dispatch<SetStateAction<boolean>>];
const PanelPairContext = createContext<PanelPair | null>(null);

/**
 * Stand-in for a collab provider that draws its own comments panel from a
 * `panel={[open, setOpen]}` the page hands it (`BoardCollabProvider`,
 * `PdfCollabProvider`): what matters is that the page hands over its
 * right-slot flag, not how the panel paints.
 */
export function PanelPairProvider({
  panel,
  children,
}: {
  panel: PanelPair;
  children: ReactNode;
}) {
  return (
    <PanelPairContext.Provider value={panel}>{children}</PanelPairContext.Provider>
  );
}

export function PanelPairToggle() {
  const [open, setOpen] = useContext(PanelPairContext)!;
  return (
    <MockHeaderPanelToggle
      label="comments"
      pressed={open}
      onPressedChange={setOpen}
    />
  );
}

export function PanelPairPanel() {
  const pair = useContext(PanelPairContext);
  return pair?.[0] ? <div data-testid="comments-panel" /> : null;
}

/**
 * Follows a document card to this same document, as a click in chat does:
 * the page stays mounted and only its query string changes.
 */
function FollowLink({ search }: { search: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <button onClick={() => navigate(`${pathname}${search}`)}>Follow card</button>
  );
}

export function renderEditor({
  route,
  url,
  element,
  follow = "?chat=ch-linked",
}: {
  route: string;
  url: string;
  element: ReactElement;
  /** The query string the "Follow card" button navigates to. */
  follow?: string;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path={route}
            element={
              <>
                {element}
                <FollowLink search={follow} />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export interface EditorChatCase {
  /** The route pattern, e.g. `/d/:id`. */
  route: string;
  /** This document's id. */
  documentId: string;
  element: () => ReactElement;
  /**
   * The other panel that shares the right-hand slot with chat: its header
   * toggle's label and the test id of what it draws. None for a viewer with
   * no panel of its own (image, generic file).
   */
  other?: { label: string; testId: string };
  /** Whether the page offers version history (and so a revision preview). */
  preview: boolean;
}

/**
 * The behaviour every editor page owes its chat panel. Mounts the real page
 * through `c.element` and drives it from the header.
 */
export function describeEditorChatPanel(name: string, c: EditorChatCase) {
  const base = c.route.replace(":id", c.documentId);
  const mount = (url = base) =>
    renderEditor({ route: c.route, url, element: c.element() });
  const chatToggle = async () =>
    within(await screen.findByTestId("slot-chat")).getByRole("button", {
      name: /chat$/,
    });

  describe(`${name} chat panel`, () => {
    it("puts the Chat toggle in the header's chat slot, closed", async () => {
      mount();
      const toggle = await chatToggle();
      expect(toggle).toHaveTextContent("Show chat");
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByTestId("chat-panel")).toBeNull();
    });

    it("opens the panel for this document from the toggle, and closes it", async () => {
      mount();
      await userEvent.click(await chatToggle());

      const panel = await screen.findByTestId("chat-panel");
      expect(panel).toHaveAttribute("data-open", "true");
      expect(panel).toHaveAttribute("data-workspace", WORKSPACE_ID);
      expect(panel).toHaveAttribute("data-document", c.documentId);
      expect(await chatToggle()).toHaveAttribute("aria-pressed", "true");

      await userEvent.click(await chatToggle());
      expect(screen.queryByTestId("chat-panel")).toBeNull();
    });

    const other = c.other;
    if (other) it(`gives the slot to one of chat and ${other.label} at a time`, async () => {
      mount();
      await userEvent.click(await chatToggle());
      await screen.findByTestId("chat-panel");

      await userEvent.click(
        screen.getByRole("button", { name: `Show ${other.label}` }),
      );
      expect(await screen.findByTestId(other.testId)).toBeInTheDocument();
      expect(screen.queryByTestId("chat-panel")).toBeNull();

      await userEvent.click(await chatToggle());
      await screen.findByTestId("chat-panel");
      expect(screen.queryByTestId(other.testId)).toBeNull();
    });

    it("opens on the channel a ?chat= link names", async () => {
      mount(`${base}?chat=ch-9`);
      const panel = await screen.findByTestId("chat-panel");
      expect(panel).toHaveAttribute("data-channel", "ch-9");
      expect(await chatToggle()).toHaveAttribute("aria-pressed", "true");
    });

    if (c.preview) {
      it("withholds the toggle and the panel while a revision preview is open", async () => {
        mount();
        await userEvent.click(
          await screen.findByRole("button", { name: "Show version history" }),
        );
        await userEvent.click(await screen.findByText("Preview revision"));
        await screen.findByTestId("revision-preview");
        // Some pages leave the slot filled with an `EditingChrome` that
        // renders nothing, so ask for the control rather than the slot.
        await waitFor(() =>
          expect(screen.queryByRole("button", { name: /chat$/ })).toBeNull(),
        );

        // A card followed while the preview is up opens the panel's state
        // but not the panel, which would read the live document behind it.
        await act(async () => {
          await userEvent.click(screen.getByText("Follow card"));
        });
        expect(screen.queryByTestId("chat-panel")).toBeNull();

        // Closing the preview gives back what it withheld.
        await userEvent.click(screen.getByText("Close preview"));
        const panel = await screen.findByTestId("chat-panel");
        expect(panel).toHaveAttribute("data-channel", "ch-linked");
        expect(await chatToggle()).toHaveAttribute("aria-pressed", "true");
      });
    }
  });
}
