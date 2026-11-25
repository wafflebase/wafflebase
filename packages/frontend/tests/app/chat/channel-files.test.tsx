import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatFileDto } from "@/api/chat";
import { ChannelFilesButton } from "@/app/chat/channel-files";

type Page = { files: ChatFileDto[]; cursor: string | null };
const fetchFilesSpy =
  vi.fn<(w: string, c: string, o: { limit?: number; before?: string }) => Promise<Page>>();

vi.mock("@/api/chat", () => ({
  fetchChannelFiles: (w: string, c: string, o: { limit?: number; before?: string }) =>
    fetchFilesSpy(w, c, o),
}));

const ID = "0b6f3c2e-8a4d-4f1e-9c7b-2d5e6f708192";
const file = (over: Partial<ChatFileDto> = {}): ChatFileDto => ({
  documentId: ID,
  type: "slides",
  title: "Roadmap",
  anchor: { slideId: "s1", label: "Slide 3" },
  messageId: "m1",
  sharedBy: { id: 2, username: "minji", photo: null },
  sharedAt: "2026-11-20T10:00:00.000Z",
  ...over,
});

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname + loc.search}</span>;
}

function renderButton() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/w/w1/chat/c1"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ChannelFilesButton workspaceId="w1" channelId="c1" lastSeq={4} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ChannelFilesButton", () => {
  beforeEach(() => {
    fetchFilesSpy.mockReset();
  });

  it("counts the files and lists them with who shared them", async () => {
    fetchFilesSpy.mockResolvedValue({ files: [file()], cursor: null });
    renderButton();
    const trigger = await screen.findByRole("button", { name: "1 file" });
    await userEvent.click(trigger);
    const row = await screen.findByRole("link", { name: /Roadmap/ });
    expect(row).toHaveTextContent("Slide 3");
    expect(row).toHaveTextContent("minji");
    expect(row.querySelector("svg")?.getAttribute("class")).toMatch(
      /text-type-slides/,
    );
    await userEvent.click(row);
    expect(screen.getByTestId("where").textContent).toMatch(
      new RegExp(`^/p/${ID}\\?chat=c1&at=`),
    );
  });

  it("says so when nothing has been shared", async () => {
    fetchFilesSpy.mockResolvedValue({ files: [], cursor: null });
    renderButton();
    await userEvent.click(await screen.findByRole("button", { name: "0 files" }));
    expect(await screen.findByText(/No documents shared yet/)).toBeInTheDocument();
  });

  it("pages with the cursor", async () => {
    fetchFilesSpy.mockImplementation(async (_w, _c, o) =>
      o.before
        ? { files: [file({ documentId: "d2", title: "Older" })], cursor: null }
        : { files: [file()], cursor: "next" },
    );
    renderButton();
    await userEvent.click(await screen.findByRole("button", { name: "1+ files" }));
    await userEvent.click(await screen.findByRole("button", { name: "Show more" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Older/ })).toBeInTheDocument(),
    );
    expect(fetchFilesSpy).toHaveBeenCalledWith("w1", "c1", {
      limit: 50,
      before: "next",
    });
  });
});
