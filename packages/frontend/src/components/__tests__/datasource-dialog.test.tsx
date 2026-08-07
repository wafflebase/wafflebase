import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataSourceDialog } from "@/components/datasource-dialog";
import { toast } from "sonner";

const createWorkspaceDataSource = vi.fn();
const testWorkspaceDataSourceConfig = vi.fn();

vi.mock("@/api/workspaces", () => ({
  createWorkspaceDataSource: (...args: unknown[]) =>
    createWorkspaceDataSource(...args),
  testWorkspaceDataSourceConfig: (...args: unknown[]) =>
    testWorkspaceDataSourceConfig(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

async function fillRequiredFields() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Database"), "postgres");
  await user.type(screen.getByLabelText("Username"), "waffle");
  return user;
}

function renderDialog() {
  return render(
    <DataSourceDialog
      workspaceId="ws-1"
      open
      onOpenChange={() => {}}
      onCreated={() => {}}
    />,
  );
}

describe("DataSourceDialog", () => {
  beforeEach(() => {
    createWorkspaceDataSource.mockReset();
    testWorkspaceDataSourceConfig.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    testWorkspaceDataSourceConfig.mockResolvedValue({ success: true });
    createWorkspaceDataSource.mockResolvedValue({ id: "ds-1" });
  });

  it("tests a connection without creating the datasource", async () => {
    renderDialog();
    const user = await fillRequiredFields();

    await user.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() =>
      expect(testWorkspaceDataSourceConfig).toHaveBeenCalledTimes(1),
    );
    expect(testWorkspaceDataSourceConfig).toHaveBeenCalledWith("ws-1", {
      host: "localhost",
      port: 5432,
      database: "postgres",
      username: "waffle",
      password: "",
      sslEnabled: false,
    });
    expect(createWorkspaceDataSource).not.toHaveBeenCalled();
  });

  it("surfaces the server's reason when the test connection fails", async () => {
    // A failed probe is a 200 with `success: false`, not a throw — so the
    // reason only reaches the user if the dialog reads `result.error`. Without
    // this the whole point of testing before saving is lost: the user learns
    // it failed but not that the host is refusing connections.
    testWorkspaceDataSourceConfig.mockResolvedValue({
      success: false,
      error: "connect ECONNREFUSED",
    });

    renderDialog();
    const user = await fillRequiredFields();

    await user.click(screen.getByRole("button", { name: /test connection/i }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Connection failed: connect ECONNREFUSED",
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(createWorkspaceDataSource).not.toHaveBeenCalled();
  });

  it("creates once when a test is followed by a save", async () => {
    renderDialog();
    const user = await fillRequiredFields();
    await user.type(screen.getByLabelText("Name"), "analytics");

    await user.click(screen.getByRole("button", { name: /test connection/i }));
    await waitFor(() =>
      expect(testWorkspaceDataSourceConfig).toHaveBeenCalledTimes(1),
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(createWorkspaceDataSource).toHaveBeenCalledTimes(1),
    );
  });

  it("keeps repeated tests free of any create call", async () => {
    renderDialog();
    const user = await fillRequiredFields();
    const testButton = screen.getByRole("button", { name: /test connection/i });

    await user.click(testButton);
    await waitFor(() =>
      expect(testWorkspaceDataSourceConfig).toHaveBeenCalledTimes(1),
    );
    await user.click(testButton);
    await waitFor(() =>
      expect(testWorkspaceDataSourceConfig).toHaveBeenCalledTimes(2),
    );

    expect(createWorkspaceDataSource).not.toHaveBeenCalled();
  });
});
