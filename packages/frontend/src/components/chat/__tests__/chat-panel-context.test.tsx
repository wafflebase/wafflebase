import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useRightPanels } from "@/components/use-right-panels";
import { useChatPanel, useChatPanelState } from "../chat-panel-context";
import { ChatPanelProvider } from "../chat-panel-provider";
import { draftStore } from "../draft-store";

const ME = 1;

/**
 * An editor in miniature: the page's `useRightPanels` feeding the provider,
 * as every detail page wires it.
 */
function harness(url = "/s/doc-1") {
  let panels: ReturnType<typeof useRightPanels> | null = null;
  function Page({ children }: { children: ReactNode }) {
    panels = useRightPanels(false);
    return (
      <ChatPanelProvider open={panels.chatOpen} onOpenChange={panels.setChatOpen}>
        {children}
      </ChatPanelProvider>
    );
  }
  // Drafts are keyed by user; the signed-in user is already cached, as it
  // is in any editor.
  const client = new QueryClient();
  client.setQueryData(["me"], { id: ME });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Page>{children}</Page>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => ({ api: useChatPanel(), state: useChatPanelState() }),
    { wrapper },
  );
  return { ...hook, panels: () => panels! };
}

describe("useChatPanel", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("opens and closes the panel through the shared right slot", () => {
    const { result, panels } = harness();
    expect(result.current.api.isOpen).toBe(false);

    act(() => panels().setCommentsOpen(true));
    act(() => result.current.api.open());
    expect(result.current.api.isOpen).toBe(true);
    // Chat takes the slot from comments.
    expect(panels().commentsOpen).toBe(false);

    act(() => result.current.api.close());
    expect(result.current.api.isOpen).toBe(false);
  });

  it("opens on the channel asked for", () => {
    const { result } = harness();
    act(() => result.current.api.open({ channelId: "c-2" }));
    expect(result.current.state?.channelId).toBe("c-2");
    expect(result.current.api.isOpen).toBe(true);
  });

  it("seeds a draft into that channel's composer, after what is there", () => {
    const { result } = harness();
    draftStore.set(ME, "c-2", "Half a thought");
    const seed = result.current.state!.draftSeed;
    act(() => result.current.api.open({ channelId: "c-2", draft: "/s/doc-1" }));
    expect(draftStore.get(ME, "c-2")).toBe("Half a thought\n/s/doc-1");
    // The panel remounts its composer to read it.
    expect(result.current.state!.draftSeed).toBe(seed + 1);
  });

  it("holds a draft without a channel until the panel picks one", () => {
    const { result } = harness();
    act(() => result.current.api.open({ draft: "Look at this" }));
    expect(result.current.state?.pendingDraft).toBe("Look at this");

    act(() => result.current.state!.takePendingDraft("c-9"));
    expect(draftStore.get(ME, "c-9")).toBe("Look at this");
    expect(result.current.state?.pendingDraft).toBeNull();
  });

  it("keeps every draft asked for before the panel picks a channel", () => {
    const { result } = harness();
    act(() => result.current.api.open({ draft: "/s/doc-1?at=one" }));
    act(() => result.current.api.open({ draft: "/s/doc-1?at=two" }));
    expect(result.current.state?.pendingDraft).toBe(
      "/s/doc-1?at=one\n/s/doc-1?at=two",
    );

    act(() => result.current.state!.takePendingDraft("c-9"));
    expect(draftStore.get(ME, "c-9")).toBe("/s/doc-1?at=one\n/s/doc-1?at=two");
  });

  it("opens on ?chat=<channelId> when the editor loads", () => {
    const { result } = harness("/d/doc-1?chat=c-7");
    expect(result.current.api.isOpen).toBe(true);
    expect(result.current.state?.channelId).toBe("c-7");
  });

  it("does not reopen from ?chat= once the user closes the panel", () => {
    const { result, rerender } = harness("/d/doc-1?chat=c-7");
    act(() => result.current.api.close());
    rerender();
    expect(result.current.api.isOpen).toBe(false);
  });

  it("is inert outside an editor", () => {
    const { result } = renderHook(() => useChatPanel());
    expect(result.current.isOpen).toBe(false);
    expect(() => result.current.open({ channelId: "c-1" })).not.toThrow();
  });
});
