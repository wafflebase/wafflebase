import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ChatPanelProvider } from "@/components/chat/chat-panel-provider";
import { useChatPanelState } from "@/components/chat/chat-panel-context";
import { decodeAnchor, parseDocumentLink } from "@/components/chat/document-link";
import { useSendToChat } from "@/components/chat/use-send-to-chat";

function render(opts: { provider?: boolean; available?: boolean; documentId?: string }) {
  const onOpenChange = vi.fn();
  const client = new QueryClient();
  client.setQueryData(["me"], { id: 1 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/s/doc"]}>
        {opts.provider === false ? (
          children
        ) : (
          <ChatPanelProvider
            open={false}
            onOpenChange={onOpenChange}
            available={opts.available}
          >
            {children}
          </ChatPanelProvider>
        )}
      </MemoryRouter>
    </QueryClientProvider>
  );
  const hook = renderHook(
    () => ({
      send: useSendToChat("sheet", "documentId" in opts ? opts.documentId : DOC),
      state: useChatPanelState(),
    }),
    { wrapper },
  );
  return { hook, onOpenChange };
}

const DOC = "0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192";

describe("useSendToChat", () => {
  it("opens the panel with an anchored link to the document as a draft", () => {
    const { hook, onOpenChange } = render({});
    const anchor = { tabId: "t", rowId: "r", colId: "c", rowSpan: 2, colSpan: 1, label: "Sheet1!A1:A2" };
    act(() => hook.result.current.send!(anchor));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    const draft = hook.result.current.state!.pendingDraft!;
    const link = parseDocumentLink(draft)!;
    expect(link.documentId).toBe(DOC);
    expect(link.route).toBe("s");
    expect(decodeAnchor(link.at, "sheet")).toEqual(anchor);
  });

  it("sends a document-level link without an anchor", () => {
    const { hook } = render({});
    act(() => hook.result.current.send!(null));
    expect(parseDocumentLink(hook.result.current.state!.pendingDraft!)!.at).toBeNull();
  });

  it("is null without a panel, while it is withheld, or without a document", () => {
    expect(render({ provider: false }).hook.result.current.send).toBeNull();
    expect(render({ available: false }).hook.result.current.send).toBeNull();
    expect(render({ documentId: undefined }).hook.result.current.send).toBeNull();
  });
});
